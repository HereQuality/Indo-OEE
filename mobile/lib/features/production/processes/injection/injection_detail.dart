import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'injection_calc.dart';
import 'injection_columns.dart';

/// The expanded INJECTION MOULDING entry: every column of the web table,
/// grouped — the three OEE figures (this entry's own; the machine's day on a
/// locked shift) on top, then Quantities, Time, Idle Time, Efficiency and the
/// entry's own text, in the sheet's words.
DetailModel injectionDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];
  final idleRows = <DetailRow>[
    for (final (key, label) in injectionStoppageFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceFirst(RegExp(r' \(min\)$', caseSensitive: false), ''),
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View downtime remark',
        ),
  ];
  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';
  String typed(Object? x) => (x == null || x == '') ? '—' : fmtNum(jsToNumber(x));
  return DetailModel(
    oee: [
      DetailOee(formulaKey: 'oeeLosses', title: 'OEE considering losses', label: 'Considering losses', value: pctStr(day['oeeLosses'])),
      DetailOee(
        formulaKey: 'oeeLunch',
        title: 'OEE not considering losses but lunch',
        label: 'Lunch only',
        value: pctStr(day['oeeLunch']),
      ),
      DetailOee(
        formulaKey: 'oeeLunchCot',
        title: 'OEE not considering losses but lunch and COT',
        label: 'Lunch + COT',
        value: pctStr(day['oeeLunchCot']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Quantities',
        icon: Icons.inventory_2_outlined,
        rows: [
          DetailMetric(label: 'Standard Time per Piece (in Sec)', value: typed(v('totalCycleSec')), formulaKey: 'cycle', tone: SheetTones.calc),
          DetailMetric(label: 'TOTAL QTY.', value: nStr(calc['actualQty']), formulaKey: 'totalQty', tone: SheetTones.calc),
          DetailMetric(label: 'OK QTY.', value: typed(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected QTY', value: nStr(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          DetailMetric(label: 'Ok Quantity (%)', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
          DetailMetric(label: 'Ideal Quantity', value: nStr(calc['idealQtyExact']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(
            label: 'Ideal Quantity/Hours',
            value: nStr(calc['idealQtyPerHour']),
            tone: SheetTones.calc,
            formulaKey: 'idealQtyPerHour',
          ),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Machine ON Time', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Machine OFF Time', value: textStr(v('machineOffTime'))),
          DetailMetric(
            label: 'Machine Shift Time (Hours)',
            value: injectionHours(calc['shiftHours']),
            tone: SheetTones.calc,
            formulaKey: 'shift',
          ),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
        ],
      ),
      DetailGroup(
        title: 'Idle Time',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(
            label: 'Total Idle Time (Min)',
            value: nStr(calc['totalStoppageMin']),
            tone: SheetTones.calc,
            formulaKey: 'totalStoppage',
          ),
          ...idleRows,
        ],
      ),
      DetailGroup(
        title: 'Efficiency',
        icon: Icons.speed_rounded,
        rows: [
          DetailMetric(
            label: 'Effective Machine Run Time (hours)',
            value: injectionHours(calc['effectiveHours']),
            tone: SheetTones.calc,
            formulaKey: 'effective',
          ),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
          // This entry's Availability / Performance / Quality (red above 100%)
          // and its Admin review state.
          ...apqMetrics(calc),
          ...reviewRows(row),
        ],
      ),
      DetailGroup(
        title: 'Entry',
        icon: Icons.assignment_outlined,
        rows: [
          DetailMetric(label: 'Item Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Operator', value: textStr(v('operator'))),
          DetailMetric(label: 'Working Status', value: injectionWorkingStatusText(row)),
          if (row['workingMode'] == 'Non Working')
            DetailMetric(label: 'Reasons For Not Working', value: injectionNotWorkingReasons(row), maxLines: 3),
          DetailMetric(
            label: 'Reason/Remarks for Rejection/ Rework',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
