import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Root keys so toasts / dialogs work from anywhere, including code that has
/// no BuildContext (providers, API callbacks).
final GlobalKey<ScaffoldMessengerState> rootMessengerKey = GlobalKey<ScaffoldMessengerState>();
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Toasts + confirm dialog (mirrors client/src/context/AlertContext.jsx).
class Alerts {
  Alerts._();

  static void success(String message) => _show(message, AppColors.ok, Icons.check_circle_outline);
  static void error(String message) => _show(message, AppColors.critical, Icons.error_outline, seconds: 5);
  // Warnings are a light amber card with dark brown text (about 9:1), not white on
  // orange (about 3:1), so the reason a keystroke was refused can actually be read.
  static void warning(String message) => _show(
        message,
        const Color(0xFFFEF3C7),
        Icons.warning_amber_rounded,
        seconds: 5,
        foreground: const Color(0xFF78350F),
        iconColor: const Color(0xFFB45309),
      );
  static void info(String message) => _show(message, AppColors.brand600, Icons.info_outline);

  static void _show(String message, Color color, IconData icon, {int seconds = 3, Color foreground = Colors.white, Color? iconColor}) {
    final messenger = rootMessengerKey.currentState;
    if (messenger == null || message.trim().isEmpty) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: color,
          duration: Duration(seconds: seconds),
          content: Row(
            children: [
              Icon(icon, color: iconColor ?? foreground, size: 22),
              const SizedBox(width: 10),
              Expanded(child: Text(message, style: TextStyle(color: foreground, fontSize: 14, height: 1.3, fontWeight: foreground == Colors.white ? FontWeight.w400 : FontWeight.w600))),
            ],
          ),
        ),
      );
  }

  /// Resolves true when the user confirms, false when they cancel / dismiss.
  static Future<bool> confirm(
    BuildContext context,
    String message, {
    String title = 'Are you sure?',
    String confirmText = 'Yes, continue',
    String cancelText = 'Cancel',
    bool danger = true,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(cancelText)),
          FilledButton(
            style: danger ? FilledButton.styleFrom(backgroundColor: AppColors.critical) : null,
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmText),
          ),
        ],
      ),
    );
    return result ?? false;
  }
}
