import 'dart:async';

import 'package:flutter/foundation.dart' show mapEquals;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'chart_props.dart';

/// Shared building blocks for the dashboard visuals: text metrics, the empty
/// state, the legend, the press tooltip and the little helpers every chart
/// needs (dimming, truncation, haptics).

/// Chart drawings (axis labels, value labels, tooltips) stop growing past this
/// text scale so a 1.6x system font never blows a 300 px stage apart. Tables
/// and lists are laid out at the full scale.
const double kChartMaxTextScale = 1.3;

/// Unselected marks fade back when their chart's dimension has a selection.
const double kDimmedOpacity = 0.28;

double markOpacity(List<String> selected, String key) =>
    selected.isEmpty || selected.contains(key) ? 1.0 : kDimmedOpacity;

/// JS `truncate(s, max)`: keeps `max - 1` characters and adds an ellipsis.
String truncateLabel(String s, [int max = 18]) => s.length > max ? '${s.substring(0, max - 1)}…' : s;

bool isFiniteNum(Object? v) => v is num && v.isFinite;

/// The card the visual sits on (what marks are separated from by their gap
/// stroke, and what the sticky table column must match).
Color chartSurface(BuildContext context) =>
    Theme.of(context).cardTheme.color ?? Theme.of(context).colorScheme.surface;

/// Selection wash used behind a selected table row.
Color chartWash(DashboardColors c, BuildContext context) =>
    c.ok.withValues(alpha: Theme.of(context).brightness == Brightness.dark ? 0.20 : 0.10);

/// A light tick on key toggles; never throws (tests / unsupported devices).
void chartHaptic() {
  try {
    unawaited(HapticFeedback.selectionClick().catchError((Object _) {}));
  } catch (_) {}
}

/// Runs [child] with the chart text-scale cap applied.
class ChartTextScope extends StatelessWidget {
  const ChartTextScope({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) =>
      MediaQuery.withClampedTextScaling(maxScaleFactor: kChartMaxTextScale, child: child);
}

/// Text style for chart labels (theme font, explicit colour, no decorations).
TextStyle chartText(
  BuildContext context, {
  double size = 11,
  Color? color,
  FontWeight? weight,
  double? spacing,
  bool tabular = true,
}) {
  final base = Theme.of(context).textTheme.bodySmall ?? const TextStyle();
  return base.copyWith(
    fontSize: size,
    color: color,
    fontWeight: weight,
    height: 1.2,
    letterSpacing: spacing,
    decoration: TextDecoration.none,
    fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null,
  );
}

/// Width/height of [text] at [style] (single line unless [maxWidth] is given).
Size measureText(String text, TextStyle style, TextScaler scaler, {double maxWidth = double.infinity, int? maxLines = 1}) {
  final tp = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: TextDirection.ltr,
    textScaler: scaler,
    maxLines: maxLines,
  )..layout(maxWidth: maxWidth);
  final size = tp.size;
  tp.dispose();
  return size;
}

double maxTextWidth(Iterable<String> texts, TextStyle style, TextScaler scaler) {
  var w = 0.0;
  for (final t in texts) {
    final s = measureText(t, style, scaler).width;
    if (s > w) w = s;
  }
  return w;
}

/// True when [a] and [b] hold the very same row objects in the same order —
/// the cheap check that lets a chart keep its derived data when the shell
/// rebuilds with an unchanged slice.
bool sameRows(List<Map<String, dynamic>>? a, List<Map<String, dynamic>>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null || a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (!identical(a[i], b[i])) return false;
  }
  return true;
}

/// True when [a] and [b] describe the same machines / bucket (the shell may
/// rebuild the context object without anything in it having changed).
bool sameCtx(DashboardCtx? a, DashboardCtx? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null) return false;
  return a.bucket == b.bucket && mapEquals(a.machineName, b.machineName) && mapEquals(a.machineOrder, b.machineOrder);
}

/// Keeps a chart's derived data until its inputs really change.
class DataMemo<T> {
  List<Map<String, dynamic>>? _rows;
  DashboardCtx? _ctx;
  String? _dim;
  T? _value;
  bool _has = false;

  T get(List<Map<String, dynamic>> rows, DashboardCtx ctx, String? dim, T Function() compute) {
    if (!_has || !sameRows(rows, _rows) || !sameCtx(ctx, _ctx) || dim != _dim) {
      _value = compute();
      _rows = rows;
      _ctx = ctx;
      _dim = dim;
      _has = true;
    }
    return _value as T;
  }
}

/// Stage size a chart may use: the given box, with sane fallbacks when a
/// parent hands out an unbounded one.
Size stageSize(BoxConstraints box, {double fallbackHeight = 300}) => Size(
      box.hasBoundedWidth ? box.maxWidth : 360,
      box.hasBoundedHeight ? box.maxHeight : fallbackHeight,
    );

