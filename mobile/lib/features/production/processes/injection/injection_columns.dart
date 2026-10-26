import '../../sheet/sheet_model.dart' show Json;
import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'injection_calc.dart';

/// The INJECTION MOULDING table (client/src/Components/Production/
/// injectionColumns.jsx), left to right in the paper sheet's own order and
/// wording. No Drawing No., Setting ON/OFF, Unutilized Machine Time or Setup
/// Efficiency columns. Hours are the sheet's decimal hours (9.5 = 9 h 30 min);
/// Ideal Quantity is the sheet's own (2 decimals, not rounded down); Unreported
/// Time and the three OEE figures are each entry's own, so — unlike most
/// sheets — they are NOT merged across a machine's day.

/// Decimal hours, as the sheet writes them (web `hours`).
String injectionHours(Object? v) => dash(fmtNum(v));

/// A typed figure (web `min`): blank reads as a dash, not as a 0 nobody typed.
String _typed(Object? v) => (v == null || v == '') ? '—' : fmtNum(jsToNumber(v));

/// Web `workingStatus`: "Non Working", a status-only day's own status, else "Working".
String injectionWorkingStatusText(Json r) {
  if (r['workingMode'] == 'Non Working') return 'Non Working';
  final status = jsTrim(jsString(jsTruthy(r['workingStatus']) ? r['workingStatus'] : ''));
  return status.isNotEmpty && status != 'PRESENT' ? status : 'Working';
}

/// Web `notWorkingReasons`: a Non Working day names its reasons — the ticked
/// ones, then whatever the remarks say (W.OFF and the like).
String injectionNotWorkingReasons(Json r) {
  if (r['workingMode'] != 'Non Working') return '—';
  final ticked = r['machineStatus'];
  final remark = jsTrim(jsString(jsTruthy(r['remarks']) ? r['remarks'] : ''));
  return dash([
    if (ticked is List)
      for (final s in ticked)
        if (jsTruthy(s)) jsString(s),
    if (remark.isNotEmpty) remark,
  ].join(', '));
}

/// The table's columns, with the Idle Time breakdown open when [open] has 'downtime'.
SheetColumns injectionColumns(Set<String> open) {
  final left = <SheetCol>[
    SheetCol(
      key: 'date',
      label: 'Date',
      width: 84,
      merge: ColMerge.date,
      bold: true,
      start: true,
      text: (d) => displayDay('${d.row['date']}'),
    ),
    SheetCol(
      key: 'machine',
      label: 'MC No.',
      width: 70,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      text: (d) => d.machineName.isEmpty ? '—' : d.machineName,
    ),
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'itemName', label: 'Item Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    vendorColumn(),
    SheetCol(key: 'operator', label: 'Operator', width: 124, start: true, text: (d) => textStr(d.row['operator'])),
    SheetCol(key: 'workingStatus', label: 'Working Status', width: 112, text: (d) => injectionWorkingStatusText(d.row)),
    SheetCol(
      key: 'notWorkingReasons',
      label: 'Reasons For Not Working',
      width: 150,
      start: true,
      text: (d) => injectionNotWorkingReasons(d.row),
    ),
    SheetCol(key: 'on', label: 'Machine ON Time', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine OFF Time', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (Hours)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => injectionHours(d.calc['shiftHours']),
    ),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Standard Time per Piece (in Sec)',
      width: 150,
      formulaKey: 'cycle',
      text: (d) => _typed(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'totalQty', label: 'TOTAL QTY.', width: 88, formulaKey: 'totalQty', text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'OK QTY.', width: 88, text: (d) => _typed(d.row['okQty'])),
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected QTY',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => nStr(d.calc['rejectedQty']),
    ),
    SheetCol(
      key: 'pctOk',
      label: 'Ok Quantity (%)',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'pctOk',
      text: (d) => pctStr(d.calc['pctOk']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Quantity',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQtyExact']),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'Ideal Quantity/Hours',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
  ];

  // Total Idle Time, opening into the sheet's ten downtime columns (Other carries its remark).
  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (Min)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Idle Time (min)',
    [
      for (final (key, label) in injectionStoppageFields)
        sheetSubCol(
          key,
          label,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' || key == 'lunchMin' ? 124 : 112,
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hours)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => injectionHours(d.calc['effectiveHours']),
    ),
    // Each entry's own (combined across the machine's day only on a locked shift) — not merged.
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    SheetCol(
      key: 'oeeLosses',
      label: 'OEE considering losses (%)',
      width: 124,
      tone: ColTone.oee,
      formulaKey: 'oeeLosses',
      text: (d) => pctStr(d.day['oeeLosses']),
    ),
    SheetCol(
      key: 'oeeLunch',
      label: 'OEE not considering losses but lunch (%)',
      width: 164,
      tone: ColTone.oee,
      formulaKey: 'oeeLunch',
      text: (d) => pctStr(d.day['oeeLunch']),
    ),
    SheetCol(
      key: 'oeeLunchCot',
      label: 'OEE not considering losses but lunch and COT (%)',
      width: 204,
      tone: ColTone.oee,
      formulaKey: 'oeeLunchCot',
      text: (d) => pctStr(d.day['oeeLunchCot']),
    ),
    // This entry's Availability / Performance / Quality (red above 100%) and its Admin review state.
    ...apqColumns(),
    reviewColumn(),
    SheetCol(
      key: 'remarks',
      label: 'Reason/Remarks for Rejection/ Rework',
      width: 84,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'downtime': 'totalStoppage'},
  );
}
