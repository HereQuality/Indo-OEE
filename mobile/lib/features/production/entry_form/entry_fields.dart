import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/utils/formatters.dart';
import 'entry_form_logic.dart';
import 'entry_style.dart';

/// A tap-to-pick box (machine, operator, part, date, time). It looks like the
/// theme's text boxes, shows a red border when [invalid], a focus ring when the
/// form steers focus to it (Save on an incomplete entry), and is muted when
/// disabled. Picking itself is [onTap]'s job.
class EntryPickerBox extends StatefulWidget {
  const EntryPickerBox({
    super.key,
    required this.text,
    required this.hint,
    required this.onTap,
    this.icon = Icons.keyboard_arrow_down_rounded,
    this.enabled = true,
    this.invalid = false,
    this.focusNode,
    this.maxLines = 1,
    this.semanticsLabel,
  });

  final String text;
  final String hint;
  final VoidCallback onTap;
  final IconData icon;
  final bool enabled;
  final bool invalid;
  final FocusNode? focusNode;
  final int maxLines;
  final String? semanticsLabel;

  @override
  State<EntryPickerBox> createState() => _EntryPickerBoxState();
}

class _EntryPickerBoxState extends State<EntryPickerBox> {
  FocusNode? _ownNode;
  late FocusNode _node;
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    _node = widget.focusNode ?? (_ownNode = FocusNode(skipTraversal: true));
    _node.addListener(_onFocus);
  }

  @override
  void didUpdateWidget(EntryPickerBox old) {
    super.didUpdateWidget(old);
    if (widget.focusNode != old.focusNode) {
      _node.removeListener(_onFocus);
      _ownNode?.dispose();
      _ownNode = null;
      _node = widget.focusNode ?? (_ownNode = FocusNode(skipTraversal: true));
      _node.addListener(_onFocus);
      _focused = _node.hasFocus;
    }
  }

  @override
  void dispose() {
    _node.removeListener(_onFocus);
    _ownNode?.dispose();
    super.dispose();
  }

  void _onFocus() {
    if (mounted && _focused != _node.hasFocus) setState(() => _focused = _node.hasFocus);
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final hasText = widget.text.isNotEmpty;
    final enabled = widget.enabled;
    final color = widget.invalid ? s.error : (_focused ? s.primary : s.outline);
    final width = widget.invalid ? 1.2 : (_focused ? 1.8 : 1.0);
    final fill = !enabled
        ? EntryStyle.calcFill(context)
        : widget.invalid
            ? EntryStyle.invalidFill(context)
            : EntryStyle.fill(context);
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticsLabel,
      value: hasText ? widget.text : widget.hint,
      excludeSemantics: true,
      onTap: enabled ? widget.onTap : null,
      child: Focus(
        focusNode: _node,
        child: Material(
          color: fill,
          shape: EntryStyle.border(enabled ? color : s.outlineVariant, width),
          child: InkWell(
            canRequestFocus: false,
            borderRadius: BorderRadius.circular(EntryStyle.radius),
            onTap: enabled
                ? () {
                    _node.unfocus();
                    widget.onTap();
                  }
                : null,
            child: Padding(
              padding: EntryStyle.fieldPadding,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      hasText ? widget.text : widget.hint,
                      maxLines: widget.maxLines,
                      overflow: TextOverflow.ellipsis,
                      style: hasText
                          ? EntryStyle.text(context, color: enabled ? null : s.onSurfaceVariant)
                          : EntryStyle.text(context, color: EntryStyle.hint(context)),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Icon(widget.icon, size: 18, color: s.onSurfaceVariant),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A calculated box: flat, muted and marked with a small ƒ so it is never
/// mistaken for something to type in. Empty (not calculable yet) reads "—".
class EntryCalcBox extends StatelessWidget {
  const EntryCalcBox({super.key, required this.value, this.semanticsLabel});

  final String value;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final empty = value.isEmpty;
    return Semantics(
      readOnly: true,
      label: semanticsLabel == null ? null : '$semanticsLabel, calculated',
      value: empty ? 'not available yet' : value,
      excludeSemantics: true,
      child: Container(
        padding: EntryStyle.fieldPadding,
        decoration: BoxDecoration(
          color: EntryStyle.calcFill(context),
          borderRadius: BorderRadius.circular(EntryStyle.radius),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                empty ? '—' : value,
                style: EntryStyle.text(context, color: empty ? EntryStyle.hint(context) : s.onSurface).copyWith(fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 8),
            Icon(Icons.functions_rounded, size: 15, color: s.onSurfaceVariant.withValues(alpha: 0.6)),
          ],
        ),
      ),
    );
  }
}

final DateFormat _dayFormat = DateFormat('EEE, dd MMM yyyy');

/// Date box: the value is "YYYY-MM-DD" and the native date picker opens on tap.
class EntryDateField extends StatelessWidget {
  const EntryDateField({
    super.key,
    required this.value,
    required this.onChanged,
    this.invalid = false,
    this.focusNode,
    this.semanticsLabel = 'Date',
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool invalid;
  final FocusNode? focusNode;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final day = parseIsoDay(value);
    return EntryPickerBox(
      text: day == null ? '' : _dayFormat.format(day),
      hint: 'Select date',
      icon: Icons.calendar_today_outlined,
      invalid: invalid,
      focusNode: focusNode,
      semanticsLabel: semanticsLabel,
      onTap: () async {
        final now = DateTime.now();
        final initial = day ?? DateTime(now.year, now.month, now.day);
        // The web's date box has no limits; a picker needs some, so keep them wide.
        final earliest = DateTime(2000);
        final first = earliest.isBefore(initial) ? earliest : initial;
        final latest = DateTime(now.year + 5, 12, 31);
        final last = latest.isAfter(initial) ? latest : initial;
        final picked = await showDatePicker(
          context: context,
          initialDate: initial,
          firstDate: first,
          lastDate: last,
          helpText: 'Date',
        );
        if (picked != null && context.mounted) onChanged(Fmt.ymd(picked));
      },
    );
  }
}

/// Time box: the value is "HH:mm", shown as "hh:mm AM/PM". Tapping it opens a
/// clock dial (the web's clock picker) that picks in fives.
class EntryTimeField extends StatelessWidget {
  const EntryTimeField({
    super.key,
    required this.value,
    required this.title,
    required this.onChanged,
    this.dialStart,
    this.invalid = false,
    this.focusNode,
  });

  final String value;
  final String title;

  /// "HH:mm" the dial starts on while the box is still empty (else it starts on now).
  final String? dialStart;
  final ValueChanged<String> onChanged;
  final bool invalid;
  final FocusNode? focusNode;

  @override
  Widget build(BuildContext context) {
    final t = entryTime(value);
    return EntryPickerBox(
      text: t == null ? entryText(value) : Fmt.hm12(t, empty: ''),
      hint: 'Select time',
      icon: Icons.schedule,
      invalid: invalid,
      focusNode: focusNode,
      semanticsLabel: title,
      onTap: () async {
        final picked = await showEntryTimePicker(context, title: title, initial: t, dialStart: dialStart);
        if (picked != null && context.mounted) onChanged(picked);
      },
    );
  }
}

/// "HH:mm" of [t] moved to the nearest five minutes (58 rolls over to the next
/// hour), the step the web's clock picker works in.
String snapToFiveMinutes(TimeOfDay t) {
  final total = (t.hour * 60 + (t.minute / 5).round() * 5) % 1440;
  return '${(total ~/ 60).toString().padLeft(2, '0')}:${(total % 60).toString().padLeft(2, '0')}';
}

/// Opens the clock dial and resolves to "HH:mm" (five-minute steps, 12-hour
/// AM/PM dial in every locale), or null when dismissed. A stored time that is not
/// on a five-minute mark (an older record) is kept if the dial was not moved.
Future<String?> showEntryTimePicker(BuildContext context, {required String title, String? initial, String? dialStart}) async {
  final stored = entryTime(initial);
  final suggested = entryTime(dialStart);
  TimeOfDay start;
  if (stored != null) {
    start = TimeOfDay(hour: int.parse(stored.substring(0, 2)), minute: int.parse(stored.substring(3, 5)));
  } else if (suggested != null) {
    start = TimeOfDay(hour: int.parse(suggested.substring(0, 2)), minute: int.parse(suggested.substring(3, 5)));
  } else {
    final now = DateTime.now();
    start = TimeOfDay(hour: now.hour, minute: now.minute - now.minute % 5);
  }
  final picked = await showTimePicker(
    context: context,
    initialTime: start,
    initialEntryMode: TimePickerEntryMode.dialOnly,
    helpText: title.toUpperCase(),
    builder: (ctx, child) {
      final theme = Theme.of(ctx);
      final s = theme.colorScheme;
      return Theme(
        data: theme.copyWith(
          timePickerTheme: theme.timePickerTheme.copyWith(
            dialHandColor: s.primary,
            hourMinuteShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            dayPeriodShape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            helpTextStyle: theme.textTheme.labelMedium?.copyWith(letterSpacing: 0.4, color: s.onSurfaceVariant),
          ),
        ),
        child: MediaQuery(
          data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: false),
          child: child ?? const SizedBox.shrink(),
        ),
      );
    },
  );
  if (picked == null) return null;
  if (stored != null && picked.hour == start.hour && picked.minute == start.minute) return stored;
  return snapToFiveMinutes(picked);
}

/// Convenience for the layout code: text scale of [context].
double entryTextScale(BuildContext context) => math.max(1.0, MediaQuery.textScalerOf(context).scale(1.0));
