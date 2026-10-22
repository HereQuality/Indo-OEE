import 'package:flutter/material.dart';

import '../charts/chart_props.dart' show DashboardColors;

/// The dashboard's surface: a rounded card with a hairline border, and a soft
/// shadow in light mode (dark mode separates by border + lighter surface
/// instead — shadows vanish on navy). Optionally washed with a [tint] (the
/// tone of a KPI tile) and tappable.
class DashCard extends StatelessWidget {
  const DashCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(12),
    this.onTap,
    this.tint,
    this.radius = 12,
    this.clip = true,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? tint;
  final double radius;
  final bool clip;

  /// The theme's card colour (white / navy-800), so the dashboard matches the
  /// rest of the app instead of inventing its own surface.
  static Color surfaceOf(BuildContext context) =>
      Theme.of(context).cardTheme.color ?? Theme.of(context).colorScheme.surface;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final base = surfaceOf(context);
    final bg = tint == null ? base : Color.alphaBlend(tint!.withValues(alpha: dark ? 0.12 : 0.07), base);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
      side: BorderSide(color: theme.colorScheme.outlineVariant),
    );
    return Material(
      color: bg,
      elevation: dark ? 0 : 1,
      shadowColor: Colors.black.withValues(alpha: 0.10),
      surfaceTintColor: Colors.transparent,
      shape: shape,
      clipBehavior: clip ? Clip.antiAlias : Clip.none,
      child: onTap == null
          ? Padding(padding: padding, child: child)
          : InkWell(onTap: onTap, child: Padding(padding: padding, child: child)),
    );
  }
}

/// The coloured edge along the top of a graph card (a gradient through the
/// first, third and fourth series colours) or of a KPI tile (the first series
/// colour, slightly faded) - processDashboard.css `.pd-card::before` /
/// `.pd-stat::before`.
class AccentEdge extends StatelessWidget {
  const AccentEdge({super.key, this.gradient = false});
  final bool gradient;

  @override
  Widget build(BuildContext context) {
    final s = DashboardColors.of(context).series;
    return ExcludeSemantics(
      child: SizedBox(
        height: gradient ? 4 : 3,
        width: double.infinity,
        child: DecoratedBox(
          decoration: gradient
              ? BoxDecoration(gradient: LinearGradient(colors: [s[0], s[2], s[3]], stops: const [0, 0.55, 1]))
              : BoxDecoration(color: s[0].withValues(alpha: 0.85)),
        ),
      ),
    );
  }
}
