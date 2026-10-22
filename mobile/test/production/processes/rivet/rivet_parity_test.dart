import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/rivet/rivet_calc.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/processes/rivet/rivet_validation.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart' show sortByMachineOn;

import '../../calc/golden_support.dart';

// Dart == the REAL client JS (fixtures from tool/gen_rivet_golden.mjs).
const dir = 'test/production/processes/rivet/fixtures';

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);
Map<String, dynamic>? _mn(dynamic v) => v == null ? null : _m(v);

void main() {
  group('golden: rivetRowCalc / rivetCycleSec', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows', () {
      expect(cases.length, greaterThan(700));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = _mn(c['row']);
        if (row != null) {
          expect(diff(rivetRowCalc(row), c['out']), isNull, reason: 'rowCalc case $i ${showCase(c['row'])}');
        } else {
          expect(diff(rivetRowCalc(null), c['out']), isNull, reason: 'rowCalc(null)');
        }
        expect(diff(rivetCycleSec(row), c['cycle']), isNull, reason: 'cycle case $i ${showCase(c['row'])}');
      }
    });
  });

  group('golden: rivetDayCalc', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} machine-days', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final rows = [for (final r in c['rows'] as List) _mn(r)];
        final sorted = sortByMachineOn(rows);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order case $i');
        expect(diff(rivetSpec.dayCalc(sorted), c['out']), isNull, reason: 'dayCalc case $i ${showCase(c['rows'])}');
      }
    });
  });

  group('golden: validateRivetEntry', () {
    final fx = loadFixture('validation.json', dir: dir) as Map;
    final cases = fx['cases'] as List;
    test('${cases.length} blocks (messages and keys)', () {
      expect(cases.length, greaterThan(900));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final errors = rivetSpec.validateEntry(_m(c['values']), saved: _mn(c['saved']));
        if (errors.isNotEmpty) withErrors++;
        expect(diff(errors, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])}');
        expect(errors.keys.toList(), (c['keys'] as List).cast<String>(), reason: 'key order case $i');
      }
      expect(withErrors, greaterThan(300));
      expect(withErrors, lessThan(cases.length), reason: 'some blocks are valid');
    });
    test('field order, downtime keys, process choices and formulas match the web', () {
      expect(rivetSpec.fieldOrder, (fx['fieldOrder'] as List).cast<String>());
      expect(rivetDowntimeKeys, (fx['downtimeKeys'] as List).cast<String>());
      expect(rivetProcessTypes, (fx['processTypes'] as List).cast<String>());
      expect(rivetSpec.formulas, (fx['formulas'] as Map).cast<String, String>());
    });
  });

  group('golden: firstError', () {
    final cases = loadFixture('first_error.json', dir: dir) as List;
    test('${cases.length} lists', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final errors = [for (final e in c['errors'] as List) (e as Map).cast<String, String>()];
        expect(diff(rivetSpec.firstError(errors), c['out']), isNull, reason: 'case $i ${showCase(c['errors'])}');
      }
    });
  });
}
