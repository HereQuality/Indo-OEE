import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../shared/limit_notice.dart';

/// The one-button notice the web raises through AlertContext's `notice(...)`
/// (AlertContainer's NoticeDialog): the reason, the figures behind it (the
/// highlighted one in red), a hint on what to check, and OK.
///
/// Ports do not build it themselves — they call [EntryNotices.show] with an
/// [EntryNotice] from `shared/limit_notice.dart` (`qtyNotice`, `stoppageNotice`,
/// `firstOverLimit`…), or just use `ctx.numBox(..., onExceedTyped:)` /
/// `ctx.minutesBox` / `ctx.notice(...)` inside a line.
class EntryNoticeDialog extends StatelessWidget {
  const EntryNoticeDialog({super.key, required this.notice});
  final EntryNotice notice;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final amber = AppColors.readable(context, AppColors.warn);
    return Dialog(
      key: const ValueKey('entry-notice'),
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.warn.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.warning_amber_rounded,
                    color: amber,
                    size: 26,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                notice.title,
                key: const ValueKey('entry-notice/title'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                notice.message,
                key: const ValueKey('entry-notice/message'),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.35,
                  color: s.onSurfaceVariant,
                ),
              ),
              if (notice.details.isNotEmpty) ...[
                const SizedBox(height: 14),
                Container(
                  key: const ValueKey('entry-notice/details'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: s.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: s.outlineVariant),
                  ),
                  child: Column(
                    children: [
                      for (final d in notice.details)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.baseline,
                            textBaseline: TextBaseline.alphabetic,
                            children: [
                              Expanded(
                                flex: 3,
                                child: Text(
                                  d.label,
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    color: s.onSurfaceVariant,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Flexible(
                                flex: 2,
                                child: Text(
                                  d.value,
                                  key: ValueKey(
                                    'entry-notice/value/${d.label}',
                                  ),
                                  textAlign: TextAlign.end,
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: FontWeight.w700,
                                    color: d.highlight ? s.error : s.onSurface,
                                    fontFeatures: const [
                                      FontFeature.tabularFigures(),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              if (notice.hint.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  notice.hint,
                  key: const ValueKey('entry-notice/hint'),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12.5,
                    height: 1.35,
                    color: s.onSurfaceVariant,
                  ),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('entry-notice/ok'),
                autofocus: true,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.warn,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 46),
                ),
                onPressed: () => Navigator.of(context).pop(),
                child: Text(notice.okText),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The small API ports call to raise a notice.
class EntryNotices {
  EntryNotices._();

  static String? _openSignature;
  static BuildContext? _openContext;
  static Object? _openToken;

  /// Whether a notice is on screen (tests, and the de-duplication below).
  static bool get isOpen =>
      _openSignature != null && (_openContext?.mounted ?? false);

  /// Shows [notice] and completes when it is closed. The same notice raised
  /// again while it is open — one per blocked keystroke — is ignored (the web
  /// keeps a single dialog); a different one waits for nothing and is dropped
  /// too, so dialogs never stack. Safe to call from an input formatter: the
  /// dialog opens once the current edit is done.
  static Future<void> show(BuildContext context, EntryNotice notice) {
    // A notice whose host screen is gone (a route popped under it) is no longer open.
    if (isOpen) return Future<void>.value();
    _openSignature = notice.signature;
    _openContext = context;
    final token = _openToken = Object();
    final done = Completer<void>();
    scheduleMicrotask(() async {
      try {
        if (context.mounted) {
          await showDialog<void>(
            context: context,
            useRootNavigator: true,
            builder: (_) => EntryNoticeDialog(notice: notice),
          );
        }
      } catch (_) {
        // A notice failing must never break typing or Save.
      } finally {
        // Only the notice that is current clears the state (a stale one finishing late must not).
        if (identical(_openToken, token)) {
          _openToken = null;
          _openSignature = null;
          _openContext = null;
        }
        done.complete();
      }
    });
    return done.future;
  }

  /// Forgets an open notice (test isolation).
  static void reset() {
    _openSignature = null;
    _openContext = null;
    _openToken = null;
  }
}
