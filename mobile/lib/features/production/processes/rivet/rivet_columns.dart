import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart' show displayDay, rejectReasons;

// Port of client/src/Components/Production/rivetColumns.jsx — the RIVET table's
// columns in the sheet's own order: the CNC set with Process, No. of Holes in
// One Piece and the four named cycle operations (set on the Part, summing to
// Total Cycle Time) shown as plain columns; Rejected Quantity is Actual − OK and
// opens into the Rejection Master split.

/// The sheet's own wording for each downtime column.
final Map<String, String> rivetDowntimeLabel = {
  ...downtimeLabels,
  'plannedDownMin': 'Planned Downtime',
  'setupMin': 'Set-up Time',
  'noManPowerMin': 'No Manpower',
  'bdMechMin': 'B.D. Mech.',
  'bdEleMin': 'B.D. Ele.',
  'lunchMin': 'Lunch / Tea / Washroom etc',
  'otherMin': 'Others',
};

/// Sheet order — Planned Downtime first, Others last.
const List<String> _downtimeOrder = [
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

SheetColumns rivetColumns(Set<String> open) {
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

  SheetCol typed(String key, String label, double width, Object? Function(CellData d) get, {bool start = false}) =>
      SheetCol(key: key, label: label, width: width, start: start, text: (d) => textStr(get(d)));
  SheetCol seconds(String key, String label, double width) =>
      SheetCol(key: key, label: label, width: width, text: (d) => minStr(d.row[key]));

  final mid = <SheetCol>[
    typed('operator', 'Operator', 124, (d) => d.row['operator'], start: true),
    machineStatusColumn(),
    typed('itemName', 'Part Name', 164, (d) => d.row['itemName'], start: true),
    // Only on a page that uses vendors (hidden through SheetCol.shownWhen).
    vendorColumn(),
    typed('drawingNo', 'Drawing No.', 124, (d) => d.row['drawingNo'], start: true),
    typed('processType', 'Process', 92, (d) => d.row['processType']),
    seconds('noOfHoles', 'No. of Holes in One Piece', 112),
    seconds('rivetLoadingSec', 'Loading (Sec)', 92),
    seconds('rivetProcessSec', 'Process (Sec)', 92),
    seconds('rivetUnloadingCleaningSec', 'Unloading and Cleaning (Sec)', 130),
    seconds('rivetOtherOperationsSec', 'Other Operations (Sec)', 112),
    SheetCol(
      key: 'cycle',
      label: 'Total Cycle Time (Sec)',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'cycle',
      text: (d) => nStr(d.calc['totalCycleSec']),
    ),
    SheetCol(key: 'on', label: 'Machine ON Time', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine OFF Time', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
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
    SheetCol(
      key: 'actualQty',
      label: 'Actual Quantity',
      width: 92,
      tone: ColTone.calc,
      text: (d) => nStr(d.calc['actualQty']),
    ),
    seconds('okQty', 'Actual OK Quantity', 100),
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
    SheetCol(
      key: 'unutilized',
      label: 'Unutilized Machine Time (%)',
      width: 112,
      tone: ColTone.day,
      formulaKey: 'unutilized',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['unutilized']),
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
    'Total Stoppage',
    [
      for (final key in _downtimeOrder)
        sheetSubCol(
          key,
          rivetDowntimeLabel[key] ?? key,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' ? 124 : (key == 'lunchMin' ? 150 : 104),
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
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
    SheetCol(
      key: 'setupEff',
      label: 'Setup Efficiency (%)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'setupEff',
      text: (d) => pctStr(d.calc['setupEfficiency']),
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
