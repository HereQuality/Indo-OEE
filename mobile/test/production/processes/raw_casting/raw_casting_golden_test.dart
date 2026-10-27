import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/processes/raw_casting/raw_casting_calc.dart';
import 'package:indo/features/production/processes/raw_casting/raw_casting_spec.dart';
import 'package:indo/features/production/processes/raw_casting/raw_casting_validation.dart';
import 'package:indo/features/production/processes/raw_casting/raw_casting_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice, workerWords;
import 'package:indo/features/production/shared/production_entry_validation.dart' show slotsFullErrors;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS (utils/rawCastingSheet.js,
/// rawCastingValidation.js, the page's pure handlers, rawCastingColumns.jsx and
/// processDashboard.js), over fixtures written by tool/gen_raw_casting_golden.mjs.
final dir = Platform.environment['RAW_CASTING_FIXTURE_DIR'] ?? 'test/production/processes/raw_casting/fixtures';

const spec = rawCastingSpec;

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];
Map<String, String> strings(Object? v) => Map<String, String>.from((v as Map).map((k, x) => MapEntry('$k', '$x')));
Object? asText(Object? v) => v is num ? jsNumStr(v) : v;

void main() {
  group('rawCastingRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(rawCastingRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('Ideal is not rounded down and Effective counts every piece; OK = TOTAL − defects', () {
      final c = rawCastingRowCalc({
        'itemName': 'X', 'machineOnTime': '08:15', 'machineOffTime': '16:00', 'totalCycleSec': 32, 'actualQty': 799,
        'rejectBreakdown': {'Blow Holes Casting': 20, 'Crack/Damage Casting': 20},
      });
      expect(c['idealQty'], closeTo(871.875, 1e-9));
      expect(c['idealQtyFloor'], 871);
      expect(c['effectiveHours'], closeTo(799 * 32 / 3600, 1e-9));
      expect(c['totalDefect'], 40);
      expect(c['okQty'], 759);
    });
  });

  group('helpers and lists match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isStatusOnly / defectTotal over ${(f['rows'] as List).length} rows', () {
      for (final c in f['rows'] as List) {
        final row = m(c['row']);
        expect(rawCastingIsStatusOnly(row), c['statusOnly'], reason: showCase(row));
        expect(diff(rawCastingDefectTotal(row), c['defectTotal']), isNull, reason: showCase(row));
      }
    });

    test('defects, idle fields, the day\'s entry limit, statuses and words are the web\'s', () {
      expect(rawCastingDefects, f['defects']);
      expect([for (final (k, l) in rawCastingIdleFields) {'key': k, 'label': l}], f['idleFields']);
      expect(rawCastingMaxEntriesPerDay, f['maxEntriesPerDay']);
      expect(spec.maxEntriesPerDay, f['maxEntriesPerDay']);
      expect(rawCastingNonWorkingStatuses, f['nonWorking']);
      final w = f['words'] as Map;
      expect([workerWords.who, workerWords.canMake, workerWords.shift], [w['who'], w['canMake'], w['shift']]);
    });

    test('isRawCastingProcess', () {
      for (final c in f['processes'] as List) {
        expect(isRawCastingProcess(m(c['process'])), c['isRaw'], reason: '${c['process']}');
      }
    });

    test('every formula text is the web\'s for the keys it words itself', () {
      final formulas = loadFixture('formulas.json', dir: dir) as Map;
      for (final k in rawCastingFormulas.keys) {
        expect(formulas[k], rawCastingFormulas[k], reason: k);
      }
      for (final k in ['shift', 'cycle', 'idealQty', 'idealQtyPerHour', 'totalDefect', 'okQty', 'totalStoppage', 'effective', 'unreported', 'productivity', 'productivityLunch', 'quality', 'availability', 'performance']) {
        expect(rawCastingFormulas[k], formulas[k], reason: k);
      }
    });
  });

  group('rawCastingDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} worker-days — each entry its own, combined once on the lock', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final sorted = sortByMachineOn([for (final r in c['rows'] as List) r == null ? null : m(r)]);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(rawCastingDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
        expect(diff(spec.dayCalc(sorted), c['out']), isNull, reason: 'spec $i');
      }
    });
  });

  group('validateRawCastingEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('${cases.length} blocks', () {
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : m(c['saved']);
        final actual = spec.validateEntry(m(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(rawCastingFieldOrder, f['order']);
      expect(spec.fieldOrder, f['order']);
      expect(rawCastingMinuteKeys, f['minuteKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = spec.firstError(list);
        final web = c['first'];
        if (web == null) {
          expect(dart, isNull, reason: '${c['errors']}');
        } else {
          expect({'index': dart?['index'], 'field': dart?['field']}, {'index': web['index'], 'field': web['field']}, reason: '${c['errors']}');
        }
      }
    });
  });

  group('values and payload match the page', () {
    test('toPayload is the web body (worker for machine, the defects split, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      var withSplit = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = rawCastingToPayload(m(c['values']), isEdit: c['isEdit'] as bool, processId: c['processId']);
        if (((c['payload'] as Map)['rejectBreakdown'] as Map?)?.isNotEmpty ?? false) withSplit++;
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
      }
      expect(withSplit, greaterThan(50));
    });

    test('the spec sends the page\'s process last', () {
      final body = spec.finishPayload(spec.toPayload(spec.emptyEntry(), isEdit: false), process: {'_id': 'p9'});
      expect(body['process'], 'p9');
      expect(body['slot'], 'auto');
      expect(body.containsKey('machine'), isFalse);
      expect(body.containsKey('worker'), isTrue);
      expect(body.containsKey('okQty'), isFalse);
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...rawCastingNumberFields, ...rawCastingTextFields, ...rawCastingTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = spec.toFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = m(c['out']);
        for (final k in typed) {
          expected[k] = asText(expected[k]);
        }
        expect(diff(actual, expected), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('hasAnyEntryData and the block tint follow the web', () {
      final cases = loadFixture('has_data.json', dir: dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        if (c.containsKey('list')) {
          expect(spec.hasAnyEntryData(rows(c['list'])), c['anyData'], reason: 'list $i');
          continue;
        }
        final v = m(c['values']);
        expect(spec.entryHasData(v), c['blockHasData'], reason: 'block $i ${showCase(v)}');
        expect(spec.hasAnyEntryData([v]), c['anyData'], reason: 'any $i ${showCase(v)}');
      }
    });

    test('picking an item copies its Standard Inspection Time', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = spec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        expected['totalCycleSec'] = asText(expected['totalCycleSec']);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block, draft merge and a defect box change', () {
      final now = DateTime(2026, 10, 27);
      final e = spec.emptyEntry(now: now);
      expect(e['date'], '2026-10-27');
      expect(e['rejectBreakdown'], <String, dynamic>{});
      for (final k in [...rawCastingNumberFields, ...rawCastingTextFields, ...rawCastingTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(spec.newBlockAfter([{...e, 'date': '2026-10-20'}], now: now)['date'], '2026-10-20');
      expect(spec.mergeDraftEntry({'machine': 'w1'}, now: now)['challanNo'], '');
      final changed = spec.applyRejectChange({...e, 'rejectBreakdown': {'Other': '1'}}, 'Blow Holes Casting', '2');
      expect(changed['rejectBreakdown'], {'Other': '1', 'Blow Holes Casting': '2'});
    });
  });

  group('popups and the entries-a-day rule', () {
    Object? enc(EntryNotice n) => [
          n.message,
          {
            'title': n.title,
            'details': [for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true}],
            'hint': n.hint,
          },
        ];

    test('Save on an incomplete entry: no quantity popup, the worker\'s words', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final out = spec.firstOverLimit(rows(c['blocks']), [for (final e in c['errors'] as List) strings(e)], machineNames: strings(c['machineName']));
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out!.index, e['index'], reason: ctx);
        expect(out.field, 'stoppageTotal', reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(enc(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(hits, greaterThan(20));
    });

    test('$rawCastingMaxEntriesPerDay entries a day, the worker named; no overlap rule', () {
      expect(spec.checksTimeOverlap, isFalse);
      var fulls = 0;
      for (final c in loadFixture('time_rules.json', dir: dir) as List) {
        final names = strings(c['names']);
        final full = slotsFullErrors(
          rows(c['entries']),
          {for (final e in (c['occupied'] as Map).entries) '${e.key}': rows(e.value)},
          editSlot: (c['editSlot'] as num?)?.toInt(),
          saved: c['saved'] == null ? null : m(c['saved']),
          max: spec.maxEntriesPerDay!,
          who: (id) => names[id] ?? 'This ${spec.machineNoun}',
        );
        fulls += full.where((e) => e.isNotEmpty).length;
        expect(diff(full, c['full']), isNull, reason: showCase(c));
      }
      expect(fulls, greaterThan(10));
    });
  });

  group('the table matches rawCastingColumns.jsx', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final cols = spec.columns({'defects', 'idle'}).where(const SheetEnv(showVendor: true));
    final all = [...cols.left, ...cols.middle];

    test('the same columns, in the same order and words', () {
      final web = <Map<String, String>>[];
      for (final c in f['columns'] as List) {
        web.add({'key': '${c['summaryKey'] ?? c['key']}', 'label': '${c['label']}'});
        for (final s in (c['subs'] as List?) ?? const []) {
          web.add({'key': '${s['key']}', 'label': '${s['label']}'});
        }
      }
      // The web's Date/Worker/… keys: 'cycle' etc. are the same on both sides.
      expect([for (final c in all) {'key': c.key, 'label': c.label}], web);
      expect(spec.columns(const {}).where(const SheetEnv(showVendor: false)).middle.any((c) => c.key == 'vendorName'), isFalse);
      expect([for (final c in cols.left) c.key], ['date', 'machine']);
    });

    test('every cell reads as the web\'s (${(f['cases'] as List).length} rows)', () {
      var checked = 0;
      for (final c in f['cases'] as List) {
        final row = m(c['row']);
        final data = CellData(row: row, calc: spec.rowCalc(row), day: m(c['day']), machineName: (c['machineName'] as String?) ?? '—');
        final web = Map<String, String>.from(c['cells'] as Map);
        for (final col in all) {
          if (col.key == 'remarks') {
            expect(web['remarks'] == '—', c['generalRemark'] == false, reason: showCase(row));
            continue;
          }
          expect(col.text(data), web[col.key], reason: '${col.key} ${showCase(row)}');
          checked++;
        }
      }
      expect(checked, greaterThan(5000));
    });
  });

  group('the dashboard matches the web', () {
    final f = loadFixture('dashboard.json', dir: dir) as Map;
    test('worker process and stoppage keys', () {
      for (final c in f['processes'] as List) {
        final p = m(c['process']);
        expect(eng.isWorkerProcess(p), c['worker'], reason: '$p');
        expect(eng.stoppageKeysFor(p), c['stoppageKeys'], reason: '$p');
      }
    });

    test('summarize over the server feed: each entry its own productivity', () {
      final cases = loadFixture('summary.json', dir: dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final rowsIn = [
          for (final r in c['rows'] as List) {for (final e in m(r).entries) e.key: e.value is int ? (e.value as int).toDouble() : e.value},
        ];
        expect(diff(eng.summarize(rowsIn), c['out']), isNull, reason: 'case $i');
      }
    });
  });
}
