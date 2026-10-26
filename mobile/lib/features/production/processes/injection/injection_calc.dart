import '../../sheet/widgets/sheet_style.dart' show sheetFormulas;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/production_sheet_calc.dart' show isNum, jsString, jsTrim, jsTruthy;

/// Port of client/src/utils/injectionSheet.js — the INJECTION MOULDING sheet's
/// figures: the CNC sheet's own formulas (shared `rowCalc` / `entryDayCalc`),
/// fed this sheet's fields, checked against the paper sheet's real rows:
///
///   Machine Shift Time (Hours)        = OFF − ON
///   Ideal Quantity                    = Shift × 3600 ÷ Standard Time per Piece —
///                                       NOT rounded down on this sheet
///                                       (`idealQtyExact`); the cap on TOTAL QTY.
///                                       is still the whole number under it (`idealQty`)
///   Ideal Quantity/Hours              = 3600 ÷ Standard Time per Piece
///   Ok Quantity (%)                   = OK ÷ TOTAL
///   Rejected QTY                      = TOTAL − OK
///   Effective Machine Run Time (hrs)  = TOTAL QTY. × Standard Time ÷ 3600
///   Total Idle Time (Min)             = the ten downtime columns added up
///   Unreported / the three OEE        = per entry (`entryDayCalc`); a day with a
///                                       Planned from Process Master's lock is
///                                       combined once, as on every other sheet.

/// The paper sheet's ten downtime columns, in its own order and wording (web
/// `INJECTION_STOPPAGE_FIELDS`).
const List<(String, String)> injectionStoppageFields = [
  ('plannedDownMin', 'Planned Down Time (min)'),
  ('setupMin', 'Setup Time (min)'),
  ('noManPowerMin', 'No Man Power (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'B.D. Mech. (min)'),
  ('bdEleMin', 'B.D. Ele. (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('lunchMin', 'Lunch / Tea / Washroom etc (Min)'),
  ('otherMin', 'Other (Min)'),
];

/// Web `NON_WORKING_STATUSES`: every Working Status but PRESENT is a day the
/// machine didn't produce — such an entry is status-only.
final List<String> injectionNonWorkingStatuses = [
  for (final s in calc.workingStatuses)
    if (s != 'PRESENT') s,
];

/// Web `isStatusOnly`.
bool injectionIsStatusOnly(Map<String, dynamic>? v) =>
    injectionNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// Web `isInjectionProcess`: a process is INJECTION MOULDING when its Data Entry
/// Page is this page, or — while it is linked to none — it is named so.
bool isInjectionProcess(Map<String, dynamic>? process) {
  final page = process?['dataEntryMenu'];
  if (jsTruthy(page)) return RegExp(r'/injection-moulding-data-entry/?$').hasMatch(jsString(page));
  final name = process?['processName'];
  return RegExp(r'\binjection\b', caseSensitive: false).hasMatch(jsTruthy(name) ? jsString(name) : '');
}

// Effective Machine Run Time counts every piece run — TOTAL QTY. — on this sheet.
Map<String, dynamic>? _withBasis(Map<String, dynamic>? row) => row == null ? null : {...row, 'runQtyBasis': 'total'};

/// Web `injectionRowCalc`: the shared row figures, plus the sheet's own Ideal
/// Quantity (not rounded down — `idealQty` stays the cap) and Ideal
/// Quantity/Hours = 3600 ÷ Standard Time per Piece.
Map<String, dynamic> injectionRowCalc(Map<String, dynamic>? row) {
  final c = calc.rowCalc(_withBasis(row));
  if (row == null) return c;
  final std = c['totalCycleSec'];
  final hasStd = isNum(std) && (std as num) > 0;
  final shift = c['shiftHours'];
  return {
    ...c,
    'idealQtyExact': hasStd && isNum(shift) ? ((shift as num) * 3600) / std : null,
    'idealQtyPerHour': hasStd ? 3600 / std : null,
  };
}

/// Web `injectionDayCalc`: one result per row of one machine's one date (in
/// `sortByMachineOn` order) — each entry's own figures, or the day's combined
/// ones on Process Master's lock.
List<Map<String, dynamic>> injectionDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    calc.entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withBasis(r)]);

/// The formula popovers of this table's calculated headers (web `INJECTION_FORMULAS`).
final Map<String, String> injectionFormulas = {
  ...sheetFormulas,
  'shift': 'Machine Shift Time (Hours) = Machine OFF Time − Machine ON Time',
  'cycle': 'Standard Time per Piece (in Sec) — filled in from the Part when picked, and can be changed for the day.',
  'totalQty': 'TOTAL QTY. = every piece the machine ran (OK + Rejected), typed as Actual Quantity on the form.',
  'rejectedQty': 'Rejected QTY = TOTAL QTY. − OK QTY.',
  'pctOk': 'Ok Quantity (%) = OK QTY. ÷ TOTAL QTY.',
  'idealQty':
      "Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece (shown to 2 decimals, as on the sheet). TOTAL QTY. can't be more than the whole number under it.",
  'idealQtyPerHour': 'Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece',
  'totalStoppage': 'Total Idle Time (Min) = the ten downtime columns added up, Lunch / Tea / Washroom included.',
  'effective':
      'Effective Machine Run Time (hours) = TOTAL QTY. × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry. A Planned Operator Shift locked in Process Master counts once for the machine's day, so a locked day is combined across its entries.",
  'oeeLosses':
      "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total Idle Time ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (combined across the machine's day on a locked shift).",
  'oeeLunchCot':
      "OEE not considering losses but lunch and COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Setup Time ÷ 60), for this entry (combined across the machine's day on a locked shift). COT = change-over time, the Setup Time column.",
  'performance':
      'Performance = Standard Time per Piece × TOTAL QTY. ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or downtime.',
};
