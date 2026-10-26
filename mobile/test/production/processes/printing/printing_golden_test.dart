import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/printing/printing_calc.dart';
import 'package:indo/features/production/processes/printing/printing_spec.dart';
import 'package:indo/features/production/processes/printing/printing_validation.dart';
import 'package:indo/features/production/processes/printing/printing_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice, printingWords, qtyNotice, stoppageNotice;
import 'package:indo/features/production/shared/production_entry_validation.dart' show isLiveMessage, slotsFullErrors;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the PRINTING port with the REAL web JS (utils/printingSheet.js,
/// printingValidation.js, the page's pure handlers, limitNotice.js,
/// entryValidation.js slotsFullErrors and the table's printingColumns.jsx
/// rendered to text), over fixtures written by tool/gen_printing_golden.mjs.
/// PRINTING_FIXTURE_DIR points a soak run at freshly generated fixtures
/// (`SEED=.. SCALE=..` — see the generator's header).
final dir = Platform.environment['PRINTING_FIXTURE_DIR'] ?? 'test/production/processes/printing/fixtures';

const spec = printingSpec;

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

/// An [EntryNotice] in the web's `[message, options]` shape.
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

void main() {
  group('printingRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows (the 16 paper rows first)', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(printingRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework relies on are always there', () {
      for (final c in cases.take(60)) {
        final out = printingRowCalc(c['row'] == null ? null : m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'idealQtyExact', 'idealQtyPerHour']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });
  });

  group('helpers match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isStatusOnly', () {
      for (final c in f['statusOnly'] as List) {
        expect(isStatusOnly(m(c['row'])), c['statusOnly'], reason: showCase(c['row']));
      }
    });
    test('isPrintingProcess', () {
      for (final c in f['processes'] as List) {
        expect(isPrintingProcess(c['process'] == null ? null : m(c['process'])), c['is'], reason: '${c['process']}');
      }
    });
    test('the downtime fields, statuses, words and the entry limit are the web\'s', () {
      final x = loadFixture('fields.json', dir: dir) as Map;
      expect(printingExtraStoppageFields, x['extra']);
      expect(printingExtraStoppageKeys, x['extraKeys']);
      expect([for (final (k, l) in printingStoppageFields) {'key': k, 'label': l}], x['stoppage']);
      expect(printingNonWorkingStatuses, x['nonWorking']);
      expect(workingStatuses, x['workingStatuses']);
      expect(printingMaxEntries, x['maxEntries']);
      final w = x['words'] as Map;
      expect(printingWords.who, w['who']);
      expect(printingWords.canMake, w['canMake']);
      expect(printingWords.shift, w['shift']);
      expect(printingWords.timeName, w['times']);
    });
    test('every formula text is the web\'s', () {
      final f = loadFixture('formulas.json', dir: dir) as Map;
      expect(printingFormulas.keys.toSet().containsAll(f.keys), isTrue);
      for (final e in f.entries) {
        expect(printingFormulas[e.key], e.value, reason: '${e.key}');
      }
    });
  });

  group('printingDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} operator-days (each entry on its own; a locked day combined)', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(spec.dayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
      }
    });
  });

  group('validatePrintingEntry matches the web', () {
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
      expect(printingFieldOrder, f['order']);
      expect(printingMinuteKeys, f['minuteKeys']);
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
    test('toPayload is the web body (worker for machine, mcMachine, process, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = printingToPayload(m(c['values']), isEdit: c['isEdit'] as bool, processId: c['processId']);
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
        // The spec's own PUT body: process added last by finishPayload.
        final viaSpec = spec.finishPayload(spec.toPayload(m(c['values']), isEdit: c['isEdit'] as bool), process: {'_id': c['processId']});
        expect(diff(viaSpec, c['payload']), isNull, reason: 'spec case $i');
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...printingNumberFields, ...printingTextFields, ...printingTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = printingToFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = m(c['out']);
        for (final k in typed) {
          final v = expected[k];
          if (v is num) expected[k] = jsNumStr(v);
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

    test('picking an item copies its Standard Time per Piece', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = spec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        if (expected['totalCycleSec'] is num) expected['totalCycleSec'] = jsNumStr(expected['totalCycleSec'] as num);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block and draft merge', () {
      final now = DateTime(2025, 5, 14);
      final e = spec.emptyEntry(now: now);
      expect(e['date'], '2025-05-14');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['mcMachine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      for (final k in [...printingNumberFields, ...printingTextFields, ...printingTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(e.containsKey('rejectBreakdown'), isFalse, reason: 'no Rejection Master on this sheet');
      expect(spec.newBlockAfter([{...e, 'date': '2025-05-12', 'machine': 'op1'}], now: now), {...e, 'date': '2025-05-12'});
      expect(spec.newBlockAfter(const [], now: now)['date'], '2025-05-14');
      final merged = spec.mergeDraftEntry({'machine': 'op1', 'itemName': 'Label'}, now: now);
      expect(merged['machine'], 'op1');
      expect(merged['stockCountingMin'], '');
      expect(merged['machineStatus'], <dynamic>[]);
    });
  });

  group('limit popups match the web', () {
    test('firstOverLimit as the page\'s Save calls it (TOTAL QTY, PRINTING_WORDS)', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var qty = 0, stop = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final names = Map<String, String>.from(c['machineName'] as Map);
        final out = spec.firstOverLimit(blocks, errors, machineNames: names);
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        expect(out.field, e['field'], reason: ctx);
        if (out.field == 'actualQty') qty++;
        if (out.field == 'stoppageTotal') stop++;
        expect(out.notice.returnFocus, isFalse, reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(encNotice(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(qty, greaterThan(10), reason: 'the generator must exercise the quantity popup');
      expect(stop, greaterThan(10), reason: 'the generator must exercise the stoppage popup');
    });

    test('the keystroke popups (TOTAL QTY over Ideal, downtime over the Machine Shift Time)', () {
      final cases = loadFixture('notices.json', dir: dir) as List;
      for (final c in cases) {
        final out = c['kind'] == 'qty'
            ? qtyNotice(calc: printingRowCalc(m(c['values'])), entered: c['entered'], label: 'TOTAL QTY', words: printingWords)
            : stoppageNotice(limitMin: c['limitMin'], totalMin: c['totalMin'], words: printingWords);
        expect(diff(encNotice(out), c['out']), isNull, reason: showCase(c));
      }
    });
  });

  group('an operator\'s date that is full (slotsFullErrors, max 8)', () {
    final f = loadFixture('slots_full.json', dir: dir) as Map;
    test('the same message on the same box as the web', () {
      var hits = 0;
      for (final c in f['cases'] as List) {
        final entries = rows(c['entries']);
        final occupied = {
          for (final e in (c['occupied'] as Map).entries) '${e.key}': rows(e.value),
        };
        final out = slotsFullErrors(
          entries,
          occupied,
          editSlot: (c['editSlot'] as num?)?.toInt(),
          saved: c['saved'] == null ? null : m(c['saved']),
          max: printingMaxEntries,
          who: (id) => const {'op1': 'Surekha'}[id] ?? 'This operator',
        );
        if (out.any((e) => e.isNotEmpty)) hits++;
        expect(diff(out, c['out']), isNull, reason: showCase(c));
      }
      expect(hits, greaterThan(5));
    });
    test('isLiveMessage', () {
      for (final c in f['live'] as List) {
        expect(isLiveMessage(c['message'] as String), c['live'], reason: '${c['message']}');
      }
    });
  });

  group('the table shows the web\'s cells (printingColumns.jsx rendered)', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final keys = (f['keys'] as List).cast<String>();
    final labels = (f['labels'] as List).cast<String>();
    final names = Map<String, String>.from(f['machineName'] as Map);
    final cols = spec.columns(const {'downtime'});
    final byKey = {for (final c in [...cols.left, ...cols.middle]) c.key: c};
    final all = [for (final c in f['rows'] as List) m((c as Map)['row'])];

    test('the same columns, in the same order and words', () {
      expect([...cols.left, ...cols.middle].map((c) => c.key).toList(), keys);
      expect([...cols.left, ...cols.middle].map((c) => c.label).toList(), labels);
      // Only Date is frozen, as on the web.
      expect(cols.left.map((c) => c.key), ['date']);
      // Unreported and the three OEE are each entry's own: not merged.
      for (final k in ['unreported', 'oeeLosses', 'oeeLunch', 'oeeLunchCot']) {
        expect(byKey[k]!.merge, ColMerge.none, reason: k);
      }
      expect(byKey['machine']!.merge, ColMerge.machineDay);
    });

    test('${all.length} rows: every cell reads as on the web', () {
      // Day figures as the list controller works them out: per operator-date, sorted by ON time.
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
      final cases = f['rows'] as List;
      for (var i = 0; i < all.length; i++) {
        final r = all[i];
        final cells = cases[i]['cells'] as Map;
        final d = CellData(row: r, calc: spec.rowCalc(r), day: dayOf['${r['_id']}'] ?? const {}, machineName: names['${r['machine']}'] ?? '—');
        for (final k in keys) {
          final col = byKey[k]!;
          final web = cells[k] as Map;
          final eye = col.remarkKind != null && spec.remarkParts(r).any((p) => p['key'] == col.remarkKind);
          final text = col.remarkKind == 'general' ? (eye ? '' : '—') : col.text(d);
          expect(text, web['text'], reason: 'row $i col $k ${showCase(r)}');
          expect(eye, web['eye'], reason: 'row $i col $k eye');
        }
      }
    });
  });
}
