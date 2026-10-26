import '../../sheet/table/shared_columns.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../shared/production_sheet_calc.dart';
import 'printing_calc.dart';

/// The sheet's hours are decimal (7.75); the web shows the clock reading on hover.
String printingHoursCell(Object? v) => isNum(v) ? fmtNum(v) : '—';

/// MC No. as the entry saved it: the web reads the machine's live name first
/// (`ctx.machineName[r.mcMachine] || r.mcName`); a row carries only the name
/// saved with it, which is what the server keeps for a renamed machine too.
String printingMcNoText(Map<String, dynamic> r) {
  if (!jsTruthy(r['mcMachine'])) return '—';
  final name = r['mcName'];
  return jsTruthy(name) ? '$name' : '—';
}

/// "Reasons For Not Working": the reasons of a Non Working day, else a dash.
String printingReasonsText(Map<String, dynamic> r) {
  final raw = r['machineStatus'];
  final list = raw is List ? [for (final s in raw) jsString(s)] : const <String>[];
  return r['workingMode'] == 'Non Working' && list.isNotEmpty ? list.join(', ') : '—';
}

/// The PRINTING table's columns, in the paper sheet's own order and wording
/// (client/src/Components/Production/printingColumns.jsx): Date | MC No. | Item
/// Name | Operator | Working Status | Reasons For Not Working | Machine ON / OFF
/// Time | Machine Shift Time | Standard Time per Piece | TOTAL / OK / Rejected
/// QTY | Ok Quantity (%) | Ideal Quantity (not rounded) | Ideal Quantity/Hours |
/// the 13 downtime columns behind Total Idle Time | Effective Machine Run Time |
/// Unreported Time | the three OEE | Reason/Remarks — then the app's own:
/// Planned Operator Shift, Availability / Performance / Quality and OEE Review.
///
/// Operator is this sheet's row key (`machine` holds the operator's id): merged
/// across the operator's entries of a date, but sitting where the sheet puts it,
/// after Item Name, so only Date is frozen. Unreported Time and the three OEE
/// are each entry's own figures (printingDayCalc), so they aren't merged.
SheetColumns printingColumns(Set<String> open) {
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
  ];

  final mid = <SheetCol>[
    SheetCol(key: 'mcNo', label: 'MC No.', width: 84, text: (d) => printingMcNoText(d.row)),
    SheetCol(key: 'itemName', label: 'Item Name', width: 164, start: true, text: (d) => textStr(d.row['itemName'])),
    // Only on a page that uses vendors, like the web (hidden through SheetCol.shownWhen).
    vendorColumn(),
    SheetCol(
      key: 'machine',
      label: 'Operator',
      width: 120,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      // ctx.machineName[r.machine] || dash(r.operator)
      text: (d) => (d.machineName.isEmpty || d.machineName == '—') ? textStr(d.row['operator']) : d.machineName,
    ),
    SheetCol(
      key: 'workingStatus',
      label: 'Working Status',
      width: 100,
      text: (d) => d.row['workingMode'] == 'Non Working' ? 'Non Working' : 'Working',
    ),
    SheetCol(key: 'machineStatus', label: 'Reasons For Not Working', width: 150, start: true, text: (d) => printingReasonsText(d.row)),
    SheetCol(key: 'on', label: 'Machine ON Time', width: 88, text: (d) => textStr(d.row['machineOnTime'])),
    SheetCol(key: 'off', label: 'Machine OFF Time', width: 88, text: (d) => textStr(d.row['machineOffTime'])),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (Hours)',
      width: 110,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => printingHoursCell(d.calc['shiftHours']),
    ),
    // Typed per entry (prefilled from the Part), so not a grey "calc" column.
    SheetCol(
      key: 'cycle',
      label: 'Standard Time per Piece (in Sec)',
      width: 130,
      formulaKey: 'cycle',
      text: (d) => minStr(d.row['totalCycleSec']),
    ),
    SheetCol(key: 'totalQty', label: 'TOTAL QTY.', width: 84, text: (d) => nStr(d.calc['actualQty'])),
    SheetCol(key: 'okQty', label: 'OK QTY.', width: 80, text: (d) => minStr(d.row['okQty'])),
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected QTY',
      width: 92,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => nStr(d.calc['rejectedQty']),
    ),
    SheetCol(
      key: 'pctOk',
      label: 'Ok Quantity (%)',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'pctOk',
      text: (d) => pctStr(d.calc['pctOk']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Quantity',
      width: 96,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQtyExact']),
    ),
    SheetCol(
      key: 'idealQtyPerHour',
      label: 'Ideal Quantity/Hours',
      width: 110,
      tone: ColTone.calc,
      formulaKey: 'idealQtyPerHour',
      text: (d) => nStr(d.calc['idealQtyPerHour']),
    ),
  ];

  addExpandable(
    open,
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Idle Time (Min)',
      width: 120,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Idle Time (min)',
    [
      for (final (key, label) in printingStoppageFields)
        fitSheetColumn(
          sheetSubCol(
            key,
            label,
            (d) => zeroIfBlank(d.row[key]),
            width: 100,
            remarkKind: key == 'otherMin' ? 'downtime' : null,
          ),
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hours)',
      width: 130,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => printingHoursCell(d.calc['effectiveHours']),
    ),
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    SheetCol(
      key: 'oeeLosses',
      label: 'OEE considering losses (%)',
      width: 120,
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
    SheetCol(
      key: 'oeeLunchCot',
      label: 'OEE not considering losses but lunch and COT (%)',
      width: 170,
      tone: ColTone.oee,
      formulaKey: 'oeeLunchCot',
      text: (d) => pctStr(d.day['oeeLunchCot']),
    ),
    SheetCol(
      key: 'remarks',
      label: 'Reason/Remarks for Rejection/ Rework',
      width: 150,
      remarkKind: 'general',
      text: (d) => '',
    ),
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
    // Availability / Performance / Quality for this entry alone, red above 100% (APQ_COLUMNS).
    ...apqColumns(),
    // The Admin review state of an entry that went over 100% (REVIEW_COLUMN).
    reviewColumn(),
  ]);

  return SheetColumns(
    left: [for (final c in left) fitSheetColumn(c)],
    middle: [for (final c in mid) fitSheetColumn(c)],
    expandSummary: const {'downtime': 'totalStoppage'},
  );
}
