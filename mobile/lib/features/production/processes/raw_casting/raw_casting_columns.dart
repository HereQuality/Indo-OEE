import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'raw_casting_calc.dart';

/// The RAW CASTING table's columns, in that paper sheet's own order and wording
/// (client/src/Components/Production/rawCastingColumns.jsx) — Worker Name sits
/// right after Date as the frozen, merged row key. Hours are decimal hours, as
/// the sheet heads them "(In Hour)"; Ideal Inspection Quantity is not rounded
/// down; Unreported Time and the two Productivity figures are each entry's own,
/// never merged across the worker's day.
SheetColumns rawCastingColumns(Set<String> open) {
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
    vendorColumn(),
    SheetCol(key: 'challanNo', label: 'Challan No.', width: 92, text: (d) => textStr(d.row['challanNo'])),
    SheetCol(key: 'workingMode', label: 'Working Status', width: 104, start: true, text: (d) => rawCastingWorkingModeText(d.row)),
    SheetCol(key: 'machineStatus', label: 'Reasons For Not Working', width: 150, start: true, text: (d) => rawCastingReasonsText(d.row)),
    SheetCol(key: 'on', label: 'Inspection Start Time', width: 100, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Inspection End Time', width: 100, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Inspection Working Hours',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => nStr(d.calc['shiftHours']),
    ),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Standard Inspection Time per Piece (in Sec)',
      width: 150,
      formulaKey: 'cycle',
      text: (d) => minStr(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'totalQty', label: 'TOTAL QTY', width: 84, text: (d) => minStr(d.row['actualQty'])),
    SheetCol(
      key: 'okQty',
      label: 'OK QTY',
      width: 80,
      tone: ColTone.calc,
      formulaKey: 'okQty',
      text: (d) => nStr(d.calc['okQty']),
    ),
  ];

  // Total Defects (calc) — expands to the sheet's three Types of Defects.
  addExpandable(
    open,
    SheetCol(
      key: 'totalDefect',
      label: 'Total Defects',
      width: 120,
      tone: ColTone.calc,
      formulaKey: 'totalDefect',
      text: (d) => nStr(d.calc['totalDefect']),
    ),
    'defects',
    'Types of Defects',
    [
      for (final defect in rawCastingDefects)
        sheetSubCol(
          defect,
          defect,
          (d) {
            final b = d.row['rejectBreakdown'];
            return zeroIfBlank(b is Map ? b[defect] : null);
          },
          width: 112,
        ),
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
    SheetCol(
      key: 'otherActivityMin',
      label: 'Time consume in Other Activity (min)',
      width: 124,
      text: (d) => zeroIfBlank(d.row['otherActivityMin']),
    ),
    SheetCol(key: 'plannedShift', label: 'Planned Operator Shift (Hours)', width: 124, text: (d) => rawCastingPlannedText(d.row)),
  ]);

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (Min)',
      width: 130,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'idle',
    'Idle Time (Min)',
    [
      for (final (key, label) in rawCastingIdleFields)
        sheetSubCol(
          key,
          label,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'otherMin' ? 104 : 150,
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Ideal Inspection Time (In Hour)',
      width: 120,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => nStr(d.calc['effectiveHours']),
    ),
    // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    ...apqColumns(),
    SheetCol(
      key: 'productivity',
      label: 'Productivity without considering Lunch, tea, etc. (%)',
      width: 190,
      tone: ColTone.oee,
      formulaKey: 'productivity',
      text: (d) => pctStr(d.day['productivity']),
    ),
    SheetCol(
      key: 'productivityLunch',
      label: 'Productivity Considering Lunch, tea, etc. (%)',
      width: 180,
      tone: ColTone.oee,
      formulaKey: 'productivityLunch',
      text: (d) => pctStr(d.day['productivityLunch']),
    ),
    reviewColumn(),
    SheetCol(key: 'remarks', label: 'Reason/Remarks for Rejection', width: 140, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'defects': 'totalDefect', 'idle': 'totalStoppage'},
  );
}

/// The Working Status column: "Non Working" or "Working".
String rawCastingWorkingModeText(Json r) => r['workingMode'] == 'Non Working' ? 'Non Working' : 'Working';

/// The Reasons For Not Working column: the ticked reasons, or "—".
String rawCastingReasonsText(Json r) {
  final raw = r['machineStatus'];
  final list = raw is List ? [for (final s in raw) s == null ? '' : jsString(s)] : const <String>[];
  return list.isEmpty ? '—' : list.join(', ');
}

/// Planned Operator Shift as decimal hours, as the sheet heads it "(Hours)".
String rawCastingPlannedText(Json r) => nStr(r['plannedOperatorShiftHours'] == '' ? null : r['plannedOperatorShiftHours']);
