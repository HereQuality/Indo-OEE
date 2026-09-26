import 'package:flutter/material.dart';

/// Tapping anywhere that is not itself tappable puts the keyboard away. A
/// button, field or picker under the finger still gets the tap — the root
/// detector only wins when nothing below it does.
class TapToDismiss extends StatelessWidget {
  const TapToDismiss({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () {
          final f = FocusManager.instance.primaryFocus;
          if (f != null && f.hasFocus) f.unfocus();
        },
        child: child,
      );
}
