import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../features/production/entry_form/entry_style.dart';

/// Port of the web's `Components/Common/TimePicker.jsx`.
///
/// A 24-hour text box (typed as HH:mm: 9, 930, 0930, 9:30, 9.30, 21:05) with a
/// clock button that opens an INLINE panel right under the box — two scrolling
/// columns, Hour 00–23 and Minute in fives (00, 05 … 55). No AM/PM anywhere.
/// The value in and out is always "HH:mm" (or "" when empty).
///
/// [minTime] ("HH:mm", inclusive) greys out and blocks anything earlier — the
/// OFF box passes the ON time (plus a minute, as the web forms do).

const double kTimeRowHeight = 38; // a comfortable tap target (the web's ROW)
final List<int> kTimeHours = [for (var i = 0; i < 24; i++) i];
final List<int> kTimeMinutes = [for (var i = 0; i < 12; i++) i * 5];

String _pad(int n) => n.toString().padLeft(2, '0');

/// Minutes since midnight of "HH:mm", or null when [t] is not that shape.
int? timeToMinutes(String? t) {
  if (t == null || !RegExp(r'^\d{2}:\d{2}$').hasMatch(t)) return null;
  return int.parse(t.substring(0, 2)) * 60 + int.parse(t.substring(3));
}

/// What a person types -> "HH:mm", "" for blank, or null when it is not a time
/// ("9", "930", "0930", "9:30", "9.30", "21:05"; hour > 23 or minute > 59 -> null).
String? parseTypedTime(String? raw) {
  final s = (raw ?? '').trim();
  if (s.isEmpty) return '';
  int h;
  int m;
  final colon = RegExp(r'^(\d{1,2})[:.](\d{1,2})$').firstMatch(s);
  if (colon != null) {
    h = int.parse(colon.group(1)!);
    m = int.parse(colon.group(2)!);
  } else if (RegExp(r'^\d{3,4}$').hasMatch(s)) {
    h = int.parse(s.substring(0, s.length - 2));
    m = int.parse(s.substring(s.length - 2));
  } else if (RegExp(r'^\d{1,2}$').hasMatch(s)) {
    h = int.parse(s);
    m = 0;
  } else {
    return null;
  }
  return h > 23 || m > 59 ? null : '${_pad(h)}:${_pad(m)}';
}

/// "HH:mm" that [WebTimeField] emits when [hour] is picked: the current minute
/// is kept; with no minute yet it is 00, or the smallest the [minTime] allows.
String pickTimeHour(int hour, {String? value, String? minTime}) {
  final cur = timeToMinutes(value);
  final min = timeToMinutes(minTime);
  final m = cur != null
      ? cur % 60
      : (min != null && hour * 60 < min ? min - hour * 60 : 0);
  return '${_pad(hour)}:${_pad(m)}';
}

/// "HH:mm" that is emitted when [minute] is picked (hour 00 while none is set).
String pickTimeMinute(int minute, {String? value}) {
  final cur = timeToMinutes(value);
  return '${_pad(cur == null ? 0 : cur ~/ 60)}:${_pad(minute)}';
}

class WebTimeField extends StatefulWidget {
  const WebTimeField({
    super.key,
    required this.value,
    required this.onChanged,
    this.minTime,
    this.invalid = false,
    this.focusNode,
    this.hint = 'hh:mm',
    this.semanticsLabel,
  });

  /// "HH:mm" or "".
  final String value;
  final ValueChanged<String> onChanged;

  /// "HH:mm", inclusive: nothing earlier can be picked or typed.
  final String? minTime;
  final bool invalid;
  final FocusNode? focusNode;
  final String hint;
  final String? semanticsLabel;

  @override
  State<WebTimeField> createState() => _WebTimeFieldState();
}

