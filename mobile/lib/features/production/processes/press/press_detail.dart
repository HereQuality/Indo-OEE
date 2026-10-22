import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../shared/production_sheet_calc.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import 'press_columns.dart';

/// Everything one saved PRESS entry holds, grouped: the three OEE percentages up
/// top, then Quantities, Time, Stoppage, Efficiency and the entry's own text —
/// every column of the web PRESS table, with the Others-downtime remark behind
/// an eye beside its figure and the general remark on its own row.
DetailModel pressDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];

  final stopRows = <DetailRow>[
    for (final key in pressDowntimeOrder)
      if (positive(row[key]))
        DetailSubRow(
          label: pressDowntimeLabel[key] ?? key,
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
          DetailMetric(label: 'Standard Time Taken (Min)', value: minStr(v('standardTimeMin'))),
          DetailMetric(label: 'No. Piece in Standard Time', value: minStr(v('pcsPerStandardTime'))),
          DetailMetric(label: 'Product Cycle Time (sec)', value: nStr(calc['totalCycleSec']), tone: SheetTones.calc, formulaKey: 'cycle'),
          DetailMetric(label: 'Ideal Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(label: 'Actual OK Quantity', value: minStr(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected Quantity', value: minStr(v('rejectedQty'))),
          DetailMetric(label: '% OK Quantity', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Machine Time ON', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Machine Time OFF', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Machine Shift Time (hr:min)', value: hmStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
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
          DetailMetric(label: 'Setup Efficiency (%)', value: pctStr(calc['setupEfficiency']), tone: SheetTones.calc, formulaKey: 'setupEff'),
          DetailMetric(label: 'Effective Machine Run Time (hr:min)', value: hmStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
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
          DetailMetric(label: 'Operation', value: textStr(v('operation'))),
          DetailMetric(label: 'Drawing No.', value: textStr(v('drawingNo'))),
          DetailMetric(label: 'Setup No.', value: textStr(v('setupNo'))),
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
