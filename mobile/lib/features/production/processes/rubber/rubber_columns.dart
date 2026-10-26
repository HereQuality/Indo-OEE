import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'rubber_calc.dart';

/// The RUBBER table's columns, in that sheet's own order and wording
/// (client/src/Components/Production/rubberColumns.jsx) — except that Worker
/// Name sits right after Date: it's this sheet's row key, where every other
/// sheet has MC No., so it's the frozen, merged column. A header carries its ⓘ
/// whenever the sheet has a formula for it, as on the web.
SheetColumns rubberColumns(Set<String> open) {
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
    SheetCol(key: 'itemName', label: 'Part Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    // Only on a page that uses vendors, like the web (hidden through SheetCol.shownWhen).
    vendorColumn(),
    // MACHINE_STATUS_COLUMN under this sheet's own label.
    SheetCol(key: 'machineStatus', label: 'Working Status', width: 150, start: true, text: (d) => machineStatusText(d.row)),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Total Cycle Time (Sec)',
      width: 110,
      formulaKey: 'cycle',
      text: (d) => minStr(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'on', label: 'Working Start Time', width: 100, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Working End Time', width: 100, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Worker Shift Time (hr:min)',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => hmStr(d.calc['shiftHours']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'IDEAL Quantity',
      width: 92,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQty']),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'IDEAL Quantity/Hour',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
    SheetCol(key: 'actualQty', label: 'Actual Quantity', width: 92, tone: ColTone.calc, text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'ACTUAL OK Quantity', width: 100, text: (d) => minStr(d.row['okQty'])),
  ];

  // Rejected = Actual − OK (calc); it opens into the Rejection Master split,
  // "Other" carrying its remark.
  addExpandable(
    open,
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected Quantity',
      width: 148,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => zeroIfBlank(d.calc['rejectedQty']),
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
    SheetCol(key: 'plannedShift', label: 'Planned Operator Shift Time (hr:min)', width: 160, text: (d) => hmStr(d.row['plannedOperatorShiftHours'])),
  ]);

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total stoppage (min)',
      width: 140,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Stoppage (min)',
    [
      for (final (key, label) in rubberStoppageFields)
        sheetSubCol(
          key,
          label,
          (d) => zeroIfBlank(d.row[key]),
          width: key == 'lunchMin' ? 150 : 112,
          remarkKind: key == 'otherMin' ? 'downtime' : null,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Effective working Time (hr:min)',
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
      label: 'Productivity without considering Lunch, tea, etc. (%)',
      width: 190,
      tone: ColTone.oee,
      formulaKey: 'productivity',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['productivity']),
    ),
    SheetCol(
      key: 'productivityLunch',
      label: 'Productivity Considering Lunch, tea, etc. (%)',
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
      label: 'REMARKS',
      width: 84,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'rejectedQty': 'rejectedQty', 'downtime': 'totalStoppage'},
  );
}
