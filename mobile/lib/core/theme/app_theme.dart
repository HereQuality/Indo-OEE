import 'package:flutter/material.dart';

import 'app_colors.dart';

class AppTheme {
  AppTheme._();

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand600,
      brightness: Brightness.light,
    ).copyWith(
      primary: AppColors.brand600,
      onPrimary: Colors.white,
      secondary: AppColors.navy800,
      surface: Colors.white,
      onSurface: AppColors.slate900,
      onSurfaceVariant: AppColors.slate600,
      outline: AppColors.slate300,
      outlineVariant: AppColors.slate200,
      error: AppColors.critical,
      surfaceContainerLowest: Colors.white,
      surfaceContainerLow: AppColors.slate50,
      surfaceContainer: AppColors.slate100,
      surfaceContainerHigh: AppColors.slate100,
    );
    return _build(scheme, AppColors.slate50);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand500,
      brightness: Brightness.dark,
    ).copyWith(
      primary: AppColors.brand400,
      onPrimary: AppColors.navy950,
      secondary: AppColors.brand300,
      surface: AppColors.navy900,
      onSurface: const Color(0xFFE2E8F0),
      onSurfaceVariant: AppColors.slate400,
      outline: const Color(0xFF334155),
      outlineVariant: const Color(0xFF2B3B55), // was #243247: card borders/dividers vanished on navy800
      error: const Color(0xFFF87171),
      surfaceContainerLowest: AppColors.navy950,
      surfaceContainerLow: AppColors.navy900,
      surfaceContainer: AppColors.navy800,
      surfaceContainerHigh: const Color(0xFF1C2A40),
    );
    return _build(scheme, AppColors.navy950);
  }

  static ThemeData _build(ColorScheme s, Color background) {
    final isDark = s.brightness == Brightness.dark;
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(color: s.outline),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: s,
      scaffoldBackgroundColor: background,
      canvasColor: s.surface,
      dividerColor: s.outlineVariant,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? AppColors.navy900 : Colors.white,
        foregroundColor: s.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
        // White bar on slate50 (and navy900 on navy950) had no visible edge.
        shape: Border(bottom: BorderSide(color: s.outlineVariant)),
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: s.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        color: isDark ? AppColors.navy800 : Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: s.outlineVariant),
        ),
      ),
      drawerTheme: DrawerThemeData(
        backgroundColor: isDark ? AppColors.navy900 : Colors.white,
        surfaceTintColor: Colors.transparent,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: isDark ? AppColors.navy800 : Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? AppColors.navy800 : Colors.white,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        clipBehavior: Clip.antiAlias,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.navy900 : Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
          borderSide: BorderSide(color: s.primary, width: 1.6),
        ),
        errorBorder: border.copyWith(borderSide: BorderSide(color: s.error)),
        focusedErrorBorder: border.copyWith(
          borderSide: BorderSide(color: s.error, width: 1.6),
        ),
        disabledBorder: border.copyWith(
          borderSide: BorderSide(color: s.outlineVariant),
        ),
        labelStyle: TextStyle(color: s.onSurfaceVariant),
        hintStyle: TextStyle(color: s.onSurfaceVariant.withValues(alpha: 0.7)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          side: BorderSide(color: s.outline),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppColors.navy800 : AppColors.slate100,
        side: BorderSide(color: s.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: 16),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStatePropertyAll(
          isDark ? AppColors.navy800 : AppColors.slate100,
        ),
        dividerThickness: 1,
      ),
    );
  }
}
