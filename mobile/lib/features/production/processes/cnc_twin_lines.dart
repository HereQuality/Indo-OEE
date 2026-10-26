import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../entry_form/common_lines.dart';
import '../entry_form/entry_fields.dart';
import '../entry_form/entry_form_logic.dart';
import '../entry_form/entry_layout.dart';
import '../entry_form/entry_line_context.dart';
import '../entry_form/entry_number_input.dart';
import '../entry_form/machine_status.dart';
import '../entry_form/web_parity_lines.dart';
import '../shared/production_sheet_calc.dart';
import 'cnc/cnc_lines.dart' as cnc show quantityLine, rejectLine;
import 'cnc_twin_calc.dart';
import 'cnc_twin_style.dart';

const List<String> _line1 = [
  'date',
  'machine',
  'operator',
  'workingMode',
  'machineStatus',
];

/// The downtime boxes of the three forms, in order: key + label (web
/// `DOWNTIME_BOXES` — unlike CNC's, Planned Downtime is a box here).
const List<(String, String)> twinDowntimeBoxes = [
  ('plannedDownMin', 'Planned Downtime (min)'),
  ('setupMin', 'Set-up Time (min)'),
  ('noManPowerMin', 'No Manpower (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'B.D. Mech. (min)'),
  ('bdEleMin', 'B.D. Ele. (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('otherMin', 'Others (min)'),
];

/// Whether the block is a status-only day (Working Status other than PRESENT,
/// or Machine Working Status = Non Working): nothing but its date, machine,
/// operator, status and remarks is asked for.
bool _statusOnly(Map<String, dynamic> v) =>
    twinIsStatusOnly(v) || twinIsNonWorking(v);

/// The Contact / Trobe / Spring entry form (ports of {Contact,Trobe,Spring}
/// EntryForm.jsx — one component on the web, one here): the shared lines with
/// this sheet's own Date…Status, Part and Idle / Downtime cards, and the CNC
/// form's own Production Master (Actual + OK typed, Rejected = Actual − OK) and
/// Rejection Master (the rejected pieces split by reason) cards.
class CncTwinLines extends EntryLines {
  const CncTwinLines(this.style);

  final TwinStyle style;

  @override
  List<Widget> left(EntryLineContext c) => [
    headLine(c, style),
    if (!_statusOnly(c.values)) ...[
      partLine(c, style),
      timeLine(c),
      cnc.quantityLine(c),
    ],
  ];

  @override
  List<Widget> right(EntryLineContext c) => [
    if (!_statusOnly(c.values)) ...[
      cnc.rejectLine(c),
      shiftLine(c),
      twinDowntimeLine(c, style),
    ],
    twinRemarksLine(c, style),
  ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
    if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
    if (entryText(v['actualQty']).isNotEmpty)
      'Actual ${entryText(v['actualQty'])}',
    if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
  ].join(' · ');
}

/// Date, Machine No., Operator and the Machine Working Status (Working / Non
/// Working, with the Status ticks of a Non Working day).
Widget headLine(EntryLineContext c, TwinStyle style) {
  final statusOnly = _statusOnly(c.values);
  final nonWorking = twinIsNonWorking(c.values);
  final operatorName = c.text('operator');
  final s = c.theme.colorScheme;
  return EntryLineCard(
    title: 'Date, Machine No., Operator',
    icon: Icons.event_note_rounded,
    hasError: c.lineHasError(_line1),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Date',
            required: true,
            error: c.err('date'),
            child: c.keyed(
              'date',
              EntryDateField(
                key: ValueKey('entry${c.index}/date'),
                value: c.text('date'),
                invalid: c.err('date') != null,
                focusNode: c.nodeFor('date'),
                onChanged: (d) {
                  HapticFeedback.selectionClick();
                  c.set('date', d);
                },
              ),
            ),
          ),
          EntryCell(
            label: 'Machine No.',
            required: true,
            error: c.err('machine'),
            hint: c.isEdit ? "Can't be changed while editing" : null,
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: 'Operator',
            required: !statusOnly,
            error: c.err('operator'),
            span: EntryCell.full,
            child: c.keyed(
              'operator',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/operator'),
                text: operatorName,
                hint: 'Select operator',
                invalid: c.err('operator') != null,
                focusNode: c.nodeFor('operator'),
                semanticsLabel: 'Operator',
                onTap: c.pickOperator,
              ),
            ),
          ),
          // Machine Working Status + the Status ticks (shared with every sheet that has them).
          ...machineWorkingStatusCells(c),
        ],
      ),
      if (nonWorking)
        nonWorkingNote(c)
      else if (statusOnly)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            '${c.text('workingStatus').trim()} — no production that day, so only Date, Machine No. and Working Status are saved (Operator and Remarks too, if filled in).',
            style: TextStyle(
              fontSize: 12.5,
              color: s.onSurfaceVariant,
              height: 1.3,
            ),
          ),
        ),
    ],
  );
}

