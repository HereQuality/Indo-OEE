import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_form_logic.dart';

Map<String, dynamic> _row(Map<String, dynamic> extra) => {
      'itemName': 'Part 1',
      'totalCycleSec': '57',
      'machineOnTime': '08:00',
      'machineOffTime': '20:00',
      'actualQty': '757',
      'okQty': '753',
      'plannedOperatorShiftHours': '13.00',
      'lunchMin': '30',
      'setupMin': '30',
      ...extra,
    };

void main() {
  test('Unreported Time in the form = Planned Operator Shift − Machine Shift − Total Stoppage, in whole minutes', () {
    // 13:00 planned, 12:00 machine, 60 stoppage (30 + 30): all 60 allowed min are logged
    expect(EntryMetrics(_row({})).stoppageLimit, 60);
    expect(EntryMetrics(_row({})).unreportedMin, 0);
    // 14:00 planned: 120 allowed, 60 logged -> 60 unreported (not 64.65)
    expect(EntryMetrics(_row({'plannedOperatorShiftHours': '14.00'})).unreportedMin, 60);
    // good-part run time (OK x cycle) plays no part
    expect(EntryMetrics(_row({'plannedOperatorShiftHours': '14.00', 'okQty': '100'})).unreportedMin, 60);
    // no Planned yet, or no machine times -> nothing to show
    expect(EntryMetrics(_row({'plannedOperatorShiftHours': ''})).unreportedMin, isNull);
    expect(EntryMetrics(_row({'machineOffTime': ''})).unreportedMin, isNull);
  });
}
