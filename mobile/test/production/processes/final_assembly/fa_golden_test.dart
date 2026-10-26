import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/processes/final_assembly/fa_calc.dart';
import 'package:indo/features/production/processes/final_assembly/fa_validation.dart';
import 'package:indo/features/production/processes/final_assembly/fa_values.dart';
import 'package:indo/features/production/processes/final_assembly/final_assembly_spec.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice, faWords, stoppageNotice;
import 'package:indo/features/production/shared/production_entry_validation.dart' show slotsFullErrors;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the FINAL ASSEMBLY port with the REAL web JS (utils/finalAssemblySheet.js,
/// finalAssemblyValidation.js, the page's pure handlers, limitNotice.js,
/// slotsFullErrors, finalAssemblyColumns.jsx rendered to text and the dashboard
/// engine), over fixtures written by tool/gen_fa_golden.mjs.
final dir = Platform.environment['FA_FIXTURE_DIR'] ?? 'test/production/processes/final_assembly/fixtures';

const spec = finalAssemblySpec;

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

Object? encNotice(EntryNotice n) => [
      n.message,
      {
        'title': n.title,
        'details': [
          for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
        ],
        'hint': n.hint,
      },
    ];

/// The web keeps a stored number as a number in the form; the app keeps text.
Map<String, dynamic> asText(Map<String, dynamic> expected, Iterable<String> typed) {
  for (final k in typed) {
    final v = expected[k];
    if (v is num) expected[k] = jsNumStr(v);
  }
  final rb = expected['rejectBreakdown'];
  if (rb is Map) {
    expected['rejectBreakdown'] = {for (final e in rb.entries) '${e.key}': e.value is num ? jsNumStr(e.value as num) : e.value};
  }
  return expected;
}

void main() {
  group('faRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows (the 18 paper rows first)', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        expect(diff(faRowCalc(c['row'] == null ? null : m(c['row'])), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });
  });

  group('helpers match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('defectTotal / isStatusOnly', () {
      for (final c in f['rows'] as List) {
        final row = m(c['row']);
        expect(diff(defectTotal(row), c['defectTotal']), isNull, reason: showCase(row));
        expect(isStatusOnly(row), c['statusOnly'], reason: showCase(row));
      }
    });
    test('isFinalAssemblyProcess', () {
      for (final c in f['processes'] as List) {
        expect(isFinalAssemblyProcess(c['process'] == null ? null : m(c['process'])), c['is'], reason: '${c['process']}');
      }
    });
    test('labels, defect reasons, idle fields, statuses, words and the entry limit', () {
      final x = loadFixture('fields.json', dir: dir) as Map;
      expect(FaLabels.all, x['labels']);
      expect(faDefectReasons, x['reasons']);
      expect([for (final (k, l) in faIdleFields) {'key': k, 'label': l}], x['idle']);
      expect(faNonWorkingStatuses, x['nonWorking']);
      expect(workingStatuses, x['workingStatuses']);
      expect(faMaxEntriesPerDay, x['maxEntries']);
      final w = x['words'] as Map;
      expect([faWords.who, faWords.canMake, faWords.shift], [w['who'], w['canMake'], w['shift']]);
      expect(w.containsKey('times'), isFalse, reason: 'no `times`: the hint reads Start / End');
      expect(faWords.timeName, 'Start / End');
    });
    test('every formula text is the web\'s', () {
      final f = loadFixture('formulas.json', dir: dir) as Map;
      for (final e in f.entries) {
        expect(faFormulas[e.key], e.value, reason: '${e.key}');
      }
    });
  });

  group('faDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} worker-days', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final sorted = sortByMachineOn([for (final r in c['rows'] as List) r == null ? null : m(r)]);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(faDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
        // The spec adds the day card's chip (Productivity) under oeeLosses.
        final viaSpec = spec.dayCalc(sorted);
        for (var j = 0; j < viaSpec.length; j++) {
          expect(viaSpec[j]['oeeLosses'], viaSpec[j]['productivity']);
        }
      }
    });
  });

  group('validateFinalAssemblyEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('${cases.length} blocks', () {
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = spec.validateEntry(m(c['values']), saved: c['saved'] == null ? null : m(c['saved']));
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(faFieldOrder, f['order']);
      expect(faMinuteKeys, f['minuteKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = spec.firstError(list);
        final web = c['first'];
        expect(web == null ? null : {'index': dart?['index'], 'field': dart?['field']}, web == null ? null : {'index': web['index'], 'field': web['field']});
        if (web == null) expect(dart, isNull);
      }
    });
  });

  group('values and payload match the page', () {
    test('toPayload (worker, process, the defects by reason, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = spec.finishPayload(spec.toPayload(m(c['values']), isEdit: c['isEdit'] as bool), process: {'_id': c['processId']});
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = faToFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = asText(m(c['out']), {...faNumberFields, ...faTextFields, ...faTimeFields});
        expect(diff(actual, expected), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('hasAnyEntryData and the block tint follow the web', () {
      for (final c in loadFixture('has_data.json', dir: dir) as List) {
        if ((c as Map).containsKey('list')) {
          expect(spec.hasAnyEntryData(rows(c['list'])), c['anyData']);
          continue;
        }
        final v = m(c['values']);
        expect(spec.entryHasData(v), c['blockHasData'], reason: showCase(v));
        expect(spec.hasAnyEntryData([v]), c['anyData'], reason: showCase(v));
      }
    });

    test('picking an item copies its Standard Time per Piece', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final expected = m(c['out']);
        if (expected['totalCycleSec'] is num) expected['totalCycleSec'] = jsNumStr(expected['totalCycleSec'] as num);
        expect(diff(spec.applyItemSelection(m(c['values']), c['itemId'] as String, items), expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block, draft merge, a defect box changed', () {
      final now = DateTime(2024, 5, 11);
      final e = spec.emptyEntry(now: now);
      expect(e['date'], '2024-05-11');
      expect(e['rejectBreakdown'], <String, dynamic>{});
      expect(spec.newBlockAfter([{...e, 'date': '2024-05-10', 'machine': 'w1'}], now: now), {...e, 'date': '2024-05-10'});
      final merged = spec.mergeDraftEntry({'machine': 'w1'}, now: now);
      expect(merged['otherActivityMin'], '');
      expect(merged['rejectBreakdown'], <String, dynamic>{});
      expect(spec.applyRejectChange(e, 'Other', '3')['rejectBreakdown'], {'Other': '3'});
    });
  });

  group('limit popups match the web', () {
    test('firstOverLimit as Save calls it: no quantity check, FA_WORDS', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final out = spec.firstOverLimit(rows(c['blocks']), errors, machineNames: Map<String, String>.from(c['machineName'] as Map));
        if (c['out'] == null) {
          expect(out, isNull, reason: 'case $i');
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect([out!.index, out.field], [e['index'], e['field']], reason: 'case $i');
        final pair = e['notice'] as List;
        expect(diff(encNotice(out.notice), [pair[0], Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus')]), isNull, reason: 'case $i');
      }
      expect(hits, greaterThan(20));
    });
    test('the keystroke popup', () {
      for (final c in loadFixture('notices.json', dir: dir) as List) {
        expect(diff(encNotice(stoppageNotice(limitMin: c['limitMin'], totalMin: c['totalMin'], words: faWords)), c['out']), isNull);
      }
    });
  });

  test('a worker\'s full date (slotsFullErrors, max 12)', () {
    var hits = 0;
    for (final c in (loadFixture('slots_full.json', dir: dir) as Map)['cases'] as List) {
      final out = slotsFullErrors(
        rows(c['entries']),
        {for (final e in (c['occupied'] as Map).entries) '${e.key}': rows(e.value)},
        editSlot: (c['editSlot'] as num?)?.toInt(),
        saved: c['saved'] == null ? null : m(c['saved']),
        max: faMaxEntriesPerDay,
        who: (id) => const {'w1': 'Alkesh'}[id] ?? 'This worker',
      );
      if (out.any((e) => e.isNotEmpty)) hits++;
      expect(diff(out, c['out']), isNull, reason: showCase(c));
    }
    expect(hits, greaterThan(5));
  });

  group('the table shows the web\'s cells (finalAssemblyColumns.jsx rendered)', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final keys = (f['keys'] as List).cast<String>();
    final names = Map<String, String>.from(f['machineName'] as Map);
    final cols = spec.columns(const {'rejectedQty'});
    final byKey = {for (final c in [...cols.left, ...cols.middle]) c.key: c};

    test('the same columns, order and words; Worker Name frozen; Unreported / Productivity not merged', () {
      expect([...cols.left, ...cols.middle].map((c) => c.key).toList(), keys);
      expect([...cols.left, ...cols.middle].map((c) => c.label).toList(), f['labels']);
      expect(cols.left.map((c) => c.key), ['date', 'machine']);
      for (final k in ['unreported', 'productivity', 'productivityLunch']) {
        expect(byKey[k]!.merge, ColMerge.none, reason: k);
      }
    });

    test('every cell reads as on the web', () {
      final all = [for (final c in f['rows'] as List) m((c as Map)['row'])];
      final groups = <String, List<Map<String, dynamic>>>{};
      for (final r in all) {
        (groups['${r['machine']}|${r['date']}'] ??= []).add(r);
      }
      final dayOf = <String, Map<String, dynamic>>{};
      for (final g in groups.values) {
        final sorted = sortByMachineOn(g);
        final res = spec.dayCalc(sorted);
        for (var i = 0; i < sorted.length; i++) {
          dayOf['${sorted[i]['_id']}'] = res[i];
        }
      }
      for (var i = 0; i < all.length; i++) {
        final r = all[i];
        final cells = (f['rows'] as List)[i]['cells'] as Map;
        final d = CellData(row: r, calc: spec.rowCalc(r), day: dayOf['${r['_id']}'] ?? const {}, machineName: names['${r['machine']}'] ?? '—');
        for (final k in keys) {
          final col = byKey[k]!;
          final web = cells[k] as Map;
          final eye = col.remarkKind != null && spec.remarkParts(r).any((p) => p['key'] == col.remarkKind);
          expect(col.remarkKind == 'general' ? (eye ? '' : '—') : col.text(d), web['text'], reason: 'row $i col $k ${showCase(r)}');
          expect(eye, web['eye'], reason: 'row $i col $k eye');
        }
      }
    });
  });

  group('the dashboard', () {
    final f = loadFixture('dashboard.json', dir: dir) as Map;
    const fa = {'processName': 'FINAL ASSEMBLY', 'dataEntryMenu': '/hqepl/production/final-assembly-data-entry'};
    test('stoppage causes lunchMin and otherMin, worded per worker', () {
      expect(eng.stoppageKeysFor(fa), f['stoppageKeys']);
      expect(eng.isWorkerProcess(fa), f['isWorker']);
    });
    for (final name in (f['scenarios'] as Map).keys) {
      test('summarize: $name', () {
        final sc = (f['scenarios'] as Map)[name] as Map;
        expect(diff(eng.summarize(rows(sc['rows'])), sc['summary']), isNull);
      });
    }
  });
}
