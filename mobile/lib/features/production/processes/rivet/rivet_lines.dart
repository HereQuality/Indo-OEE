import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/production_sheet_calc.dart';
import '../cnc/cnc_lines.dart' show quantityLine, rejectLine;
import 'rivet_calc.dart';

// The RIVET Data Entry form (port of RivetEntryForm.jsx): the shared lines with
// RIVET's own cards — Date/Machine/Operator + Machine Working Status, Process /
// Part / No. of Holes / the four tickable operations — and CNC's Production
// Master (Actual within Ideal, OK within Actual) and Rejection Master cards.

final List<String> _line2 = ['processType', 'itemName', 'vendor', 'noOfHoles', ...rivetOpKeys];

/// The downtime boxes of the RIVET form, in order: key + label.
const List<(String, String)> rivetDowntimeBoxes = [
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

class RivetEntryLines extends EntryLines {
  const RivetEntryLines();

  // Non Working: the machine did not run, so only the first line (and Remarks)
  // is asked for.
  @override
  List<Widget> left(EntryLineContext c) => isNonWorking(c.values)
      ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]
      : [dateMachineOperatorLine(c, workingStatus: true), rivetPartLine(c), timeLine(c), quantityLine(c)];

  @override
  List<Widget> right(EntryLineContext c) => isNonWorking(c.values)
      ? [remarksLine(c)]
      : [rejectLine(c), shiftLine(c), rivetDowntimeLine(c), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) => isNonWorking(v)
      ? 'Non Working'
      : [
          if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
          if (entryText(v['actualQty']).isNotEmpty) 'Actual ${entryText(v['actualQty'])}',
          if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
        ].join(' · ');
}

/// A row of tappable choices (a dropdown on the web). [selected] may be several.
class _Choices extends StatelessWidget {
  const _Choices({
    required this.idPrefix,
    required this.options,
    required this.selected,
    required this.onTap,
    this.focusNode,
    this.invalid = false,
  });

  final String idPrefix;
  final List<String> options;
  final Set<String> selected;
  final void Function(String option) onTap;
  final FocusNode? focusNode;
  final bool invalid;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Focus(
      focusNode: focusNode,
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final o in options)
            ChoiceChip(
              key: ValueKey('$idPrefix/$o'),
              label: Text(o),
              selected: selected.contains(o),
              side: invalid && selected.isEmpty ? BorderSide(color: s.error) : null,
              onSelected: (_) {
                HapticFeedback.selectionClick();
                onTap(o);
              },
            ),
        ],
      ),
    );
  }
}

/// Part Name (+ Vendor Name), Process, No. of Holes in One Piece, the four tickable
/// operations and the grey Total Cycle Time - the web's line 2, box for box.
Widget rivetPartLine(EntryLineContext c) {
  final m = c.metrics;
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  final process = c.text('processType');
  // A record saved with a value since retired from the list still shows it.
  final processOptions = [...rivetProcessTypes, if (process.isNotEmpty && !rivetProcessTypes.contains(process)) process];
  return EntryLineCard(
    title: 'Process, Part, Total Cycle Time',
    icon: Icons.precision_manufacturing_outlined,
    hasError: c.lineHasError(_line2),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Part Name',
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                // Web `partCycleLabel` (Rivet's picker passes `label`): "Rivet 4mm — 45 sec".
                text: partBoxText(c),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: 'Part Name',
                onTap: c.pickItem,
              ),
            ),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
          EntryCell(
            label: 'Process',
            required: true,
            error: c.err('processType'),
            span: EntryCell.full,
            child: c.keyed(
              'processType',
              _Choices(
                idPrefix: 'entry${c.index}/processType',
                options: processOptions,
                selected: {if (process.isNotEmpty) process},
                invalid: c.err('processType') != null,
                focusNode: c.nodeFor('processType'),
                onTap: (o) => c.set('processType', o),
              ),
            ),
          ),
          EntryCell(
            label: 'No. of Holes in One Piece',
            error: c.err('noOfHoles'),
            child: c.keyed('noOfHoles', c.numBox('noOfHoles', label: 'No. of Holes in One Piece')),
          ),
        ],
      ),
      // The web has no heading or note over the operation tick boxes.
      const SizedBox(height: 10),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [for (final f in rivetOpFields) _opTile(c, f, item, excluded)],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Total Cycle Time (Sec)',
            child: c.calcBox('totalCycleSec', entryFmt(m.calc['totalCycleSec']), 'Total Cycle Time (Sec)'),
          ),
        ],
      ),
    ],
  );
}

Widget _opTile(EntryLineContext c, Map<String, dynamic> f, Map<String, dynamic>? item, Set<String> excluded) {
  final key = f['key'] as String;
  final canTick = entryCanTick(item, key);
  final isExcluded = excluded.contains(key);
  return c.keyed(
    key,
    EntryOpTile(
      key: ValueKey('entry${c.index}/$key'),
      label: '${f['label']}'.replaceFirst(' (sec)', ''),
      value: canTick ? entryFmt(item![key]) : '',
      ticked: canTick && !isExcluded,
      excluded: isExcluded,
      enabled: canTick,
      focusNode: c.nodeFor(key),
      onToggle: () {
        HapticFeedback.selectionClick();
        final raw = c.values['excludedOps'];
        final list = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
        c.set('excludedOps', isExcluded ? list.where((k) => '$k' != key).toList() : [...list, key]);
      },
    ),
  );
}

/// The nine downtime boxes, the running total against the Machine Shift, and the
/// "Others" remark once Others downtime is used. RIVET's own wording (web
/// RivetEntryForm.jsx line 8): "Remark for Others downtime" - the shared
/// `downtimeLine` says "Other".
Widget rivetDowntimeLine(EntryLineContext c) {
  final m = c.metrics;
  final keys = [for (final b in rivetDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = rivetDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
  return EntryLineCard(
    title: 'Downtime / Stoppage (min)',
    icon: Icons.build_circle_outlined,
    hasError: c.lineHasError(keys),
    optional: true,
    hasValue: c.anyFilled([for (final k in keys) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in rivetDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      // Phone-only: why some downtime boxes take nothing (the web raises a popup when you type).
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
