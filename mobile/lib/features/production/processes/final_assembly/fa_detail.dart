import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'fa_calc.dart';
import 'fa_columns.dart';

/// Everything one saved FINAL ASSEMBLY entry holds, grouped: the entry's two
/// Productivity percentages up top, then Assembly, Time, Idle & activity, OEE
/// and the entry's own text — every figure of the web sheet's table
/// (finalAssemblyColumns.jsx), the "Other" defect / idle remarks behind an eye
/// beside their figures.
DetailModel faDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];
  final rb = row['rejectBreakdown'];

  final defectRows = <DetailRow>[
    for (final reason in faDefectReasons)
      if (positive(rb is Map ? rb[reason] : null) || (reason == 'Other' && remarks('reject').isNotEmpty))
        DetailSubRow(
          label: reason,
          value: zeroIfBlank(rb is Map ? rb[reason] : null),
          remarks: reason == 'Other' ? remarks('reject') : const [],
          remarkTone: SheetTones.reject,
          remarkLabel: 'View defect remark',
        ),
  ];
  final idleRows = <DetailRow>[
    for (final (key, label) in faIdleFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceFirst(RegExp(r' \(min\)$', caseSensitive: false), ''),
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
      DetailOee(formulaKey: 'productivity', title: FaLabels.productivity, label: 'Without lunch', value: pctStr(day['productivity'])),
      DetailOee(formulaKey: 'productivityLunch', title: FaLabels.productivityLunch, label: 'With lunch', value: pctStr(day['productivityLunch'])),
    ],
    groups: [
      DetailGroup(
        title: 'Assembly',
        icon: Icons.fact_check_outlined,
        rows: [
          DetailMetric(label: FaLabels.std, value: minStr(v('totalCycleSec')), formulaKey: 'cycle'),
          DetailMetric(label: FaLabels.totalQty, value: minStr(v('actualQty'))),
          DetailMetric(label: FaLabels.okQty, value: nStr(calc['okQty']), tone: SheetTones.calc, formulaKey: 'okQty', strong: true),
          DetailMetric(label: FaLabels.rejectedQty, value: zeroIfBlank(calc['totalDefect']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          ...defectRows,
          DetailMetric(label: FaLabels.idealQty, value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(label: FaLabels.idealQtyPerHour, value: nStr(calc['idealQtyPerHour']), tone: SheetTones.calc, formulaKey: 'idealQtyPerHour'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: FaLabels.start, value: textStr(v('machineOnTime'))),
          DetailMetric(label: FaLabels.end, value: textStr(v('machineOffTime'))),
          DetailMetric(label: FaLabels.hours, value: nStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(
            label: 'Planned Operator Shift (Hours)',
            value: nStr(v('plannedOperatorShiftHours') == '' ? null : v('plannedOperatorShiftHours')),
          ),
          DetailMetric(label: FaLabels.effective, value: nStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
          DetailMetric(label: FaLabels.unreported, value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
        ],
      ),
      DetailGroup(
        title: 'Idle time & other activity',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: FaLabels.otherActivity, value: textStr(v('otherActivity')), maxLines: 3),
          DetailMetric(label: FaLabels.otherActivityMin, value: zeroIfBlank(v('otherActivityMin'))),
          DetailMetric(label: FaLabels.totalIdle, value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
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
          DetailMetric(label: FaLabels.worker, value: textStr(v('operator'))),
          DetailMetric(label: FaLabels.itemName, value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: FaLabels.workingStatus, value: row['workingMode'] == 'Non Working' ? 'Non Working' : 'Working'),
          DetailMetric(label: FaLabels.reasons, value: faReasonsText(row), maxLines: 3),
          DetailMetric(label: FaLabels.remarks, value: generalText.isEmpty ? '—' : generalText, maxLines: 3, remarks: general),
        ],
      ),
    ],
  );
}
