import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'bpc_calc.dart';

/// The BEFORE POWDER COATING table's columns, in that paper sheet's own order and
/// wording (client/src/Components/Production/bpcColumns.jsx) — except Operator,
/// which sits right after Date: it's this sheet's row key (where every other
/// sheet has MC No.), so it's the frozen, merged column. Times are decimal hours,
/// as the sheet heads them "(Hours)". Ideal Quantity is not rounded down. The
/// paper has only two OEE columns and works every row out on its own Machine
/// Shift — so Unreported Time and the two OEE figures are each entry's own,
/// never merged across the operator's day. The app's Planned Operator Shift,
/// Availability / Performance / Quality and OEE Review columns are added.
SheetColumns bpcColumns(Set<String> open) {
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
      label: 'Operator',
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
    SheetCol(key: 'workingMode', label: 'Working Status', width: 104, start: true, text: (d) => bpcWorkingModeText(d.row)),
    SheetCol(key: 'machineStatus', label: 'Reasons For Not Working', width: 150, start: true, text: (d) => bpcReasonsText(d.row)),
    SheetCol(key: 'on', label: 'Machine ON Time', width: 92, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine OFF Time', width: 92, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (Hours)',
      width: 112,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => nStr(d.calc['shiftHours']),
    ),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Standard Time per Piece (Sec)',
      width: 124,
      formulaKey: 'cycle',
      text: (d) => minStr(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'totalQty', label: 'TOTAL QTY', width: 84, text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'OK QTY', width: 80, text: (d) => minStr(d.row['okQty'])),
  ];

  // Rejected = TOTAL − OK (calc); expands to this sheet's own reasons, "Other"
  // carrying its remark, then their total — the paper's column after them.
  addExpandable(
    open,
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected QTY',
      width: 120,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => zeroIfBlank(d.calc['rejectedQty']),
    ),
    'rejectedQty',
    'Rejected QTY',
    [
      for (final reason in bpcRejectReasons)
        sheetSubCol(
          reason,
          reason,
          (d) {
            final b = d.row['rejectBreakdown'];
            return minStr(b is Map ? b[reason] : null);
          },
          width: reason == 'Other' ? 108 : 112,
          remarkKind: reason == 'Other' ? 'reject' : null,
        ),
      sheetSubCol(
        'rejectSplitTotal',
        'Total',
        (d) => fmtNum(rejectSplitTotal(d.row)),
        width: 84,
        tone: ColTone.calc,
        formulaKey: 'rejectSplitTotal',
      ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Quantity',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQty']),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'Ideal Quantity/Hours',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift (Hours)',
      width: 124,
      text: (d) => bpcPlannedText(d.row),
    ),
    for (final (key, label) in bpcStoppageFields)
      SheetCol(
        key: key,
        label: label,
        width: key == 'lunchMin' ? 150 : 104,
        remarkKind: key == 'otherMin' ? 'downtime' : null,
        text: (d) => zeroIfBlank(d.row[key]),
      ),
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (Min)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hours)',
      width: 132,
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
    // Availability / Performance / Quality for this entry alone, red above 100% (APQ_COLUMNS).
    ...apqColumns(),
    SheetCol(
      key: 'oeeLosses',
      label: 'OEE considering losses (%)',
      width: 112,
      tone: ColTone.oee,
      formulaKey: 'oeeLosses',
      text: (d) => pctStr(d.day['oeeLosses']),
    ),
    SheetCol(
      key: 'oeeLunch',
      label: 'OEE not considering losses but lunch (%)',
      width: 150,
      tone: ColTone.oee,
      formulaKey: 'oeeLunch',
      text: (d) => pctStr(d.day['oeeLunch']),
    ),
    // The Admin review state of an entry that went over 100% (REVIEW_COLUMN).
    reviewColumn(),
    SheetCol(key: 'remarks', label: 'Reason/Remarks', width: 120, remarkKind: 'general', text: (d) => ''),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'rejectedQty': 'rejectedQty'},
  );
}

/// The Working Status column: "Non Working" or "Working".
String bpcWorkingModeText(Json r) => r['workingMode'] == 'Non Working' ? 'Non Working' : 'Working';

/// The Reasons For Not Working column: the ticked reasons, or "—".
String bpcReasonsText(Json r) {
  final raw = r['machineStatus'];
  final list = raw is List ? [for (final s in raw) s == null ? '' : jsString(s)] : const <String>[];
  return list.isEmpty ? '—' : list.join(', ');
}

/// Planned Operator Shift as decimal hours, as the sheet heads it "(Hours)".
String bpcPlannedText(Json r) => nStr(r['plannedOperatorShiftHours'] == '' ? null : r['plannedOperatorShiftHours']);
