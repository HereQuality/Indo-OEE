import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// iOS's number and phone keypads have no return key, so once a numeric box is
/// focused there is no way to put the keyboard away. This adds the missing
/// "Done" strip above the keypad — for every screen, and only when the focused
/// field really is a number / phone field on iOS (Android keypads have their
/// own action button, and text keyboards have Return).
class KeyboardDoneBar extends StatefulWidget {
  const KeyboardDoneBar({super.key, required this.child});
  final Widget child;

  @override
  State<KeyboardDoneBar> createState() => _KeyboardDoneBarState();
}

class _KeyboardDoneBarState extends State<KeyboardDoneBar> {
  @override
  void initState() {
    super.initState();
    FocusManager.instance.addListener(_onFocus);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_onFocus);
    super.dispose();
  }

  void _onFocus() {
    if (mounted) setState(() {});
  }

  /// The keyboard type of the field that has focus, if it is a text field.
  TextInputType? _focusedKeyboard() {
    final ctx = FocusManager.instance.primaryFocus?.context;
    if (ctx == null) return null;
    EditableText? editable;
    if (ctx.widget is EditableText) {
      editable = ctx.widget as EditableText;
    } else {
      ctx.visitAncestorElements((e) {
        if (e.widget is EditableText) {
          editable = e.widget as EditableText;
          return false;
        }
        return true;
      });
    }
    return editable?.keyboardType;
  }

  static bool _isKeypad(TextInputType? t) =>
      t != null && (t.index == TextInputType.number.index || t.index == TextInputType.phone.index);

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    final ios = Theme.of(context).platform == TargetPlatform.iOS;
    final show = ios && inset > 0 && _isKeypad(_focusedKeyboard());
    final s = Theme.of(context).colorScheme;
    return Stack(
      children: [
        widget.child,
        if (show)
          Positioned(
            left: 0,
            right: 0,
            bottom: inset,
            child: Material(
              color: s.surfaceContainerHigh,
              elevation: 0,
              child: DecoratedBox(
                decoration: BoxDecoration(border: Border(top: BorderSide(color: s.outlineVariant))),
                child: SizedBox(
                  height: 40,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: () {
                          HapticFeedback.selectionClick();
                          FocusManager.instance.primaryFocus?.unfocus();
                        },
                        child: const Text('Done'),
                      ),
                      const SizedBox(width: 8),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
