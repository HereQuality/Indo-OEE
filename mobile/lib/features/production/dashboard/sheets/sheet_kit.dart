import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shared building blocks for the four dashboard bottom sheets (date range,
/// filters, drill-down, customize): presentation helpers, the handle / header /
/// sticky footer chrome, tab controls and a few small pieces. Colours always
/// come from the Theme so every sheet is correct in light and dark.

/// Widest a sheet grows on a tablet / landscape phone.
const double kSheetMaxWidth = 720;

/// Horizontal gutter inside every sheet.
const double kSheetGutter = 16;

/// Haptics that can never throw (no platform channel in tests, unsupported
/// devices) and are never awaited.
class SheetHaptics {
  SheetHaptics._();

  static void selection() => _run(HapticFeedback.selectionClick);
  static void light() => _run(HapticFeedback.lightImpact);
  static void medium() => _run(HapticFeedback.mediumImpact);

  static void _run(Future<void> Function() f) {
    try {
      f().catchError((Object _) {});
    } catch (_) {
      // Haptics are decoration only.
    }
  }
}

/// Palette every sheet draws with, derived from the active ColorScheme.
class SheetTone {
  SheetTone.of(BuildContext context)
      : scheme = Theme.of(context).colorScheme,
        dark = Theme.of(context).brightness == Brightness.dark;

  final ColorScheme scheme;
  final bool dark;

  Color get accent => scheme.primary;
  Color get onAccent => scheme.onPrimary;
  Color get ink => scheme.onSurface;
  Color get muted => scheme.onSurfaceVariant;
  Color get border => scheme.outlineVariant;

  /// Faint accent fill (range band, selected row).
  Color get wash => scheme.primary.withValues(alpha: dark ? 0.20 : 0.10);

  /// Recessed area: segmented-control track, bar track, thumbnail plate.
  Color get track => scheme.surfaceContainerHigh;

  /// Raised card sitting on the sheet.
  Color get card => dark ? scheme.surfaceContainerLow : scheme.surfaceContainerLowest;

  /// Text colour for `error` tinted surfaces.
  Color get errorText => dark ? scheme.error : const Color(0xFFB91C1C);
}

/// Opens a modal bottom sheet with the dashboard's standard settings: full
/// height allowed, below the status bar, no built-in drag handle (each sheet
/// draws its own), and capped at [kSheetMaxWidth] on wide screens.
Future<T?> showSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  bool isDismissible = true,
  bool enableDrag = true,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: false,
    isDismissible: isDismissible,
    enableDrag: enableDrag,
    constraints: const BoxConstraints(maxWidth: kSheetMaxWidth),
    builder: builder,
  );
}

/// A sheet that starts part-way up and can be dragged taller (or dismissed).
/// [builder] gets the scroll controller to attach to its main scrollable and
/// the sheet controller for [SheetGrabArea].
Future<T?> showDraggableSheet<T>(
  BuildContext context, {
  required Widget Function(BuildContext context, ScrollController scroll, DraggableScrollableController sheet) builder,
  double initialSize = 0.86,
  double minSize = 0.5,
  double maxSize = 0.96,
}) {
  return showSheet<T>(
    context,
    builder: (ctx) => _DraggableHost(builder: builder, initialSize: initialSize, minSize: minSize, maxSize: maxSize),
  );
}

class _DraggableHost extends StatefulWidget {
  const _DraggableHost({required this.builder, required this.initialSize, required this.minSize, required this.maxSize});

  final Widget Function(BuildContext context, ScrollController scroll, DraggableScrollableController sheet) builder;
  final double initialSize;
  final double minSize;
  final double maxSize;

  @override
  State<_DraggableHost> createState() => _DraggableHostState();
}

class _DraggableHostState extends State<_DraggableHost> {
  final DraggableScrollableController _sheet = DraggableScrollableController();

  @override
  void dispose() {
    _sheet.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => DraggableScrollableSheet(
        controller: _sheet,
        expand: false,
        snap: true,
        snapSizes: [widget.initialSize],
        initialChildSize: widget.initialSize,
        minChildSize: widget.minSize,
        maxChildSize: widget.maxSize,
        builder: (ctx, scroll) => widget.builder(ctx, scroll, _sheet),
      );
}

/// Wraps a sheet's non-scrolling top area so it can be dragged like the rest of
/// a [DraggableScrollableSheet] (the scroll view only reacts to its own
/// content). A flick down from the opening size, or letting go near the
/// smallest size, closes the sheet.
class SheetGrabArea extends StatelessWidget {
  const SheetGrabArea({super.key, required this.controller, required this.minSize, required this.snapSizes, required this.child});

  final DraggableScrollableController controller;
  final double minSize;

  /// Sizes (fractions) the sheet settles on, ascending, including the largest.
  final List<double> snapSizes;
  final Widget child;

