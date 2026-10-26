import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'vmc_columns.dart';

/// Everything one saved VMC entry holds, grouped: the three OEE percentages up
/// top, then Quantities, Time, Stoppage, Efficiency and the entry's own text —
/// every column of the web VMC table, with the "Others" downtime remark behind
/// an eye beside its figure and the general remark on its own row.
DetailModel vmcDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
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
  final excluded = row['excludedOps'] is List ? (row['excludedOps'] as List).map((e) => '$e').toSet() : <String>{};

  // Program Time / No. of Piece In One Program: a ticked-off one is a per-entry
  // note only (the cycle time keeps using both).
  final programRows = <DetailRow>[
    for (final key in const ['programTimeMin', 'pcsPerProgram'])
      if (hasValue(row[key]))
        DetailSubRow(
          label: key == 'programTimeMin' ? 'Program Time (min)' : 'No. of Piece In One Program',
          value: minStr(row[key]),
          struck: excluded.contains(key),
          note: excluded.contains(key) ? 'skipped' : null,
        ),
  ];
  final stopRows = <DetailRow>[
    for (final key in vmcDowntimeOrder)
      if (positive(row[key]))
        DetailSubRow(
          label: vmcDowntimeLabel[key] ?? key,
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View downtime remark',
        ),
  ];

  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';
  final workOrderNo = textStr(row['workOrderNo']);

  return DetailModel(
    oee: [
      DetailOee(formulaKey: 'oeeLosses', title: 'OEE considering losses', label: 'Considering losses', value: pctStr(day['oeeLosses'])),
      DetailOee(formulaKey: 'oeeLunch', title: 'OEE not considering losses but lunch', label: 'Lunch only', value: pctStr(day['oeeLunch'])),
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
          DetailMetric(label: 'Product Cycle Time (sec)', value: nStr(calc['totalCycleSec']), tone: SheetTones.calc, formulaKey: 'cycle'),
          ...programRows,
          DetailMetric(label: 'Ideal Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(label: 'Actual Quantity', value: nStr(calc['actualQty']), tone: SheetTones.calc),
          DetailMetric(label: 'Actual OK Quantity', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected Quantity', value: nStr(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          ...rejectRows,
          DetailMetric(label: '% OK Quantity', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Machine ON Time', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Machine OFF Time', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Machine Shift Time (hr:min)', value: hmStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
          DetailMetric(label: 'Unutilized Machine Time (%)', value: pctStr(day['unutilized']), tone: SheetTones.day, formulaKey: 'unutilized'),
        ],
      ),
      DetailGroup(
        title: 'Stoppage',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Total Stoppage (min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
          ...stopRows,
        ],
      ),
      DetailGroup(
        title: 'Efficiency',
        icon: Icons.speed_rounded,
        rows: [
          DetailMetric(label: 'Effective Machine Run Time (hr:min)', value: hmStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
          DetailMetric(label: 'Setup Efficiency (%)', value: pctStr(calc['setupEfficiency']), tone: SheetTones.calc, formulaKey: 'setupEff'),
          DetailMetric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
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
          machineStatusMetric(row),
          DetailMetric(label: 'Part Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Drawing No.', value: textStr(v('drawingNo'))),
          if (workOrderNo != '—') DetailMetric(label: 'Work Order No.', value: workOrderNo),
          DetailMetric(
            label: 'Remarks',
            value: generalText.isEmpty ? '—' : generalText,
            maxLines: 3,
            remarks: general,
          ),
        ],
      ),
    ],
  );
}
