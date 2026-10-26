import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'raw_casting_calc.dart';
import 'raw_casting_columns.dart';

/// Everything one saved RAW CASTING entry holds, grouped: the two Productivity
/// percentages up top (this entry's own), then Inspection, Time, Idle & activity,
/// OEE and the entry's own text — every figure of the web sheet's table
/// (rawCastingColumns.jsx), with the "Other" idle remark behind an eye beside its
/// figure and the Reason/Remarks on its own row.
DetailModel rawCastingDetail(Json row, Json calc, Json day) {
  final parts = remarkParts(row);
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in parts)
          if (p['key'] == kind) p,
      ];

  final split = row['rejectBreakdown'];
  final defectRows = <DetailRow>[
    for (final d in rawCastingDefects)
      if (positive(split is Map ? split[d] : null)) DetailSubRow(label: d, value: zeroIfBlank((split as Map)[d])),
  ];
  final idleRows = <DetailRow>[
    for (final (key, label) in rawCastingIdleFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceAll(RegExp(r' etc \(Min\)$| \(Min\)$'), ''),
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
        title: 'Inspection',
        icon: Icons.fact_check_outlined,
        rows: [
          DetailMetric(label: 'Standard Inspection Time per Piece (in Sec)', value: minStr(v('totalCycleSec')), formulaKey: 'cycle'),
          DetailMetric(label: 'TOTAL QTY', value: minStr(v('actualQty'))),
          DetailMetric(label: 'OK QTY', value: nStr(calc['okQty']), tone: SheetTones.calc, formulaKey: 'okQty', strong: true),
          DetailMetric(label: 'Total Defects', value: nStr(calc['totalDefect']), tone: SheetTones.calc, formulaKey: 'totalDefect'),
          ...defectRows,
          DetailMetric(label: 'Ideal Inspection Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(
            label: 'Ideal Inspection Quantity/Hour',
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
          DetailMetric(label: 'Inspection Start Time', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Inspection End Time', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Inspection Working Hours', value: nStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift (Hours)', value: rawCastingPlannedText(row)),
          DetailMetric(label: 'Ideal Inspection Time (In Hour)', value: nStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
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
        rows: [
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
          DetailMetric(label: 'Challan No.', value: textStr(v('challanNo'))),
          DetailMetric(label: 'Working Status', value: rawCastingWorkingModeText(row)),
          DetailMetric(label: 'Reasons For Not Working', value: rawCastingReasonsText(row), maxLines: 3),
          DetailMetric(
            label: 'Reason/Remarks for Rejection',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
