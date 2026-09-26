
import 'package:flutter/material.dart';

/// Look shared by every box of the entry form, so typed fields, pickers and
/// the calculated (read-only) boxes line up at the same height in both themes.
/// Compact on purpose: a 40 px box, 12 px gaps, 14 px text.
class EntryStyle {
  EntryStyle._();

  static const double radius = 10;

  /// Gap between grid cells.
  static const double gap = 10;

  /// Gap between stacked grid rows.
  static const double rowGap = 10;

  /// Padding of a card of the form.
  static const double cardPadding = 12;

  /// 40 px at normal text size (14 px x 1.3 line + 2 x 11).
  static const EdgeInsets fieldPadding = EdgeInsets.symmetric(horizontal: 12, vertical: 11);

  /// Text inside a box. One size + line height for typed, picker and calc boxes
  /// so a row of them is a single height.
  static TextStyle text(BuildContext context, {Color? color}) => TextStyle(
        fontSize: 14,
        height: 1.3,
        color: color ?? Theme.of(context).colorScheme.onSurface,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  /// Small helper / error text under a box.
  static const double noteSize = 12;

  /// Fill of an editable box — the theme's input fill.
  static Color fill(BuildContext context) {
    final t = Theme.of(context);
    return t.inputDecorationTheme.fillColor ?? t.colorScheme.surface;
  }

  /// Fill of a calculated box: flat and muted so it never reads as editable —
  /// slate in light, a step darker than the card in dark.
  static Color calcFill(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return s.brightness == Brightness.dark ? s.surfaceContainerLowest : s.surfaceContainer;
  }

  static Color hint(BuildContext context) => Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.7);

  static OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(radius),
        borderSide: BorderSide(color: color, width: width),
      );

  /// The subtle red wash an invalid box gets on top of its fill.
  static Color invalidFill(BuildContext context) =>
      Color.alphaBlend(Theme.of(context).colorScheme.error.withValues(alpha: 0.06), fill(context));
}