class _WebTimeFieldState extends State<WebTimeField> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.value,
  );
  FocusNode? _ownNode;
  late FocusNode _node;
  bool _open = false;
  bool _dirty = false; // typed, not yet committed
  final GlobalKey _panelKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _node = widget.focusNode ?? (_ownNode = FocusNode());
    _node.addListener(_onFocus);
  }

  @override
  void didUpdateWidget(WebTimeField old) {
    super.didUpdateWidget(old);
    if (widget.focusNode != old.focusNode) {
      _node.removeListener(_onFocus);
      _ownNode?.dispose();
      _ownNode = null;
      _node = widget.focusNode ?? (_ownNode = FocusNode());
      _node.addListener(_onFocus);
    }
    // A value the user did not type (a reset, a pick, a reload) shows at once;
    // text still being typed is never fought with.
    if (!_dirty && widget.value != _controller.text) _setText(widget.value);
  }

  @override
  void dispose() {
    _node.removeListener(_onFocus);
    _ownNode?.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _setText(String t) {
    _controller.value = TextEditingValue(
      text: t,
      selection: TextSelection.collapsed(offset: t.length),
    );
  }

  void _onFocus() {
    if (_node.hasFocus) {
      if (!_open && mounted) _show();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_node.hasFocus) return;
        _controller.selection = TextSelection(
          baseOffset: 0,
          extentOffset: _controller.text.length,
        );
      });
    } else {
      _commitTyped();
    }
  }

  void _commitTyped() {
    if (!_dirty) return;
    final parsed = parseTypedTime(_controller.text);
    _dirty = false;
    final min = timeToMinutes(widget.minTime);
    // Not a time, or earlier than allowed: keep what was there.
    final reject =
        parsed == null ||
        (parsed.isNotEmpty && min != null && timeToMinutes(parsed)! < min);
    if (reject) {
      _setText(widget.value);
    } else {
      _setText(parsed);
      if (parsed != widget.value) widget.onChanged(parsed);
    }
  }

  void _emit(String v) {
    _dirty = false;
    _setText(v);
    widget.onChanged(v);
  }

  /// Opens the panel and, once it is laid out, scrolls the page so all of it is
  /// on screen (it pushes the content below it down, like the web).
  void _show() {
    setState(() => _open = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _panelKey.currentContext;
      if (!mounted || !_open || ctx == null) return;
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 150),
        alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
      );
    });
  }

  void _close() {
    if (_open) setState(() => _open = false);
  }

  void _outside() {
    if (_node.hasFocus) _node.unfocus(); // commits through the focus listener
    _commitTyped();
    _close();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final bad = widget.invalid;
    return TapRegion(
      onTapOutside: (_) => _outside(),
      child: CallbackShortcuts(
        bindings: {const SingleActivator(LogicalKeyboardKey.escape): _close},
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              label: widget.semanticsLabel,
              child: TextField(
                controller: _controller,
                focusNode: _node,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                textInputAction: TextInputAction.done,
                autocorrect: false,
                enableSuggestions: false,
                style: EntryStyle.text(context),
                scrollPadding: const EdgeInsets.fromLTRB(16, 96, 16, 120),
                inputFormatters: [LengthLimitingTextInputFormatter(5)],
                // The panel is inside this widget's TapRegion; taps on it must not blur the box.
                onTapOutside: (_) {},
                onTap: () {
                  if (!_open) _show();
                },
                onChanged: (_) => _dirty = true,
                onSubmitted: (_) {
                  _commitTyped();
                  _close();
                },
                decoration: InputDecoration(
                  hintText: widget.hint,
                  isDense: true,
                  contentPadding: const EdgeInsets.only(
                    left: 12,
                    top: 11,
                    bottom: 11,
                  ),
                  fillColor: bad ? EntryStyle.invalidFill(context) : null,
                  enabledBorder: bad ? EntryStyle.border(s.error, 1.2) : null,
                  focusedBorder: bad ? EntryStyle.border(s.error, 1.8) : null,
                  suffixIconConstraints: const BoxConstraints(
                    minWidth: 40,
                    minHeight: 40,
                  ),
                  suffixIcon: IconButton(
                    key: const ValueKey('time-toggle'),
                    tooltip: 'Choose time',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(
                      minWidth: 40,
                      minHeight: 40,
                    ),
                    visualDensity: VisualDensity.compact,
                    isSelected: _open,
                    icon: Icon(
                      Icons.schedule,
                      size: 18,
                      color: s.onSurfaceVariant,
                    ),
                    selectedIcon: Icon(
                      Icons.schedule,
                      size: 18,
                      color: s.primary,
                    ),
                    onPressed: () => _open ? _close() : _show(),
                  ),
                ),
              ),
            ),
            if (_open)
              _TimePanel(
                key: _panelKey,
                value: widget.value,
                minTime: widget.minTime,
                onPick: _emit,
                onClear: () {
                  _emit('');
                  _close();
                },
                onDone: _close,
              ),
          ],
        ),
      ),
    );
  }
}

class _TimePanel extends StatelessWidget {
  const _TimePanel({
    super.key,
    required this.value,
    required this.minTime,
    required this.onPick,
    required this.onClear,
    required this.onDone,
  });

