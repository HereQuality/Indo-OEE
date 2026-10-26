import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/process/process_spec.dart';

import 'package:indo/features/production/shared/production_sheet_calc.dart'
    show sortByMachineOn;

import 'package:indo/features/production/shared/production_sheet_calc.dart'
    show jsNumStr;

import '../calc/golden_support.dart';

Map<String, dynamic> _map(Object? m) => Map<String, dynamic>.from(m as Map);

/// Registers the golden-vector parity tests of a CNC-twin process: its Dart
/// rowCalc / dayCalc / validation / first-error / payload / formulas against the
/// REAL web JS (fixtures from tool/gen_twin_golden.mjs under [dir]).
void registerTwinParity(ProcessSpec spec, String name) {
  final dir = 'test/production/processes/$name/fixtures';
  dynamic fx(String file) => loadFixture(file, dir: dir);

  group('$name parity with the web JS', () {
    test('rowCalc', () {
      final cases = fx('row_calc.json') as List;
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : _map(c['row']);
        final actual = row == null ? <String, dynamic>{} : spec.rowCalc(row);
        expect(
          diff(actual, c['out']),
          isNull,
          reason: 'case $i ${showCase(c['row'])}',
        );
      }
    });

    test('dayCalc (rows sorted like the controller)', () {
      final cases = fx('day_calc.json') as List;
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final rows = [
          for (final r in c['rows'] as List)
            if (r != null) _map(r),
        ];
        // The web sorts null rows out first; the controller feeds sorted rows.
        final sorted = sortRows(rows);
        expect(
          [for (final r in sorted) r['_id']],
          c['order'],
          reason: 'order $i',
        );
        expect(
          diff(spec.dayCalc(sorted), c['out']),
          isNull,
          reason: 'case $i ${showCase(c['rows'])}',
        );
      }
    });

    test('validateEntry', () {
      final cases = fx('validation.json') as List;
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : _map(c['saved']);
        final actual = spec.validateEntry(_map(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(
          diff(actual, c['errors']),
          isNull,
          reason:
              'case $i ${showCase(c['values'])} saved=${showCase(c['saved'])}',
        );
      }
      // The set is meant to hit both outcomes.
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length));
    });

    test('field order and the first incomplete field', () {
      final f = fx('first_error.json') as Map;
      expect(spec.fieldOrder, f['order']);
      final cases = f['cases'] as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final errors = [
          for (final e in c['errors'] as List)
            e == null ? <String, String>{} : Map<String, String>.from(e as Map),
        ];
        expect(
          diff(spec.firstError(errors), c['first']),
          isNull,
          reason: 'case $i ${showCase(c['errors'])}',
        );
      }
    });

    test('toPayload', () {
      final cases = fx('payload.json') as List;
      expect(cases.length, greaterThan(100));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = spec.toPayload(
          _map(c['values']),
          isEdit: c['isEdit'] as bool,
        );
        expect(
          diff(actual, c['payload']),
          isNull,
          reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}',
        );
      }
    });

    test('a saved record becomes Actual + the Rejection Master split (quantityFormValues)', () {
      final q = fx('quantity_form.json') as Map;
      final cases = q['forms'] as List;
      expect(cases.length, greaterThan(10));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = _map(c['row']);
        final web = _map(c['out']);
        final v = spec.toFormValues(row);
        // The web keeps numbers, the phone keeps the text of a box: same figures.
        final actual = web['actualQty'];
        expect(
          v['actualQty'],
          actual is num ? jsNumStr(actual) : actual,
          reason: 'case $i actual ${showCase(c['row'])}',
        );
        final webSplit = _map(web['rejectBreakdown']);
        final split = _map(v['rejectBreakdown']);
        expect(split.keys.toList(), webSplit.keys.toList(), reason: 'case $i split ${showCase(c['row'])}');
        for (final e in webSplit.entries) {
          expect(split[e.key], e.value is num ? jsNumStr(e.value as num) : '${e.value}', reason: 'case $i ${e.key}');
        }
      }
      expect(spec.emptyEntry()['rejectBreakdown'], isEmpty);
      for (final c in q['hasReject'] as List) {
        final v = _map((c as Map)['v']);
        expect(spec.entryHasData({...spec.emptyEntry(), ...v}), c['out'], reason: showCase(c['v']));
      }
    });

    test('formulas, status-only days', () {
      final misc = fx('misc.json') as Map;
      final web = Map<String, String>.from(misc['formulas'] as Map);
      for (final e in web.entries) {
        expect(spec.formulas[e.key], e.value, reason: 'formula ${e.key}');
      }
      expect(web.keys.toSet().difference(spec.formulas.keys.toSet()), isEmpty);
    });
  });
}

/// `sortByMachineOn` — what the controller does before `dayCalc`.
List<Map<String, dynamic>> sortRows(List<Map<String, dynamic>> rows) =>
    sortByMachineOn(rows);
