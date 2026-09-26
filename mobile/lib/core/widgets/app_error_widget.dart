import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// What replaces a widget that failed to build — a small, calm message in the
/// spot where it was, instead of Flutter's red (debug) / grey (release) box that
/// makes the whole screen look like the app crashed. Everything around it keeps
/// working. Debug builds also show the exception so it can be found.
class AppErrorWidget extends StatelessWidget {
  const AppErrorWidget(this.details, {super.key});
  final FlutterErrorDetails details;

  @override
  Widget build(BuildContext context) {
    final dark = MediaQuery.maybePlatformBrightnessOf(context) == Brightness.dark;
    final ink = dark ? const Color(0xFFCBD5E1) : const Color(0xFF475569);
    return Directionality(
      textDirection: TextDirection.ltr,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 44),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline_rounded, size: 20, color: ink),
                const SizedBox(height: 6),
                Text(
                  "This part couldn't be shown.",
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: ink, decoration: TextDecoration.none),
                ),
                if (kDebugMode) ...[
                  const SizedBox(height: 4),
                  Text(
                    details.exceptionAsString(),
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: ink, decoration: TextDecoration.none),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
