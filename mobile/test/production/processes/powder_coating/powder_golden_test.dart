import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/powder_coating/powder_calc.dart';
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice;
import 'package:indo/features/production/processes/powder_coating/powder_validation.dart';
import 'package:indo/features/production/processes/powder_coating/powder_values.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS (utils/powderCoatingSheet.js,
/// powderCoatingValidation.js and the page's pure handlers), over fixtures
/// written by tool/gen_powder_golden.mjs. See mobile/docs/PROCESS_PORTING.md.
/// POWDER_FIXTURE_DIR points a soak run at freshly generated fixtures
/// (`SEED=.. SCALE=..` — see tool/gen_powder_golden.mjs).
final dir = Platform.environment['POWDER_FIXTURE_DIR'] ?? 'test/production/processes/powder_coating/fixtures';

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

void main() {
  group('powderRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(powderRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework relies on are always there', () {
      for (final c in cases.take(60)) {
        final out = powderRowCalc(c['row'] == null ? null : m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'totalDefect', 'okQty']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });
  });

  group('helpers match the web', () {
    final cases = loadFixture('helpers.json', dir: dir) as List;
    test('defectTotal / isStatusOnly over ${cases.length} rows', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = m(c['row']);
        expect(diff(defectTotal(row), c['defectTotal']), isNull, reason: 'defectTotal $i ${showCase(row)}');
        expect(isStatusOnly(row), c['statusOnly'], reason: 'isStatusOnly $i ${showCase(row)}');
      }
    });
    test('the defect / idle field lists and statuses are the web\'s', () {
      final f = loadFixture('idle_fields.json', dir: dir) as Map;
      expect([for (final (k, l) in powderDefectFields) {'key': k, 'label': l}], f['defects']);
      expect([for (final (k, l) in powderIdleFields) {'key': k, 'label': l}], f['idle']);
      expect(powderNonWorkingStatuses, f['nonWorking']);
    });
    test('every formula text is the web\'s', () {
      final f = loadFixture('formulas.json', dir: dir) as Map;
      for (final e in f.entries) {
        expect(powderFormulas[e.key], e.value, reason: '${e.key}');
      }
    });
  });

  group('powderDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} worker-days', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(powderDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
      }
    });
  });

  group('validatePowderEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('${cases.length} blocks', () {
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : m(c['saved']);
        final actual = validatePowderEntry(m(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      // The set exercises both outcomes.
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(powderFieldOrder, f['order']);
      expect(powderMinuteKeys, f['minuteKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = powderCoatingSpec.firstError(list);
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
    test('toPayload is the web body (worker for machine, process, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = powderToPayload(m(c['values']), isEdit: c['isEdit'] as bool, processId: c['processId']);
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...powderNumberFields, ...powderTextFields, ...powderTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = powderToFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = m(c['out']);
        for (final k in typed) {
          final v = expected[k];
          if (v is num) expected[k] = jsNumStr(v);
        }
        // The web keeps what the row held for vendor / item; a falsy one is ''.
        expected['date'] = actual['date'] == '2026-01-01' ? '2026-01-01' : expected['date'];
        expect(diff(actual, expected), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('hasAnyEntryData and the block tint follow the web', () {
      final cases = loadFixture('has_data.json', dir: dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        if (c.containsKey('list')) {
          expect(powderHasAnyEntryData(rows(c['list'])), c['anyData'], reason: 'list $i');
          continue;
        }
        final v = m(c['values']);
        expect(powderEntryHasData(v), c['blockHasData'], reason: 'block $i ${showCase(v)}');
        expect(powderHasAnyEntryData([v]), c['anyData'], reason: 'any $i ${showCase(v)}');
      }
    });

    test('picking an item copies its Standard Inspection Time', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = powderApplyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        if (expected['totalCycleSec'] is num) expected['totalCycleSec'] = jsNumStr(expected['totalCycleSec'] as num);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block and draft merge', () {
      final now = DateTime(2026, 10, 22);
      final e = powderEmptyEntry(now: now);
      expect(e['date'], '2026-10-22');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      for (final k in [...powderNumberFields, ...powderTextFields, ...powderTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(powderNewBlockAfter([{...e, 'date': '2026-10-20'}], now: now)['date'], '2026-10-20');
      expect(powderNewBlockAfter(const [], now: now)['date'], '2026-10-22');
      final merged = powderMergeDraft({'machine': 'w1', 'itemName': 'Panel'}, now: now);
      expect(merged['machine'], 'w1');
      expect(merged['lessCoatingQty'], '');
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

    test('the page\'s call: no quantity check, the worker\'s words, workers named by id', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final names = Map<String, String>.from(c['machineName'] as Map);
        final out = powderCoatingSpec.firstOverLimit(blocks, errors, machineNames: names);
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        // Total Qty beating Ideal is OEE Review's business, never a limit popup.
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
}
