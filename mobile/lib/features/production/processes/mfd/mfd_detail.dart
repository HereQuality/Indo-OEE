import 'package:flutter/material.dart';

import '../../process/process_spec.dart';
import '../../sheet/sheet_model.dart';
import '../../sheet/table/shared_columns.dart';
import '../../sheet/widgets/sheet_format.dart';
import '../../sheet/widgets/sheet_style.dart';
import '../../shared/production_sheet_calc.dart';
import 'mfd_calc.dart';
import 'mfd_columns.dart';

/// The expanded MODULAR FRAME DRILLING entry: every column of the web table,
/// grouped — the three OEE figures (this entry's own; the machine's day on a
/// locked shift) on top, then Part, Quantities, Time, Downtime, Efficiency and
/// the entry's own text, in the sheet's words.
DetailModel mfdDetail(Json row, Json calc, Json day) {
  Object? v(String key) => row[key];
  List<Json> remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];
  final downtimeRows = <DetailRow>[
    for (final (key, label) in mfdStoppageFields)
      if (positive(row[key]))
        DetailSubRow(
          label: label.replaceFirst(RegExp(r' \(min\)$', caseSensitive: false), ''),
          value: zeroIfBlank(row[key]),
          unit: 'min',
          remarks: key == 'otherMin' ? remarks('downtime') : const [],
          remarkTone: SheetTones.downtime,
          remarkLabel: 'View downtime remark',
        ),
  ];
  final general = remarks('general');
  final generalText = general.isEmpty ? '' : '${general.first['text']}';
  String typed(Object? x) => (x == null || x == '') ? '—' : fmtNum(jsToNumber(x));
  return DetailModel(
    oee: [
      DetailOee(formulaKey: 'oeeLosses', title: 'OEE considering losses', label: 'Considering losses', value: pctStr(day['oeeLosses'])),
      DetailOee(formulaKey: 'oeeLunch', title: 'OEE not considering losses, but lunch', label: 'Lunch only', value: pctStr(day['oeeLunch'])),
      DetailOee(
        formulaKey: 'oeeLunchCot',
        title: 'OEE not considering losses, but lunch & COT',
        label: 'Lunch + COT',
        value: pctStr(day['oeeLunchCot']),
      ),
    ],
    groups: [
      DetailGroup(
        title: 'Part',
        icon: Icons.precision_manufacturing_outlined,
        rows: [
          DetailMetric(label: 'Part Name', value: textStr(v('itemName'))),
          ?vendorMetric(row),
          DetailMetric(label: 'Drawing No.', value: textStr(v('drawingNo'))),
          DetailMetric(label: 'Process', value: textStr(v('operation'))),
          DetailMetric(label: 'No. of Holes in One Piece', value: typed(v('noOfHoles'))),
          DetailMetric(label: 'Stroke Required for One Piece', value: typed(v('strokeRequired'))),
          DetailMetric(label: 'Total Cycle Time (Sec)', value: typed(v('totalCycleSec')), formulaKey: 'cycle', tone: SheetTones.calc),
        ],
      ),
      DetailGroup(
        title: 'Quantities',
        icon: Icons.inventory_2_outlined,
        rows: [
          DetailMetric(label: 'IDEAL Quantity', value: dash(fmtIdeal(calc['idealQtyExact'])), tone: SheetTones.calc, formulaKey: 'idealQty'),
          DetailMetric(
            label: 'IDEAL Quantity/Hour',
            value: dash(fmtIdealPerHour(calc['idealQtyPerHour'])),
            tone: SheetTones.calc,
            formulaKey: 'idealQtyPerHour',
          ),
          DetailMetric(label: 'Actual Quantity', value: nStr(calc['actualQty']), formulaKey: 'actualQty', tone: SheetTones.calc),
          DetailMetric(label: 'ACTUAL OK Quantity', value: typed(v('okQty')), strong: true),
          DetailMetric(label: 'Rejected Quantity', value: nStr(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
          DetailMetric(label: '% OK Quantity', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
        ],
      ),
      DetailGroup(
        title: 'Time',
        icon: Icons.schedule_rounded,
        rows: [
          DetailMetric(label: 'Machine Time ON', value: textStr(v('machineOnTime'))),
          DetailMetric(label: 'Machine Time OFF', value: textStr(v('machineOffTime'))),
          DetailMetric(label: 'Setting Time ON', value: textStr(v('settingOnTime'))),
          DetailMetric(label: 'Setting Time OFF', value: textStr(v('settingOffTime'))),
          DetailMetric(label: 'Machine Shift Time (Hour)', value: mfdHours(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
          DetailMetric(label: 'Planned Operator Shift Time (hr:min)', value: hmStr(v('plannedOperatorShiftHours'))),
        ],
      ),
      DetailGroup(
        title: 'Downtime',
        icon: Icons.pause_circle_outline_rounded,
        rows: [
          DetailMetric(label: 'Total stoppage (Min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
          ...downtimeRows,
        ],
      ),
      DetailGroup(
        title: 'Efficiency',
        icon: Icons.speed_rounded,
        rows: [
          DetailMetric(
            label: 'Effective Machine Run Time (Hour)',
            value: mfdHours(calc['effectiveHours']),
            tone: SheetTones.calc,
            formulaKey: 'effective',
          ),
          DetailMetric(label: 'Unreported Time (Min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
          DetailMetric(label: 'Efficiency (%)', value: pctStr(calc['efficiency']), tone: SheetTones.calc, formulaKey: 'efficiency'),
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
          DetailMetric(label: 'Working Status', value: mfdWorkingStatusText(row)),
          if (row['workingMode'] == 'Non Working')
            DetailMetric(label: 'Reasons For Not Working', value: mfdNotWorkingReasons(row), maxLines: 3),
          DetailMetric(label: 'REMARKS', value: generalText.isEmpty ? '—' : generalText, maxLines: 3, remarks: general),
        ],
      ),
    ],
  );
}
