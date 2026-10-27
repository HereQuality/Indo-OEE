// The calculation fixes of 2026-10-27 (CALC-001 ... CALC-006), with the same numbers as
// client/src/utils/productionSheet.test.mjs and server/utils/calcFixes.test.js.
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as dash;
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart';
import 'package:indo/features/production/processes/injection/injection_spec.dart';
import 'package:indo/features/production/processes/mfd/mfd_calc.dart';
import 'package:indo/features/production/processes/press/press_calc.dart';
import 'package:indo/features/production/processes/rivet/rivet_calc.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/processes/spm/spm_calc.dart';
import 'package:indo/features/production/processes/vmc/vmc_calc.dart';
import 'package:indo/features/production/shared/planned_shift.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart' as rules;
import 'package:indo/features/production/shared/production_sheet_calc.dart';

void main() {
  group('CALC-001: Ideal Quantity does not floor one low on an exact division', () {
    test('00:00-03:00 at 2.7 s = 4000; RIVET 02:35 at 37.2 s = 250', () {
      expect(rowCalc({'itemName': 'P', 'totalCycleSec': 2.7, 'machineOnTime': '00:00', 'machineOffTime': '03:00'})['idealQty'], 4000);
      expect(rivetRowCalc({'itemName': 'P', 'totalCycleSec': 37.2, 'machineOnTime': '00:00', 'machineOffTime': '02:35'})['idealQty'], 250);
      expect(rowCalc({'itemName': 'P', 'totalCycleSec': 100, 'machineOnTime': '00:00', 'machineOffTime': '00:05'})['idealQty'], 3);
    });
    test('VMC and PRESS: 180 min x 15 pcs / 2.7 min = 1000; 60 min x 7 / 7.5 min = 56', () {
      expect(vmcRowCalc({'itemName': 'P', 'programTimeMin': 2.7, 'pcsPerProgram': 15, 'machineOnTime': '00:00', 'machineOffTime': '03:00'})['idealQty'], 1000);
      expect(pressRowCalc({'itemName': 'P', 'standardTimeMin': 2.7, 'pcsPerStandardTime': 15, 'machineOnTime': '00:00', 'machineOffTime': '03:00'})['idealQty'], 1000);
      expect(vmcRowCalc({'itemName': 'P', 'programTimeMin': 7.5, 'pcsPerProgram': 7, 'machineOnTime': '00:00', 'machineOffTime': '01:00'})['idealQty'], 56);
    });
  });

  test("CALC-002: the dashboard's Ideal QTY for MODULAR FRAME DRILLING takes Lunch out like the table", () {
    final row = <String, dynamic>{
      'date': '2026-10-27', 'machine': 'm', 'itemName': 'P', 'totalCycleSec': 50, 'machineOnTime': '08:15', 'machineOffTime': '18:55',
      'lunchMin': 30, 'calcMode': 'perEntry', 'actualQty': 700, 'okQty': 700,
    };
    expect(mfdRowCalc(row)['idealQtyExact'], 732);
    expect(dash.summarize([{...row, 'idealLessLunch': true}])['idealQty'], 732);
    expect(dash.summarize([{...row}])['idealQty'], 768, reason: 'an unflagged row still reads the plain shift');
  });

  test('CALC-003: a number that rounds to zero never prints a minus', () {
    expect(fmtNum(-2.8e-14), '0');
    expect(fmtNum(-0.0013), '0');
    expect(fmtNum(-0.0), '0');
    expect(fmtNum(-0.5), '-0.5');
    expect(fmtNum(12.5), '12.5');
    expect(fmtPct(-0.00001), '0.00%');
    expect(fmtPct(-0.0), '0.00%');
    expect(fmtPct(0.8333333), '83.33%');
    expect(fmtPct(-0.25), '-25.00%');
    expect(dash.formats['pct']!(-0.00001), '0.00%');
    expect(dash.formats['hours']!(-1e-12), '0 hr');
  });

  group('CALC-004: the form counts a new entry\'s locked 12 h once, as the table does after Save', () {
    Map<String, dynamic> mk(String on, String off, [Map<String, dynamic> extra = const {}]) => {
          'itemName': 'P', 'totalCycleSec': 60, 'machineOnTime': on, 'machineOffTime': off, 'okQty': 200, 'actualQty': 200,
          'plannedOperatorShiftHours': 12, 'machine': 'm', 'date': '2026-10-27', ...extra,
        };
    final saved = [mk('08:00', '12:00', {'_id': 'a', 'plannedLocked': true}), mk('12:30', '16:30', {'_id': 'b', 'plannedLocked': true})];
    final form = mk('17:00', '21:00');

    test('day figures: 83.33% and 120 min, not the old 41.67% and 840', () {
      final wrong = dayFiguresFor(dayCalc, rules.withDecimalPlanned(form), saved)!;
      expect((wrong['oeeLosses'] as double) - 10 / 24, closeTo(0, 1e-9));
      final right = dayFiguresFor(dayCalc, rules.withDecimalPlanned(form, plannedLocked: true), saved)!;
      expect((right['oeeLosses'] as double) - 10 / 12, closeTo(0, 1e-9));
      expect((right['unreportedMin'] as double).round(), 120);
      final afterSave = dayFiguresFor(dayCalc, {...form, 'plannedLocked': true}, saved)!;
      expect(right['oeeLosses'], afterSave['oeeLosses']);
    });

    test('an edited locked entry keeps its own flag', () {
      final edited = dayFiguresFor(
        dayCalc,
        rules.withDecimalPlanned({...form, '_id': 'c', 'plannedLocked': true}),
        [...saved, {...form, '_id': 'c', 'plannedLocked': true}],
      )!;
      expect((edited['oeeLosses'] as double) - 10 / 12, closeTo(0, 1e-9));
    });

    test('ProcessSpec.oeeOver100 passes the lock: a locked day over 100% is flagged, a typed Planned is not marked', () {
      // 3 entries x 250 pcs at 60 s = 12.5 h run on a 12 h lock = 104.17%; counted on 24 h it would read 52%.
      final big = {'okQty': 250, 'actualQty': 250};
      final savedBig = [mk('08:00', '12:00', {'_id': 'a', 'plannedLocked': true, ...big}), mk('12:30', '16:30', {'_id': 'b', 'plannedLocked': true, ...big})];
      final formBig = mk('17:00', '21:00', big);
      const lock = ShiftSetting(locked: true, hours: 12);
      for (final spec in <ProcessSpec>[cncSpec, rivetSpec, injectionSpec]) {
        expect(spec.oeeOver100(formBig, saved: savedBig, plannedShift: lock), containsAll(['oeeLosses', 'oeeLunch', 'oeeLunchCot']), reason: spec.key);
        expect(spec.oeeOver100(formBig, saved: savedBig), isNot(contains('oeeLosses')), reason: '${spec.key} without a lock the 12 h is added twice');
        expect(spec.oeeOver100(formBig, saved: savedBig, plannedShift: lock.copyWith(fromEntry: true)), isNot(contains('oeeLosses')), reason: '${spec.key} a kept-from-entry shift adds no flag');
      }
      expect(rules.withDecimalPlanned(form).containsKey('plannedLocked'), isFalse);
    });
  });

  test('CALC-006: unticking more seconds than the Part has leaves no cycle, not a nonsense one', () {
    const times = {'machineOnTime': '08:00', 'machineOffTime': '16:00'};
    final rivet = rivetRowCalc({
      'itemName': 'P', 'totalCycleSec': 33.1, 'rivetLoadingSec': 21.4, 'rivetProcessSec': 11.7,
      'excludedOps': ['rivetLoadingSec', 'rivetProcessSec'], ...times,
    });
    expect(rivet['totalCycleSec'], isNull);
    expect(rivet['idealQty'], isNull);
    final cnc = rowCalc({'itemName': 'P', 'totalCycleSec': 20, 'boringSec': 36.9, 'excludedOps': ['boringSec'], ...times});
    expect(cnc['totalCycleSec'], isNull);
    expect(cnc['idealQty'], isNull);
    final spm = spmRowCalc({'itemName': 'P', 'totalCycleSec': 20, 'loadingSec': 36.9, 'excludedOps': ['loadingSec'], ...times});
    expect(spm['idealQty'], isNull);
    expect(rowCalc({'itemName': 'P', 'totalCycleSec': 20, 'boringSec': 5.5, 'excludedOps': ['boringSec'], ...times})['totalCycleSec'], 14.5);
  });
}
