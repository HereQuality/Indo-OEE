import 'dart:math' as math;

import '../../sheet/widgets/sheet_style.dart' show sheetFormulas;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumStr, jsNumber, jsRound, jsString, jsToFixed, jsTruthy, spanMinutes;

/// Port of client/src/utils/mfdSheet.js — the MODULAR FRAME DRILLING sheet's
/// figures: the CNC sheet's own formulas (shared `rowCalc` / `entryDayCalc`)
/// fed this sheet's fields, with its own IDEAL Quantity:
///
///   Machine Shift Time (Hour)         = Machine Time OFF − Machine Time ON
///   IDEAL Quantity                    = (Machine Shift min − Lunch min) × 60 ÷ Total
///                                       Cycle Time — Lunch / Tea out, NOT rounded down
///                                       (`idealQtyExact`, shown with 0 decimals); the
///                                       cap on Actual is the whole number under it (`idealQty`)
///   IDEAL Quantity/Hour               = IDEAL Quantity ÷ Machine Shift hours (1 decimal)
///   Effective Machine Run Time (Hour) = ACTUAL OK × Total Cycle Time ÷ 3600 (the CNC rule)
///   Efficiency (%)                    = Effective ÷ Machine Shift hours
///   Unreported / the three OEE        = per entry (`entryDayCalc`); a day with a
///                                       Planned from Process Master's lock is combined once.

/// A date's entries per machine (web `MFD_MAX_SLOTS`, server MAX_SLOTS).
const int mfdMaxSlots = 8;

/// A part's Process, set once on the Part (web `MFD_OPERATIONS`, server Item.js).
const List<String> mfdOperations = ['DRILLING', 'TAPPING', 'DRILL/CHAM'];

/// The paper sheet's ten downtime columns, in its own order and wording.
const List<(String, String)> mfdStoppageFields = [
  ('plannedDownMin', 'Planned downtime (min)'),
  ('setupMin', 'Set-up Time (min)'),
  ('noManPowerMin', 'No Manpower (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'B.D. Mech. (min)'),
  ('bdEleMin', 'B.D. Ele. (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('lunchMin', 'Lunch / Tea / Washroom etc (min)'),
  ('otherMin', 'Others (min)'),
];

/// Web `isMfdProcess`: by its Data Entry Page, or — while linked to none — by
/// its whole name (never "DRILLING" alone).
bool isMfdProcess(Map<String, dynamic>? process) {
  final page = process?['dataEntryMenu'];
  if (jsTruthy(page)) return RegExp(r'/modular-frame-drilling-data-entry/?$').hasMatch(jsString(page));
  final name = process?['processName'];
  return RegExp(r'\bmodular\s*frame\s*drilling\b', caseSensitive: false).hasMatch(jsTruthy(name) ? jsString(name) : '');
}

/// Web `mfdIdealQty`: unrounded, Lunch / Tea out.
double mfdIdealQty(double shiftMin, double lunchMin, double cycleSec) => math.max(0, ((shiftMin - lunchMin) * 60) / cycleSec);

/// Web `mfdRowCalc`.
Map<String, dynamic> mfdRowCalc(Map<String, dynamic>? row) {
  final c = calc.rowCalc(row);
  if (row == null) return c;
  final cycle = c['totalCycleSec'];
  final shiftMin = spanMinutes(row['machineOnTime'], row['machineOffTime']);
  final l = jsNumber(row['lunchMin']);
  // JS `num(row.lunchMin) || 0`.
  final lunchMin = (l == null || l.isNaN || l == 0) ? 0.0 : l;
  final double? exact = isNum(cycle) && (cycle as num) > 0 && shiftMin != null ? mfdIdealQty(shiftMin, lunchMin, cycle.toDouble()) : null;
  final eff = c['effectiveHours'];
  return {
    ...c,
    'idealQtyExact': exact,
    'idealQty': exact == null ? null : (exact + 1e-9).floorToDouble(),
    'idealLunchMin': exact == null ? null : lunchMin,
    'idealQtyPerHour': exact != null && shiftMin! > 0 ? exact / (shiftMin / 60) : null,
    'efficiency': isNum(eff) && shiftMin != null && shiftMin > 0 ? (eff as num) / (shiftMin / 60) : null,
  };
}

/// Web `mfdDayCalc`: each entry's own figures, or the day's combined ones on a lock.
List<Map<String, dynamic>> mfdDayCalc(Iterable<Map<String, dynamic>?>? rows) => calc.entryDayCalc(rows ?? const <Map<String, dynamic>?>[]);

/// IDEAL Quantity as the paper shows it (0 decimals) — web `fmtIdeal`.
String fmtIdeal(Object? v) => isNum(v) ? jsNumStr(jsRound((v as num).toDouble())) : '';

/// IDEAL Quantity/Hour (1 decimal) — web `fmtIdealPerHour`.
String fmtIdealPerHour(Object? v) => isNum(v) ? jsToFixed((v as num).toDouble(), 1) : '';

/// The formula popovers of this table's calculated headers (web `MFD_FORMULAS`).
final Map<String, String> mfdFormulas = {
  ...sheetFormulas,
  'shift': 'Machine Shift Time (Hour) = Machine Time OFF − Machine Time ON',
  'cycle': 'Total Cycle Time (Sec) — filled in from the Part when picked, and can be changed for the day.',
  'partRef':
      'Drawing No., Process, No. of Holes and Stroke Required are the Part\'s own (Production › Parts), copied onto the entry when the Part is picked.',
  'idealQty':
      "IDEAL Quantity = (Machine Shift Time in min − Lunch / Tea in min) × 60 ÷ Total Cycle Time, shown with no decimals as on the sheet. Actual Quantity can't be more than the whole number under it.",
  'idealQtyPerHour': 'IDEAL Quantity/Hour = IDEAL Quantity ÷ Machine Shift Time (hours)',
  'actualQty': 'Actual Quantity — every piece run (OK + Rejected), typed on the form.',
  'rejectedQty': 'Rejected Quantity = Actual Quantity − ACTUAL OK Quantity',
  'pctOk': '% OK Quantity = ACTUAL OK Quantity ÷ Actual Quantity',
  'totalStoppage': 'Total stoppage (Min) = the ten downtime columns added up, Lunch / Tea / Washroom included.',
  'effective': 'Effective Machine Run Time (Hour) = ACTUAL OK Quantity × Total Cycle Time ÷ 3600',
  'efficiency': 'Efficiency (%) = Effective Machine Run Time ÷ Machine Shift Time (hours), for this entry.',
  'unreported':
      "Unreported Time (Min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total stoppage, for this entry. A Planned Operator Shift locked in Process Master counts once for the machine's day, so a locked day is combined across its entries.",
  'oeeLosses':
      "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total stoppage ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  'oeeLunch':
      "OEE not considering losses, but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  'oeeLunchCot':
      "OEE not considering losses, but lunch & COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Set-up Time ÷ 60), for this entry (combined across the machine's day on a locked shift). COT = change-over time, the Set-up Time column.",
  'performance':
      'Performance = Total Cycle Time × Actual Quantity ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or downtime.',
};