  void _update(DragUpdateDetails d) {
    if (!controller.isAttached) return;
    final size = controller.pixelsToSize(controller.pixels - d.delta.dy);
    controller.jumpTo(size.clamp(minSize, snapSizes.last).toDouble());
  }

  void _end(BuildContext context, DragEndDetails d) {
    if (!controller.isAttached) return;
    final v = d.primaryVelocity ?? 0; // > 0 is downwards
    final cur = controller.size;
    final stops = <double>{minSize, ...snapSizes}.toList()..sort();
    final opening = stops.length > 1 ? stops[1] : stops.first;
    double target;
    if (v > 700) {
      if (cur <= opening + 0.02) return _close(context);
      target = stops.lastWhere((s) => s < cur - 0.02, orElse: () => opening);
    } else if (v < -700) {
      target = stops.firstWhere((s) => s > cur + 0.02, orElse: () => stops.last);
    } else {
      target = stops.reduce((a, b) => (a - cur).abs() <= (b - cur).abs() ? a : b);
      if (target == minSize && stops.length > 1) return _close(context);
    }
    controller.animateTo(target, duration: const Duration(milliseconds: 220), curve: Curves.easeOutCubic);
  }

  void _close(BuildContext context) => Navigator.of(context).maybePop();

  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.opaque,
        onVerticalDragUpdate: _update,
        onVerticalDragEnd: (d) => _end(context, d),
        child: child,
      );
}

/// The little grabber pill at the top of a sheet.
class SheetHandle extends StatelessWidget {
  const SheetHandle({super.key});

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: Center(
          child: Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(top: 10, bottom: 6),
            decoration: BoxDecoration(
              color: SheetTone.of(context).muted.withValues(alpha: 0.45),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
      );
}

/// Overline + title (+ subtitle) on the left, optional actions and a close
/// button on the right.
class SheetHeader extends StatelessWidget {
  const SheetHeader({
    super.key,
    required this.title,
    this.overline,
    this.subtitle,
    this.actions = const [],
    this.onClose,
    this.closeEnabled = true,
    this.titleMaxLines = 3,
  });

  final String title;
  final int titleMaxLines;
  final String? overline;
  final String? subtitle;
  final List<Widget> actions;
  final VoidCallback? onClose;
  final bool closeEnabled;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(kSheetGutter, 2, 4, 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (overline != null)
                  Text(
                    overline!.toUpperCase(),
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.7, color: t.muted),
                  ),
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    maxLines: titleMaxLines,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.25, color: t.ink),
                  ),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(subtitle!, style: TextStyle(fontSize: 12.5, height: 1.3, color: t.muted)),
                  ),
              ],
            ),
          ),
          ...actions,
          IconButton(
            tooltip: 'Close',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            icon: const Icon(Icons.close_rounded),
            onPressed: closeEnabled ? (onClose ?? () => Navigator.of(context).maybePop()) : null,
          ),
        ],
      ),
    );
  }
}

/// Sticky action bar pinned to the bottom of a sheet (above the home indicator).
class SheetFooter extends StatelessWidget {
  const SheetFooter({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).bottomSheetTheme.backgroundColor ?? t.scheme.surface,
        border: Border(top: BorderSide(color: t.border)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: t.dark ? 0.35 : 0.06), blurRadius: 12, offset: const Offset(0, -3))],
      ),
      child: SafeArea(
        top: false,
        child: Padding(padding: const EdgeInsets.fromLTRB(kSheetGutter, 10, kSheetGutter, 10), child: child),
      ),
    );
  }
}

/// A sheet that fills [fraction] of the available height and moves up with the
/// keyboard, so a search field is never covered.
class FullHeightSheet extends StatelessWidget {
  const FullHeightSheet({super.key, required this.child, this.fraction = 0.94});
  final Widget child;
  final double fraction;

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: LayoutBuilder(
          builder: (context, box) {
            final full = box.maxHeight.isFinite ? box.maxHeight : MediaQuery.sizeOf(context).height;
            return SizedBox(height: full * fraction, child: child);
          },
        ),
      );
}

/// One tab of a [SegmentedTabs] / [ChipTabs].
class TabItem<T> {
  const TabItem(this.value, this.label, {this.count});
  final T value;
  final String label;

  /// Small badge after the label (e.g. how many are selected).
  final int? count;
}

/// Equal-width segmented control in a recessed track (the web's `.pd-seg`).
class SegmentedTabs<T> extends StatelessWidget {
  const SegmentedTabs({super.key, required this.items, required this.selected, required this.onSelected});

