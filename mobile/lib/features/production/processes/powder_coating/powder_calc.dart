// Port of client/src/utils/powderCoatingSheet.js — the After Powder Coating
// inspection sheet's figures — together with the parts of the web's current
// utils/productionSheet.js (rowCalc incl. Availability / Performance / Quality,
// dayCalc incl. the two Productivity figures) that it feeds.
//
// The shared Dart `rowCalc` / `dayCalc` (shared/production_sheet_calc.dart) carry
// those additions (`runQtyBasis`, Other Activity, A/P/Q, Productivity), so the
// derived row is simply handed to them. Verified against the REAL JS by golden
// vectors (test/production/processes/powder_coating).
//
//   Inspection Start / End Time   → machineOnTime / machineOffTime
//   Inspection Working Hours      → Machine Shift Time
//   Standard Inspection Time / pc → totalCycleSec
//   TOTAL QTY (typed)             → actualQty
//   Total Defect / Rework         → the four defect counts added up
//   OK QTY                        → Total Qty − Total Defect / Rework
//   Ideal Inspection Time (hr)    → Effective Run Time, on Total Qty

import '../../shared/production_sheet_calc.dart';

/// The sheet's Types of defect / rework, in its own order (key, label).
const List<(String, String)> powderDefectFields = [
  ('lessCoatingQty', 'Less Powder Coating'),
  ('dotsQty', 'Dots'),
  ('missCoatingQty', 'Miss Powder Coating'),
  ('otherDefectQty', 'Other'),
];

/// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const List<(String, String)> powderIdleFields = [
  ('lunchMin', 'Lunch / Tea / Washroom etc (min)'),
  ('otherMin', 'Other (min)'),
];

final List<String> powderDefectKeys = [for (final f in powderDefectFields) f.$1];

/// Every Working Status (utils/productionSheet.js WORKING_STATUSES).
const List<String> powderWorkingStatuses = [
  'PRESENT',
  'ABSENT',
  'LEAVE',
  'M/C OFF',
  'M/C STOP',
  'UNDER MAINT.',
  'SUNDAY',
  'W/OFF',
  'HOLIDAY',
  'STOCK COUNTING',
  'REPORT NOT FILLUP',
];

/// Every Working Status but PRESENT is a day the worker didn't inspect.
final List<String> powderNonWorkingStatuses = [
  for (final s in powderWorkingStatuses)
    if (s != 'PRESENT') s,
];

/// The reasons a Non Working day can carry (MACHINE_STATUSES).
const List<String> powderMachineStatuses = ['Machine Breakdown', 'No Manpower', 'No Planning'];

/// The reasons a new entry is offered (the web's WORKER_STATUSES): a worker has
/// no machine to break down. An entry saved with "Machine Breakdown" still shows it.
final List<String> powderReasonStatuses = [
  for (final s in powderMachineStatuses)
    if (s != 'Machine Breakdown') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool isStatusOnly(Map<String, dynamic>? v) =>
    powderNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// Total Defect / Rework — the four counts added up (blank ones as 0); null
/// while none is typed and there's no Total Qty either.
double? defectTotal(Map<String, dynamic>? row) {
  final typed = [
    for (final k in powderDefectKeys) jsNumber(row?[k]),
  ].where(isNum).cast<double>().toList();
  if (typed.isEmpty && !isNum(jsNumber(row?['actualQty']))) return null;
  return typed.fold<double>(0, (a, b) => a + b);
}

/// A row as the shared formulas read it: OK / Rejected from Total Qty and the
/// defect counts (what the server stores too), Effective Run Time on Total Qty.
Map<String, dynamic>? _withDerived(Map<String, dynamic>? row) {
  if (row == null) return row;
  final total = jsNumber(row['actualQty']);
  final defects = defectTotal(row);
  return {
    ...row,
    'runQtyBasis': 'total',
    if (isNum(total)) ...{'rejectedQty': defects, 'okQty': total! - defects!},
  };
}

/// `powderRowCalc`: the shared formulas over the derived row, plus Total Defect
/// and OK Qty.
Map<String, dynamic> powderRowCalc(Map<String, dynamic>? row) {
  final base = rowCalc(_withDerived(row));
  final total = jsNumber(row?['actualQty']);
  final defects = defectTotal(row);
  return {
    ...base,
    'totalDefect': defects,
    'okQty': isNum(total) ? total! - defects! : null,
  };
}

/// `powderDayCalc`: the web's `dayCalc` over the derived rows, one map per row
/// in `sortByMachineOn` order.
List<Map<String, dynamic>> powderDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    dayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withDerived(r)]);

/// The formula popovers for this table's calculated headers
/// (`POWDER_FORMULAS`, over the web's shared FORMULAS).
const Map<String, String> powderFormulas = {
  'cycle': 'Standard Inspection Time per Piece — filled in from the Part when picked, and can be changed for the day.',
  'rejectedQty':
      'Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.',
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, with Shift Hours and Lunch added up across every entry of this machine's date — so every entry of that machine/date shows the same figure. Shown as 0% when the result is below 0 and 100% when it is above 100.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      "OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Inspection Working Hours − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Standard Inspection Time per Piece × Total Qty ÷ Operating Time, for this entry — how fast the inspection went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.',
  'review':
      'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
  // This sheet's own wording.
  'shift': 'Inspection Working Hours = Inspection End Time − Inspection Start Time',
  'idealQty': 'Ideal Inspection Quantity = Inspection Working Hours × 3600 ÷ Standard Inspection Time per Piece, rounded down.',
  'idealQtyPerHour': 'Ideal Inspection Quantity / Hour = Ideal Inspection Quantity ÷ Inspection Working Hours',
  'totalDefect': 'Total Defect / Rework = Less Powder Coating + Dots + Miss Powder Coating + Other',
  'okQty': 'OK Qty = Total Qty − Total Defect / Rework',
  'totalStoppage': 'Total Idle Time = Lunch / Tea / Washroom + Other',
  'effective': 'Ideal Inspection Time (hr) = Total Qty × Standard Inspection Time per Piece ÷ 3600 — every piece inspected counts.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift − Ideal Inspection Time − Other Activity − Total Idle Time, combined across every entry of this worker's date.",
  'productivity':
      "Productivity without considering Lunch, Tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity), combined across every entry of this worker's date.",
  'productivityLunch':
      "Productivity considering Lunch, Tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity − Lunch / Tea), combined across every entry of this worker's date.",
  'quality': 'Quality = OK Qty ÷ Total Qty, for this entry.',
};
