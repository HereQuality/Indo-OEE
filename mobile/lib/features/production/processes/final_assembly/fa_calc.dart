// Port of client/src/utils/finalAssemblySheet.js — the FINAL ASSEMBLY sheet's
// figures: After Powder Coating's shape, kept per WORKER (each row's `machine`
// is its worker's id). The shared formulas (shared/production_sheet_calc.dart)
// fed this sheet's fields:
//
//   Start / End Time                 → machineOnTime / machineOffTime
//   Working Hours                    = End − Start
//   Standard Time per Piece (Sec)    → totalCycleSec — OPTIONAL (PACKING has none)
//   Total QTY (typed)                → actualQty
//   Types of Defects (typed)         → rejectBreakdown over [faDefectReasons]
//   Total Defects / Rejected QTY     = the defects added up
//   OK QTY                           = Total QTY − Total Defects
//   Ideal Quantity                   = Hours × 3600 ÷ Std — NOT floored (blank without Std)
//   Ideal Quantity/Hour              = 3600 ÷ Std
//   Effective time (hr)              = Total QTY × Std ÷ 3600 (0 without Std)
//   Unreported / the two Productivity figures: entryDayCalc, each entry on its own.
//
// Verified against the REAL JS by golden vectors (test/production/processes/final_assembly).

import '../../shared/production_sheet_calc.dart';
import '../../sheet/widgets/sheet_style.dart' show sheetFormulas;

/// The sheet's labels in one place (web FA_LABELS).
abstract final class FaLabels {
  static const sheet = 'FINAL ASSEMBLY';
  static const worker = 'Worker Name';
  static const workers = 'workers';
  static const itemName = 'Item Name';
  static const workingStatus = 'Working Status';
  static const reasons = 'Reasons For Not Working';
  static const start = 'Assembly Start Time';
  static const end = 'Assembly End Time';
  static const hours = 'Assembly Working Hours';
  static const std = 'Standard Time per Piece (Sec)';
  static const totalQty = 'Total QTY';
  static const okQty = 'OK QTY';
  static const rejectedQty = 'Rejected QTY';
  static const defects = 'Types of Defects';
  static const totalDefects = 'Total Defects';
  static const idealQty = 'Ideal Quantity';
  static const idealQtyPerHour = 'Ideal Quantity/Hour';
  static const otherActivity = 'Other Activity Carried out';
  static const otherActivityMin = 'Time consume in Other Activity (min)';
  static const lunchMin = 'Lunch / Tea / Washroom etc (Min)';
  static const otherMin = 'Other (Min)';
  static const totalIdle = 'Total Idle (Min)';
  static const effective = 'Effective Assembly Time (hr)';
  static const unreported = 'Unreported (min)';
  static const productivity = 'Productivity without considering Lunch, tea, etc. (%)';
  static const productivityLunch = 'Productivity Considering Lunch, tea, etc. (%)';
  static const remarks = 'Remarks';

  /// Every label by its web key (for the parity test).
  static const Map<String, String> all = {
    'sheet': sheet,
    'worker': worker,
    'workers': workers,
    'itemName': itemName,
    'workingStatus': workingStatus,
    'reasons': reasons,
    'start': start,
    'end': end,
    'hours': hours,
    'std': std,
    'totalQty': totalQty,
    'okQty': okQty,
    'rejectedQty': rejectedQty,
    'defects': defects,
    'totalDefects': totalDefects,
    'idealQty': idealQty,
    'idealQtyPerHour': idealQtyPerHour,
    'otherActivity': otherActivity,
    'otherActivityMin': otherActivityMin,
    'lunchMin': lunchMin,
    'otherMin': otherMin,
    'totalIdle': totalIdle,
    'effective': effective,
    'unreported': unreported,
    'productivity': productivity,
    'productivityLunch': productivityLunch,
    'remarks': remarks,
  };
}

