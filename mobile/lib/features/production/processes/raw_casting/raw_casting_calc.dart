// Port of client/src/utils/rawCastingSheet.js — the RAW CASTING inspection
// sheet's figures (sheet key "rawCasting"), on After Powder Coating's template.
// Kept per WORKER: each row's `machine` is its worker's id (the API sets it).
//
//   Inspection Start / End Time        → machineOnTime / machineOffTime
//   Inspection Working Hours           = End − Start
//   Standard Inspection Time / pc      → totalCycleSec (prefilled from the Part)
//   TOTAL QTY (typed)                  → actualQty
//   Types of Defects                   → rejectBreakdown over [rawCastingDefects]
//   Total Defects                      = the three added up
//   OK QTY                             = TOTAL − Total Defects
//   Ideal Inspection Quantity          = Hours × 3600 ÷ Std — NOT floored
//   Ideal Inspection Quantity/Hour     = 3600 ÷ Std
//   Ideal Inspection Time (hr)         = TOTAL × Std ÷ 3600 (runQtyBasis "total")
//   Unreported / the two Productivity  = each entry's own ([entryDayCalc]); a day
//                                        on Process Master's lock is combined once.
// Verified against the REAL JS by golden vectors (test/production/processes/raw_casting).

import '../../shared/production_sheet_calc.dart';

/// Web `isRawCastingProcess`: the page the process is linked to, else its name.
bool isRawCastingProcess(Map<String, dynamic>? process) {
  final page = jsString(process?['dataEntryMenu'] ?? '');
  if (page.isNotEmpty) return RegExp(r'/raw-casting-data-entry/?$').hasMatch(page);
  return RegExp(r'\braw\s*casting\b', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day the worker didn't inspect.
final List<String> rawCastingNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool rawCastingIsStatusOnly(Map<String, dynamic>? v) =>
    rawCastingNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// The sheet's Types of Defects, in its own order, kept as the entry's
/// Rejection Master split (`rejectBreakdown`).
const List<String> rawCastingDefects = ['Blow Holes Casting', 'Crack/Damage Casting', 'Other'];

/// Idle Time on this sheet: Lunch / Tea / Washroom and Other only.
const List<(String, String)> rawCastingIdleFields = [
  ('lunchMin', 'Lunch / Tea / Washroom etc (Min)'),
  ('otherMin', 'Other (Min)'),
];

/// One worker takes up to this many entries on a date.
const int rawCastingMaxEntriesPerDay = 8;

double? _defect(Map<String, dynamic>? row, String d) {
  final split = row?['rejectBreakdown'];
  return jsNumber(split is Map ? split[d] : null);
}

/// Total Defects — the three counts added up (blank ones as 0); null while none
/// is typed and there's no TOTAL QTY either.
double? rawCastingDefectTotal(Map<String, dynamic>? row) {
  final typed = [for (final d in rawCastingDefects) _defect(row, d)].where(isNum).cast<double>().toList();
  if (typed.isEmpty && !isNum(jsNumber(row?['actualQty']))) return null;
  return typed.fold<double>(0, (a, b) => a + b);
}

Map<String, dynamic>? _withDerived(Map<String, dynamic>? row) {
  if (row == null) return row;
  final total = jsNumber(row['actualQty']);
  final defects = rawCastingDefectTotal(row);
  return {
    ...row,
    'runQtyBasis': 'total',
    if (isNum(total)) ...{'rejectedQty': defects, 'okQty': total! - defects!},
  };
}

/// `rawCastingRowCalc`: rowCalc's figures with this sheet's own unrounded Ideal
/// Inspection Quantity, Ideal/Hour = 3600 ÷ Std, Total Defects and OK QTY.
Map<String, dynamic> rawCastingRowCalc(Map<String, dynamic>? row) {
  final c = rowCalc(_withDerived(row));
  if (row == null) return c;
  final Object? rawCycle = c['totalCycleSec'];
  final Object? rawShift = c['shiftHours'];
  final double? cycle = isNum(rawCycle) && (rawCycle as num) > 0 ? rawCycle.toDouble() : null;
  final double? shift = isNum(rawShift) ? (rawShift as num).toDouble() : null;
  final double? idealQty = cycle != null && shift != null ? (shift * 3600) / cycle : null;
  final total = jsNumber(row['actualQty']);
  final defects = rawCastingDefectTotal(row);
  return {
    ...c,
    'idealQty': idealQty,
    'idealQtyFloor': isNum(idealQty) ? (idealQty! + 1e-9).floorToDouble() : null,
    'idealQtyPerHour': cycle != null ? 3600 / cycle : null,
    'totalDefect': defects,
    'okQty': isNum(total) ? total! - defects! : null,
  };
}

/// `rawCastingDayCalc`: Unreported Time and the two Productivity figures, one
/// result per row in [sortByMachineOn] order — each entry on its own.
List<Map<String, dynamic>> rawCastingDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withDerived(r)]);

/// The formula popovers (`RAW_CASTING_FORMULAS`, over the web's shared FORMULAS).
const Map<String, String> rawCastingFormulas = {
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
  'review':
      'Admin review: an entry whose Availability, Performance, Quality or any of its OEE figures (the Productivity figures, on a worker sheet) is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
  'shift': 'Inspection Working Hours = Inspection End Time − Inspection Start Time',
  'cycle': 'Standard Inspection Time per Piece — filled in from the Part when picked, and can be changed for the day.',
  'idealQty':
      'Ideal Inspection Quantity = Inspection Working Hours × 3600 ÷ Standard Inspection Time per Piece — not rounded down, as on the sheet.',
  'idealQtyPerHour': 'Ideal Inspection Quantity/Hour = 3600 ÷ Standard Inspection Time per Piece',
  'totalDefect': 'Total Defects = Blow Holes Casting + Crack/Damage Casting + Other',
  'okQty': 'OK QTY = TOTAL QTY − Total Defects',
  'totalStoppage': 'Total Idle Time (Min) = Lunch / Tea / Washroom + Other',
  'effective':
      'Ideal Inspection Time (hours) = TOTAL QTY × Standard Inspection Time per Piece ÷ 3600 — every piece inspected counts.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift × 60 − Ideal Inspection Time × 60 − Time in Other Activity − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivity':
      "Productivity without considering Lunch, tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivityLunch':
      "Productivity considering Lunch, tea, etc. = Ideal Inspection Time ÷ (Planned Operator Shift − Other Activity ÷ 60 − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'quality': 'Quality = OK QTY ÷ TOTAL QTY, for this entry.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Inspection Working Hours − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Standard Inspection Time per Piece × TOTAL QTY ÷ Operating Time, for this entry — how fast the inspection went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.',
};
