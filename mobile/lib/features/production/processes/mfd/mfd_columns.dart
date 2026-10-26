import '../../sheet/sheet_model.dart' show Json;
import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'mfd_calc.dart';

/// The MODULAR FRAME DRILLING table (client/src/Components/Production/
/// mfdColumns.jsx), left to right in the paper sheet's own order and wording.
/// Hours are the sheet's decimal hours; IDEAL Quantity is the sheet's own
/// (Lunch / Tea out) with no decimals and IDEAL Quantity/Hour with one.
/// Unreported Time, Efficiency and the three OEE figures are each entry's own,
/// so — unlike most sheets — they are NOT merged across a machine's day: two
/// overlapping entries on one machine keep their own.

/// Decimal hours, as the sheet writes them (web `hours`).
String mfdHours(Object? v) => dash(fmtNum(v));

/// A typed figure (web `min`): blank reads as a dash, not as a 0 nobody typed.
String _typed(Object? v) => (v == null || v == '') ? '—' : fmtNum(jsToNumber(v));

/// Web `workingStatus`.
String mfdWorkingStatusText(Json r) => r['workingMode'] == 'Non Working' ? 'Non Working' : 'Working';

/// Web `notWorkingReasons`: the ticked reasons, then whatever the remarks say.
String mfdNotWorkingReasons(Json r) {
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

/// The table's columns, with the Downtime breakdown open when [open] has 'downtime'.
SheetColumns mfdColumns(Set<String> open) {
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
      label: 'MC NO.',
      width: 70,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      text: (d) => d.machineName.isEmpty ? '—' : d.machineName,
    ),
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'operator', label: 'Operator', width: 124, start: true, text: (d) => textStr(d.row['operator'])),
    SheetCol(key: 'workingStatus', label: 'Working Status', width: 112, text: (d) => mfdWorkingStatusText(d.row)),
    SheetCol(key: 'notWorkingReasons', label: 'Reasons For Not Working', width: 150, start: true, text: (d) => mfdNotWorkingReasons(d.row)),
    SheetCol(key: 'itemName', label: 'Part Name', width: 180, start: true, text: (d) => textStr(d.row['itemName'])),
    vendorColumn(),
    // The Part's own reference figures, copied onto the entry when it was picked.
    SheetCol(key: 'drawingNo', label: 'Drawing No.', width: 120, start: true, text: (d) => textStr(d.row['drawingNo'])),
    SheetCol(key: 'operation', label: 'Process', width: 96, text: (d) => textStr(d.row['operation'])),
    SheetCol(key: 'noOfHoles', label: 'No. of Holes in One Piece', width: 104, text: (d) => _typed(d.row['noOfHoles'])),
    SheetCol(key: 'strokeRequired', label: 'Stroke Required for One Piece', width: 112, text: (d) => _typed(d.row['strokeRequired'])),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(key: 'cycle', label: 'Total Cycle Time (Sec)', width: 104, formulaKey: 'cycle', text: (d) => _typed(d.row['totalCycleSec'])),
    SheetCol(key: 'on', label: 'Machine Time ON', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine Time OFF', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(key: 'settingOn', label: 'Setting Time ON', width: 92, text: (d) => textStr(d.row['settingOnTime'])),
    SheetCol(key: 'settingOff', label: 'Setting Time OFF', width: 92, text: (d) => textStr(d.row['settingOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (Hour)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => mfdHours(d.calc['shiftHours']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'IDEAL Quantity',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => dash(fmtIdeal(d.calc['idealQtyExact'])),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'IDEAL Quantity/Hour',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => dash(fmtIdealPerHour(d.calc['idealQtyPerHour'])),
    ),
    SheetCol(key: 'actualQty', label: 'Actual Quantity', width: 92, formulaKey: 'actualQty', text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'ACTUAL OK Quantity', width: 100, text: (d) => _typed(d.row['okQty'])),
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected Quantity',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => nStr(d.calc['rejectedQty']),
    ),
    SheetCol(key: 'pctOk', label: '% OK Quantity', width: 96, tone: ColTone.calc, formulaKey: 'pctOk', text: (d) => pctStr(d.calc['pctOk'])),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
  ];

  // Total stoppage, opening into the sheet's ten downtime columns (Others carries its remark).
  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total stoppage (Min)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Downtime (min)',
    [
      for (final (key, label) in mfdStoppageFields)
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
      label: 'Effective Machine Run Time (Hour)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => mfdHours(d.calc['effectiveHours']),
    ),
    // Each entry's own (combined across the machine's day only on a locked shift) — not merged.
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (Min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    SheetCol(
      key: 'efficiency',
      label: 'Efficiency (%)',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'efficiency',
      text: (d) => pctStr(d.calc['efficiency']),
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
      label: 'OEE not considering losses, but lunch (%)',
      width: 164,
      tone: ColTone.oee,
      formulaKey: 'oeeLunch',
      text: (d) => pctStr(d.day['oeeLunch']),
    ),
    SheetCol(
      key: 'oeeLunchCot',
      label: 'OEE not considering losses, but lunch & COT (%)',
      width: 204,
      tone: ColTone.oee,
      formulaKey: 'oeeLunchCot',
      text: (d) => pctStr(d.day['oeeLunchCot']),
    ),
    // This entry's Availability / Performance / Quality (red above 100%) and its Admin review state.
    ...apqColumns(),
    reviewColumn(),
    SheetCol(key: 'remarks', label: 'REMARKS', width: 84, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'downtime': 'totalStoppage'},
  );
}
