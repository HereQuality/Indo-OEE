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
      // Boundary of a field / picker / toggle: 3.5:1 on white (was slate300, 1.5:1 —
      // boxes vanished into the page). Dividers and card edges use outlineVariant.
      outline: const Color(0xFF7C8BA1),
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
      outline: const Color(0xFF5B6B85), // 3.2:1 on navy900 (was #334155, 1.7:1)
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
    // Menus, pickers and dialogs share one surface so nothing picks up Material's tint.
    final overlay = isDark ? AppColors.navy800 : Colors.white;
    final hint = isDark ? AppColors.slate400 : AppColors.slate500; // 4.8:1 on white (was ~3.6:1)
    final selectedTint = s.primary.withValues(alpha: isDark ? 0.22 : 0.12);
    final overlayShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: BorderSide(color: s.outlineVariant),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: s,
      scaffoldBackgroundColor: background,
      canvasColor: s.surface,
      dividerColor: s.outlineVariant,
      visualDensity: const VisualDensity(horizontal: -1, vertical: -1),
      textTheme: _compactText(),
      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? AppColors.navy900 : Colors.white,
        foregroundColor: s.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
        // White bar on slate50 (and navy900 on navy950) had no visible edge.
        shape: Border(bottom: BorderSide(color: s.outlineVariant)),
        centerTitle: false,
        toolbarHeight: 52,
        titleSpacing: 16,
        titleTextStyle: TextStyle(
          color: s.onSurface,
          fontSize: 17,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        ),
      ),
      // Slim bottom bar: 56 px, small label, no tall pill.
      navigationBarTheme: NavigationBarThemeData(
        height: 56,
        elevation: 0,
        backgroundColor: isDark ? AppColors.navy900 : Colors.white,
        surfaceTintColor: Colors.transparent,
        indicatorColor: s.primary.withValues(alpha: isDark ? 0.22 : 0.12),
        indicatorShape: const StadiumBorder(),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelPadding: const EdgeInsets.only(top: 1),
        iconTheme: WidgetStateProperty.resolveWith(
          (st) => IconThemeData(size: 22, color: st.contains(WidgetState.selected) ? s.primary : s.onSurfaceVariant),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (st) => TextStyle(
            fontSize: 11,
            letterSpacing: 0,
            fontWeight: st.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
            color: st.contains(WidgetState.selected) ? s.primary : s.onSurfaceVariant,
          ),
        ),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        extendedPadding: const EdgeInsets.symmetric(horizontal: 16),
        extendedIconLabelSpacing: 6,
        extendedSizeConstraints: const BoxConstraints.tightFor(height: 44),
        sizeConstraints: const BoxConstraints.tightFor(width: 48, height: 48),
        iconSize: 20,
        extendedTextStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: 0),
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      cardTheme: CardThemeData(
        color: isDark ? AppColors.navy800 : Colors.white,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
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
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.navy900 : Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
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
        isDense: true,
        labelStyle: TextStyle(color: s.onSurfaceVariant, fontSize: 13),
        hintStyle: TextStyle(color: hint, fontSize: 13.5),
        helperStyle: TextStyle(color: s.onSurfaceVariant, fontSize: 12),
        errorStyle: TextStyle(color: s.error, fontSize: 12, fontWeight: FontWeight.w500),
        errorMaxLines: 3,
        helperMaxLines: 3,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 44),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, letterSpacing: 0),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(64, 44),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 44),
          side: BorderSide(color: s.outline),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, letterSpacing: 0),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(11)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size(44, 40),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5, letterSpacing: 0),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppColors.navy800 : AppColors.slate100,
        side: BorderSide(color: s.outlineVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        labelStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, letterSpacing: 0, color: s.onSurface),
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
      // Every style here MUST carry a colour: ListTile replaces (does not merge
      // with) the ambient text style, and a colourless TextStyle paints white —
      // invisible on the light surfaces (dropdown options, drawer, settings rows).
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14),
        minVerticalPadding: 6,
        horizontalTitleGap: 12,
        iconColor: s.onSurfaceVariant,
        selectedColor: s.primary,
        selectedTileColor: selectedTint,
        titleTextStyle: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, letterSpacing: 0, color: s.onSurface),
        subtitleTextStyle: TextStyle(fontSize: 12.5, letterSpacing: 0, color: s.onSurfaceVariant),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: overlay,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        shape: overlayShape,
        iconColor: s.onSurfaceVariant,
        textStyle: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, letterSpacing: 0, color: s.onSurface),
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 14, fontWeight: FontWeight.w500, letterSpacing: 0, color: s.onSurface),
        ),
      ),
      menuTheme: MenuThemeData(
        style: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(overlay),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(overlayShape),
        ),
      ),
      dropdownMenuTheme: DropdownMenuThemeData(
        textStyle: TextStyle(fontSize: 14, letterSpacing: 0, color: s.onSurface),
        menuStyle: MenuStyle(
          backgroundColor: WidgetStatePropertyAll(overlay),
          surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
          shape: WidgetStatePropertyAll(overlayShape),
        ),
      ),
      datePickerTheme: DatePickerThemeData(
        backgroundColor: overlay,
        surfaceTintColor: Colors.transparent,
        headerBackgroundColor: overlay,
        headerForegroundColor: s.onSurface,
        headerHelpStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: s.onSurfaceVariant),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        dividerColor: s.outlineVariant,
        todayBorder: BorderSide(color: s.primary),
      ),
      // Material's seed-derived defaults paint the hour box lavender and AM pink;
      // keep it to the brand blue and neutral greys.
      timePickerTheme: TimePickerThemeData(
        backgroundColor: overlay,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        hourMinuteColor: WidgetStateColor.resolveWith(
          (st) => st.contains(WidgetState.selected) ? selectedTint : s.surfaceContainer,
        ),
        hourMinuteTextColor: WidgetStateColor.resolveWith(
          (st) => st.contains(WidgetState.selected) ? s.primary : s.onSurface,
        ),
        dayPeriodColor: WidgetStateColor.resolveWith(
          (st) => st.contains(WidgetState.selected) ? selectedTint : Colors.transparent,
        ),
        dayPeriodTextColor: WidgetStateColor.resolveWith(
          (st) => st.contains(WidgetState.selected) ? s.primary : s.onSurfaceVariant,
        ),
        dayPeriodBorderSide: BorderSide(color: s.outline),
        dialBackgroundColor: s.surfaceContainer,
        dialHandColor: s.primary,
        dialTextColor: WidgetStateColor.resolveWith(
          (st) => st.contains(WidgetState.selected) ? s.onPrimary : s.onSurface,
        ),
        entryModeIconColor: s.onSurfaceVariant,
        helpTextStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: s.onSurfaceVariant),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          visualDensity: VisualDensity.compact,
          textStyle: const WidgetStatePropertyAll(TextStyle(fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: 0)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        contentTextStyle: TextStyle(fontSize: 13.5, letterSpacing: 0, color: s.onInverseSurface),
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

  /// One notch below Material's default scale, with the default's wide letter
  /// spacing removed — the main reason the UI read as bulky.
  static TextTheme _compactText() => const TextTheme(
        displayLarge: TextStyle(fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: -0.5),
        displayMedium: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.4),
        displaySmall: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.3),
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.2),
        headlineMedium: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, letterSpacing: -0.1),
        headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: 0),
        titleLarge: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, letterSpacing: 0),
        titleMedium: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, letterSpacing: 0),
        titleSmall: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: 0),
        bodyLarge: TextStyle(fontSize: 14, letterSpacing: 0),
        bodyMedium: TextStyle(fontSize: 13.5, letterSpacing: 0),
        bodySmall: TextStyle(fontSize: 12, letterSpacing: 0),
        labelLarge: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: 0),
        labelMedium: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0),
        labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.2),
      );
}
