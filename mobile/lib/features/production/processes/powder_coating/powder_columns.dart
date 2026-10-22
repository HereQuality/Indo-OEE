import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'powder_calc.dart';

/// The After Powder Coating table's columns, in that sheet's own order and
/// wording (client/src/Components/Production/powderCoatingColumns.jsx) —
/// except that Worker Name sits right after Date: it's this sheet's row key,
/// where every other sheet has MC No., so it's the frozen, merged column.
SheetColumns powderColumns(Set<String> open) {
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
      label: 'Worker Name',
      width: 104,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      // ctx.machineName[r.machine] || dash(r.operator)
      text: (d) => (d.machineName.isEmpty || d.machineName == '—') ? textStr(d.row['operator']) : d.machineName,
    ),
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'itemName', label: 'Item Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    // Only on a page that uses vendors, like the web (hidden through SheetCol.shownWhen).
    vendorColumn(),
    // MACHINE_STATUS_COLUMN under this sheet's own label.
    SheetCol(key: 'machineStatus', label: 'Working Status', width: 150, start: true, text: (d) => machineStatusText(d.row)),
    SheetCol(key: 'on', label: 'Inspection Start Time', width: 100, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Inspection End Time', width: 100, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Inspection Working Hours (hr:min)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => hmStr(d.calc['shiftHours']),
    ),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Standard Inspection Time per Piece (Sec)',
      width: 150,
      text: (d) => minStr(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'actualQty', label: 'Total Qty', width: 84, text: (d) => minStr(d.row['actualQty'])),
    SheetCol(
      key: 'okQty',
      label: 'OK Qty',
      width: 80,
      tone: ColTone.calc,
      formulaKey: 'okQty',
      text: (d) => nStr(d.calc['okQty']),
    ),
  ];

  addExpandable(
    open,
    SheetCol(
      key: 'totalDefect',
      label: 'Total Defect / Rework',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalDefect',
      text: (d) => nStr(d.calc['totalDefect']),
    ),
    'defects',
    'Types of Defect / Rework',
    [
      for (final (key, label) in powderDefectFields)
        sheetSubCol(key, label, (d) => zeroIfBlank(d.row[key]), width: 118),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Inspection Quantity',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQty']),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'Ideal Inspection Quantity/Hour',
      width: 124,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
    SheetCol(key: 'otherActivity', label: 'Other Activity Carried Out', width: 140, start: true, text: (d) => textStr(d.row['otherActivity'])),
    SheetCol(key: 'otherActivityMin', label: 'Time in Other Activity (min)', width: 112, text: (d) => zeroIfBlank(d.row['otherActivityMin'])),
    SheetCol(key: 'plannedShift', label: 'Planned Operator Shift Time (hr:min)', width: 160, text: (d) => hmStr(d.row['plannedOperatorShiftHours'])),
  ]);

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (min)',
      width: 140,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'idle',
    'Idle Time',
    [
      for (final (key, label) in powderIdleFields)
        sheetSubCol(
          key,
          label,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' ? 124 : 150,
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Ideal Inspection Time (hr:min)',
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
    // Availability / Performance / Quality for this entry alone, red above 100% (APQ_COLUMNS).
    ...apqColumns(),
    SheetCol(
      key: 'productivity',
      label: 'Productivity without considering Lunch, Tea, etc. (%)',
      width: 190,
      tone: ColTone.oee,
      formulaKey: 'productivity',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['productivity']),
    ),
    SheetCol(
      key: 'productivityLunch',
      label: 'Productivity considering Lunch, Tea, etc. (%)',
      width: 180,
      tone: ColTone.oee,
      formulaKey: 'productivityLunch',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['productivityLunch']),
    ),
    // The Admin review state of an entry that went over 100% (REVIEW_COLUMN).
    reviewColumn(),
    SheetCol(
      key: 'remarks',
      label: 'Reason/Remarks for Rejection/Rework',
      width: 150,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'defects': 'totalDefect', 'idle': 'totalStoppage'},
  );
}