/// Part / Item Name and this entry's own cycle time (prefilled from the Part).
Widget partLine(EntryLineContext c, TwinStyle style) {
  final item = entryItemFor(c.values, c.items);
  final partCycle = item == null ? null : entryNum(item['totalCycleSec']);
  final typed = entryNum(c.values['totalCycleSec']);
  final usualHint =
      c.err('totalCycleSec') == null && partCycle != null && typed != partCycle
      ? "Part's usual: ${fmtNum(partCycle)} sec"
      : null;
  return EntryLineCard(
    title: style.partCardTitle,
    icon: Icons.precision_manufacturing_outlined,
    hasError: c.lineHasError(const ['itemName', 'totalCycleSec', 'vendor']),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: style.itemLabel,
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                text: c.text('itemName'),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: style.itemLabel,
                onTap: c.pickItem,
              ),
            ),
          ),
          EntryCell(
            label: style.cycleLabel,
            required: true,
            error: c.err('totalCycleSec'),
            hint: usualHint,
            child: c.keyed(
              'totalCycleSec',
              c.numBox(
                'totalCycleSec',
                decimals: true,
                label: style.cycleLabel,
              ),
            ),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
    ],
  );
}

/// The downtime boxes (Idle Time on Spring), the running total with its
/// allowance bar and the "Others" remark box.
Widget twinDowntimeLine(EntryLineContext c, TwinStyle style) {
  final m = c.metrics;
  final keys = [
    for (final b in twinDowntimeBoxes) b.$1,
    'stoppageTotal',
    'otherMinRemark',
  ];
  final anyLocked = twinDowntimeBoxes.any(
    (b) => c.locked(b.$1, m.minutesLimit(b.$1).max),
  );
  return EntryLineCard(
    title: style.downtimeCardTitle,
    icon: Icons.build_circle_outlined,
    hasError: c.lineHasError(keys),
    optional: true,
    hasValue: c.anyFilled([for (final k in keys) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in twinDowntimeBoxes)
            EntryCell(
              label: label,
              error: c.err(key),
              child: c.keyed(key, c.minutesBox(key, label)),
            ),
        ],
      ),
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed('stoppageTotal', stoppageMeter(c)),
      if (m.otherDowntimeUsed) ...[
        const SizedBox(height: 10),
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Remark for Others downtime',
              required: true,
              error: c.err('otherMinRemark'),
              span: EntryCell.full,
              child: c.keyed(
                'otherMinRemark',
                EntryTextField(
                  key: ValueKey('entry${c.index}/otherMinRemark'),
                  value: c.text('otherMinRemark'),
                  maxLength: 300,
                  minLines: 2,
                  maxLines: 4,
                  hint: 'What was the “Others” downtime?',
                  invalid: c.err('otherMinRemark') != null,
                  focusNode: c.nodeFor('otherMinRemark'),
                  semanticsLabel: 'Remark for Others downtime',
                  onChanged: (t) => c.set('otherMinRemark', t),
                ),
              ),
            ),
          ],
        ),
      ],
    ],
  );
}

/// Remarks (Spring: "Reason / Remarks for Rejection / Rework"), optional.
Widget twinRemarksLine(EntryLineContext c, TwinStyle style) => EntryLineCard(
  title: style.remarksCardTitle,
  icon: Icons.notes_rounded,
  hasError: c.lineHasError(const ['remarks']),
  optional: true,
  hasValue: c.anyFilled(const ['remarks']),
  revealKey: 'entry${c.index}/remarks',
  children: [
    EntryGrid(
      cells: [
        EntryCell(
          span: EntryCell.full,
          child: c.keyed(
            'remarks',
            EntryTextField(
              key: ValueKey('entry${c.index}/remarks'),
              value: c.text('remarks'),
              maxLength: 500,
              minLines: 2,
              maxLines: 5,
              hint: 'Anything worth noting about this shift (optional)',
              focusNode: c.nodeFor('remarks'),
              semanticsLabel: style.remarksLabel,
              onChanged: (t) => c.set('remarks', t),
            ),
          ),
        ),
      ],
    ),
  ],
);
