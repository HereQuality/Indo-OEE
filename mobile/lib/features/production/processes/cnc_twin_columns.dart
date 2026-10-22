import '../sheet/table/shared_columns.dart';
import '../sheet/table/sheet_columns.dart';
import '../sheet/widgets/sheet_format.dart';
import '../shared/production_sheet_calc.dart';
import 'cnc_twin_style.dart';

/// The Contact / Trobe / Spring tables (client/src/Components/Production/
/// {contact,trobe,spring}Columns.jsx), in their sheet order. The Vendor Name
/// column shows (as on the web) only on a page that uses vendors.
SheetColumns twinColumns(Set<String> open, TwinStyle style) {
  final spring = style.spring;
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
      label: style.machineColumnLabel,
      width: 70,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      text: (d) => d.machineName.isEmpty ? '—' : d.machineName,
    ),
  ];

  SheetCol operatorCol() => SheetCol(
    key: 'operator',
    label: 'Operator',
    width: 124,
    start: true,
    text: (d) => textStr(d.row['operator']),
  );
  SheetCol itemCol() => SheetCol(
    key: 'itemName',
    label: style.itemLabel,
    width: 164,
    start: true,
    text: (d) => textStr(d.row['itemName']),
  );
  SheetCol onCol() => SheetCol(
    key: 'on',
    label: 'Machine ON Time',
    width: 92,
    text: (d) => textStr(d.row['machineOnTime']),
  );
  SheetCol offCol() => SheetCol(
    key: 'off',
    label: 'Machine OFF Time',
    width: 92,
    text: (d) => textStr(d.row['machineOffTime']),
  );
  SheetCol shiftCol() => SheetCol(
    key: 'shift',
    label: 'Machine Shift Time (hr:min)',
    width: 104,
    tone: ColTone.calc,
    formulaKey: 'shift',
    text: (d) => hmStr(d.calc['shiftHours']),
  );
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  SheetCol cycleCol() => SheetCol(
    key: 'cycle',
    label: style.cycleLabel,
    width: 150,
    formulaKey: 'cycle',
    text: (d) => minStr(d.row['totalCycleSec']),
  );
  SheetCol idealCol() => SheetCol(
    key: 'idealQty',
    label: 'Ideal Quantity',
    width: 88,
    tone: ColTone.calc,
    formulaKey: 'idealQty',
    text: (d) => nStr(d.calc['idealQty']),
  );
  SheetCol idealPerHourCol() => SheetCol(
    key: 'idealQtyPerHour',
    label: 'Ideal Quantity/Hours',
    width: 104,
    tone: ColTone.calc,
    text: (d) => nStr(d.calc['idealQtyPerHour']),
  );
  SheetCol plannedCol() => SheetCol(
    key: 'plannedShift',
    label: 'Planned Operator Shift Time (hr:min)',
    width: 160,
    text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
  );

  final mid = <SheetCol>[];
  if (spring) {
    mid.addAll([
      itemCol(),
      vendorColumn(),
      operatorCol(),
      machineStatusColumn(),
      onCol(),
      offCol(),
      shiftCol(),
      cycleCol(),
      SheetCol(
        key: 'totalQty',
        label: 'Total Qty',
        width: 88,
        tone: ColTone.calc,
        text: (d) => nStr(d.calc['actualQty']),
      ),
      SheetCol(
        key: 'okQty',
        label: 'OK Qty',
        width: 88,
        text: (d) => minStr(d.row['okQty']),
      ),
      SheetCol(
        key: 'rejectedQty',
        label: 'Rejected Qty',
        width: 96,
        formulaKey: 'rejectedQty',
        text: (d) => minStr(d.row['rejectedQty']),
      ),
      SheetCol(
        key: 'pctOk',
        label: 'OK Quantity (%)',
        width: 96,
        tone: ColTone.calc,
        formulaKey: 'pctOk',
        text: (d) => pctStr(d.calc['pctOk']),
      ),
      idealCol(),
      idealPerHourCol(),
      plannedCol(),
    ]);
  } else {
    mid.addAll([
      operatorCol(),
      if (style.workingStatusColumn)
        SheetCol(
          key: 'workingStatus',
          label: 'Working Status',
          width: 120,
          start: true,
          text: (d) => textStr(d.row['workingStatus']),
        ),
      machineStatusColumn(),
      itemCol(),
      vendorColumn(),
      SheetCol(
        key: 'drawingNo',
        label: 'Drawing No.',
        width: 124,
        start: true,
        text: (d) => textStr(d.row['drawingNo']),
      ),
      cycleCol(),
      onCol(),
      offCol(),
      shiftCol(),
      idealCol(),
      idealPerHourCol(),
      SheetCol(
        key: 'okQty',
        label: 'Actual OK Quantity',
        width: 100,
        text: (d) => minStr(d.row['okQty']),
      ),
      SheetCol(
        key: 'rejectedQty',
        label: 'Rejected Quantity',
        width: 100,
        formulaKey: 'rejectedQty',
        text: (d) => minStr(d.row['rejectedQty']),
      ),
      SheetCol(
        key: 'pctOk',
        label: '% OK Quantity',
        width: 88,
        tone: ColTone.calc,
        formulaKey: 'pctOk',
        text: (d) => pctStr(d.calc['pctOk']),
      ),
      plannedCol(),
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
  }

  // The stoppage columns exactly as the web's STOPPAGE_FIELDS give them, Lunch
  // / Rest second-to-last.
  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: spring ? 'Total Idle Time (min)' : 'Total Stoppage (min)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    spring ? 'Idle Time' : 'Total Stoppage',
    [
      for (final f in stoppageFields)
        sheetSubCol(
          '${f['key']}',
          '${f['label']}',
          (d) => zeroIfBlank(d.row[f['key']]),
          width: f['key'] == 'otherMin' ? 124 : 112,
          remarkKind: f['key'] == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.add(
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hr:min)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => hmStr(d.calc['effectiveHours']),
    ),
  );
  mid.add(
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      merge: ColMerge.machineDay,
      text: (d) => nStr(d.day['unreportedMin']),
    ),
  );
  if (!spring) {
    mid.add(
      SheetCol(
        key: 'setupEff',
        label: 'Setup Efficiency (%)',
        width: 104,
        tone: ColTone.calc,
        formulaKey: 'setupEff',
        text: (d) => pctStr(d.calc['setupEfficiency']),
      ),
    );
  }
  mid.addAll([
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
      label: style.remarksLabel == 'Remarks'
          ? 'Remarks'
          : 'Reason/Remarks for Rejection/Rework',
      width: 84,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    // Only the stoppage breakdown opens on these tables.
    expandSummary: const {'downtime': 'totalStoppage'},
  );
}
