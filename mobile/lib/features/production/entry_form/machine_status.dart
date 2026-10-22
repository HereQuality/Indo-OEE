import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../shared/production_sheet_calc.dart' show isNonWorking, machineStatuses, workingModes;
import 'entry_layout.dart';
import 'entry_line_context.dart';
import 'entry_style.dart';

// The shared Machine Working Status of the entry forms — the phone's version of
// the web form's "Machine Working Status" select + MachineStatusSelect.jsx
// (client/src/Components/Production/).
//
//   Machine Working Status   Working | Non Working          (workingMode)
//   Status  (Non Working)    Machine Breakdown, No Manpower, No Planning, Remarks
//                                                           (machineStatus)
//
// "Remarks" is not stored as a status: ticking it opens the form's own Remarks
// box and puts the cursor there; it shows ticked while that box holds text. A
// Working entry carries no Status — switching back drops any ticked.
//
// A Non Working entry needs nothing else: the form shows [nonWorkingNote] and the
// Remarks card instead of Part / Time / Quantity / Stoppage, Operator becomes
// optional and the validation returns after Date + Machine (already so in
// `production_entry_validation.dart`).

/// The two cells (`Machine Working Status`, then `Status` while Non Working) of
/// the "Date, Machine No., Operator" card — pass `workingStatus: true` to
/// `dateMachineOperatorLine`, or place these yourself in a card of your own.
List<EntryCell> machineWorkingStatusCells(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final mode = nonWorking ? 'Non Working' : 'Working';
  final ticked = machineStatusList(c.values);
  return [
    EntryCell(
      label: 'Machine Working Status',
      error: c.err('workingMode'),
      span: EntryCell.full,
      child: c.keyed(
        'workingMode',
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (final m in workingModes)
              ChoiceChip(
                key: ValueKey('entry${c.index}/workingMode/$m'),
                label: Text(m),
                selected: mode == m,
                onSelected: (_) {
                  if (mode == m) return;
                  HapticFeedback.selectionClick();
                  c.set('workingMode', m);
                  // Working has no Status — drop any picked while it was Non Working.
                  if (m == 'Working') c.set('machineStatus', <dynamic>[]);
                },
              ),
          ],
        ),
      ),
    ),
    if (nonWorking)
      EntryCell(
        label: 'Status',
        error: c.err('machineStatus'),
        span: EntryCell.full,
        child: c.keyed(
          'machineStatus',
          MachineStatusSelect(
            index: c.index,
            ticked: ticked,
            remark: c.text('remarks'),
            onChanged: (list) => c.set('machineStatus', list),
            onOpenRemarks: () => c.focusField('remarks'),
          ),
        ),
      ),
  ];
}

/// The `machineStatus` list of a block as strings.
List<String> machineStatusList(Map<String, dynamic> values) {
  final raw = values['machineStatus'];
  return raw is List ? [for (final s in raw) '$s'] : <String>[];
}

/// The web's note under a Non Working entry (shown in place of the other cards).
Widget nonWorkingNote(EntryLineContext c) {
  final s = c.theme.colorScheme;
  return Padding(
    key: ValueKey('entry${c.index}/nonWorkingNote'),
    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
    child: Text.rich(
      TextSpan(
        style: TextStyle(fontSize: 13, height: 1.35, color: s.onSurfaceVariant),
        children: const [
          TextSpan(text: 'Non Working', style: TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(text: ' — the machine did not run, so nothing else is needed. Pick a Status if you like and press Save.'),
        ],
      ),
    ),
  );
}

/// Status ticks (Machine Breakdown / No Manpower / No Planning, in that order)
/// plus the "Remarks" tick. Statuses are kept in `machineStatuses` order like
/// the web's picker.
class MachineStatusSelect extends StatefulWidget {
  const MachineStatusSelect({
    super.key,
    required this.index,
    required this.ticked,
    required this.onChanged,
    this.remark = '',
    this.onOpenRemarks,
  });

  final int index;
  final List<String> ticked;
  final ValueChanged<List<String>> onChanged;

  /// The form's Remarks text: the "Remarks" tick shows on while it is not empty.
  final String remark;

  /// Called when Remarks is ticked on: open the Remarks box and focus it.
  final VoidCallback? onOpenRemarks;

  @override
  State<MachineStatusSelect> createState() => _MachineStatusSelectState();
}

class _MachineStatusSelectState extends State<MachineStatusSelect> {
  late bool _remarksOn = widget.remark.isNotEmpty;

  @override
  void didUpdateWidget(MachineStatusSelect old) {
    super.didUpdateWidget(old);
    // An entry opened for editing (or text typed into Remarks) brings its own.
    if (widget.remark.isNotEmpty && !_remarksOn) _remarksOn = true;
  }

  @override
  Widget build(BuildContext context) {
    final i = widget.index;
    final remarksTicked = _remarksOn || widget.remark.isNotEmpty;
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        for (final st in machineStatuses)
          FilterChip(
            key: ValueKey('entry$i/machineStatus/$st'),
            label: Text(st),
            selected: widget.ticked.contains(st),
            onSelected: (on) {
              HapticFeedback.selectionClick();
              widget.onChanged([
                for (final x in machineStatuses)
                  if (x == st ? on : widget.ticked.contains(x)) x,
              ]);
            },
          ),
        FilterChip(
          key: ValueKey('entry$i/machineStatus/Remarks'),
          label: const Text('Remarks'),
          avatar: remarksTicked ? null : Icon(Icons.edit_note_rounded, size: 18, color: EntryStyle.hint(context)),
          selected: remarksTicked,
          onSelected: (_) {
            HapticFeedback.selectionClick();
            // Text written in Remarks keeps the tick on, like the web.
            final next = widget.remark.isNotEmpty ? true : !_remarksOn;
            setState(() => _remarksOn = next);
            if (next) widget.onOpenRemarks?.call();
          },
        ),
      ],
    );
  }
}
