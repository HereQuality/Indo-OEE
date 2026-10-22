import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'powder_calc.dart';

/// Everything one saved After Powder Coating entry holds, grouped: the two
/// Productivity percentages up top (combined across the worker's date), then
/// Inspection, Time, Idle & activity, OEE and the entry's own text — every
/// figure of the web sheet's table, with the "Other" idle remark behind an eye
/// beside its figure and the general remark on its own row.
DetailModel powderDetail(Json row, Json calc, Json day) {
  final parts = remarkParts(row);
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in parts)
          if (p['key'] == kind) p,
      ];

  final defectRows = <DetailRow>[
    for (final (key, label) in powderDefectFields)
      if (positive(row[key])) DetailSubRow(label: label, value: zeroIfBlank(row[key])),
  ];
  final idleRows = <DetailRow>[
    for (final (key, label) in powderIdleFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceAll(' etc (min)', '').replaceAll(' (min)', ''),
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
        formulaKey: 'productivity',
        title: 'Productivity without considering Lunch, Tea, etc.',
        label: 'Without lunch',
        value: pctStr(day['productivity']),
      ),
      DetailOee(
        formulaKey: 'productivityLunch',
        title: 'Productivity considering Lunch, Tea, etc.',
        label: 'With lunch',
        value: pctStr(day['productivityLunch']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Inspection',
        icon: Icons.fact_check_outlined,
        rows: [
          DetailMetric(label: 'Standard Inspection Time per Piece (Sec)', value: minStr(v('totalCycleSec'))),
          DetailMetric(label: 'Ideal Inspection Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(
            label: 'Ideal Inspection Quantity/Hour',
            value: nStr(calc['idealQtyPerHour']),
            tone: SheetTones.calc,
            formulaKey: 'idealQtyPerHour',
          ),
          DetailMetric(label: 'Total Qty', value: minStr(v('actualQty'))),
          DetailMetric(label: 'OK Qty', value: nStr(calc['okQty']), tone: SheetTones.calc, formulaKey: 'okQty', strong: true),
          DetailMetric(label: 'Total Defect / Rework', value: nStr(calc['totalDefect']), tone: SheetTones.calc, formulaKey: 'totalDefect'),
          ...defectRows,
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Inspection Start Time', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Inspection End Time', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Inspection Working Hours (hr:min)', value: hmStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
          DetailMetric(label: 'Ideal Inspection Time (hr:min)', value: hmStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
        ],
      ),
      DetailGroup(
        title: 'Idle time & other activity',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Other Activity Carried Out', value: textStr(v('otherActivity')), maxLines: 3),
          DetailMetric(label: 'Time in Other Activity (min)', value: zeroIfBlank(v('otherActivityMin'))),
          DetailMetric(label: 'Total Idle Time (min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
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
          DetailMetric(label: 'Worker Name', value: textStr(v('operator'))),
          DetailMetric(label: 'Item Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Working Status', value: machineStatusText(row), maxLines: 3),
          DetailMetric(
            label: 'Reason/Remarks for Rejection/Rework',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
