import '../../sheet/table/sheet_columns.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';

/// The columns of the web table in sheet order, with the four breakdowns
/// opened as [open] says.
SheetColumns cncColumns(Set<String> open) {
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
    SheetCol(
      key: 'operator',
      label: 'Operator',
      width: 124,
      start: true,
      text: (d) => textStr(d.row['operator']),
    ),
    machineStatusColumn(),
    SheetCol(
      key: 'itemName',
      label: 'Part Name',
      width: 164,
      start: true,
      text: (d) => textStr(d.row['itemName']),
    ),
    // Only on a page that uses vendors (hidden through SheetCol.shownWhen).
    vendorColumn(),
    SheetCol(
      key: 'drawingNo',
      label: 'Drawing No.',
      width: 124,
      start: true,
      text: (d) => textStr(d.row['drawingNo']),
    ),
  ];

  addExpandable(
    open,
    SheetCol(
      key: 'cycle',
      label: 'Total Cycle Time (sec)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'cycle',
      text: (d) => nStr(d.calc['totalCycleSec']),
    ),
    'cycle',
    'Total Cycle Time',
    [
      for (final f in cycleOpFields)
        sheetSubCol(
          '${f['key']}',
          cycleOpLabel(f),
          (d) => textStr(d.row[f['key']]),
          width: 96,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'on',
      label: 'Machine ON Time',
      width: 92,
      text: (d) => textStr(d.row['machineOnTime']),
    ),
    SheetCol(
      key: 'off',
      label: 'Machine OFF Time',
      width: 92,
      text: (d) => textStr(d.row['machineOffTime']),
    ),
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
      text: (d) => nStr(d.calc['actualQty']),
    ),
    SheetCol(
      key: 'okQty',
      label: 'Actual OK Quantity',
      width: 100,
      text: (d) => minStr(d.row['okQty']),
    ),
  ]);

  addExpandable(
    open,
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected Quantity',
      width: 148,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
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

  mid.add(
    SheetCol(
      key: 'pctOk',
      label: '% OK Quantity',
      width: 88,
      tone: ColTone.calc,
      formulaKey: 'pctOk',
      text: (d) => pctStr(d.calc['pctOk']),
    ),
  );

  mid.add(
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
  );

  mid.add(
    SheetCol(
      key: 'unutilized',
      label: 'Unutilized Machine Time (%)',
      width: 112,
      tone: ColTone.day,
      formulaKey: 'unutilized',
      text: (d) => pctStr(d.day['unutilized']),
    ),
  );

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
      // Lunch / Rest is stoppage time, so it sits with the other stoppage boxes.
      sheetSubCol(
        'lunchMin',
        'Lunch / Rest (min)',
        (d) => zeroIfBlank(d.row['lunchMin']),
        width: 100,
      ),
      for (final f in stoppageFields)
        if (f['key'] != 'plannedDownMin' && f['key'] != 'lunchMin')
          sheetSubCol(
            '${f['key']}',
            downtimeLabels['${f['key']}'] ?? '${f['label']}',
            (d) => zeroIfBlank(d.row[f['key']]),
            width: f['key'] == 'otherMin' ? 124 : 104,
            remarkKind: f['key'] == 'otherMin' ? 'downtime' : null,
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
    // This entry's Availability / Performance / Quality, red above 100%.
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
    // The Admin review state of an entry that went over 100%.
    reviewColumn(),
    SheetCol(
      key: 'remarks',
      label: 'Remarks',
      width: 84,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
  );
}

