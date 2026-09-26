import 'dart:async';

import '../../../core/utils/alerts.dart';

/// The form's "you can't type more than that" toasts. The same message asked
/// for again while it is still on screen — one per blocked keystroke — keeps a
/// single toast instead of restarting it every time (the web's AlertContext
/// does the same by keying live toasts on type + message).
class EntryFormToast {
  EntryFormToast._();

  /// Where warnings go. Tests swap it to record them.
  static void Function(String message) sink = Alerts.warning;

  /// "Now" for the de-duplication window. Tests swap it.
  static DateTime Function() clock = DateTime.now;

  /// A little shorter than Alerts.warning's 3 s, so a keystroke right after the
  /// toast faded re-shows it.
  static const Duration window = Duration(milliseconds: 2500);

  static String? _last;
  static DateTime? _at;

  static void warn(String message) {
    final now = clock();
    final at = _at;
    if (_last == message && at != null && now.difference(at) < window) return;
    _last = message;
    _at = now;
    // Asked for from inside the text box's input formatter: show it once that
    // edit is done, and never let a toast failure break typing.
    scheduleMicrotask(() {
      try {
        sink(message);
      } catch (_) {}
    });
  }

  /// Forgets the last toast (test isolation).
  static void reset() {
    _last = null;
    _at = null;
    sink = Alerts.warning;
    clock = DateTime.now;
  }
}
