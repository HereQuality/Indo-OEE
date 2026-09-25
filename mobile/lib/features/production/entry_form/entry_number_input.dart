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
class EntryNumberFormatter extends TextInputFormatter {
  const EntryNumberFormatter({this.decimals = true, this.max, this.onExceedMax});

  final bool decimals;
  final double? max;
  final void Function(double max)? onExceedMax;

  static final RegExp _withDecimals = RegExp(r'^\d*\.?\d*$');
  static final RegExp _integers = RegExp(r'^\d*$');

  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final next = newValue.text;
    if (next.isNotEmpty && !(decimals ? _withDecimals : _integers).hasMatch(next)) return oldValue;

    final ceiling = max;
    if (ceiling != null && ceiling.isFinite && next.isNotEmpty) {
      final n = jsNumber(next);
      final old = oldValue.text.isEmpty ? null : jsNumber(oldValue.text);
      final falling = n != null && old != null && n < old;
      if (n != null && n > ceiling && !falling) {
        onExceedMax?.call(ceiling);
        return oldValue;
      }
    }
    return newValue;
  }
}

/// A text box of the entry form. Numeric ones are NumberInput: number keypad,
/// select-all on focus, 7 characters at most, digits only, capped by [max].
/// Multi-line ones are the remark boxes. The box owns its controller and keeps
/// it in step with [value], so the parent stays the single source of truth.
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

  @override
  State<EntryTextField> createState() => _EntryTextFieldState();
}

class _EntryTextFieldState extends State<EntryTextField> {
  late final TextEditingController _controller = TextEditingController(text: widget.value);
  FocusNode? _ownNode;
  late FocusNode _node;

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
    // part) — show it. A value the user just typed already equals the text.
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
    if (!widget.numeric || !_node.hasFocus) return;
    // After the tap has placed its caret: select the whole figure so typing
    // replaces it, like tabbing into a spreadsheet cell.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_node.hasFocus) return;
      _controller.selection = TextSelection(baseOffset: 0, extentOffset: _controller.text.length);
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final bad = widget.invalid;
    return Semantics(
      label: widget.semanticsLabel,
      child: TextField(
        controller: _controller,
        focusNode: _node,
        keyboardType: widget.numeric
            ? TextInputType.numberWithOptions(decimal: widget.decimals)
            : TextInputType.multiline,
        textInputAction: widget.numeric ? TextInputAction.next : TextInputAction.newline,
        textCapitalization: widget.numeric ? TextCapitalization.none : TextCapitalization.sentences,
        autocorrect: !widget.numeric,
        enableSuggestions: !widget.numeric,
        minLines: widget.minLines,
        maxLines: widget.maxLines,
        style: EntryStyle.text(context),
        // Room above the keyboard (and a sticky save bar) when the field scrolls into view.
        scrollPadding: const EdgeInsets.fromLTRB(20, 80, 20, 160),
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
          fillColor: bad ? EntryStyle.invalidFill(context) : null,
          enabledBorder: bad ? EntryStyle.border(s.error, 1.2) : null,
          focusedBorder: bad ? EntryStyle.border(s.error, 1.8) : null,
        ),
      ),
    );
  }
}
