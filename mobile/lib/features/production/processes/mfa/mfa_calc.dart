// Port of client/src/utils/mfaSheet.js — the MODULAR FRAME ASSEMBLY sheet's
// figures (sheet key "mfa"). Kept per WORKER: each row's `machine` is its
// worker's id (the API sets it). The CNC sheet's own formulas
// (shared/production_sheet_calc.dart) fed this sheet's fields:
//
//   Assembly Start / End Time        → machineOnTime / machineOffTime
//   Standard Assembly Time / pc      → totalCycleSec (prefilled from the Part)
//   TOTAL QTY / OK QTY               → actualQty / okQty; Rejected = TOTAL − OK
//   Ideal Assembly Quantity          = Hours × 3600 ÷ Std — NOT floored
//   Ideal Assembly Quantity/Hour     = 3600 ÷ Std
//   Ideal Assembly Time (hr)         = TOTAL × Std ÷ 3600 (runQtyBasis "total")
//
// Every entry's Unreported / Productivity is its own (entryDayCalc). Verified
// against the REAL JS by golden vectors (test/production/processes/mfa).

import '../../shared/limit_notice.dart' show NoticeWords;
import '../../shared/production_sheet_calc.dart';

/// The sheet's timing words (`MFA_LABELS`).
const String mfaStart = 'Assembly Start Time';
const String mfaEnd = 'Assembly End Time';
const String mfaHours = 'Assembly Working Hours';
const String mfaCycle = 'Standard Assembly Time per Piece';
const String mfaIdealQty = 'Ideal Assembly Quantity';
const String mfaIdealQtyPerHour = 'Ideal Assembly Quantity/Hour';
const String mfaEffective = 'Ideal Assembly Time (In Hour)';

/// The limit popups in this sheet's words (`MFA_WORDS`; no `times`, so "Start / End").
const NoticeWords mfaWords =
    NoticeWords(who: 'Worker', canMake: 'this worker can assemble', shift: mfaHours, timeName: 'Start / End');

/// One worker takes up to this many entries on a date (`MFA_MAX_ENTRIES_PER_DAY`).
const int mfaMaxEntriesPerDay = 8;

/// Web `isMfaProcess`: the linked page first, else the whole name.
bool isMfaProcess(Map<String, dynamic>? process) {
  final page = jsString(process?['dataEntryMenu'] ?? '');
  if (page.isNotEmpty) return RegExp(r'/modular-frame-assembly-data-entry/?$').hasMatch(page);
  return RegExp(r'\bmodular\s*frame\s*assembly\b', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day the worker didn't work.
final List<String> mfaNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`.
bool mfaIsStatusOnly(Map<String, dynamic>? v) => mfaNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// Idle Time on this sheet: Lunch / Tea / Washroom and Other only (`MFA_IDLE_FIELDS`).
const List<(String, String)> mfaIdleFields = [
  ('lunchMin', 'Lunch / Tea / Washroom etc (Min)'),
  ('otherMin', 'Other (Min)'),
];

Map<String, dynamic>? _withBasis(Map<String, dynamic>? row) => row == null ? null : {...row, 'runQtyBasis': 'total'};

/// `mfaRowCalc`: rowCalc on TOTAL, with this sheet's own Ideal Assembly
/// Quantity (not floored) and Quantity/Hour (3600 ÷ Std).
Map<String, dynamic> mfaRowCalc(Map<String, dynamic>? row) {
  final c = rowCalc(_withBasis(row));
  if (row == null) return c;
  final cycle = c['totalCycleSec'];
  final hasCycle = isNum(cycle) && (cycle as num) > 0;
  final shift = c['shiftHours'];
  final double? ideal = hasCycle && isNum(shift) ? (shift as num) * 3600 / cycle : null;
  return {
    ...c,
    'idealQty': ideal,
    'idealQtyFloor': isNum(ideal) ? (ideal! + 1e-9).floorToDouble() : null,
    'idealQtyPerHour': hasCycle ? 3600 / cycle : null,
  };
}

/// `mfaDayCalc`: each entry on its own (combined once on Process Master's lock).
List<Map<String, dynamic>> mfaDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withBasis(r)]);

/// `MFA_FORMULAS`.
const Map<String, String> mfaFormulas = {
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
  'shift': '$mfaHours = $mfaEnd − $mfaStart',
  'cycle': '$mfaCycle — filled in from the Part when picked, and can be changed for the day.',
  'rejectedQty': 'Rejected QTY = TOTAL QTY − OK QTY, so OK + Rejected = TOTAL.',
  'idealQty': '$mfaIdealQty = $mfaHours × 3600 ÷ $mfaCycle — not rounded down, as on the sheet.',
  'idealQtyPerHour': '$mfaIdealQtyPerHour = 3600 ÷ $mfaCycle',
  'totalStoppage': 'Total Idle Time (Min) = Lunch / Tea / Washroom + Other',
  'effective': '$mfaEffective = TOTAL QTY × $mfaCycle ÷ 3600 — every piece assembled counts, rejected ones too.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift × 60 − Ideal Assembly Time × 60 − Time in Other Activity − Total Idle Time, for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivity':
      "Productivity without considering Lunch, tea, etc. = Ideal Assembly Time ÷ (Planned Operator Shift − Other Activity ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivityLunch':
      "Productivity considering Lunch, tea, etc. = Ideal Assembly Time ÷ (Planned Operator Shift − Other Activity ÷ 60 − Lunch / Tea ÷ 60), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'quality': 'Quality = OK QTY ÷ TOTAL QTY, for this entry.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = $mfaHours − Total Idle Time − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = $mfaCycle × TOTAL QTY ÷ Operating Time, for this entry — how fast the assembly went against the standard time. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or idle time.',
};
