import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/press/press_calc.dart';
import 'package:indo/features/production/processes/press/press_spec.dart';
import 'package:indo/features/production/processes/press/press_validation.dart';
import 'package:indo/features/production/processes/press/press_values.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart' show stoppageLimitMin, withDecimalPlanned;
import 'package:indo/features/production/shared/production_sheet_calc.dart' show metricsOver100, sortByMachineOn;

import '../../calc/golden_support.dart';

const dir = 'test/production/processes/press/fixtures';

Map<String, dynamic> m(Object? x) => Map<String, dynamic>.from(x as Map);

/// Golden parity: every function below is compared with the REAL web JS
/// (client/src/utils/pressSheet.js, pressValidation.js and PressDataEntry.jsx's
/// toPayload) over the vectors in fixtures/ — see tool/gen_press_golden.mjs.
void main() {
  test('standardCycleSec', () {
    final cases = loadFixture('standard_cycle.json', dir: dir) as List;
    expect(cases.length, greaterThan(400));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      expect(diff(standardCycleSec(m(c['row'])), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
    }
  });

  test('pressRowCalc matches pressRowCalc in pressSheet.js', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    expect(cases.length, greaterThan(400));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      expect(diff(pressSpec.rowCalc(m(c['row'])), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
    }
  });

  test('pressDayCalc matches pressDayCalc in pressSheet.js', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    expect(cases.length, greaterThan(250));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final rows = [for (final r in c['rows'] as List) m(r)];
      // The list controller sorts by Machine ON time before asking the spec.
      expect(diff(pressSpec.dayCalc(sortByMachineOn(rows)), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
    }
  });

  test('validatePressEntry matches pressValidation.js (messages included)', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    expect(cases.length, greaterThan(500));
    var withErrors = 0, clean = 0;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final saved = c['saved'] == null ? null : m(c['saved']);
      final actual = pressSpec.validateEntry(m(c['values']), saved: saved);
      expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])}');
      if (actual.isEmpty) {
        clean++;
      } else {
        withErrors++;
      }
    }
    // The vectors exercise both outcomes.
    expect(clean, greaterThan(20));
    expect(withErrors, greaterThan(200));
  });

  test('firstError follows PRESS_FIELD_ORDER like firstPressError', () {
    final cases = loadFixture('first_error.json', dir: dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final errors = [
        for (final e in c['errors'] as List) e == null ? null : Map<String, String>.from(m(e)),
      ];
      expect(diff(pressSpec.firstError(errors), c['out']), isNull, reason: 'case $i ${showCase(c['errors'])}');
    }
  });

  test('stoppage allowance, decimal planned shift and the over-100% flag', () {
    final cases = loadFixture('helpers.json', dir: dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final dec = withDecimalPlanned(m(c['values']));
      expect(diff(dec['plannedOperatorShiftHours'], c['decimalPlanned']), isNull, reason: 'planned $i');
      expect(diff(pressStoppageLimitMin(dec), c['stoppageLimit']), isNull, reason: 'limit $i ${showCase(c['values'])}');
      expect(diff(metricsOver100(pressRowCalc(dec)), c['over']), isNull, reason: 'over $i ${showCase(c['values'])}');
    }
    // The allowance is the Machine Shift (CNC's shared rule has caught up with the web).
    expect(pressStoppageLimitMin({'machineOnTime': '08:00', 'machineOffTime': '16:00', 'plannedOperatorShiftHours': 9}), 480);
    expect(stoppageLimitMin({'machineOnTime': '08:00', 'machineOffTime': '16:00', 'plannedOperatorShiftHours': 9}), 480);
  });

  test('toPayload matches the page\'s toPayload (exact keys, numbers and ""s)', () {
    final cases = loadFixture('payload.json', dir: dir) as List;
    expect(cases.length, greaterThan(300));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final actual = pressSpec.toPayload(m(c['values']), isEdit: c['isEdit'] as bool);
      expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])}');
    }
  });

  test('constants and formulas match the web', () {
    final k = m(loadFixture('constants.json', dir: dir));
    expect(pressOperations, k['operations']);
    expect(pressDowntimeKeys, k['downtimeKeys']);
    expect(pressFieldOrder, k['fieldOrder']);
    expect(pressSpec.fieldOrder, k['fieldOrder']);
    expect([for (final f in pressProgramFields) f], [for (final f in k['programFields'] as List) m(f)]);
    expect(pressTextFields, k['textFields']);
    expect(pressNumberFields, k['numberFields']);
    expect(pressSpec.formulas, m(k['formulas']));
  });
}