/// The web's `Empty`: a centred, muted one-liner where a chart would be.
class ChartEmpty extends StatelessWidget {
  const ChartEmpty(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, box) {
        final showIcon = !box.hasBoundedHeight || box.maxHeight >= 96;
        return Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (showIcon) ...[
                  Icon(Icons.insert_chart_outlined_rounded, size: 30, color: cs.onSurfaceVariant.withValues(alpha: 0.45)),
                  const SizedBox(height: 8),
                ],
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: chartText(context, size: 13, color: cs.onSurfaceVariant, tabular: false).copyWith(height: 1.35),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// One legend entry. With [onTap] it is a toggle (hidden entries are struck
/// through and faded, like the web's OEE legend).
class LegendItem {
  const LegendItem(this.label, this.color, {this.hidden = false, this.onTap, this.line = false, this.semanticLabel});
  final String label;
  final Color color;
  final bool hidden;
  final VoidCallback? onTap;

  /// A short line swatch (for line series) instead of a square.
  final bool line;
  final String? semanticLabel;
}

class ChartLegend extends StatelessWidget {
  const ChartLegend({super.key, required this.items, required this.colors, this.alignment = WrapAlignment.center});
  final List<LegendItem> items;
  final DashboardColors colors;
  final WrapAlignment alignment;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: alignment,
      spacing: 4,
      runSpacing: 0,
      children: [for (final it in items) _LegendChip(item: it, colors: colors)],
    );
  }
}

class _LegendChip extends StatelessWidget {
  const _LegendChip({required this.item, required this.colors});
  final LegendItem item;
  final DashboardColors colors;

  @override
  Widget build(BuildContext context) {
    final tappable = item.onTap != null;
    final swatch = Container(
      width: item.line ? 16 : 10,
      height: item.line ? 3 : 10,
      decoration: BoxDecoration(
        color: item.hidden ? colors.muted.withValues(alpha: 0.5) : item.color,
        borderRadius: BorderRadius.circular(item.line ? 2 : 3),
      ),
    );
    final label = Flexible(
      child: Text(
        item.label,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: chartText(context, size: 12, color: colors.axis.withValues(alpha: item.hidden ? 0.5 : 1), tabular: false).copyWith(
          decoration: item.hidden ? TextDecoration.lineThrough : TextDecoration.none,
          decorationColor: colors.axis,
        ),
      ),
    );
    final content = ConstrainedBox(
      // Legend toggles are real buttons: give them a finger-sized hit box.
      constraints: BoxConstraints(minHeight: tappable ? 40 : 24),
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: tappable ? 8 : 6, vertical: 2),
        child: Row(mainAxisSize: MainAxisSize.min, children: [swatch, const SizedBox(width: 6), label]),
      ),
    );
    if (!tappable) return Semantics(label: item.semanticLabel ?? item.label, child: content);
    return Semantics(
      button: true,
      toggled: !item.hidden,
      label: item.semanticLabel ?? item.label,
      excludeSemantics: true,
      onTap: item.onTap,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(borderRadius: BorderRadius.circular(8), onTap: item.onTap, child: content),
      ),
    );
  }
}

/// One line of a [ChartTooltipCard].
class TooltipLine {
  const TooltipLine(this.text, {this.color, this.value});
  final String text;
  final Color? color;
  final String? value;
}

/// The floating card shown while a mark is pressed (widget-drawn charts; the
/// fl_chart ones paint their own with the same look).
class ChartTooltipCard extends StatelessWidget {
  const ChartTooltipCard({super.key, this.title, required this.lines, required this.colors});
  final String? title;
  final List<TooltipLine> lines;
  final DashboardColors colors;

  @override
  Widget build(BuildContext context) {
    final surface = chartSurface(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 240),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colors.grid),
          boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8, offset: Offset(0, 2))],
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (title != null)
                Text(title!, style: chartText(context, size: 12, color: colors.ink, weight: FontWeight.w700)),
              for (final l in lines)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (l.color != null) ...[
                        Container(width: 8, height: 8, decoration: BoxDecoration(color: l.color, shape: BoxShape.circle)),
                        const SizedBox(width: 6),
                      ],
                      Flexible(child: Text(l.text, style: chartText(context, size: 12, color: colors.ink))),
                      if (l.value != null) ...[
                        const SizedBox(width: 8),
                        Text(l.value!, style: chartText(context, size: 12, color: colors.ink, weight: FontWeight.w700)),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A long-press tooltip (Flutter's own [Tooltip]) skinned like the chart
/// tooltips — used for rows / headers of the widget-drawn visuals.
class ChartPressTip extends StatelessWidget {
  const ChartPressTip({super.key, required this.message, required this.colors, required this.child});
  final String message;
  final DashboardColors colors;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (message.isEmpty) return child;
    return Tooltip(
      message: message,
      triggerMode: TooltipTriggerMode.longPress,
      showDuration: const Duration(seconds: 3),
      preferBelow: false,
      constraints: const BoxConstraints(maxWidth: 260),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: chartSurface(context),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colors.grid),
        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8, offset: Offset(0, 2))],
      ),
      textStyle: chartText(context, size: 12, color: colors.ink, tabular: false),
      child: child,
    );
  }
}
