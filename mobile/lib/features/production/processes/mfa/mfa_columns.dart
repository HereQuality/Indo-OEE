import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'mfa_calc.dart';

/// The MODULAR FRAME ASSEMBLY table's columns, in that paper sheet's own order
/// (client/src/Components/Production/mfaColumns.jsx) — Worker Name right after
/// Date, as the frozen, merged column. Hours read as decimal hours; Ideal
/// Assembly Quantity is not rounded down; every entry's Unreported Time and two
/// Productivity figures are its own (never merged). No Vendor Name.
SheetColumns mfaColumns(Set<String> open) {
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
    SheetCol(
      key: 'workingMode',
      label: 'Working Status',
      width: 104,
      start: true,
      text: (d) => d.row['workingMode'] == 'Non Working' ? 'Non Working' : 'Working',
    ),
    SheetCol(
      key: 'machineStatus',
      label: 'Reasons For Not Working',
      width: 150,
      start: true,
      text: (d) {
        final s = d.row['machineStatus'];
        return s is List && s.isNotEmpty ? s.map(jsString).join(', ') : '—';
      },
    ),
    SheetCol(key: 'on', label: mfaStart, width: 100, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: mfaEnd, width: 100, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(key: 'shift', label: mfaHours, width: 112, tone: ColTone.calc, formulaKey: 'shift', text: (d) => nStr(d.calc['shiftHours'])),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(key: 'cycle', label: '$mfaCycle (in Sec)', width: 150, formulaKey: 'cycle', text: (d) => minStr(d.row['totalCycleSec'])),
    SheetCol(key: 'totalQty', label: 'TOTAL QTY', width: 84, text: (d) => minStr(d.row['actualQty'])),
    SheetCol(key: 'okQty', label: 'OK QTY', width: 84, text: (d) => minStr(d.row['okQty'])),
    // Rejected = TOTAL − OK; no reason split on this sheet (Remarks only).
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected QTY',
      width: 92,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => zeroIfBlank(d.calc['rejectedQty']),
    ),
    SheetCol(key: 'idealQty', label: mfaIdealQty, width: 112, tone: ColTone.calc, formulaKey: 'idealQty', text: (d) => nStr(d.calc['idealQty'])),
    SheetCol(
      key: 'idealQtyPerHour',
      label: mfaIdealQtyPerHour,
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
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift (Hours)',
      width: 124,
      text: (d) => nStr(d.row['plannedOperatorShiftHours'] == '' ? null : d.row['plannedOperatorShiftHours']),
    ),
  ];

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (Min)',
      width: 140,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'idle',
    'Idle Time (Min)',
    [
      for (final (key, label) in mfaIdleFields)
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
    SheetCol(key: 'effective', label: mfaEffective, width: 124, tone: ColTone.calc, formulaKey: 'effective', text: (d) => nStr(d.calc['effectiveHours'])),
    // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
    SheetCol(key: 'unreported', label: 'Unreported Time (min)', width: 104, tone: ColTone.day, formulaKey: 'unreported', text: (d) => nStr(d.day['unreportedMin'])),
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
    SheetCol(key: 'remarks', label: 'Remarks', width: 84, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'idle': 'totalStoppage'},
  );
}
