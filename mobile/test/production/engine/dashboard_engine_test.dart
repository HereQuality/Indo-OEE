// Golden tests for lib/features/production/dashboard/dashboard_engine.dart.
//
// The fixtures under fixtures/ are produced by tool/golden_entry.js, which runs
// the REAL client/src/utils/processDashboard.js (bundled with esbuild) over a
// deterministic input set — see the header of that file to regenerate them.
// Every assertion here is "Dart == JS": numbers to 1e-9, NaN == NaN, null == null.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart';

late Map<String, dynamic> golden;

typedef Json = Map<String, dynamic>;

Map<String, dynamic> _load(String name) => jsonDecode(File('test/production/engine/fixtures/$name').readAsStringSync()) as Map<String, dynamic>;

// ── comparison ─────────────────────────────────────────────────────────────
final _specials = <String, double>{'__NaN__': double.nan, '__Infinity__': double.infinity, '__-Infinity__': double.negativeInfinity};

Object? decodeIn(Object? v) => v == '__undefined__' ? null : (v is String && _specials.containsKey(v)) ? _specials[v] : v;

void cmp(Object? actual, Object? expected, String path, List<String> errs) {
  if (errs.length >= 25) return;
  void fail(String msg) => errs.add('$path: $msg');
  if (expected is String && _specials.containsKey(expected)) {
    final want = _specials[expected]!;
    if (actual is! num) return fail('expected $expected got $actual');
    if (want.isNaN ? !actual.isNaN : actual != want) fail('expected $expected got $actual');
    return;
  }
  if (expected == null) {
    if (actual != null) fail('expected null got $actual (${actual.runtimeType})');
    return;
  }
  if (expected is num) {
    if (actual is! num) return fail('expected $expected got $actual (${actual.runtimeType})');
    if (actual.isNaN || actual.isInfinite) return fail('expected $expected got $actual');
    final diff = (actual - expected).abs();
    if (diff > 1e-9 && diff > 1e-12 * expected.abs()) fail('expected $expected got $actual');
    return;
  }
  if (expected is String || expected is bool) {
    if (actual != expected) fail('expected "$expected" got "$actual"');
    return;
  }
  if (expected is List) {
    if (actual is! List) return fail('expected a list got ${actual.runtimeType}');
    if (actual.length != expected.length) return fail('expected ${expected.length} items got ${actual.length}');
    for (var i = 0; i < expected.length; i++) {
      cmp(actual[i], expected[i], '$path[$i]', errs);
    }
    return;
  }
  if (expected is Map) {
    if (actual is! Map) return fail('expected a map got ${actual.runtimeType}');
    for (final k in expected.keys) {
      cmp(actual[k], expected[k], '$path.$k', errs);
    }
    for (final k in actual.keys) {
      if (!expected.containsKey(k) && actual[k] != null) fail('unexpected key "$k" = ${actual[k]}');
    }
    return;
  }
  fail('unhandled fixture value $expected');
}

void expectGolden(Object? actual, Object? expected, String what) {
  final errs = <String>[];
  cmp(actual, expected, what, errs);
  expect(errs, isEmpty, reason: errs.join('\n'));
}

List<Map<String, dynamic>> rowsOf(Json sc) => (sc['rows'] as List).cast<Map<String, dynamic>>();

DashboardCtx ctxOf(Json sc) {
  final c = sc['ctx'] as Map<String, dynamic>;
  return DashboardCtx(
    machineName: (c['machineName'] as Map).map((k, v) => MapEntry('$k', '$v')),
    machineOrder: (c['machineOrder'] as Map).map((k, v) => MapEntry('$k', (v as num).toInt())),
    bucket: c['bucket'] as String,
  );
}

Map<String, List<String>> filtersOf(Object? raw) => (raw as Map).map((k, v) => MapEntry('$k', (v as List).cast<String>()));

List<int> idx(List<Map<String, dynamic>> rows, Iterable<Map<String, dynamic>> subset) => [for (final r in subset) rows.indexWhere((x) => identical(x, r))];