/// Web `isFinalAssemblyProcess`: the page a process is linked to, or — not
/// linked yet — its whole name (so MODULAR FRAME ASSEMBLY is never taken for it).
bool isFinalAssemblyProcess(Map<String, dynamic>? process) {
  final page = process?['dataEntryMenu'];
  if (jsTruthy(page)) return RegExp(r'/final-assembly-data-entry/?$').hasMatch(jsString(page));
  return RegExp(r'\bfinal\s*assembly\b', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day the worker didn't work.
final List<String> faNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool isStatusOnly(Map<String, dynamic>? v) => faNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// The sheet's Types of Defects, in its order (FA_DEFECT_REASONS).
const List<String> faDefectReasons = ['Wrong Assembly', 'Broken Screw', 'Wrong Clamping', 'Other'];

/// Idle Time on this sheet: Lunch / Tea / Washroom and Other only (key, label).
const List<(String, String)> faIdleFields = [
  ('lunchMin', FaLabels.lunchMin),
  ('otherMin', FaLabels.otherMin),
];

/// One worker takes up to this many entries on a date, and they MAY overlap.
const int faMaxEntriesPerDay = 12;

bool _isNum(double? v) => v != null && v.isFinite;

Object? _defect(Map<String, dynamic>? row, String reason) {
  final rb = row?['rejectBreakdown'];
  return rb is Map ? rb[reason] : null;
}

/// Total Defects — the defect boxes added up (blank ones as 0); null while none
/// is typed and there's no Total QTY either.
double? defectTotal(Map<String, dynamic>? row) {
  final typed = [for (final r in faDefectReasons) jsNumber(_defect(row, r))].where(_isNum).cast<double>().toList();
  if (typed.isEmpty && !_isNum(jsNumber(row?['actualQty']))) return null;
  return typed.fold<double>(0, (a, b) => a + b);
}

/// A row as the shared formulas read it: OK / Rejected from Total QTY and the
/// defects, Effective time on Total QTY.
Map<String, dynamic>? _withDerived(Map<String, dynamic>? row) {
  if (row == null) return row;
  final total = jsNumber(row['actualQty']);
  final defects = defectTotal(row);
  return {
    ...row,
    'runQtyBasis': 'total',
    if (_isNum(total)) ...{'rejectedQty': defects, 'okQty': total! - defects!},
  };
}

/// `faRowCalc`: rowCalc's figures with this sheet's own Ideal Quantity (not
/// floored, blank without a Standard Time) and Ideal Quantity/Hour, plus Total
/// Defects and OK QTY.
Map<String, dynamic> faRowCalc(Map<String, dynamic>? row) {
  final c = rowCalc(_withDerived(row));
  if (row == null) return c;
  final cycle = isNum(c['totalCycleSec']) ? (c['totalCycleSec'] as num).toDouble() : null;
  final hasCycle = cycle != null && cycle > 0;
  final shift = isNum(c['shiftHours']) ? (c['shiftHours'] as num).toDouble() : null;
  final idealQty = hasCycle && shift != null ? (shift * 3600) / cycle : null;
  final total = jsNumber(row['actualQty']);
  final defects = defectTotal(row);
  final eff = c['effectiveHours'];
  return {
    ...c,
    'idealQty': idealQty,
    'idealQtyFloor': _isNum(idealQty) ? (idealQty! + 1e-9).floorToDouble() : null,
    'idealQtyPerHour': hasCycle ? 3600 / cycle : null,
    // No Standard Time (PACKING): Effective time is 0, as on the paper.
    'effectiveHours': isNum(eff) ? eff : (shift != null ? 0.0 : null),
    'totalDefect': defects,
    'okQty': _isNum(total) ? total! - defects! : null,
  };
}

/// `faDayCalc`: Unreported and the two Productivity figures, one result per row
/// in sortByMachineOn order — each entry on its own (combined once on a locked day).
List<Map<String, dynamic>> faDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withDerived(r)]);

/// The formula popovers for this table's calculated headers (FA_FORMULAS).
final Map<String, String> faFormulas = {
  ...sheetFormulas,
  'shift': '${FaLabels.hours} = ${FaLabels.end} − ${FaLabels.start}',
  'cycle': '${FaLabels.std} — filled in from the Part when picked, can be changed for the day, and may be left blank (PACKING has none).',
  'idealQty': '${FaLabels.idealQty} = ${FaLabels.hours} × 3600 ÷ Standard Time per Piece — not rounded down; blank without a Standard Time.',
  'idealQtyPerHour': '${FaLabels.idealQtyPerHour} = 3600 ÷ Standard Time per Piece',
  'rejectedQty': '${FaLabels.rejectedQty} = ${FaLabels.totalDefects} = ${faDefectReasons.join(' + ')}. The breakdown shows each.',
  'totalDefect': '${FaLabels.totalDefects} = ${faDefectReasons.join(' + ')}',
  'okQty': '${FaLabels.okQty} = ${FaLabels.totalQty} − ${FaLabels.totalDefects}',
  'totalStoppage': '${FaLabels.totalIdle} = Lunch / Tea / Washroom + Other',
  'effective': '${FaLabels.effective} = ${FaLabels.totalQty} × Standard Time per Piece ÷ 3600 — every piece counts; 0 without a Standard Time.',
  'unreported':
      "${FaLabels.unreported} = Planned Operator Shift × 60 − Effective time × 60 − Other Activity − Total Idle, for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivity':
      "Productivity without considering Lunch, tea, etc. = Effective time ÷ (Planned Operator Shift − Other Activity), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'productivityLunch':
      "Productivity considering Lunch, tea, etc. = Effective time ÷ (Planned Operator Shift − Other Activity − Lunch / Tea), for this entry (with Process Master's fixed shift: combined across the worker's whole date).",
  'quality': 'Quality = ${FaLabels.okQty} ÷ ${FaLabels.totalQty}, for this entry.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Working Hours − Total Idle − Other Activity; Planned Production Time = Planned Operator Shift − Lunch / Tea. Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Standard Time per Piece × Total QTY ÷ Operating Time, for this entry (blank without a Standard Time). Above 100% (red) sends the entry to Admin review.',
};
