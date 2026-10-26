import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'rubber_calc.dart';

/// Everything one saved RUBBER entry holds, grouped: the two Productivity
/// percentages up top (combined across the worker's date), then Production,
/// Time, Stoppage, OEE and the entry's own text — every figure of the web
/// sheet's table, in its words, with the "Other" reject / "Others" stoppage
/// remarks behind an eye beside their figure and the general remark on its own
/// row.
DetailModel rubberDetail(Json row, Json calc, Json day) {
  final parts = remarkParts(row);
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in parts)
          if (p['key'] == kind) p,
      ];

  final breakdown = row['rejectBreakdown'] is Map ? Map<String, dynamic>.from(row['rejectBreakdown'] as Map) : <String, dynamic>{};
  final rejectRows = <DetailRow>[
    for (final reason in rejectReasons)
      if (hasValue(breakdown[reason]) || (reason == 'Other' && remarks('reject').isNotEmpty))
        DetailSubRow(
          label: reason,
          value: minStr(breakdown[reason]),
          remarks: reason == 'Other' ? remarks('reject') : const [],
          remarkTone: SheetTones.reject,
          remarkLabel: 'View reject remark',
        ),
  ];
  final stopRows = <DetailRow>[
    for (final (key, label) in rubberStoppageFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceAll(' etc (min)', '').replaceAll(' (min)', ''),
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View stoppage remark',
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
        title: 'Production',
        icon: Icons.inventory_2_outlined,
        rows: [
          // Typed per entry (prefilled from the Part), so not a grey "calc" figure.
          DetailMetric(label: 'Total Cycle Time (Sec)', value: minStr(v('totalCycleSec'))),
          DetailMetric(label: 'IDEAL Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(
            label: 'IDEAL Quantity/Hour',
            value: nStr(calc['idealQtyPerHour']),
            tone: SheetTones.calc,
            formulaKey: 'idealQtyPerHour',
          ),
          DetailMetric(label: 'Actual Quantity', value: nStr(calc['actualQty'])),
          DetailMetric(label: 'ACTUAL OK Quantity', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected Quantity', value: zeroIfBlank(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          ...rejectRows,
          DetailMetric(label: '% OK Quantity', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Working Start Time', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Working End Time', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Worker Shift Time (hr:min)', value: hmStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
          DetailMetric(label: 'Effective working Time (hr:min)', value: hmStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
        ],
      ),
      DetailGroup(
        title: 'Stoppage',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Total stoppage (min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
          ...stopRows,
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
          DetailMetric(label: 'Part Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Working Status', value: machineStatusText(row), maxLines: 3),
          DetailMetric(
            label: 'REMARKS',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
