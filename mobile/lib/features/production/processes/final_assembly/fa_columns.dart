import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'fa_calc.dart';

/// "Reasons For Not Working": the reasons the entry carries, else a dash.
String faReasonsText(Map<String, dynamic> r) {
  final raw = r['machineStatus'];
  final list = raw is List ? [for (final s in raw) jsString(s)] : const <String>[];
  return list.isNotEmpty ? list.join(', ') : '—';
}

Object? _defect(Map<String, dynamic> r, String reason) {
  final rb = r['rejectBreakdown'];
  return rb is Map ? rb[reason] : null;
}

/// The FINAL ASSEMBLY table's columns, in that paper sheet's own order
/// (client/src/Components/Production/finalAssemblyColumns.jsx) — Worker Name
/// right after Date, frozen and merged (the row key). Hours are decimal;
/// Ideal Quantity is not rounded down (blank without a Standard Time). Every
/// entry's Unreported and two Productivity figures are its own (not merged).
SheetColumns faColumns(Set<String> open) {
  final left = <SheetCol>[
    SheetCol(key: 'date', label: 'Date', width: 84, merge: ColMerge.date, bold: true, start: true, text: (d) => displayDay('${d.row['date']}')),
    SheetCol(
      key: 'machine',
      label: FaLabels.worker,
      width: 104,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      // ctx.machineName[r.machine] || dash(r.operator)
      text: (d) => (d.machineName.isEmpty || d.machineName == '—') ? textStr(d.row['operator']) : d.machineName,
    ),
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'itemName', label: FaLabels.itemName, width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    vendorColumn(),
    SheetCol(
      key: 'workingMode',
      label: FaLabels.workingStatus,
      width: 100,
      text: (d) => d.row['workingMode'] == 'Non Working' ? 'Non Working' : 'Working',
    ),
    SheetCol(key: 'machineStatus', label: FaLabels.reasons, width: 150, start: true, text: (d) => faReasonsText(d.row)),
    SheetCol(key: 'on', label: FaLabels.start, width: 96, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: FaLabels.end, width: 96, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(key: 'shift', label: FaLabels.hours, width: 110, tone: ColTone.calc, formulaKey: 'shift', text: (d) => nStr(d.calc['shiftHours'])),
    // Typed per entry (prefilled from the Part, optional), so not a grey "calc" column.
    SheetCol(key: 'cycle', label: FaLabels.std, width: 130, formulaKey: 'cycle', text: (d) => minStr(d.row['totalCycleSec'])),
    SheetCol(key: 'actualQty', label: FaLabels.totalQty, width: 84, text: (d) => minStr(d.row['actualQty'])),
    SheetCol(key: 'okQty', label: FaLabels.okQty, width: 80, tone: ColTone.calc, formulaKey: 'okQty', text: (d) => nStr(d.calc['okQty'])),
  ];

  // Rejected QTY = Total Defects; opens to the four Types of Defects ("Other"
  // carrying its remark), then Total Defects.
  addExpandable(
    open,
    SheetCol(
      key: 'rejectedQty',
      label: FaLabels.rejectedQty,
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => zeroIfBlank(d.calc['totalDefect']),
    ),
    'rejectedQty',
    FaLabels.defects,
    [
      for (final reason in faDefectReasons)
        fitSheetColumn(
          sheetSubCol(reason, reason, (d) => zeroIfBlank(_defect(d.row, reason)), width: 96, remarkKind: reason == 'Other' ? 'reject' : null),
        ),
      fitSheetColumn(
        sheetSubCol('totalDefect', FaLabels.totalDefects, (d) => fmtNum(d.calc['totalDefect'] ?? 0), width: 100, tone: ColTone.calc, formulaKey: 'totalDefect'),
      ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(key: 'idealQty', label: FaLabels.idealQty, width: 96, tone: ColTone.calc, formulaKey: 'idealQty', text: (d) => nStr(d.calc['idealQty'])),
    SheetCol(
      key: 'idealQtyPerHour',
      label: FaLabels.idealQtyPerHour,
      width: 110,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
    SheetCol(key: 'otherActivity', label: FaLabels.otherActivity, width: 140, start: true, text: (d) => textStr(d.row['otherActivity'])),
    SheetCol(key: 'otherActivityMin', label: FaLabels.otherActivityMin, width: 130, text: (d) => zeroIfBlank(d.row['otherActivityMin'])),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift (Hours)',
      width: 130,
      text: (d) => nStr(d.row['plannedOperatorShiftHours'] == '' ? null : d.row['plannedOperatorShiftHours']),
    ),
    for (final (key, label) in faIdleFields)
      SheetCol(key: key, label: label, width: 110, remarkKind: key == 'otherMin' ? 'downtime' : null, text: (d) => zeroIfBlank(d.row[key])),
    SheetCol(
      key: 'totalStoppage',
      label: FaLabels.totalIdle,
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    SheetCol(key: 'effective', label: FaLabels.effective, width: 120, tone: ColTone.calc, formulaKey: 'effective', text: (d) => nStr(d.calc['effectiveHours'])),
    // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
    SheetCol(key: 'unreported', label: FaLabels.unreported, width: 96, tone: ColTone.day, formulaKey: 'unreported', text: (d) => nStr(d.day['unreportedMin'])),
    ...apqColumns(),
    SheetCol(
      key: 'productivity',
      label: FaLabels.productivity,
      width: 190,
      tone: ColTone.oee,
      formulaKey: 'productivity',
      text: (d) => pctStr(d.day['productivity']),
    ),
    SheetCol(
      key: 'productivityLunch',
      label: FaLabels.productivityLunch,
      width: 180,
      tone: ColTone.oee,
      formulaKey: 'productivityLunch',
      text: (d) => pctStr(d.day['productivityLunch']),
    ),
    reviewColumn(),
    SheetCol(key: 'remarks', label: FaLabels.remarks, width: 110, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'rejectedQty': 'rejectedQty'},
  );
}
