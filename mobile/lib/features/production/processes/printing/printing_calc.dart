// Port of client/src/utils/printingSheet.js — the PRINTING sheet's figures:
// the shared formulas (shared/production_sheet_calc.dart) fed this sheet's
// fields, the SPRING FOR PINS way:
//
//   Standard Time per Piece (sec)   → totalCycleSec (prefilled from the Part)
//   TOTAL QTY. / OK QTY.            → actualQty / okQty (Rejected = TOTAL − OK)
//   Effective Machine Run Time      → on TOTAL QTY (runQtyBasis "total")
//   Total Idle Time                 → every one of its 13 downtime columns: its
//                                     own three (extraStoppageKeys) + the ten
// plus, as the paper sheet shows them:
//   Ideal Quantity        = Machine Shift × 3600 ÷ Std, NOT rounded (idealQtyExact)
//                           — the cap on TOTAL QTY still uses it rounded down (idealQty)
//   Ideal Quantity/Hours  = 3600 ÷ Std
//
// Kept per OPERATOR: each row's `machine` is its operator's id (the API sets
// it), so the shared table and day formulas group by operator. The MC No. is
// optional and is `mcMachine`, never the row key. Each entry is worked out on
// its own (entryDayCalc). Verified against the REAL JS by golden vectors
// (test/production/processes/printing).

import '../../shared/production_sheet_calc.dart';
import '../../sheet/widgets/sheet_style.dart' show sheetFormulas;

/// Which sheet a process's data entry happens on is the page it is linked to in
/// Process Master (its "Data Entry Page"). A process not linked to any page yet
/// is taken as PRINTING if it is named so (web `isPrintingProcess`).
bool isPrintingProcess(Map<String, dynamic>? process) {
  final page = process?['dataEntryMenu'];
  if (jsTruthy(page)) return RegExp(r'/printing-data-entry/?$').hasMatch(jsString(page));
  return RegExp(r'\bprinting\b', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day with no work — such an entry is
/// status-only. Keep in step with server/models/PrintingEntry.js.
final List<String> printingNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool isStatusOnly(Map<String, dynamic>? v) =>
    printingNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// Most entries one operator may have on a date (MAX_SLOTS on the server).
const int printingMaxEntries = 8;

/// Printing's own downtime columns, ahead of the ten every sheet has. Keep in
/// step with PRINTING_EXTRA_STOPPAGE_KEYS in server/models/PrintingEntry.js.
/// The same shape as `stoppageFields`, so the dashboard can list them beside it.
const List<Map<String, dynamic>> printingExtraStoppageFields = [
  {'key': 'askQueryQcMin', 'label': 'Ask Query To QC Team (min)'},
  {'key': 'emptyBagTuggingMin', 'label': 'Empty Bag Tugging (min)'},
  {'key': 'stockCountingMin', 'label': 'Stock Counting (min)'},
];

const List<String> printingExtraStoppageKeys = ['askQueryQcMin', 'emptyBagTuggingMin', 'stockCountingMin'];

/// The ten shared columns in the paper sheet's own wording.
const Map<String, String> _sheetWording = {
  'plannedDownMin': 'Planned Down Time (min)',
  'setupMin': 'Setup Time (min)',
  'noManPowerMin': 'No Man Power (min)',
  'materialShiftingMin': 'Material Shifting (min)',
  'noMaterialMin': 'No Material (min)',
  'bdMechMin': 'B.D. Mech. (min)',
  'bdEleMin': 'B.D. Ele. (min)',
  'noPowerMin': 'No Power (min)',
  'lunchMin': 'Lunch / Tea / Washroom etc (Min)',
  'otherMin': 'Other (Min)',
};

/// Every downtime column of the sheet, in its own order (key, label).
final List<(String, String)> printingStoppageFields = [
  for (final f in printingExtraStoppageFields) (f['key'] as String, f['label'] as String),
  for (final f in stoppageFields) (f['key'] as String, _sheetWording[f['key']] ?? f['label'] as String),
];

/// Every downtime key of the sheet, in its own order.
final List<String> printingStoppageKeys = [for (final f in printingStoppageFields) f.$1];

/// What every row of this sheet tells the shared formulas (web `withPrinting`):
/// Effective Run Time on TOTAL QTY, and its three own downtime columns counted
/// as stoppage.
Map<String, dynamic>? withPrinting(Map<String, dynamic>? row) =>
    row == null ? null : {...row, 'runQtyBasis': 'total', 'extraStoppageKeys': printingExtraStoppageKeys};

/// `printingRowCalc`: the shared formulas over the adapted row, plus the
/// sheet's own unrounded Ideal Quantity and Ideal Quantity/Hours.
Map<String, dynamic> printingRowCalc(Map<String, dynamic>? row) {
  final c = rowCalc(withPrinting(row));
  if (row == null) return c;
  final std = isNum(c['totalCycleSec']) ? (c['totalCycleSec'] as num).toDouble() : null;
  final hasStd = std != null && std > 0;
  final shift = isNum(c['shiftHours']) ? (c['shiftHours'] as num).toDouble() : null;
  return {
    ...c,
    // The sheet's own Ideal Quantity, unrounded (942.86); idealQty stays the
    // rounded-down figure TOTAL QTY is capped at.
    'idealQtyExact': hasStd && shift != null ? (shift * 3600) / std : null,
    'idealQtyPerHour': hasStd ? 3600 / std : null,
  };
}

/// `printingDayCalc`: one result per row, in sortByMachineOn order — each entry
/// on its own (a day on Process Master's locked shift is combined once).
List<Map<String, dynamic>> printingDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    entryDayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) withPrinting(r)]);

