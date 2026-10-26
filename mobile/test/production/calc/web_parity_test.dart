// Golden parity for the pieces added when the web's figures grew past the
// original CNC port: formula texts, Non Working, metricsOver100, the decimal-hours
// helpers and the new constants. Fixtures: tool/gen_golden.mjs (the real JS).
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/shared/shift_hours.dart';
import 'package:indo/features/production/sheet/widgets/sheet_style.dart';

import 'golden_support.dart';

void main() {
  test('sheetFormulas == the web FORMULAS (plus the phone-only stoppageAllowed)', () {
    final web = Map<String, dynamic>.from(loadFixture('formulas.json') as Map);
    expect(web.keys.length, greaterThan(15));
    for (final e in web.entries) {
      expect(sheetFormulas[e.key], e.value, reason: 'formula ${e.key}');
    }
    expect(sheetFormulas.keys.toSet().difference(web.keys.toSet()), {'stoppageAllowed'});
  });

  test('constants: working modes, machine statuses, planned stops, OEE labels', () {
    final c = (loadFixture('time_and_dates.json') as Map)['constants'] as Map;
    expect(workingModes, c['WORKING_MODES']);
    expect(machineStatuses, c['MACHINE_STATUSES']);
    expect(plannedStopKeys, c['PLANNED_STOP_KEYS']);
    expect(oeeMetricLabels, c['OEE_METRIC_LABELS']);
    expect(workingStatuses, c['WORKING_STATUSES']);
  });

  test('golden: metricsOver100 and isNonWorking', () {
    final f = loadFixture('metrics_over_100.json') as Map;
    final cases = f['cases'] as List;
    expect(cases.length, greaterThan(300));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final calc = c['calc'] == null ? null : Map<String, dynamic>.from(c['calc'] as Map);
      expect(metricsOver100(calc), c['out'], reason: 'case $i $calc');
    }
    for (final c in f['nonWorking'] as List) {
      final v = (c as Map)['v'];
      expect(isNonWorking(v == null ? null : Map<String, dynamic>.from(v as Map)), c['out'], reason: '$v');
    }
  });

  group('golden: shift hours (decimal hours)', () {
    final f = loadFixture('shift_hours.json') as Map;

    test('hoursToHm / hoursToShiftInput', () {
      for (final c in f['hoursToHm'] as List) {
        expect(hoursToHm((c as Map)['h']), c['out'], reason: 'hoursToHm ${c['h']}');
      }
      for (final c in f['hoursToShiftInput'] as List) {
        expect(hoursToShiftInput((c as Map)['h']), c['out'], reason: 'hoursToShiftInput ${c['h']}');
      }
    });

    test('parseShiftHours', () {
      for (final c in f['parseShiftHours'] as List) {
        final got = parseShiftHours((c as Map)['t']);
        final want = c['out'] as Map;
        expect(got.hours, want['hours'], reason: 'parseShiftHours ${c['t']}');
      }
    });

    test('hmToWireHours', () {
      for (final c in f['hmToWireHours'] as List) {
        expect(hmToWireHours(((c as Map)['h'] as num).toDouble()), c['out'], reason: '${c['h']}');
      }
    });
  });

  test('new rowCalc figures by hand (Availability / Performance / Quality)', () {
    final c = rowCalc({
      'itemName': 'P',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'totalCycleSec': '45',
      'plannedOperatorShiftHours': '8',
      'actualQty': '600',
      'okQty': '590',
      'lunchMin': '30',
      'plannedDownMin': '10',
      'setupMin': '20',
    });
    expect(c['plannedProdMin'], 480 - 40);
    expect(c['operatingMin'], 480 - 60);
    expect(c['availability'], closeTo(420 / 440, 1e-12));
    expect(c['idealRunSec'], 45 * 600);
    expect(c['performance'], closeTo(45 * 600 / 60 / 420, 1e-12));
    expect(c['quality'], closeTo(590 / 600, 1e-12));
    // Spring's rule: Effective Run Time counts every piece run
    final spring = rowCalc({'itemName': 'P', 'machineOnTime': '08:00', 'machineOffTime': '16:00', 'totalCycleSec': '36', 'actualQty': '300', 'okQty': '200', 'runQtyBasis': 'total'});
    expect(spring['effectiveHours'], 300 * 36 / 3600);
  });

  test('dayCalc: Unutilized is clamped with the raw figure kept; Unreported uses Effective Run Time', () {
    final out = dayCalc([
      {'_id': 'a', 'itemName': 'P', 'machineOnTime': '08:00', 'machineOffTime': '08:30', 'totalCycleSec': '45', 'okQty': '10', 'actualQty': '10', 'plannedOperatorShiftHours': '8'},
    ]).single;
    expect(out['unutilizedRaw'], greaterThan(1));
    expect(out['unutilized'], 1);
    expect(out['unreportedMin'], closeTo(8 * 60 - 10 * 45 / 60, 1e-9));
    expect(out.keys, containsAll(['productivity', 'productivityLunch']));
  });
}
