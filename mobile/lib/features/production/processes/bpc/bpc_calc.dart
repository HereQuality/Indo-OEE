// Port of client/src/utils/bpcSheet.js — the BEFORE POWDER COATING sheet's
// figures (sheet key "bpc"; a different process from AFTER POWDER COATING,
// processes/powder_coating/). Kept per OPERATOR: each row's `machine` is its
// operator's id (the API sets it), so the shared table and day formulas group
// by operator. The SPRING FOR PINS quantity / time model, fed this sheet's fields:
//
//   Machine ON / OFF Time             → machineOnTime / machineOffTime
//   Machine Shift Time (Hours)        = OFF − ON
//   Standard Time per Piece (Sec)     → totalCycleSec (prefilled from the Part)
//   TOTAL QTY / OK QTY                → actualQty / okQty; Rejected = TOTAL − OK
//   Ideal Quantity                    = Shift × 3600 ÷ Std — NOT floored
//   Ideal Quantity/Hours              = 3600 ÷ Std
//   Total Idle Time                   = Setup + B.D. + Lunch + Other
//   Effective Machine Run Time        = TOTAL × Std ÷ 3600 (runQtyBasis "total")
//   Unreported Time                   = Planned×60 − Effective×60 − Idle
//   OEE considering losses            = Eff ÷ (Planned − every stoppage EXCEPT Lunch ÷ 60)
//   OEE not considering losses but lunch = Eff ÷ (Planned − Lunch ÷ 60)
//
// Every entry's Unreported / OEE is its own ([entryDayCalc]); a day on Process
// Master's lock is combined once, as on every other sheet. Verified against the
// REAL JS by golden vectors (test/production/processes/bpc).

import '../../shared/production_sheet_calc.dart';

/// Which sheet a process's data entry happens on is the page it is linked to in
/// Process Master ("Data Entry Page"). A process not linked to any page yet is
/// taken as BEFORE POWDER COATING if it is named so (web `isBpcProcess`).
bool isBpcProcess(Map<String, dynamic>? process) {
  final page = jsString(process?['dataEntryMenu'] ?? '');
  if (page.isNotEmpty) return RegExp(r'/before-powder-coating-data-entry/?$').hasMatch(page);
  return RegExp(r'before\s*powder\s*coating', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day the operator didn't work — such an
/// entry is status-only.
final List<String> bpcNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool bpcIsStatusOnly(Map<String, dynamic>? v) => bpcNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// The sheet's own Rejected QTY columns, in its order (web `BPC_REJECT_REASONS`).
const List<String> bpcRejectReasons = ['Blow Holes Casting', 'Crack/Damage Casting', 'Threading Casting', 'TAP Broken Casting', 'Other'];

/// The sheet's downtime columns, in its order and wording. B.D. (Breakdown) is
/// stored under the shared bdMechMin key, so rowCalc / dayCalc and the server's
/// oeeMetrics count it unchanged (web `BPC_STOPPAGE_FIELDS`).
const List<(String, String)> bpcStoppageFields = [
  ('setupMin', 'Setup Time (min)'),
  ('bdMechMin', 'B.D. (Breakdown) (min)'),
  ('lunchMin', 'Lunch / Tea / Washroom etc (Min)'),
  ('otherMin', 'Other (Min)'),
];

/// One operator takes up to this many entries on a date (the paper has up to six).
const int bpcMaxEntriesPerDay = 8;

/// Effective Machine Run Time counts every piece run — TOTAL QTY — on this sheet.
Map<String, dynamic>? _withBasis(Map<String, dynamic>? row) => row == null ? null : {...row, 'runQtyBasis': 'total'};

/// `bpcRowCalc`: rowCalc's figures with this sheet's own Ideal Quantity — not
/// floored (the paper shows 102.857…) — and Ideal Quantity/Hours = 3600 ÷
/// Standard Time. `idealQtyFloor` is the whole pieces the shift could make.
Map<String, dynamic> bpcRowCalc(Map<String, dynamic>? row) {
  final c = rowCalc(_withBasis(row));
  if (row == null) return c;
  final Object? rawCycle = c['totalCycleSec'];
  final Object? rawShift = c['shiftHours'];
  final double? cycle = isNum(rawCycle) && (rawCycle as num) > 0 ? rawCycle.toDouble() : null;
  final double? shift = isNum(rawShift) ? (rawShift as num).toDouble() : null;
  final double? idealQty = cycle != null && shift != null ? (shift * 3600) / cycle : null;
  return {
    ...c,
    'idealQty': idealQty,
    'idealQtyFloor': isNum(idealQty) ? (idealQty! + 1e-9).floorToDouble() : null,
    'idealQtyPerHour': cycle != null ? 3600 / cycle : null,
  };
}

/// `bpcDayCalc`: Unreported Time and the two OEE figures, one result per row in
/// [sortByMachineOn] order — each entry on its own (combined once for a day on
/// Process Master's lock); OEE considering losses leaves Lunch out of the losses.
List<Map<String, dynamic>> bpcDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withBasis(r)], lossesExceptLunch: true);

/// The rejected pieces the reason columns add up to — the paper's total after them.
double rejectSplitTotal(Map<String, dynamic>? row) {
  final split = row?['rejectBreakdown'];
  var sum = 0.0;
  for (final r in bpcRejectReasons) {
    final n = jsToNumber(split is Map ? split[r] : null);
    if (n.isFinite) sum += n;
  }
  return sum;
}

/// The formula popovers for this table's calculated headers (`BPC_FORMULAS`,
/// over the web's shared FORMULAS).
const Map<String, String> bpcFormulas = {
  // utils/sheetFormulas.js FORMULAS — the ones this sheet doesn't word its own way.
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, with Shift Hours and Lunch added up across every entry of this machine's date — so every entry of that machine/date shows the same figure. Shown as 0% when the result is below 0 and 100% when it is above 100.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'review':
      'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
  // This sheet's own wording.
  'shift': 'Machine Shift Time (Hours) = Machine OFF Time − Machine ON Time',
  'cycle': 'Standard Time per Piece — filled in from the Part when picked, and can be changed for the day.',
  'rejectedQty':
      'Rejected QTY = TOTAL QTY − OK QTY, so OK + Rejected = TOTAL. The breakdown shows how it splits across Blow Holes, Crack/Damage, Threading, TAP Broken and Other.',
  'rejectSplitTotal': 'The reason columns added up — always equal to Rejected QTY.',
  'idealQty': 'Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece — not rounded down, as on the sheet.',
  'idealQtyPerHour': 'Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece',
  'totalStoppage': 'Total Idle Time (Min) = Setup Time + B.D. (Breakdown) + Lunch / Tea / Washroom + Other',
  'effective':
      'Effective Machine Run Time (hours) = TOTAL QTY × Standard Time per Piece ÷ 3600 — every piece run counts, rejected ones too.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  'oeeLosses':
      "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − (Setup + B.D. + Other) ÷ 60) — every stoppage except Lunch / Tea, for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the operator's whole date).",
  'performance':
      'Performance = Standard Time per Piece × TOTAL QTY ÷ Operating Time, for this entry. Above 100% (red) sends the entry to Admin review — usually a wrong time per piece, quantity or idle time.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift Time − Total Idle Time; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.',
  'quality': 'Quality = OK QTY ÷ TOTAL QTY, for this entry.',
};
