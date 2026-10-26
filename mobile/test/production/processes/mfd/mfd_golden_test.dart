import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/mfd/mfd_calc.dart';
import 'package:indo/features/production/processes/mfd/mfd_spec.dart';
import 'package:indo/features/production/processes/mfd/mfd_validation.dart';
import 'package:indo/features/production/processes/mfd/mfd_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice, qtyNotice;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS — utils/mfdSheet.js,
/// mfdValidation.js, limitNotice.js, the page's pure handlers
/// (ModularFrameDrillingDataEntry.jsx) and the table's columns (mfdColumns.jsx,
/// rendered) — over fixtures written by tool/gen_mfd_golden.mjs.
/// MFD_FIXTURE_DIR points a soak run at freshly generated fixtures
/// (`SEED=.. SCALE=..` — see the generator).
final dir = Platform.environment['MFD_FIXTURE_DIR'] ?? 'test/production/processes/mfd/fixtures';

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

void main() {
  group('mfdRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows (the paper sheet\'s own included)', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(mfdRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework and this sheet rely on are always there', () {
      for (final c in cases.take(60)) {
        if (c['row'] == null) continue;
        final out = mfdRowCalc(m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'idealQtyExact', 'idealLunchMin', 'idealQtyPerHour', 'effectiveHours', 'efficiency']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });
  });

  group('helpers and constants match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isMfdProcess: by its Data Entry Page, or by its whole name while not linked', () {
      for (final c in f['processes'] as List) {
        final p = (c as Map)['process'];
        expect(isMfdProcess(p == null ? null : m(p)), c['isMfd'], reason: showCase(p));
      }
    });
    test('the ten downtime columns, the Processes, eight entries a day', () {
      expect([for (final (k, l) in mfdStoppageFields) {'key': k, 'label': l}], f['stoppageFields']);
      expect(mfdOperations, f['operations']);
      expect(mfdMaxSlots, f['maxSlots']);
      expect(mfdSpec.maxEntriesPerDay, f['maxSlots']);
    });
    test('IDEAL Quantity with 0 decimals and IDEAL Quantity/Hour with 1, as the web formats them', () {
      for (final c in f['fmt'] as List) {
        final v = (c as Map)['v'];
        expect(fmtIdeal(v), c['ideal'], reason: '$v');
        expect(fmtIdealPerHour(v), c['perHour'], reason: '$v');
      }
    });
    test('every formula text is the web\'s', () {
      final web = loadFixture('formulas.json', dir: dir) as Map;
      // The phone's shared map also explains the form's grey allowance box; nothing else is extra.
      expect(mfdFormulas.keys.toSet().difference(web.keys.toSet()), {'stoppageAllowed'});
      for (final e in web.entries) {
        expect(mfdFormulas[e.key], e.value, reason: '${e.key}');
      }
      expect(mfdSpec.formulas, same(mfdFormulas));
    });
  });

  group('mfdDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} machine-days: each entry its own figures, a locked day combined once', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(mfdDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
        expect(diff(mfdSpec.dayCalc(sorted), c['out']), isNull, reason: 'spec case $i');
      }
    });
  });

  group('validateMfdEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('${cases.length} blocks, every message word for word', () {
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : m(c['saved']);
        final actual = mfdSpec.validateEntry(m(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(mfdFieldOrder, f['order']);
      expect(mfdMinuteKeys, f['minuteKeys']);
      expect(mfdDowntimeKeys, f['downtimeKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = mfdSpec.firstError(list);
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
    test('toPayload is the web body (Actual / OK, no Rejected, the Part\'s figures, Non Working blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = mfdSpec.toPayload(m(c['values']), isEdit: c['isEdit'] as bool);
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
        expect(actual.containsKey('rejectedQty'), isFalse);
        expect(actual.containsKey('rejectBreakdown'), isFalse);
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...mfdNumberFields, ...mfdTextFields, ...mfdTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = mfdSpec.toFormValues(m(c['row']), now: DateTime(2026, 1, 1));
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
          expect(mfdSpec.hasAnyEntryData(rows(c['list'])), c['anyData'], reason: 'list $i');
          continue;
        }
        final v = m(c['values']);
        expect(mfdSpec.entryHasData(v), c['blockHasData'], reason: 'block $i ${showCase(v)}');
        expect(mfdSpec.hasAnyEntryData([v]), c['anyData'], reason: 'any $i ${showCase(v)}');
      }
    });

    test('picking a part copies its Drawing No., Process, Holes, Stroke and Total Cycle Time', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = mfdSpec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        for (final k in ['totalCycleSec', 'noOfHoles', 'strokeRequired']) {
          if (expected[k] is num) expected[k] = jsNumStr(expected[k] as num);
        }
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block and draft merge', () {
      final now = DateTime(2026, 10, 26);
      final e = mfdSpec.emptyEntry(now: now);
      expect(e['date'], '2026-10-26');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      expect(e.containsKey('rejectBreakdown'), isFalse, reason: 'no Rejection Master');
      for (final k in [...mfdNumberFields, ...mfdTextFields, ...mfdTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(mfdSpec.newBlockAfter([{...e, 'date': '2026-10-20'}], now: now)['date'], '2026-10-20');
      expect(mfdSpec.newBlockAfter(const [], now: now)['date'], '2026-10-26');
      final merged = mfdSpec.mergeDraftEntry({'machine': 'm1', 'itemName': '24 PIN FRAME'}, now: now);
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

    test('the page\'s call: Actual Quantity against the IDEAL Quantity rounded down, machines named by id', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final names = Map<String, String>.from(c['machineName'] as Map);
        final out = mfdSpec.firstOverLimit(blocks, errors, machineNames: names);
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        expect(out.field, e['field'], reason: ctx);
        expect(out.notice.returnFocus, isFalse, reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(enc(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(hits, greaterThan(20), reason: 'the generator must exercise the popup path');
    });
  });

  group('the cap\'s popup matches the web (it names the Lunch / Tea IDEAL took out)', () {
    test('qtyNotice over the paper rows and more', () {
      final cases = loadFixture('qty_notice.json', dir: dir) as List;
      var withLunch = 0;
      for (final c in cases) {
        final calc = mfdRowCalc(m((c as Map)['row']));
        final n = qtyNotice(calc: calc, entered: c['entered'], label: 'Actual Quantity');
        final pair = c['out'] as List;
        final opts = m(pair[1]);
        final want = [
          pair[0],
          {'title': opts['title'], 'details': opts['details'], 'hint': opts['hint']},
        ];
        final got = [
          n.message,
          {
            'title': n.title,
            'details': [
              for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
            ],
            'hint': n.hint,
          },
        ];
        expect(diff(got, want), isNull, reason: showCase(c['row']));
        if (n.details.any((d) => d.label == 'Less Lunch / Tea')) withLunch++;
      }
      expect(withLunch, greaterThan(5));
    });
  });

  group('the table shows the web\'s cells', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final names = Map<String, String>.from(f['machineName'] as Map);
    final cols = mfdSpec.columns({'downtime'});
    final all = [...cols.left, ...cols.middle];

    test('the same columns, in the same order, with the same headings (Idle Time opened)', () {
      expect([for (final c in all) c.key], [for (final c in f['columns'] as List) c['key']]);
      expect([for (final c in all) c.label], [for (final c in f['columns'] as List) c['label']]);
      // Closed, Idle Time is its total alone.
      final closed = mfdSpec.columns(const {});
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
        final days = mfdSpec.dayCalc(sorted);
        for (var i = 0; i < sorted.length; i++) {
          dayById['${sorted[i]['_id']}'] = days[i];
        }
      }
      var checked = 0;
      for (final r in f['rows'] as List) {
        final row = m((r as Map)['row']);
        final data = CellData(
          row: row,
          calc: mfdSpec.rowCalc(row),
          day: dayById['${row['_id']}']!,
          machineName: names['${row['machine']}'] ?? '',
        );
        final cells = m(r['cells']);
        for (final col in all) {
          final web = m(cells[col.key]);
          final parts = [
            for (final p in mfdSpec.remarkParts(row))
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
