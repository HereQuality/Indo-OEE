import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/embossing/embossing_calc.dart';
import 'package:indo/features/production/processes/embossing/embossing_spec.dart';
import 'package:indo/features/production/processes/embossing/embossing_validation.dart';
import 'package:indo/features/production/processes/embossing/embossing_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS — utils/embossingSheet.js,
/// embossingValidation.js, the page's pure handlers (EmbossingDataEntry.jsx) and
/// the table's columns (embossingColumns.jsx, rendered) — over fixtures written
/// by tool/gen_embossing_golden.mjs. See mobile/docs/PROCESS_PORTING.md.
/// EMBOSSING_FIXTURE_DIR points a soak run at freshly generated fixtures
/// (`SEED=.. SCALE=..` — see the generator).
final dir = Platform.environment['EMBOSSING_FIXTURE_DIR'] ?? 'test/production/processes/embossing/fixtures';

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

void main() {
  group('embossingRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows (the paper sheet\'s own included)', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(embossingRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework and this sheet rely on are always there', () {
      for (final c in cases.take(60)) {
        if (c['row'] == null) continue;
        final out = embossingRowCalc(m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'idealQtyExact', 'idealQtyPerHour', 'effectiveHours']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });
  });

  group('helpers and constants match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isStatusOnly over every row', () {
      for (final c in f['rows'] as List) {
        final row = m((c as Map)['row']);
        expect(embossingIsStatusOnly(row), c['statusOnly'], reason: showCase(row));
      }
    });
    test('isEmbossingProcess: by its Data Entry Page, or by name while not linked', () {
      for (final c in f['processes'] as List) {
        final p = (c as Map)['process'];
        expect(isEmbossingProcess(p == null ? null : m(p)), c['isEmbossing'], reason: showCase(p));
      }
    });
    test('the ten downtime columns, the statuses', () {
      expect([for (final (k, l) in embossingStoppageFields) {'key': k, 'label': l}], f['stoppageFields']);
      expect(embossingNonWorkingStatuses, f['nonWorking']);
      expect(workingStatuses, f['workingStatuses']);
    });
    test('every formula text is the web\'s', () {
      final web = loadFixture('formulas.json', dir: dir) as Map;
      // The phone's shared map also explains the form's grey allowance box; nothing else is extra.
      expect(embossingFormulas.keys.toSet().difference(web.keys.toSet()), {'stoppageAllowed'});
      for (final e in web.entries) {
        expect(embossingFormulas[e.key], e.value, reason: '${e.key}');
      }
      expect(embossingSpec.formulas, same(embossingFormulas));
    });
  });

  group('embossingDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} machine-days: each entry its own figures, a locked day combined once', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(embossingDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
        expect(diff(embossingSpec.dayCalc(sorted), c['out']), isNull, reason: 'spec case $i');
      }
    });
  });

  group('validateEmbossingEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('TOTAL past Ideal is allowed (no error); the messages are the sheet\'s', () {
      final base = {
        'date': '2026-05-15', 'machine': 'm1', 'operator': 'JAYA BEN', 'itemName': 'Plate', 'totalCycleSec': '20',
        'machineOnTime': '08:30', 'machineOffTime': '18:00', 'actualQty': '5400', 'okQty': '5400',
        'plannedOperatorShiftHours': '9.5', 'lunchMin': '30', 'workingMode': 'Working', 'machineStatus': <dynamic>[],
      };
      expect(embossingSpec.validateEntry(base), isEmpty, reason: 'Ideal 1710 — 5400 still saves');
      expect(embossingSpec.validateEntry({...base, 'actualQty': ''})['actualQty'], 'TOTAL QTY is required');
      expect(embossingSpec.validateEntry({...base, 'okQty': ''})['okQty'], 'OK QTY is required');
      expect(embossingSpec.validateEntry({...base, 'okQty': '5401'})['okQty'], "OK can't be more than TOTAL QTY (5400)");
    });

    test('${cases.length} blocks, every message word for word', () {
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : m(c['saved']);
        final actual = embossingSpec.validateEntry(m(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(embossingFieldOrder, f['order']);
      expect(embossingMinuteKeys, f['minuteKeys']);
      expect(embossingDowntimeKeys, f['downtimeKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = embossingSpec.firstError(list);
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
    test('toPayload is the web body (TOTAL / OK, no Rejected, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = embossingSpec.toPayload(m(c['values']), isEdit: c['isEdit'] as bool);
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
        expect(actual.containsKey('rejectedQty'), isFalse);
        expect(actual.containsKey('rejectBreakdown'), isFalse);
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...embossingNumberFields, ...embossingTextFields, ...embossingTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = embossingSpec.toFormValues(m(c['row']), now: DateTime(2026, 1, 1));
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
          expect(embossingSpec.hasAnyEntryData(rows(c['list'])), c['anyData'], reason: 'list $i');
          continue;
        }
        final v = m(c['values']);
        expect(embossingSpec.entryHasData(v), c['blockHasData'], reason: 'block $i ${showCase(v)}');
        expect(embossingSpec.hasAnyEntryData([v]), c['anyData'], reason: 'any $i ${showCase(v)}');
      }
    });

    test('picking an item copies its Drawing No. and Standard Time per Piece', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = embossingSpec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        if (expected['totalCycleSec'] is num) expected['totalCycleSec'] = jsNumStr(expected['totalCycleSec'] as num);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block and draft merge', () {
      final now = DateTime(2026, 10, 26);
      final e = embossingSpec.emptyEntry(now: now);
      expect(e['date'], '2026-10-26');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      expect(e.containsKey('rejectBreakdown'), isFalse, reason: 'no Rejection Master');
      for (final k in [...embossingNumberFields, ...embossingTextFields, ...embossingTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(embossingSpec.newBlockAfter([{...e, 'date': '2026-10-20'}], now: now)['date'], '2026-10-20');
      expect(embossingSpec.newBlockAfter(const [], now: now)['date'], '2026-10-26');
      final merged = embossingSpec.mergeDraftEntry({'machine': 'm1', 'itemName': 'Plate'}, now: now);
      expect(merged['machine'], 'm1');
      expect(merged['okQty'], '');
      expect(merged['machineStatus'], <dynamic>[]);
    });
  });

  group('firstOverLimit (Save on an incomplete entry) matches the web', () {
    Object? enc(EntryNotice n) => [
          n.message,
          {
            'title': n.title,
            'details': [
              for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
            ],
            'hint': n.hint,
          },
        ];

    test('the page\'s call: no quantity check (TOTAL past Ideal goes to OEE Review), machines named by id', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final names = Map<String, String>.from(c['machineName'] as Map);
        final out = embossingSpec.firstOverLimit(blocks, errors, machineNames: names);
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        expect(out.field, 'stoppageTotal', reason: ctx);
        expect(out.field, e['field'], reason: ctx);
        expect(out.notice.returnFocus, isFalse, reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(enc(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(hits, greaterThan(20), reason: 'the generator must exercise the popup path');
    });
  });

  group('the table shows the web\'s cells', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final names = Map<String, String>.from(f['machineName'] as Map);
    final cols = embossingSpec.columns({'downtime'});
    final all = [...cols.left, ...cols.middle];

    test('the same columns, in the same order, with the same headings (Idle Time opened)', () {
      expect([for (final c in all) c.key], [for (final c in f['columns'] as List) c['key']]);
      expect([for (final c in all) c.label], [for (final c in f['columns'] as List) c['label']]);
      // Closed, Idle Time is its total alone.
      final closed = embossingSpec.columns(const {});
      expect(closed.middle.map((c) => c.key), isNot(contains('lunchMin')));
      expect(closed.middle.map((c) => c.key), contains('totalStoppage'));
    });

    test('Unreported Time and the three OEE are each entry\'s own: not merged across the machine\'s day', () {
      for (final key in ['unreported', 'oeeLosses', 'oeeLunch', 'oeeLunchCot']) {
        expect(all.firstWhere((c) => c.key == key).merge, ColMerge.none, reason: key);
      }
      expect(all.firstWhere((c) => c.key == 'date').merge, ColMerge.date);
      expect(all.firstWhere((c) => c.key == 'machine').merge, ColMerge.machineDay);
    });

    test('every cell of ${(f['rows'] as List).length} rows reads as on the web', () {
      final list = [for (final r in f['rows'] as List) m((r as Map)['row'])];
      // The page's day results: per machine and date, in Machine ON order (SheetController).
      final groups = <String, List<Map<String, dynamic>>>{};
      for (final r in list) {
        (groups['${r['machine']}|${r['date']}'] ??= []).add(r);
      }
      final dayById = <String, Map<String, dynamic>>{};
      for (final g in groups.values) {
        final sorted = sortByMachineOn(g);
        final days = embossingSpec.dayCalc(sorted);
        for (var i = 0; i < sorted.length; i++) {
          dayById['${sorted[i]['_id']}'] = days[i];
        }
      }
      var checked = 0;
      for (final r in f['rows'] as List) {
        final row = m((r as Map)['row']);
        final data = CellData(
          row: row,
          calc: embossingSpec.rowCalc(row),
          day: dayById['${row['_id']}']!,
          machineName: names['${row['machine']}'] ?? '',
        );
        final cells = m(r['cells']);
        for (final col in all) {
          final web = m(cells[col.key]);
          final parts = [
            for (final p in embossingSpec.remarkParts(row))
              if (p['key'] == col.remarkKind) p,
          ];
          final ctx = '${col.key} ${showCase(row)}';
          if (col.remarkKind == 'general') {
            // The Remarks column: the eye when the entry has remarks, else a dash (sheet_table.dart).
            expect(parts.isEmpty ? '—' : '', web['text'], reason: ctx);
          } else {
            expect(col.text(data), web['text'], reason: ctx);
          }
          expect(col.remarkKind != null && parts.isNotEmpty, web['eye'] == true, reason: 'eye $ctx');
          final style = web['text'] == '' ? null : col.style?.call(data);
          expect(style == CellStyle.danger, web['danger'] == true, reason: 'red $ctx');
          if (col.key == 'review') {
            final want = switch (web['badge']) {
              'warning' => CellMark.warn,
              'success' => CellMark.ok,
              'danger' => CellMark.danger,
              _ => null,
            };
            expect(style?.mark, want, reason: 'badge $ctx');
            expect(style?.pill ?? false, want != null, reason: 'pill $ctx');
          }
          checked++;
        }
      }
      expect(checked, greaterThan(5000));
    });
  });
}
