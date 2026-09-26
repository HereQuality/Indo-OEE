import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../shared/production_sheet_calc.dart' show jsNumber;
import 'entry_style.dart';

/// Port of client/src/Components/Production/NumberInput.jsx as an input
/// formatter: only digits (and one decimal point where [decimals]) get in, and
/// an optional [max] stops a value RISING past it — [onExceedMax] fires once per
/// blocked keystroke so the caller can say why nothing happened — but never
/// blocks shortening a value that is already over (lowering OK Quantity after
/// the reject boxes were filled leaves them above their new ceiling; backspacing
/// one has to stay possible, and every step down is still over until the last).
///
/// Anything that is not a digit is dropped rather than refusing the whole edit,
/// so pasting "12abc" leaves 12 and a decimal keypad that types "," (some
/// locales) still makes a decimal point. The returned value always carries a
/// selection inside its text, so a blocked or cleaned edit can never trip the
/// text input's range assertions.
class EntryNumberFormatter extends TextInputFormatter {
  const EntryNumberFormatter({this.decimals = true, this.max, this.onExceedMax});

  final bool decimals;
  final double? max;
  final void Function(double max)? onExceedMax;

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = newValue.text;
    final kept = StringBuffer();
    // before[i] = how many characters of text[0, i) survived the clean-up.
    final before = List<int>.filled(text.length + 1, 0);
    var seenDot = false;
    var keptCount = 0;
    for (var i = 0; i < text.length; i++) {
      before[i] = keptCount;
      final c = text[i];
      final code = c.codeUnitAt(0);
      final isDigit = code >= 0x30 && code <= 0x39;
      final isDot = decimals && (c == '.' || c == ',') && !seenDot;
      if (isDigit || isDot) {
        if (isDot) seenDot = true;
        kept.write(isDot ? '.' : c);
        keptCount++;
      }
    }
    before[text.length] = keptCount;
    final cleaned = kept.toString();

    // Nothing usable was typed (a letter, a lone symbol): the keystroke does nothing.
    if (text.isNotEmpty && cleaned.isEmpty) return _safe(oldValue);

    final ceiling = max;
    if (ceiling != null && ceiling.isFinite && cleaned.isNotEmpty) {
      final n = jsNumber(cleaned);
      final old = oldValue.text.isEmpty ? null : jsNumber(oldValue.text);
      final falling = n != null && old != null && n < old;
      if (n != null && n > ceiling && !falling) {
        onExceedMax?.call(ceiling);
        return _safe(oldValue);
      }
    }

    if (cleaned == text) return _safe(newValue);

    int at(int offset) => before[offset.clamp(0, text.length)];
    final sel = newValue.selection;
    return TextEditingValue(
      text: cleaned,
      selection: sel.isValid
          ? TextSelection(baseOffset: at(sel.baseOffset), extentOffset: at(sel.extentOffset))
          : TextSelection.collapsed(offset: cleaned.length),
    );
  }

  /// [v] with a selection inside its text and no composing range.
  static TextEditingValue _safe(TextEditingValue v) {
    final len = v.text.length;
    final s = v.selection;
    final ok = s.isValid && s.baseOffset <= len && s.extentOffset <= len;
    return TextEditingValue(
      text: v.text,
      selection: ok ? s : TextSelection.collapsed(offset: len),
    );
  }
}

