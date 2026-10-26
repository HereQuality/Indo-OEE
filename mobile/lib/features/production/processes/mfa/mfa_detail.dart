import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'mfa_calc.dart';

/// Everything one saved MODULAR FRAME ASSEMBLY entry holds, grouped: the two
/// Productivity percentages up top (this entry's own), then Assembly, Time,
/// Idle time & other activity, OEE and the entry's own text — every figure of
/// the web sheet's table, in its words.
DetailModel mfaDetail(Json row, Json calc, Json day) {
  final parts = remarkParts(row);
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in parts)
          if (p['key'] == kind) p,
      ];
  final idleRows = <DetailRow>[
    for (final (key, label) in mfaIdleFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceAll(' etc (Min)', '').replaceAll(' (Min)', ''),
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View idle time remark',
        ),
  ];
  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';
  final status = row['machineStatus'];

  return DetailModel(
    oee: [
      DetailOee(
        formulaKey: 'productivity',
        title: 'Productivity without considering Lunch, tea, etc.',
        label: 'Without lunch',
        value: pctStr(day['productivity']),
      ),
      DetailOee(
        formulaKey: 'productivityLunch',
        title: 'Productivity Considering Lunch, tea, etc.',
        label: 'With lunch',
        value: pctStr(day['productivityLunch']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Assembly',
        icon: Icons.fact_check_outlined,
        rows: [
          DetailMetric(label: '$mfaCycle (in Sec)', value: minStr(v('totalCycleSec'))),
          DetailMetric(label: 'TOTAL QTY', value: minStr(v('actualQty'))),
          DetailMetric(label: 'OK QTY', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected QTY', value: zeroIfBlank(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          DetailMetric(label: mfaIdealQty, value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(label: mfaIdealQtyPerHour, value: nStr(calc['idealQtyPerHour']), tone: SheetTones.calc, formulaKey: 'idealQtyPerHour'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: mfaStart, value: textStr(v('machineOnTime'))),
          DetailMetric(label: mfaEnd, value: textStr(v('machineOffTime'))),
          DetailMetric(label: mfaHours, value: nStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift (Hours)', value: nStr(v('plannedOperatorShiftHours') == '' ? null : v('plannedOperatorShiftHours'))),
          DetailMetric(label: mfaEffective, value: nStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
        ],
      ),
      DetailGroup(
        title: 'Idle time & other activity',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Other Activity Carried Out', value: textStr(v('otherActivity')), maxLines: 3),
          DetailMetric(label: 'Time consume in Other Activity (min)', value: zeroIfBlank(v('otherActivityMin'))),
          DetailMetric(label: 'Total Idle Time (Min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
          ...idleRows,
        ],
      ),
      DetailGroup(
        title: 'OEE',
        icon: Icons.speed_rounded,
        rows: [...apqMetrics(calc), ...reviewRows(row)],
      ),
      DetailGroup(
        title: 'Entry',
        icon: Icons.assignment_outlined,
        rows: [
          DetailMetric(label: 'Worker Name', value: textStr(v('operator'))),
          DetailMetric(label: 'Item Name', value: textStr(v('itemName'))),
          DetailMetric(label: 'Working Status', value: row['workingMode'] == 'Non Working' ? 'Non Working' : 'Working'),
          DetailMetric(
            label: 'Reasons For Not Working',
            value: status is List && status.isNotEmpty ? status.map(jsString).join(', ') : '—',
            maxLines: 3,
          ),
          DetailMetric(label: 'Remarks', value: generalText.isEmpty ? '—' : generalText, maxLines: 3, remarks: general),
        ],
      ),
    ],
  );
}
