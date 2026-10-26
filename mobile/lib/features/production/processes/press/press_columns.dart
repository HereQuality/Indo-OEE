import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../shared/production_sheet_calc.dart' show displayDay, rejectReasons;
import '../../sheet/widgets/sheet_format.dart';

/// The sheet's own wording for each downtime column (pressColumns.jsx).
const Map<String, String> pressDowntimeLabel = {
  'plannedDownMin': 'Planned Downtime',
  'setupMin': 'Set-up Time',
  'noManPowerMin': 'No Manpower',
  'materialShiftingMin': 'Material Shifting',
  'noMaterialMin': 'No Material',
  'bdMechMin': 'B.D. Mech.',
  'bdEleMin': 'B.D. Ele.',
  'noPowerMin': 'No Power',
  'lunchMin': 'Lunch / Tea / Washroom etc',
  'otherMin': 'Others',
};

/// Sheet order — Planned Downtime first, Others last.
const List<String> pressDowntimeOrder = [
  'plannedDownMin',
  'setupMin',
  'noManPowerMin',
  'materialShiftingMin',
  'noMaterialMin',
  'bdMechMin',
  'bdEleMin',
  'noPowerMin',
  'lunchMin',
  'otherMin',
];

/// The PRESS table's columns, left to right exactly as the web (pressColumns.jsx)
/// lists them — no Unutilized Machine Time column, Setup Efficiency before
/// Effective Machine Run Time — with the ten stoppage figures folded behind
/// Total Stoppage as [open] says. The Vendor Name column shows only
/// for a process with vendors.
SheetColumns pressColumns(Set<String> open) {
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
      label: 'Machine',
      width: 70,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      text: (d) => d.machineName.isEmpty ? '—' : d.machineName,
    ),
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'operator', label: 'Operator', width: 124, start: true, text: (d) => textStr(d.row['operator'])),
    machineStatusColumn(),
    SheetCol(key: 'itemName', label: 'Part Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    // Only on a page that uses vendors (hidden through SheetCol.shownWhen).
    vendorColumn(),
    SheetCol(key: 'operation', label: 'Operation', width: 130, start: true, text: (d) => textStr(d.row['operation'])),
    SheetCol(key: 'drawingNo', label: 'Drawing No.', width: 130, start: true, text: (d) => textStr(d.row['drawingNo'])),
    SheetCol(key: 'setupNo', label: 'Setup No.', width: 84, text: (d) => textStr(d.row['setupNo'])),
    SheetCol(key: 'standardTimeMin', label: 'Standard Time Taken (Min)', width: 112, text: (d) => minStr(d.row['standardTimeMin'])),
    SheetCol(key: 'pcsPerStandardTime', label: 'No. Piece in Standard Time', width: 112, text: (d) => minStr(d.row['pcsPerStandardTime'])),
    SheetCol(
      key: 'cycle',
      label: 'Product Cycle Time (sec)',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'cycle',
      text: (d) => nStr(d.calc['totalCycleSec']),
    ),
    SheetCol(key: 'on', label: 'Machine Time ON', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine Time OFF', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (hr:min)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => hmStr(d.calc['shiftHours']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Quantity',
      width: 88,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQty']),
    ),
    SheetCol(key: 'actualQty', label: 'Actual Quantity', width: 92, tone: ColTone.calc, text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'Actual OK Quantity', width: 100, text: (d) => minStr(d.row['okQty'])),
  ];

  // Rejected = Actual − OK (calculated); opens into the Rejection Master split,
  // the "Other" figure carrying its remark.
  addExpandable(
    open,
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected Quantity',
      width: 148,
      tone: ColTone.calc,
      text: (d) => nStr(d.calc['rejectedQty']),
    ),
    'rejectedQty',
    'Rejected Quantity',
    [
      for (final reason in rejectReasons)
        sheetSubCol(
          reason,
          reason,
          (d) {
            final b = d.row['rejectBreakdown'];
            return minStr(b is Map ? b[reason] : null);
          },
          width: reason == 'Other' ? 124 : 100,
          remarkKind: reason == 'Other' ? 'reject' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'pctOk',
      label: '% OK Quantity',
      width: 88,
      tone: ColTone.calc,
      formulaKey: 'pctOk',
      text: (d) => pctStr(d.calc['pctOk']),
    ),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
  ]);

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Stoppage (min)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Total Stoppage (min)',
    [
      for (final key in pressDowntimeOrder)
        sheetSubCol(
          key,
          pressDowntimeLabel[key]!,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' ? 124 : (key == 'lunchMin' ? 150 : 104),
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'setupEff',
      label: 'Setup Efficiency (%)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'setupEff',
      text: (d) => pctStr(d.calc['setupEfficiency']),
    ),
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hr:min)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => hmStr(d.calc['effectiveHours']),
    ),
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      merge: ColMerge.machineDay,
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    ...apqColumns(),
    SheetCol(
      key: 'oeeLosses',
      label: 'OEE considering losses (%)',
      width: 124,
      tone: ColTone.oee,
      formulaKey: 'oeeLosses',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLosses']),
    ),
    SheetCol(
      key: 'oeeLunch',
      label: 'OEE not considering losses but lunch (%)',
      width: 164,
      tone: ColTone.oee,
      formulaKey: 'oeeLunch',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLunch']),
    ),
    SheetCol(
      key: 'oeeLunchCot',
      label: 'OEE not considering losses but lunch and setup time (%)',
      width: 204,
      tone: ColTone.oee,
      formulaKey: 'oeeLunchCot',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLunchCot']),
    ),
    reviewColumn(),
    SheetCol(key: 'remarks', label: 'Remarks', width: 84, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'rejectedQty': 'rejectedQty', 'downtime': 'totalStoppage'},
  );
}