/// A text box of the entry form. Numeric ones are NumberInput: number keypad
/// (decimal point only where [decimals]), select-all on focus, 7 characters at
/// most, digits only, capped by [max]. Multi-line ones are the remark boxes.
/// The box owns its controller and keeps it in step with [value], so the parent
/// stays the single source of truth.
///
/// A numeric box whose ceiling is 0 and that holds nothing ("locked": Rejected is
/// 0, no stoppage time is left...) is drawn muted with a lock and takes focus
/// but no keyboard — the parent says why underneath it (see [capLocks]).
class EntryTextField extends StatefulWidget {
  const EntryTextField({
    super.key,
    required this.value,
    required this.onChanged,
    this.numeric = false,
    this.decimals = true,
    this.maxLength = 7,
    this.max,
    this.onExceedMax,
    this.invalid = false,
    this.focusNode,
    this.hint,
    this.minLines = 1,
    this.maxLines = 1,
    this.semanticsLabel,
    this.textInputAction,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool numeric;
  final bool decimals;
  final int maxLength;
  final double? max;
  final void Function(double max)? onExceedMax;
  final bool invalid;
  final FocusNode? focusNode;
  final String? hint;
  final int minLines;
  final int maxLines;
  final String? semanticsLabel;

  /// Defaults to "next" for numbers (focus moves to the next box in form order)
  /// and a new line for the remark boxes.
  final TextInputAction? textInputAction;

  /// True when a numeric box with ceiling [max] and text [value] cannot take
  /// anything: the ceiling is 0 and the box holds nothing above 0.
  static bool capLocks(String value, double? max) {
    if (max == null || !max.isFinite || max > 0) return false;
    final n = jsNumber(value);
    return n == null || !n.isFinite || n <= 0;
  }

  @override
  State<EntryTextField> createState() => _EntryTextFieldState();
}

class _EntryTextFieldState extends State<EntryTextField> {
  late final TextEditingController _controller = TextEditingController(text: widget.value);
  FocusNode? _ownNode;
  late FocusNode _node;

  bool get _locked => widget.numeric && EntryTextField.capLocks(_controller.text, widget.max);

  @override
  void initState() {
    super.initState();
    _node = widget.focusNode ?? (_ownNode = FocusNode());
    _node.addListener(_onFocus);
  }

  @override
  void didUpdateWidget(EntryTextField old) {
    super.didUpdateWidget(old);
    if (widget.focusNode != old.focusNode) {
      _node.removeListener(_onFocus);
      _ownNode?.dispose();
      _ownNode = null;
      _node = widget.focusNode ?? (_ownNode = FocusNode());
      _node.addListener(_onFocus);
    }
    // The page can change a value the user did not type (a reset, a cleared
    // part) — show it. A value the user just typed already equals the text, so
    // typing is never fought with.
    if (widget.value != _controller.text) {
      _controller.value = TextEditingValue(
        text: widget.value,
        selection: TextSelection.collapsed(offset: widget.value.length),
      );
    }
  }

  @override
  void dispose() {
    _node.removeListener(_onFocus);
    _ownNode?.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _onFocus() {
    if (!widget.numeric || !_node.hasFocus || _locked) return;
    // After the tap has placed its caret: select the whole figure so typing
    // replaces it, like tabbing into a spreadsheet cell.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_node.hasFocus || _locked) return;
      final len = _controller.text.length;
      _controller.selection = TextSelection(baseOffset: 0, extentOffset: len);
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final bad = widget.invalid;
    final locked = _locked;
    return Semantics(
      label: widget.semanticsLabel,
      child: TextField(
        controller: _controller,
        focusNode: _node,
        readOnly: locked,
        showCursor: locked ? false : null,
        enableInteractiveSelection: !locked,
        keyboardType: widget.numeric
            ? TextInputType.numberWithOptions(decimal: widget.decimals)
            : TextInputType.multiline,
        textInputAction: widget.textInputAction ?? (widget.numeric ? TextInputAction.next : TextInputAction.newline),
        textCapitalization: widget.numeric ? TextCapitalization.none : TextCapitalization.sentences,
        autocorrect: !widget.numeric,
        enableSuggestions: !widget.numeric,
        minLines: widget.minLines,
        maxLines: widget.maxLines,
        style: EntryStyle.text(context, color: locked ? s.onSurfaceVariant : null),
        // Room above the keyboard when the field scrolls into view.
        scrollPadding: const EdgeInsets.fromLTRB(16, 96, 16, 120),
        inputFormatters: [
          LengthLimitingTextInputFormatter(widget.maxLength),
          if (widget.numeric)
            EntryNumberFormatter(decimals: widget.decimals, max: widget.max, onExceedMax: widget.onExceedMax),
        ],
        onChanged: widget.onChanged,
        decoration: InputDecoration(
          hintText: widget.hint,
          isDense: true,
          contentPadding: EntryStyle.fieldPadding,
          filled: locked ? true : null,
          fillColor: locked ? EntryStyle.calcFill(context) : (bad ? EntryStyle.invalidFill(context) : null),
          enabledBorder: bad ? EntryStyle.border(s.error, 1.2) : (locked ? EntryStyle.border(s.outlineVariant) : null),
          focusedBorder: bad ? EntryStyle.border(s.error, 1.8) : (locked ? EntryStyle.border(s.outline, 1.4) : null),
          suffixIcon: locked ? Icon(Icons.lock_outline_rounded, size: 16, color: s.onSurfaceVariant.withValues(alpha: 0.7)) : null,
          suffixIconConstraints: const BoxConstraints(minWidth: 32, minHeight: 16),
        ),
      ),
    );
  }
}
