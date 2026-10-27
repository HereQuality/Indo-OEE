// Port of client/src/utils/vmcSheet.js — the VMC sheet's figures.
//
// VMC differs from CNC in where its cycle time comes from: Product Cycle Time =
// Program Time (min) x 60 / No. of Piece In One Program, put where the CNC
// formulas expect it (`totalCycleSec`) and handed to CNC's rowCalc / dayCalc.
// The shared Dart rowCalc / dayCalc (current with the web's productionSheet.js,
// Availability / Performance / Quality and the day-level figures included) are
// reused as they are.

import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumber, jsRound, spanMinutes;
import '../../sheet/sheet_model.dart';

/// Why a machine did not run (MACHINE_NOT_RUN in server/models/VmcEntry.js).
const List<String> machineNotRun = ['M/C OFF', 'ABSENT', 'SUNDAY', 'HOLIDAY', 'STOCK COUNTING', 'REPORT NOT FILLUP'];

/// Program Time and No. of Piece In One Program, as the form's tick boxes offer them.
const List<({String key, String label})> vmcProgramFields = [
  (key: 'programTimeMin', label: 'Program Time (min)'),
  (key: 'pcsPerProgram', label: 'No. of Piece In One Program'),
];

/// Product Cycle Time (sec) = Program Time (min) x 60 / pieces per program;
/// null until both are usable.
double? programCycleSec(Json? row) {
  final minutes = jsNumber(row?['programTimeMin']);
  final pieces = jsNumber(row?['pcsPerProgram']);
  return isNum(minutes) && isNum(pieces) && pieces! > 0 ? (minutes! * 60) / pieces : null;
}

/// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
Json withCycle(Json row) => {...row, 'totalCycleSec': programCycleSec(row) ?? ''};

/// vmcRowCalc: the shared figures over the program-derived cycle time, with
/// Ideal Quantity worked from the whole numbers typed.
Json vmcRowCalc(Json? row) {
  if (row == null) return <String, dynamic>{};
  final calcRow = calc.rowCalc(withCycle(row));
  // Ideal Quantity = FLOOR(Machine Shift (min) x pieces / Program Time (min)) — the
  // same figure as shift seconds / cycle seconds, but from the numbers typed, so a
  // cycle time that doesn't divide evenly (7 min / 9 pcs) can't tip a floor over by 1.
  final shiftMin = spanMinutes(row['machineOnTime'], row['machineOffTime']);
  final minutes = jsNumber(row['programTimeMin']);
  final pieces = jsNumber(row['pcsPerProgram']);
  if (shiftMin == null || !isNum(minutes) || minutes! <= 0 || !isNum(pieces)) return calcRow;
  // Scaled to whole thousandths first so 180 min x 15 pcs / 2.7 min is exactly 1000, not 999.99...
  final idealQty = (jsRound(shiftMin * pieces! * 1000) / jsRound(minutes * 1000)).floorToDouble();
  final shiftHours = calcRow['shiftHours'] as double?;
  // JS: calc.shiftHours ? idealQty / calc.shiftHours : null  (0 and null are falsy)
  return {
    ...calcRow,
    'idealQty': idealQty,
    'idealQtyPerHour': (shiftHours != null && shiftHours != 0 && !shiftHours.isNaN) ? idealQty / shiftHours : null,
  };
}

/// vmcDayCalc: one result per row of one machine's one date (feed it
/// `sortByMachineOn(rows)` like the page does) — the shared dayCalc over the
/// program-derived cycle time, same order and meaning as the web's dayCalc.
List<Json> vmcDayCalc(Iterable<Json?>? rows) =>
    calc.dayCalc([for (final r in rows ?? const <Json?>[]) if (r != null) withCycle(r)]);

/// The formula texts behind the VMC table's calculated headers (web VMC_FORMULAS:
/// the shared FORMULAS with `cycle`, `idealQty` and `idealQtyPerHour` worded for VMC).
const Map<String, String> vmcFormulas = {
  'cycle': 'Product Cycle Time = Program Time (min) × 60 ÷ No. of Piece In One Program.',
  'shift': 'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty':
      "Ideal Quantity = FLOOR(Machine Shift Time (min) × No. of Piece In One Program ÷ Program Time (min)) — the most the shift could make, so Actual Quantity can't be more than this.",
  'rejectedQty':
      'Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.',
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, with Shift Hours and Lunch added up across every entry of this machine's date — so every entry of that machine/date shows the same figure. Shown as 0% when the result is below 0 and 100% when it is above 100.",
  'totalStoppage': 'Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.',
  'effective': 'Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600, shown as hours:minutes (753 × 57 s = 11:55).',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift − Effective Run Time − Total Stoppage, combined across every entry of this machine's date — so every entry of that machine/date shows the same figure.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      "OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every stoppage; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Cycle Time × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or stoppage.',
  'quality': 'Quality = OK Quantity ÷ (OK + Rejected), for this entry.',
  'review':
      'Admin review: an entry whose Availability, Performance, Quality or any of its OEE figures (the Productivity figures, on a worker sheet) is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
  'idealQtyPerHour': 'Ideal Quantity / Hour = Ideal Quantity ÷ Machine Shift Time (hours).',
  // Not in the web map, but the phone's stoppage-allowed note reads it.
  'stoppageAllowed':
      'Stoppage Allowed = the Machine Shift (min): all stoppage together (Lunch / Rest included) can\'t be more than the time the machine ran.',
};