  final List<TabItem<T>> items;
  final T selected;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: t.track, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          for (final item in items)
            Expanded(
              child: Semantics(
                button: true,
                selected: item.value == selected,
                label: item.label,
                excludeSemantics: true,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    if (item.value == selected) return;
                    SheetHaptics.selection();
                    onSelected(item.value);
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    curve: Curves.easeOut,
                    constraints: const BoxConstraints(minHeight: 44),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                    decoration: BoxDecoration(
                      color: item.value == selected ? Theme.of(context).colorScheme.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: item.value == selected && !t.dark
                          ? [BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 3, offset: const Offset(0, 1))]
                          : null,
                    ),
                    child: _TabLabel(item: item, on: item.value == selected, center: true),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Horizontally scrolling pill tabs (drill-down and filter sections).
class ChipTabs<T> extends StatelessWidget {
  const ChipTabs({super.key, required this.items, required this.selected, required this.onSelected, this.padding = const EdgeInsets.symmetric(horizontal: kSheetGutter)});

  final List<TabItem<T>> items;
  final T selected;
  final ValueChanged<T> onSelected;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: padding,
      child: Row(
        children: [
          for (final item in items) ...[
            Semantics(
              button: true,
              selected: item.value == selected,
              label: item.label,
              excludeSemantics: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  if (item.value == selected) return;
                  SheetHaptics.selection();
                  onSelected(item.value);
                },
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 44),
                  child: Center(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 160),
                      curve: Curves.easeOut,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: item.value == selected ? t.accent : Colors.transparent,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: item.value == selected ? t.accent : t.border),
                      ),
                      child: _TabLabel(item: item, on: item.value == selected, filled: true),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _TabLabel<T> extends StatelessWidget {
  const _TabLabel({required this.item, required this.on, this.center = false, this.filled = false});
  final TabItem<T> item;
  final bool on;
  final bool center;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final fg = filled ? (on ? t.onAccent : t.ink) : (on ? t.ink : t.muted);
    final label = Text(
      item.label,
      textAlign: center ? TextAlign.center : TextAlign.start,
      maxLines: center ? 2 : 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, height: 1.2, color: fg),
    );
    final count = item.count;
    if (count == null || count <= 0) return label;
    final badge = Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: filled && on ? t.onAccent.withValues(alpha: 0.22) : t.accent.withValues(alpha: t.dark ? 0.30 : 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$count',
        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: filled && on ? t.onAccent : t.ink),
      ),
    );
    return Row(
      mainAxisSize: center ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: center ? MainAxisAlignment.center : MainAxisAlignment.start,
      children: [Flexible(child: label), badge],
    );
  }
}

/// Small uppercase caption above a group ("PERIOD", "MACHINE").
class SheetLabel extends StatelessWidget {
  const SheetLabel(this.text, {super.key, this.padding = const EdgeInsets.only(bottom: 8)});
  final String text;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Padding(
        padding: padding,
        child: Text(
          text.toUpperCase(),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.7, color: SheetTone.of(context).muted),
        ),
      );
}

/// Inline message inside a sheet (a snackbar would be hidden behind the sheet).
class SheetBanner extends StatelessWidget {
  const SheetBanner(this.message, {super.key, this.icon = Icons.error_outline_rounded, this.isError = true});
  final String message;
  final IconData icon;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final tone = isError ? t.scheme.error : t.accent;
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: t.dark ? 0.16 : 0.09),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: tone.withValues(alpha: 0.45)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 18, color: tone)),
            const SizedBox(width: 10),
            Expanded(child: Text(message, style: TextStyle(fontSize: 13, height: 1.35, color: t.ink))),
          ],
        ),
      ),
    );
  }
}

/// A rounded, softly elevated container used for rows and summary blocks.
class SheetCard extends StatelessWidget {
  const SheetCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.onTap, this.selected = false, this.radius = 14});

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  final bool selected;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final shape = BorderRadius.circular(radius);
    return Material(
      color: selected ? t.wash : t.card,
      elevation: 0,
      borderRadius: shape,
      child: Ink(
        decoration: BoxDecoration(
          borderRadius: shape,
          border: Border.all(color: selected ? t.accent.withValues(alpha: 0.55) : t.border),
          boxShadow: t.dark ? null : [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 2))],
        ),
        child: InkWell(
          borderRadius: shape,
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Column count for a grid of chips that stays legible at large text sizes.
int gridColumns(BuildContext context, {int normal = 4, double minCellWidth = 64, double horizontal = kSheetGutter * 2}) {
  final width = math.min(MediaQuery.sizeOf(context).width, kSheetMaxWidth) - horizontal;
  final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
  final by = (width / (minCellWidth * math.max(1.0, scale))).floor();
  return by.clamp(2, normal);
}

/// "3 days" / "1 day".
String plural(num n, String one, [String? many]) => '${n == n.roundToDouble() ? n.round() : n} ${n == 1 ? one : (many ?? '${one}s')}';