  final String value;
  final String? minTime;
  final ValueChanged<String> onPick;
  final VoidCallback onClear;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final cur = timeToMinutes(value);
    final hour = cur == null ? null : cur ~/ 60;
    final minute = cur == null ? null : cur % 60;
    final min = timeToMinutes(minTime);
    final scale = math.min(
      1.4,
      math.max(1.0, MediaQuery.textScalerOf(context).scale(1.0)),
    );
    return Container(
      key: const ValueKey('time-panel'),
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      constraints: const BoxConstraints(maxWidth: 300),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color ?? s.surface,
        borderRadius: BorderRadius.circular(EntryStyle.radius),
        border: Border.all(color: s.outlineVariant),
      ),
      child: MediaQuery.withClampedTextScaling(
        maxScaleFactor: scale,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _TimeColumn(
                    label: 'Hour',
                    keyName: 'hour',
                    items: kTimeHours,
                    selected: hour,
                    disabled: (h) => min != null && h * 60 + 59 < min,
                    onPick: (h) =>
                        onPick(pickTimeHour(h, value: value, minTime: minTime)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _TimeColumn(
                    label: 'Minute',
                    keyName: 'minute',
                    items: kTimeMinutes,
                    selected: minute,
                    disabled: (m) =>
                        min != null && hour != null && hour * 60 + m < min,
                    onPick: (m) => onPick(pickTimeMinute(m, value: value)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                TextButton(
                  key: const ValueKey('time-clear'),
                  style: TextButton.styleFrom(
                    foregroundColor: s.onSurfaceVariant,
                    minimumSize: const Size(44, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: onClear,
                  child: const Text('Clear'),
                ),
                FilledButton(
                  key: const ValueKey('time-done'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(44, 36),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: onDone,
                  child: const Text('Done'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TimeColumn extends StatefulWidget {
  const _TimeColumn({
    required this.label,
    required this.keyName,
    required this.items,
    required this.selected,
    required this.disabled,
    required this.onPick,
  });

  final String label;
  final String keyName;
  final List<int> items;
  final int? selected;
  final bool Function(int) disabled;
  final ValueChanged<int> onPick;

  @override
  State<_TimeColumn> createState() => _TimeColumnState();
}

class _TimeColumnState extends State<_TimeColumn> {
  late final ScrollController _scroll = ScrollController(
    initialScrollOffset: _target(),
  );

  /// The chosen value sits about the middle of the column, like the web.
  /// (The web scrolls by the VALUE, which overshoots the minute column; this
  /// scrolls by the row of the nearest item.)
  double _target() {
    final sel = widget.selected;
    var at = 0;
    if (sel != null) {
      at = widget.items.indexWhere((n) => n >= sel);
      if (at < 0) at = widget.items.length - 1;
    }
    return math.max(0, at * kTimeRowHeight - kTimeRowHeight * 1.5);
  }

  @override
  void didUpdateWidget(_TimeColumn old) {
    super.didUpdateWidget(old);
    if (old.selected != widget.selected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_scroll.hasClients) return;
        _scroll.jumpTo(
          _target().clamp(0, _scroll.position.maxScrollExtent).toDouble(),
        );
      });
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: Text(
            widget.label,
            textAlign: TextAlign.center,
            maxLines: 1,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: s.onSurfaceVariant,
            ),
          ),
        ),
        Container(
          height: kTimeRowHeight * 4,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: s.outlineVariant),
          ),
          child: Semantics(
            label: widget.label,
            child: ListView.builder(
              key: ValueKey('time-list-${widget.keyName}'),
              controller: _scroll,
              padding: EdgeInsets.zero,
              itemExtent: kTimeRowHeight,
              itemCount: widget.items.length,
              itemBuilder: (context, i) {
                final n = widget.items[i];
                final on = widget.selected == n;
                final off = widget.disabled(n);
                return Semantics(
                  button: true,
                  selected: on,
                  enabled: !off,
                  child: Material(
                    key: ValueKey('time-${widget.keyName}-${_pad(n)}'),
                    color: on ? s.primary : Colors.transparent,
                    child: InkWell(
                      canRequestFocus: false,
                      onTap: off ? null : () => widget.onPick(n),
                      child: Center(
                        child: Text(
                          _pad(n),
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: on ? FontWeight.w600 : FontWeight.w400,
                            fontFeatures: const [FontFeature.tabularFigures()],
                            color: (on ? s.onPrimary : s.onSurface).withValues(
                              alpha: off ? 0.35 : 1,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}
