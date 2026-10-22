import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/entry_style.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show qtyNotice;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'rivet_calc.dart';

// The RIVET Data Entry form (port of RivetEntryForm.jsx): the shared lines with
// RIVET's own cards — Date/Machine/Operator + Machine Working Status, Process /
// Part / No. of Holes / the four tickable operations, and the two typed
// quantities (OK + Rejected, capped by Ideal Quantity).

final List<String> _line2 = ['processType', 'itemName', 'vendor', 'noOfHoles', ...rivetOpKeys];
const List<String> _line5 = ['okQty', 'rejectedQty'];

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
      : [dateMachineOperatorLine(c, workingStatus: true), rivetPartLine(c), timeLine(c), rivetQuantityLine(c)];

  @override
  List<Widget> right(EntryLineContext c) => isNonWorking(c.values)
      ? [remarksLine(c)]
      : [shiftLine(c), downtimeLine(c, boxes: rivetDowntimeBoxes), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) => isNonWorking(v)
      ? 'Non Working'
      : [
          if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
          if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
          if (entryText(v['rejectedQty']).isNotEmpty) 'Rejected ${entryText(v['rejectedQty'])}',
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

/// Process, Part Name, No. of Holes, the four tickable operations and Total Cycle Time.
Widget rivetPartLine(EntryLineContext c) {
  final m = c.metrics;
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  final hasItem = c.text('item').isNotEmpty;
  final s = c.theme.colorScheme;
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
                text: c.text('itemName'),
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
      const SizedBox(height: 10),
      Text(
        hasItem || item != null ? 'Operations in this cycle' : 'Operations (pick a part first)',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurface),
      ),
      const SizedBox(height: 2),
      Text(
        "Untick one to leave it out of this entry's cycle time.",
        style: TextStyle(fontSize: EntryStyle.noteSize, color: s.onSurfaceVariant, height: 1.25),
      ),
      const SizedBox(height: 8),
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
            hint: "The Part's own Total Cycle Time, minus any unticked operation above",
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

/// Actual OK and Rejected Quantity — both typed; together within Ideal Quantity.
Widget rivetQuantityLine(EntryLineContext c) {
  final m = c.metrics;
  final ideal = m.idealQty;
  double? room(String otherKey) => ideal == null ? null : (ideal - (entryNum(c.values[otherKey]) ?? 0)).clamp(0, double.infinity).toDouble();
  Widget box(String field, String label, String other) => c.keyed(
        field,
        c.numBox(
          field,
          label: label,
          max: room(other),
          // Past Ideal Quantity: the web's popup (entered = typed + the other box); a toast without popups.
          onExceedTyped: c.onLimit(
            (typed) => qtyNotice(calc: m.calc, entered: typed + (entryNum(c.values[other]) ?? 0)),
            (_) => "OK + Rejected can't be more than Ideal Quantity (${fmtNum(ideal)}): as per calculation this machine can make at most "
                '${fmtNum(ideal)} pieces in ${hoursToHm(m.calc['shiftHours'])} hr at ${fmtNum(m.calc['totalCycleSec'])} sec per piece.',
          ),
        ),
      );

  return EntryLineCard(
    title: 'Production (Qty)',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Actual OK Quantity',
            required: true,
            error: c.err('okQty'),
            child: box('okQty', 'Actual OK Quantity', 'rejectedQty'),
          ),
          EntryCell(
            label: 'Rejected Quantity',
            required: true,
            error: c.err('rejectedQty'),
            child: box('rejectedQty', 'Rejected Quantity', 'okQty'),
          ),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}
