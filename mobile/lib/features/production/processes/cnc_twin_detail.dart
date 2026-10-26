import 'package:flutter/material.dart';

import '../process/process_spec.dart';
import '../sheet/sheet_model.dart';
import '../sheet/table/shared_columns.dart';
import '../sheet/widgets/sheet_format.dart';
import '../sheet/widgets/sheet_style.dart';
import '../shared/production_sheet_calc.dart';
import 'cnc_twin_style.dart';

/// The expanded entry of Contact / Trobe / Spring: the OEE tiles, then
/// Quantities, Time, Stoppage (Idle Time on Spring), Efficiency and the entry's
/// own text — every column of the web table, grouped.
DetailModel twinDetail(Json row, Json calc, Json day, TwinStyle style) {
  Object? v(String key) => row[key];
  final spring = style.spring;
  List<Json> remarks(String kind) => [
    for (final p in remarkParts(row))
      if (p['key'] == kind) p,
  ];
  final breakdown = row['rejectBreakdown'] is Map
      ? Map<String, dynamic>.from(row['rejectBreakdown'] as Map)
      : <String, dynamic>{};
  final rejectRows = <DetailRow>[
    for (final reason in rejectReasons)
      if (hasValue(breakdown[reason]) ||
          (reason == 'Other' && remarks('reject').isNotEmpty))
        DetailSubRow(
          label: reason,
          value: minStr(breakdown[reason]),
          remarks: reason == 'Other' ? remarks('reject') : const [],
          remarkTone: SheetTones.reject,
          remarkLabel: 'View reject remark',
        ),
  ];
  final stopLabel = spring ? 'Idle Time' : 'Stoppage';
  final stopRows = <DetailRow>[
    for (final f in stoppageFields)
      if (positive(row[f['key']]))
        DetailSubRow(
          label: '${f['label']}'.replaceFirst(' (min)', ''),
          value: zeroIfBlank(row[f['key']]),
          unit: 'min',
          remarks: f['key'] == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View downtime remark',
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
      DetailOee(
        formulaKey: 'oeeLunchCot',
        title: 'OEE not considering losses but lunch and setup time',
        label: 'Lunch + Setup Time',
        value: pctStr(day['oeeLunchCot']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Quantities',
        icon: Icons.inventory_2_outlined,
        rows: [
          DetailMetric(
            label: style.cycleLabel.replaceFirst('(Sec)', '(sec)'),
            value: minStr(v('totalCycleSec')),
            formulaKey: 'cycle',
            tone: SheetTones.calc,
          ),
          DetailMetric(
            label: 'Ideal Quantity',
            value: nStr(calc['idealQty']),
            tone: SheetTones.calc,
            formulaKey: 'idealQty',
          ),
          DetailMetric(
            label: 'Ideal Quantity/Hours',
            value: nStr(calc['idealQtyPerHour']),
          ),
          DetailMetric(
            label: spring ? 'Total Qty' : 'Actual Quantity',
            value: nStr(calc['actualQty']),
          ),
          DetailMetric(
            label: spring ? 'OK Qty' : 'Actual OK Quantity',
            value: minStr(v('okQty')),
            strong: true,
          ),
          DetailMetric(
            label: spring ? 'Rejected Qty' : 'Rejected Quantity',
            value: nStr(calc['rejectedQty']),
            tone: SheetTones.calc,
            formulaKey: 'rejectedQty',
          ),
          ...rejectRows,
          DetailMetric(
            label: spring ? 'OK Quantity (%)' : '% OK Quantity',
            value: pctStr(calc['pctOk']),
            tone: SheetTones.calc,
            formulaKey: 'pctOk',
          ),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(
            label: 'Machine ON Time',
            value: textStr(v('machineOnTime')),
          ),
          DetailMetric(
            label: 'Machine OFF Time',
            value: textStr(v('machineOffTime')),
          ),
          DetailMetric(
            label: 'Machine Shift Time (hr:min)',
            value: hmStr(calc['shiftHours']),
            tone: SheetTones.calc,
            formulaKey: 'shift',
          ),
          DetailMetric(
            label: 'Planned Operator Shift Time (hr:min)',
            value: hmStr(v('plannedOperatorShiftHours')),
          ),
          if (!spring)
            DetailMetric(
              label: 'Unutilized Machine Time (%)',
              value: pctStr(day['unutilized']),
              tone: SheetTones.day,
              formulaKey: 'unutilized',
            ),
        ],
      ),
      DetailGroup(
        title: stopLabel,
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(
            label: spring ? 'Total Idle Time (min)' : 'Total Stoppage (min)',
            value: nStr(calc['totalStoppageMin']),
            tone: SheetTones.calc,
            formulaKey: 'totalStoppage',
          ),
          ...stopRows,
        ],
      ),
      DetailGroup(
        title: 'Efficiency',
        icon: Icons.speed_rounded,
        rows: [
          DetailMetric(
            label: 'Effective Machine Run Time (hr:min)',
            value: hmStr(calc['effectiveHours']),
            tone: SheetTones.calc,
            formulaKey: 'effective',
          ),
          DetailMetric(
            label: 'Unreported Time (min)',
            value: nStr(day['unreportedMin']),
            tone: SheetTones.day,
            formulaKey: 'unreported',
          ),
          if (!spring)
            DetailMetric(
              label: 'Setup Efficiency (%)',
              value: pctStr(calc['setupEfficiency']),
              tone: SheetTones.calc,
              formulaKey: 'setupEff',
            ),
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
          DetailMetric(label: 'Operator', value: textStr(v('operator'))),
          if (style.workingStatusColumn)
            DetailMetric(
              label: 'Working Status',
              value: textStr(v('workingStatus')),
            ),
          machineStatusMetric(row),
          DetailMetric(label: style.itemLabel, value: textStr(v('itemName'))),
          ?vendorMetric(row),
          if (!spring)
            DetailMetric(label: 'Drawing No.', value: textStr(v('drawingNo'))),
          DetailMetric(
            label: style.remarksLabel,
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
