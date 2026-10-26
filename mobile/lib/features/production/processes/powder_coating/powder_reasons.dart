import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../entry_form/entry_style.dart';
import '../../shared/production_sheet_calc.dart' show machineStatuses;
import 'powder_calc.dart';

/// The "Reasons For Not Working" ticks of a Non Working day (the web's
/// `<MachineStatusSelect statuses={WORKER_STATUSES}>` in PowderCoatingEntryForm.jsx).
/// A worker has no machine to break down, so a new entry is offered only the
/// worker reasons plus "Remarks"; a reason an entry was saved with is still
/// listed, ticked, so editing it neither hides nor silently drops it. Same keys
/// (`entry<i>/machineStatus/<reason>`) and "Remarks" behaviour as the shared
/// status ticks of the machine sheets (entry_form/machine_status.dart).
class PowderReasonSelect extends StatefulWidget {
  const PowderReasonSelect({
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
  State<PowderReasonSelect> createState() => _PowderReasonSelectState();
}

class _PowderReasonSelectState extends State<PowderReasonSelect> {
  late bool _remarksOn = widget.remark.isNotEmpty;

  @override
  void didUpdateWidget(PowderReasonSelect old) {
    super.didUpdateWidget(old);
    // An entry opened for editing (or text typed into Remarks) brings its own.
    if (widget.remark.isNotEmpty && !_remarksOn) _remarksOn = true;
  }

  @override
  Widget build(BuildContext context) {
    final i = widget.index;
    final remarksTicked = _remarksOn || widget.remark.isNotEmpty;
    final offered = [
      for (final st in machineStatuses)
        if (powderReasonStatuses.contains(st) || widget.ticked.contains(st)) st,
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      children: [
        for (final st in offered)
          FilterChip(
            key: ValueKey('entry$i/machineStatus/$st'),
            label: Text(st),
            selected: widget.ticked.contains(st),
            onSelected: (on) {
              HapticFeedback.selectionClick();
              widget.onChanged([
                for (final x in offered)
                  if (x == st ? on : widget.ticked.contains(x)) x,
              ]);
            },
          ),
        FilterChip(
          key: ValueKey('entry$i/machineStatus/Remarks'),
          label: const Text('Remarks'),
          avatar: remarksTicked
              ? null
              : Icon(
                  Icons.edit_note_rounded,
                  size: 18,
                  color: EntryStyle.hint(context),
                ),
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