/// The formula popovers for this table's calculated headers (PRINTING_FORMULAS).
final Map<String, String> printingFormulas = {
  ...sheetFormulas,
  ..._printingOwnFormulas,
};

const Map<String, String> _printingOwnFormulas = {
  'shift': 'Machine Shift Time = Machine OFF Time − Machine ON Time',
  'cycle': 'Standard Time per Piece — filled in from the Part when picked, and can be changed for the day.',
  'idealQty':
      "Ideal Quantity = Machine Shift Time × 3600 ÷ Standard Time per Piece, as the sheet shows it (not rounded). TOTAL QTY can't be more than it rounded down — a part-piece can't be made.",
  'idealQtyPerHour': 'Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece',
  'pctOk': 'Ok Quantity (%) = OK QTY ÷ TOTAL QTY',
  'rejectedQty': 'Rejected QTY = TOTAL QTY − OK QTY.',
  'totalStoppage':
      'Total Idle Time = every downtime column added up — Ask Query To QC Team, Empty Bag Tugging and Stock Counting included.',
  'effective': 'Effective Machine Run Time = TOTAL QTY × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift × 60 − Effective Machine Run Time × 60 − Total Idle Time, for this entry (a day on Process Master's locked shift: combined across the operator's date).",
  'oeeLosses':
      "OEE considering losses = Effective Machine Run Time ÷ (Planned Operator Shift − Total Idle Time ÷ 60), for this entry (a day on Process Master's locked shift: combined across the operator's date).",
  'oeeLunch':
      'OEE not considering losses but lunch = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60), for this entry (a locked-shift day: combined).',
  'oeeLunchCot':
      'OEE not considering losses but lunch and COT = Effective Machine Run Time ÷ (Planned Operator Shift − Lunch ÷ 60 − Setup Time ÷ 60), for this entry (a locked-shift day: combined).',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every downtime column; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Standard Time per Piece × TOTAL QTY ÷ Operating Time, for this entry. Above 100% (red) sends the entry to Admin review: usually a wrong time per piece, quantity or downtime.',
  'quality': 'Quality = OK QTY ÷ TOTAL QTY, for this entry.',
};