void main() {
  setUpAll(() {
    golden = _load('engine_golden_en_US.json');
    engineNumberLocale = 'en-US';
  });
  tearDown(() {
    engineClock = DateTime.now;
    engineNumberLocale = 'en-US';
  });

  group('scenarios (rows -> figures)', () {
    late Map<String, dynamic> scenarios;
    setUpAll(() => scenarios = golden['scenarios'] as Map<String, dynamic>);

    test('the fixture covers the intended scenarios', () {
      expect(scenarios.keys, containsAll(['plant', 'long', 'legacy', 'empty', 'single', 'blank', 'dates62', 'dates63', 'dates62dup', 'weird']));
      expect(rowsOf(scenarios['plant']).length, greaterThan(150));
    });

    for (final name in ['plant', 'long', 'legacy', 'empty', 'single', 'blank', 'dates62', 'dates63', 'dates62dup', 'weird']) {
      group(name, () {
        late Json sc;
        late List<Map<String, dynamic>> rows;
        late DashboardCtx ctx;
        setUpAll(() {
          sc = golden['scenarios'][name] as Json;
          rows = rowsOf(sc);
          ctx = ctxOf(sc);
        });

        test('timeBucket', () => expect(timeBucket(rows), sc['bucket']));

        test('calcOf equals rowCalc per row and is cached per row identity', () {
          expectGolden([for (final r in rows) calcOf(r)], sc['calc'], 'calc');
          for (final r in rows) {
            expect(identical(calcOf(r), calcOf(r)), isTrue);
          }
        });

        test('summarize', () => expectGolden(summarize(rows), sc['summary'], 'summary'));

        test('dimensions: label, value, text, groupRows and summarizeBy', () {
          final dims = sc['dims'] as Map<String, dynamic>;
          expect(dimensions.keys.toList(), dims.keys.toList());
          for (final dim in dimensions.keys) {
            final want = dims[dim] as Map<String, dynamic>;
            final d = dimensions[dim]!;
            expect(d.key, dim);
            expect(d.label, want['label']);
            expect([for (final r in rows) d.value(r)], want['values'], reason: '$dim values');
            expect([for (final r in rows) d.text(d.value(r), ctx)], want['texts'], reason: '$dim texts');
            expectGolden([for (final e in groupRows(rows, dim).entries) [e.key, idx(rows, e.value)]], want['groups'], 'groups[$dim]');
            expectGolden(summarizeBy(rows, dim, ctx), want['by'], 'by[$dim]');
          }
        });

        test('hasFilters / applyFilters (with and without except)', () {
          for (final (i, f) in (sc['filters'] as List).indexed) {
            final want = f as Map<String, dynamic>;
            final filters = filtersOf(want['filters']);
            expect(hasFilters(filters), want['has'], reason: 'has #$i');
            final applied = applyFilters(rows, filters);
            expect(idx(rows, applied), want['applied'], reason: 'applied #$i ${want['filters']}');
            expect(identical(applied, rows), want['sameRef'], reason: 'sameRef #$i');
            for (final dim in dimensions.keys) {
              expect(idx(rows, applyFilters(rows, filters, dim)), (want['except'] as Map)[dim], reason: 'except $dim #$i ${want['filters']}');
            }
          }
        });

        test('measures (stat / cause / reason) read the summary like the JS getters', () {
          final want = (sc['measures'] as List).cast<Map<String, dynamic>>();
          final full = summarize(rows);
          final sub = summarize(applyFilters(rows, filtersOf((sc['filters'] as List)[3]['filters'])));
          for (final (i, s) in [full, sub].indexed) {
            final stats = <Map<String, dynamic>>[
              for (final st in statCatalog)
                () {
                  final m = statMeasure(st);
                  final v = measureValue(m, s);
                  return {'key': m['key'], 'label': m['label'], 'format': m['format'], 'value': v, 'formatted': formats[m['format']]!(v), 'exact': formatExact(m['format'] as String, v)};
                }(),
            ];
            expectGolden(stats, want[i]['stats'], 'stats#$i');
            final causeKeys = [for (final g in stoppageGroups) ...(g['fields'] as List).cast<String>(), 'nope'];
            expectGolden([for (final k in causeKeys) _measureRow(causeMeasure(k), s)], want[i]['causes'], 'causes#$i');
            const reasons = ['Dimension Out', 'Tool Mark', 'Surface Finish', 'Porosity / Blow Hole', 'Material Defect', 'Setting Mistake', 'Operator Mistake', 'Machine Fault', 'Other', 'Weird', '5', 'nope'];
            expectGolden([for (final k in reasons) _measureRow(reasonMeasure(k), s)], want[i]['reasons'], 'reasons#$i');
          }
        });
      });
    }
  });

  test('toggleFilter', () {
    var f = newEmptyFilters();
    for (final t in (golden['toggles'] as List).cast<Map<String, dynamic>>()) {
      if (t['dim'] == 'brandNew') {
        expect(toggleFilter(emptyFilters, 'brandNew', 'x'), filtersOf(t['result']));
        continue;
      }
      final before = {for (final e in f.entries) e.key: [...e.value]};
      f = toggleFilter(f, t['dim'] as String, t['value'] as String);
      expect(f, filtersOf(t['result']));
      // The old map is left alone.
      expect(before, isNot(same(f)));
    }
  });

  test('compareMachines orders by sheet position, then natural name', () {
    final c = golden['compare'] as Map<String, dynamic>;
    final m = c['ctx'] as Map<String, dynamic>;
    final ctx = DashboardCtx(
      machineName: (m['machineName'] as Map).map((k, v) => MapEntry('$k', '$v')),
      machineOrder: (m['machineOrder'] as Map).map((k, v) => MapEntry('$k', (v as num).toInt())),
      bucket: 'date',
    );
    final names = (m['machineName'] as Map).map((k, v) => MapEntry('$k', '$v'));
    final items = <Map<String, dynamic>>[
      for (final k in names.keys) {'key': k, 'label': 'lbl-${names[k]}'},
      ...[
        {'key': 'gone1', 'label': 'Zed'},
        {'key': 'gone2', 'label': 'alpha 10'},
        {'key': 'gone3', 'label': 'alpha 9'},
        {'key': 'gone4', 'label': ''},
      ],
    ];
    List<String> order(List<Map<String, dynamic>> list, int Function(Map<String, dynamic>, Map<String, dynamic>) by, String key) =>
        [for (final i in sortedStable(list, by)) i[key] as String];
    expect(order(items, compareMachines(ctx), 'key'), c['itemsByKey']);
    final options = [for (final i in items) <String, dynamic>{'value': i['key'], 'label': i['label']}];
    expect(order(options, compareMachines(ctx, (o) => o['value'] as String?), 'value'), c['itemsByValue']);
    expect(order(items, compareMachines(null), 'key'), c['noCtx']);
    expect(order(items, compareMachines(const DashboardCtx(machineName: {}, machineOrder: {}, bucket: 'date')), 'key'), c['emptyCtx']);
  });

  test('naturalCompare == localeCompare(numeric) across the whole string battery', () {
    final n = golden['natural'] as Map<String, dynamic>;
    final strings = (n['strings'] as List).cast<String>();
    final matrix = (n['matrix'] as List).cast<String>();
    final wrong = <String>[];
    for (var i = 0; i < strings.length; i++) {
      for (var j = 0; j < strings.length; j++) {
        final got = naturalCompare(strings[i], strings[j]);
        final want = matrix[i][j] == '<' ? -1 : (matrix[i][j] == '>' ? 1 : 0);
        if (got.sign != want) wrong.add('"${strings[i]}" vs "${strings[j]}": want $want got $got');
      }
    }
    expect(wrong.length, 0, reason: '${wrong.length} mismatches, first:\n${wrong.take(40).join('\n')}');
  });

  group('formats', () {
    void checkFormats(Map<String, dynamic> formatsFixture, String locale) {
      engineNumberLocale = locale;
      final inputs = (formatsFixture['inputs'] as List).map(decodeIn).toList();
      final results = formatsFixture['results'] as Map<String, dynamic>;
      expect(formats.keys.toList(), results.keys.toList());
      final wrong = <String>[];
      for (final f in results.keys) {
        final r = results[f] as Map<String, dynamic>;
        for (var i = 0; i < inputs.length; i++) {
          final v = inputs[i] as num?;
          final got = formats[f]!(v);
          if (got != r['formatted'][i]) wrong.add('$locale $f(${formatsFixture['inputs'][i]}): want "${r['formatted'][i]}" got "$got"');
          final ex = formatExact(f, v);
          if (ex != r['exact'][i]) wrong.add('$locale formatExact($f, ${formatsFixture['inputs'][i]}): want "${r['exact'][i]}" got "$ex"');
        }
      }
      expect(wrong, isEmpty, reason: wrong.take(40).join('\n'));
    }

    test('en-US (K / M / B / T)', () {
      expect((golden['formats'] as Map)['locale'], 'en-US');
      checkFormats(golden['formats'] as Map<String, dynamic>, 'en-US');
    });

    test('en-IN (K / L / Cr / KCr / LCr)', () {
      final f = _load('engine_golden_en_IN_formats.json')['formats'] as Map<String, dynamic>;
      expect(f['locale'], 'en-IN');
      checkFormats(f, 'en-IN');
    });

    test('a device locale outside India reads en-US, an Indian tag reads lakh/crore', () {
      engineNumberLocale = 'hi_IN';
      expect(formats['qty']!(1234567), '12.35L');
      engineNumberLocale = 'de-DE';
      expect(formats['qty']!(1234567), '1.23M');
      engineNumberLocale = null; // device locale (flutter_test reports en-US)
      expect(formats['qty']!(1234567), '1.23M');
    });

    test('unknown format names fail loudly', () {
      expect(() => formatExact('nope', 1), throwsArgumentError);
    });
  });

  group('catalogs', () {
    late Map<String, dynamic> cat;
    setUpAll(() => cat = golden['catalogs'] as Map<String, dynamic>);

    test('STAT_CATALOG / CHART_CATALOG / defaults / stoppage groups are identical', () {
      expectGolden(statCatalog, cat['STAT_CATALOG'], 'statCatalog');
      expectGolden(chartCatalog, cat['CHART_CATALOG'], 'chartCatalog');
      expect(defaultStats, cat['DEFAULT_STATS']);
      expect(defaultCharts, cat['DEFAULT_CHARTS']);
      expectGolden(stoppageGroups, cat['STOPPAGE_GROUPS'], 'stoppageGroups');
      expectGolden(emptyFilters, cat['EMPTY_FILTERS'], 'emptyFilters');
      expect(newEmptyFilters(), emptyFilters);
      expect(monthLabels, cat['MONTH_LABELS']);
      expect(maxRangeDays, cat['MAX_RANGE_DAYS']);
      expect(defaultRangeKey, cat['DEFAULT_RANGE_KEY']);
    });

    test('lookups, dimension labels and quick-range keys', () {
      expect(statsByKey.keys.toList(), cat['statKeys']);
      expect(chartsByKey.keys.toList(), cat['chartKeys']);
      expect(identical(statsByKey['okQty'], statCatalog[1]), isTrue);
      expect(dimensions.keys.toList(), cat['dimensionKeys']);
      expect({for (final e in dimensions.entries) e.key: e.value.label}, cat['dimensionLabels']);
      expect([for (final q in quickRanges) [q.key, q.label]], cat['quickKeys']);
    });

    test('every chart measure is a tile, except the unreported-time chart', () {
      for (final c in chartCatalog) {
        final m = c['measure'];
        if (m == null) continue;
        expect(statsByKey.containsKey(m), m != 'unreportedMin', reason: '${c['key']} -> $m');
      }
    });

    test('causeLabel and monthLabel', () {
      expect([for (final p in cat['causeLabels']) [p[0], causeLabel(p[0] as String)]], cat['causeLabels']);
      expect([for (final p in cat['monthLabels']) [p[0], monthLabel(p[0] as String)]], cat['monthLabels']);
    });

    test('dimension texts', () {
      final texts = cat['dimTexts'] as Map<String, dynamic>;
      final ctx = DashboardCtx(machineName: const {'m1': 'MC 10', 'm2': 'MC 2', 'm3': '7A', 'm4': '7B', 'm5': 'MC 1', 'm6': 'cnc 3', 'm7': 'MC 2', 'm8': ''}, machineOrder: const {}, bucket: 'date');
      for (final dim in texts.keys) {
        for (final p in texts[dim] as List) {
          expect(dimensions[dim]!.text(p[0] as String, ctx), p[1], reason: '$dim ${p[0]}');
        }
      }
      // ctx-less text of the non-machine dimensions.
      expect(dimensions['operator']!.text(''), '(no operator)');
      expect(dimensions['month']!.text('2026-09'), 'Sep 2026');
    });

    test('resolveWidgets', () {
      for (final c in (cat['resolve'] as List).cast<Map<String, dynamic>>()) {
        final saved = decodeIn(c['saved']);
        final label = c['name'];
        expect([for (final w in resolveWidgets(saved, statsByKey, defaultStats)) w['key']], c['stats'], reason: '$label stats');
        expect([for (final w in resolveWidgets(saved, chartsByKey, defaultCharts)) w['key']], c['charts'], reason: '$label charts');
      }
    });
  });

  group('period helpers', () {
    test('every quick range, default ranges, quickRangeKey, describeRange and yearsOfExtent on 12 pinned days', () {
      final period = (golden['period'] as List).cast<Map<String, dynamic>>();
      for (final p in period) {
        final n = (p['now'] as List).cast<int>();
        engineClock = () => DateTime(n[0], n[1], n[2], n[3], n[4]);
        final at = 'now=${n.join('-')}';
        expectGolden({for (final q in quickRanges) q.key: q.range()}, p['quick'], 'quick $at');
        expectGolden(defaultRange(), p['defaultRange'], 'defaultRange $at');
        expectGolden(defaultEntryRange(), p['defaultEntryRange'], 'defaultEntryRange $at');
        for (final (i, pair) in (p['quickKeys'] as List).indexed) {
          expect(quickRangeKey((pair[0] as List).cast<String>()), pair[1], reason: 'quickRangeKey #$i $at');
        }
        const extents = <Map<String, dynamic>?>[
          null,
          {'from': '2026-01-05', 'to': '2026-09-25'},
          {'from': '2023-02-01', 'to': '2025-12-31'},
          {'from': '2026-09-01', 'to': '2026-09-01'},
          {'from': '2020-01-01', 'to': '2030-06-01'},
          {'from': '2027-01-01', 'to': '2028-01-01'},
          {'from': '1999-12-31', 'to': '2026-01-01'},
        ];
        expectGolden([for (final e in extents) yearsOfExtent(e)], p['years'], 'years $at');
        const describe = <List<String>>[
          ['2025-01-01', '2025-12-31'], ['2026-09-01', '2026-09-30'], ['2024-02-01', '2024-02-29'], ['2023-02-01', '2023-02-28'],
          ['2026-09-05', '2026-09-05'], ['2026-09-05', '2026-09-06'], ['2026-08-15', '2026-09-14'], ['2026-01-01', '2026-06-30'],
          ['2026-01-01', '2027-12-31'], ['2026-02-01', '2026-02-29'], ['', ''], ['2026-09-01', ''], ['', '2026-09-30'],
          ['2026-12-01', '2026-12-31'], ['2026-01-01', '2026-01-31'], ['2026-09-30', '2026-09-01'], ['2026-09-01', '2026-09-31'],
        ];
        final actual = [for (final r in describe) describeRange(r), for (final q in quickRanges) describeRange(q.range())];
        expectGolden(actual, p['describe'], 'describe $at');
      }
    });

    test('isoDate / parseIsoDate / monthRange / yearRange / rangeDays', () {
      final sp = golden['staticPeriod'] as Map<String, dynamic>;
      for (final p in sp['isoDate'] as List) {
        final c = (p[0] as List).cast<int>();
        expect(isoDate(DateTime(c[0], c[1], c[2], c[3])), p[1]);
      }
      for (final p in sp['parse'] as List) {
        final d = parseIsoDate(p[0] as String);
        expect([d.year, d.month, d.day, d.hour, d.minute], p[1], reason: 'parse ${p[0]}');
      }
      for (final p in sp['monthRange'] as List) {
        expect(monthRange(p[0] as String), p[1], reason: 'monthRange ${p[0]}');
      }
      for (final p in sp['yearRange'] as List) {
        expect(yearRange(p[0] as int), p[1]);
      }
      for (final p in sp['rangeDays'] as List) {
        expect(rangeDays((p[0] as List).cast<String>()), p[1], reason: 'rangeDays ${p[0]}');
      }
    });

    test('dates are local calendar days: isoDate never shifts through UTC', () {
      expect(isoDate(DateTime(2026, 9, 5, 0, 0)), '2026-09-05');
      expect(isoDate(DateTime(2026, 9, 5, 23, 59, 59)), '2026-09-05');
      expect(isoDate(parseIsoDate('2026-09-05')), '2026-09-05');
    });

    test('unparsable dates are a FormatException, not a crash deeper down', () {
      expect(() => parseIsoDate('nope'), throwsFormatException);
      expect(() => parseIsoDate('2026-xx-01'), throwsFormatException);
      expect(() => monthRange('2026'), throwsFormatException);
      expect(describeRange(['abc', 'def']), 'undefined/undefined/abc to undefined/undefined/def');
    });
  });

  group('helpers', () {
    test('stableSort keeps the order of ties (JS Array.sort is stable)', () {
      final items = [for (var i = 0; i < 200; i++) <String, int>{'k': i % 3, 'i': i}];
      final sorted = sortedStable(items, (a, b) => a['k']!.compareTo(b['k']!));
      for (var i = 1; i < sorted.length; i++) {
        final a = sorted[i - 1], b = sorted[i];
        expect(a['k']! < b['k']! || (a['k']! == b['k']! && a['i']! < b['i']!), isTrue);
      }
      final inPlace = [...items];
      stableSort(inPlace, (a, b) => b['k']!.compareTo(a['k']!));
      expect(inPlace.first['k'], 2);
      expect(inPlace.first['i'], 2);
    });

    test('measureValue accepts a hand-made measure', () {
      final m = <String, dynamic>{'key': 'x', 'label': 'x', 'format': 'qty', 'get': (Map<String, dynamic> s) => s['totalQty']};
      expect(measureValue(m, {'totalQty': 5.0}), 5.0);
      expect(measureValue(statMeasure(statsByKey['okPct']!), {'okPct': null}), isNull);
    });

    test('summarize keeps its documented shape (all numbers are doubles)', () {
      final s = summarize([
        {'_id': '1', 'machine': 'm1', 'date': '2026-09-01', 'itemName': 'A', 'totalCycleSec': 60, 'machineOnTime': '06:00', 'machineOffTime': '14:00', 'okQty': 100, 'actualQty': 110, 'rejectBreakdown': {'Tool Mark': 10}},
      ]);
      for (final k in ['totalQty', 'okQty', 'rejectedQty', 'idealQty', 'shiftHours', 'effectiveHours', 'plannedShiftHours', 'downtimeMin', 'unreportedMin', 'unutilizedDays', 'entries', 'machineDays']) {
        expect(s[k], isA<double>(), reason: k);
      }
      expect(s['entries'], 1.0);
      expect(s['machineDays'], 1.0);
      expect(s['downtimeByCause'], isA<Map<String, double>>());
      expect(s['rejectByReason'], {'Tool Mark': 10.0});
      expect((s['downtimeByCause'] as Map).keys, hasLength(10));
    });

    test('rejectByReason falls back to the single reason, then "Not specified"', () {
      Json row(Json extra) => {'_id': 'x', 'machine': 'm', 'date': '2026-09-01', 'okQty': 90, 'actualQty': 100, ...extra};
      expect(summarize([row({'rejectReason': 'Tool Mark'})])['rejectByReason'], {'Tool Mark': 10.0});
      expect(summarize([row({})])['rejectByReason'], {'Not specified': 10.0});
      expect(summarize([row({'rejectBreakdown': {'Tool Mark': 4, 'Other': '6', 'Zero': 0}})])['rejectByReason'], {'Tool Mark': 4.0, 'Other': 6.0});
      // Integer-like reasons enumerate first, ascending — like a JS object.
      expect((summarize([row({'rejectBreakdown': {'b': 1, '10': 1, '2': 1}})])['rejectByReason'] as Map).keys.toList(), ['2', '10', 'b']);
    });

    test('JS Number() semantics on stored values: blanks, numeric strings, junk', () {
      Json row(Object? ok) => {'_id': 'x', 'machine': 'm', 'date': '2026-09-01', 'okQty': ok};
      expect(summarize([row(' 12 ')])['okQty'], 12.0);
      expect(summarize([row('0x10')])['okQty'], 16.0);
      expect(summarize([row('1e2')])['okQty'], 100.0);
      expect(summarize([row('abc')])['okQty'], 0.0);
      expect(summarize([row(null)])['okQty'], 0.0);
      expect(summarize([row('')])['okQty'], 0.0);
      expect(summarize([row(true)])['okQty'], 1.0);
    });

    test('empty input summarises to zeros and nulls', () {
      final s = summarize(const []);
      expect(s['totalQty'], 0.0);
      expect(s['okPct'], isNull);
      expect(s['oeeLosses'], isNull);
      expect(s['entries'], 0.0);
      expect(summarizeBy(const [], 'machine', const DashboardCtx(machineName: {}, machineOrder: {}, bucket: 'date')), isEmpty);
      expect(timeBucket(const []), 'date');
    });

    test('unknown dimensions are an ArgumentError', () {
      expect(() => groupRows(const [], 'nope'), throwsArgumentError);
      expect(() => applyFilters([{}], {'nope': ['x']}), throwsArgumentError);
    });
  });
}

Map<String, dynamic> _measureRow(Map<String, dynamic> m, Map<String, dynamic> s) => {'key': m['key'], 'label': m['label'], 'format': m['format'], 'value': measureValue(m, s)};
