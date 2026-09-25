import 'package:flutter/material.dart';

/// Design tokens shared with the web client's tailwind.config.js so both apps
/// look identical.
class AppColors {
  AppColors._();

  // navy
  static const navy800 = Color(0xFF162032);
  static const navy900 = Color(0xFF111C2E);
  static const navy950 = Color(0xFF0B1220);

  // brand
  static const brand300 = Color(0xFF93C5FD);
  static const brand400 = Color(0xFF60A5FA);
  static const brand500 = Color(0xFF3B82F6);
  static const brand600 = Color(0xFF2563EB);
  static const brand700 = Color(0xFF1D4ED8);

  // status
  static const ok = Color(0xFF16A34A); // in stock / good
  static const warn = Color(0xFFD97706); // low / warning
  static const critical = Color(0xFFDC2626); // critical / error

  // slate scale (light UI neutrals)
  static const slate50 = Color(0xFFF8FAFC);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate400 = Color(0xFF94A3B8);
  static const slate500 = Color(0xFF64748B);
  static const slate600 = Color(0xFF475569);
  static const slate700 = Color(0xFF334155);
  static const slate800 = Color(0xFF1E293B);
  static const slate900 = Color(0xFF0F172A);

  /// Text colour that stays readable on a tinted pill in both themes: the
  /// 600-level tones are fine on light, but on the dark surfaces they fall
  /// below 4.5:1, so they are lightened there.
  static Color readable(BuildContext context, Color tone) {
    if (Theme.of(context).brightness != Brightness.dark) return tone;
    return Color.lerp(tone, Colors.white, 0.35)!;
  }
}
