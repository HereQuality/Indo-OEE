import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'rivet_calc.dart';
import 'rivet_columns.dart';

/// Everything one saved RIVET entry holds, grouped like the CNC detail: the
/// three OEE percentages on top, then Quantities (with the four cycle
/// operations), Time, Stoppage, Efficiency and the entry's own text — every
/// calculated column of the web sheet's table. Rejected Quantity is Actual − OK,
/// followed by its Rejection Master split; the "Other" reject remark and the
/// "Others" downtime remark sit behind an eye.
DetailModel rivetDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];
  final breakdown = row['rejectBreakdown'] is Map ? Map<String, dynamic>.from(row['rejectBreakdown'] as Map) : <String, dynamic>{};
  final excluded = row['excludedOps'] is List ? (row['excludedOps'] as List).map((e) => '$e').toSet() : <String>{};

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
  final opRows = <DetailRow>[
    for (final f in rivetOpFields)
      if (hasValue(row[f['key']]))
        DetailSubRow(
          label: '${f['label']}'.replaceFirst(' (sec)', ' (Sec)'),
          value: minStr(row[f['key']]),
          struck: excluded.contains(f['key']),
          note: excluded.contains(f['key']) ? 'skipped' : null,
        ),
  ];
  const downtimeOrder = ['lunchMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'otherMin', 'plannedDownMin'];
  final stopRows = <DetailRow>[
    for (final key in downtimeOrder)
      if (positive(row[key]))
        DetailSubRow(
          label: rivetDowntimeLabel[key] ?? key,
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View downtime remark',
        ),
  ];

  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';

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
          DetailMetric(label: 'Total Cycle Time (Sec)', value: nStr(calc['totalCycleSec']), tone: SheetTones.calc, formulaKey: 'cycle'),
          ...opRows,
          DetailMetric(label: 'Ideal Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(label: 'Actual Quantity', value: nStr(calc['actualQty'])),
          DetailMetric(label: 'Actual OK Quantity', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected Quantity', value: nStr(calc['rejectedQty']), tone: SheetTones.calc),
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
          DetailMetric(label: 'Process', value: textStr(v('processType'))),
          DetailMetric(label: 'No. of Holes in One Piece', value: minStr(v('noOfHoles'))),
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
