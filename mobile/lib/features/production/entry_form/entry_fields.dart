import 'dart:math' as math;

import 'package:flutter/cupertino.dart' show CupertinoPicker, CupertinoPickerDefaultSelectionOverlay;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/app_colors.dart';
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
                  const SizedBox(width: 8),
                  Icon(widget.icon, size: 20, color: s.onSurfaceVariant),
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
            Icon(Icons.functions_rounded, size: 16, color: s.onSurfaceVariant.withValues(alpha: 0.6)),
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
        final first = DateTime(2020).isBefore(initial) ? DateTime(2020) : initial;
        final endOfNext = DateTime(now.year + 1, 12, 31);
        final last = endOfNext.isAfter(initial) ? endOfNext : initial;
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

/// Time box: the value is "HH:mm" and a five-minute wheel opens on tap (the
/// web's clock picker steps in fives too).
class EntryTimeField extends StatelessWidget {
  const EntryTimeField({
    super.key,
    required this.value,
    required this.title,
    required this.onChanged,
    this.invalid = false,
    this.focusNode,
  });

  final String value;
  final String title;
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
        final picked = await showEntryTimePicker(context, title: title, initial: t);
        if (picked != null && context.mounted) onChanged(picked);
      },
    );
  }
}

/// Resolves to "HH:mm", '' when the user cleared it, null when dismissed.
Future<String?> showEntryTimePicker(BuildContext context, {required String title, String? initial}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => EntryTimeSheet(title: title, initial: initial),
  );
}

/// Hour / minute (fives) / AM-PM wheels. A stored minute that is not a
/// multiple of five (an older record) is kept unless the minute wheel moves.
class EntryTimeSheet extends StatefulWidget {
  const EntryTimeSheet({super.key, required this.title, this.initial});

  final String title;
  final String? initial;

  @override
  State<EntryTimeSheet> createState() => _EntryTimeSheetState();
}

class _EntryTimeSheetState extends State<EntryTimeSheet> {
  late int _h12; // 1..12
  late bool _pm;
  late int _minute;
  late final FixedExtentScrollController _hourC;
  late final FixedExtentScrollController _minuteC;
  late final FixedExtentScrollController _ampmC;

  @override
  void initState() {
    super.initState();
    final t = entryTime(widget.initial);
    int h24;
    if (t != null) {
      h24 = int.parse(t.substring(0, 2));
      _minute = int.parse(t.substring(3, 5));
    } else {
      final now = DateTime.now();
      h24 = now.hour;
      _minute = now.minute - now.minute % 5;
    }
    _pm = h24 >= 12;
    _h12 = h24 % 12 == 0 ? 12 : h24 % 12;
    _hourC = FixedExtentScrollController(initialItem: _h12 - 1);
    _minuteC = FixedExtentScrollController(initialItem: (_minute / 5).round() % 12);
    _ampmC = FixedExtentScrollController(initialItem: _pm ? 1 : 0);
  }

  @override
  void dispose() {
    _hourC.dispose();
    _minuteC.dispose();
    _ampmC.dispose();
    super.dispose();
  }

  String get _label => '${_h12.toString().padLeft(2, '0')}:${_minute.toString().padLeft(2, '0')} ${_pm ? 'PM' : 'AM'}';

  String get _value {
    final h24 = (_h12 % 12) + (_pm ? 12 : 0);
    return '${h24.toString().padLeft(2, '0')}:${_minute.toString().padLeft(2, '0')}';
  }

  Widget _wheel(Key key, FixedExtentScrollController c, List<String> labels, ValueChanged<int> onChanged, {bool looping = true}) {
    final s = Theme.of(context).colorScheme;
    return CupertinoPicker(
      key: key,
      scrollController: c,
      itemExtent: 44,
      looping: looping,
      selectionOverlay: CupertinoPickerDefaultSelectionOverlay(background: s.primary.withValues(alpha: 0.12)),
      onSelectedItemChanged: (i) {
        HapticFeedback.selectionClick();
        onChanged(i % labels.length);
      },
      children: [
        for (final l in labels)
          Center(
            child: Text(
              l,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600, color: s.onSurface, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final hasValue = entryTime(widget.initial) != null;
    return SingleChildScrollView(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(
              _label,
              key: const Key('time-preview'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w700,
                color: AppColors.readable(context, s.primary),
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 176,
              child: Row(
                children: [
                  Expanded(
                    child: _wheel(
                      const Key('time-hour'),
                      _hourC,
                      [for (var h = 1; h <= 12; h++) h.toString().padLeft(2, '0')],
                      (i) => setState(() => _h12 = i + 1),
                    ),
                  ),
                  Text(':', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: s.onSurfaceVariant)),
                  Expanded(
                    child: _wheel(
                      const Key('time-minute'),
                      _minuteC,
                      [for (var m = 0; m < 60; m += 5) m.toString().padLeft(2, '0')],
                      (i) => setState(() => _minute = i * 5),
                    ),
                  ),
                  Expanded(
                    child: _wheel(
                      const Key('time-ampm'),
                      _ampmC,
                      const ['AM', 'PM'],
                      (i) => setState(() => _pm = i == 1),
                      looping: false,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                if (hasValue) ...[
                  OutlinedButton(onPressed: () => Navigator.pop(context, ''), child: const Text('Clear')),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context, _value),
                    child: const Text('Set time'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Convenience for the layout code: text scale of [context].
double entryTextScale(BuildContext context) => math.max(1.0, MediaQuery.textScalerOf(context).scale(1.0));
