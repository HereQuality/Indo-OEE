import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'spm_calc.dart';

/// The sheet's own wording for each downtime column (web `SPM_DOWNTIME_LABEL`).
const Map<String, String> spmDowntimeLabels = {
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
const List<String> spmDowntimeOrder = [
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

/// The SPM table's columns, left to right in the sheet's own order (port of
/// spmColumns.jsx): the CNC/VMC set with SPM's cycle breakdown — No. of Holes,
/// No. of Piece in One Cycle, Stroke Required, then Loading / Process / Unloading
/// and Cleaning / Other Operations — in place of the operation breakdown, and the
/// ten stoppage figures folded behind Total Stoppage.
SheetColumns spmColumns(Set<String> open) {
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

  SheetCol calcCol(String key, String label, String Function(CellData) text, {double width = 100, String? formulaKey}) => SheetCol(
        key: key,
        label: label,
        width: width,
        tone: ColTone.calc,
        formulaKey: formulaKey ?? key,
        text: text,
      );

  final mid = <SheetCol>[
    SheetCol(key: 'operator', label: 'Operator', width: 124, start: true, text: (d) => textStr(d.row['operator'])),
    machineStatusColumn(),
    SheetCol(key: 'itemName', label: 'Part Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    vendorColumn(),
    SheetCol(key: 'drawingNo', label: 'Drawing No.', width: 124, start: true, text: (d) => textStr(d.row['drawingNo'])),
    for (final f in spmReferenceFields)
      SheetCol(key: f['key']!, label: f['label']!, width: 104, text: (d) => minStr(d.row[f['key']])),
    for (final f in spmOpFields)
      SheetCol(
        key: f['key']!,
        label: f['label']!.replaceFirst('(sec)', '(Sec)'),
        width: 100,
        text: (d) => minStr(d.row[f['key']]),
      ),
    calcCol('cycle', 'Total Cycle Time (Sec)', (d) => nStr(d.calc['totalCycleSec']), width: 120),
    SheetCol(key: 'on', label: 'Machine ON Time', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine OFF Time', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
    calcCol('shift', 'Machine Shift Time (hr:min)', (d) => hmStr(d.calc['shiftHours']), width: 104),
    calcCol('idealQty', 'Ideal Quantity', (d) => nStr(d.calc['idealQty']), width: 88),
    // Actual here is OK + Rejected (calculated, as on the web).
    SheetCol(key: 'actualQty', label: 'Actual Quantity', width: 92, tone: ColTone.calc, text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'Actual OK Quantity', width: 100, text: (d) => minStr(d.row['okQty'])),
    SheetCol(key: 'rejectedQty', label: 'Rejected Quantity', width: 100, text: (d) => minStr(d.row['rejectedQty'])),
    calcCol('pctOk', '% OK Quantity', (d) => pctStr(d.calc['pctOk']), width: 88),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
    // Combined across every entry of this machine's date (see dayCalc), so shown
    // once per machine/date group, like Unreported Time and the OEE columns.
    SheetCol(
      key: 'unutilized',
      label: 'Unutilized Machine Time (%)',
      width: 112,
      tone: ColTone.day,
      formulaKey: 'unutilized',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['unutilized']),
    ),
  ];

  addExpandable(
    open,
    calcCol('totalStoppage', 'Total Stoppage (min)', (d) => nStr(d.calc['totalStoppageMin']), width: 150),
    'downtime',
    'Total Stoppage',
    [
      for (final key in spmDowntimeOrder)
        sheetSubCol(
          key,
          spmDowntimeLabels[key]!,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' ? 124 : (key == 'lunchMin' ? 150 : 104),
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    calcCol('effective', 'Effective Machine Run Time (hr:min)', (d) => hmStr(d.calc['effectiveHours']), width: 116),
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      merge: ColMerge.machineDay,
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    calcCol('setupEff', 'Setup Efficiency (%)', (d) => pctStr(d.calc['setupEfficiency']), width: 104),
    // Availability / Performance / Quality of this entry alone (red above 100%, which sends it to Admin review).
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
  );
}
