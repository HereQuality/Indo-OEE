import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'bpc_calc.dart';
import 'bpc_columns.dart';

/// Everything one saved BEFORE POWDER COATING entry holds, grouped: the sheet's
/// two OEE percentages up top (this entry's own), then Quantities, Time, Idle
/// Time, OEE and the entry's own text — every figure of the web sheet's table
/// (bpcColumns.jsx), worded and formatted as it is, with the "Other" reject /
/// idle remarks behind an eye beside their figure and the Reason/Remarks on its
/// own row.
DetailModel bpcDetail(Json row, Json calc, Json day) {
  final parts = remarkParts(row);
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in parts)
          if (p['key'] == kind) p,
      ];

  final breakdown = row['rejectBreakdown'] is Map ? Map<String, dynamic>.from(row['rejectBreakdown'] as Map) : <String, dynamic>{};
  final rejectRows = <DetailRow>[
    for (final reason in bpcRejectReasons)
      if (hasValue(breakdown[reason]) || (reason == 'Other' && remarks('reject').isNotEmpty))
        DetailSubRow(
          label: reason,
          value: minStr(breakdown[reason]),
          remarks: reason == 'Other' ? remarks('reject') : const [],
          remarkTone: SheetTones.reject,
          remarkLabel: 'View reject remark',
        ),
  ];
  final idleRows = <DetailRow>[
    for (final (key, label) in bpcStoppageFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceAll(RegExp(r' etc \(Min\)$| \((Min|min)\)$'), ''),
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View idle time remark',
        ),
  ];

  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';

  return DetailModel(
    oee: [
      DetailOee(
        formulaKey: 'oeeLosses',
        title: 'OEE considering losses',
        label: 'Considering losses',
        value: pctStr(day['oeeLosses']),
      ),
      DetailOee(
        formulaKey: 'oeeLunch',
        title: 'OEE not considering losses but lunch',
        label: 'Lunch only',
        value: pctStr(day['oeeLunch']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Quantities',
        icon: Icons.inventory_2_outlined,
        rows: [
          DetailMetric(label: 'Standard Time per Piece (Sec)', value: minStr(v('totalCycleSec')), formulaKey: 'cycle'),
          DetailMetric(label: 'TOTAL QTY', value: nStr(calc['actualQty'])),
          DetailMetric(label: 'OK QTY', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected QTY', value: zeroIfBlank(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          ...rejectRows,
          if (rejectRows.isNotEmpty) DetailSubRow(label: 'Total', value: fmtNum(rejectSplitTotal(row))),
          DetailMetric(label: 'Ideal Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
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
          DetailMetric(label: 'Machine Shift Time (Hours)', value: nStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift (Hours)', value: bpcPlannedText(row)),
          DetailMetric(
            label: 'Effective Machine Run Time (hours)',
            value: nStr(calc['effectiveHours']),
            tone: SheetTones.calc,
            formulaKey: 'effective',
          ),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
        ],
      ),
      DetailGroup(
        title: 'Idle time',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Total Idle Time (Min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
          ...idleRows,
        ],
      ),
      DetailGroup(
        title: 'OEE',
        icon: Icons.speed_rounded,
        rows: [
          // This entry's Availability / Performance / Quality (red above 100%) and its Admin review state.
          ...apqMetrics(calc),
          ...reviewRows(row),
        ],
      ),
      DetailGroup(
        title: 'Entry',
        icon: Icons.assignment_outlined,
        rows: [
          DetailMetric(label: 'Operator', value: textStr(v('operator'))),
          DetailMetric(label: 'Item Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Working Status', value: bpcWorkingModeText(row)),
          DetailMetric(label: 'Reasons For Not Working', value: bpcReasonsText(row), maxLines: 3),
          DetailMetric(
            label: 'Reason/Remarks',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
