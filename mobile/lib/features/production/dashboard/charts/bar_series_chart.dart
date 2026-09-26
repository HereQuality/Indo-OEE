import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import 'axis_kit.dart';
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'nice_axis.dart';

/// A vertical bar chart on fl_chart: one group per [TimePoint], one stacked
/// segment per series (or a single bar). Backs OeeByMachine, OkRejectedTrend,
/// DowntimeByMachine and every panel of UnreportedByMachine.
///
/// Touch: press (or drag along) to read a mark's exact values in a tooltip; a
/// tap anywhere in a bar's column calls [onTap] (the cross-filter) — the touch
/// area is widened to the whole column so thin bars are still easy to hit.
class BarSeriesChart extends StatelessWidget {
  const BarSeriesChart({
    super.key,
    required this.points,
    required this.colors,
    required this.seriesColors,
    required this.seriesNames,
    required this.title,
    required this.xTick,
    required this.yText,
    required this.valueText,
    required this.opacityOf,
    this.onTap,
    this.axis,
    this.intervals = 4,
    this.maxBar = 34,
    this.stacked = true,
    this.topLabel,
    this.compact = false,
    this.zeroLine = false,
    this.tickGap = 16,
    this.topPad = 8,
    this.rightPad = 6,
    this.semanticLabel,
  });

  final List<TimePoint> points;
  final DashboardColors colors;
  final List<Color> seriesColors;
  final List<String> seriesNames;

  /// Tooltip heading / x tick text of a point.
  final String Function(TimePoint p) title;
  final String Function(TimePoint p) xTick;

  /// Tick labels of the y axis; exact value text for tooltips.
  final String Function(double v) yText;
  final String Function(double v) valueText;

  /// 1 for a normal mark, 0.28 for a dimmed one.
  final double Function(TimePoint p) opacityOf;
  final void Function(TimePoint p)? onTap;

  /// A shared axis (small multiples); computed from the data when null.
  final NiceAxis? axis;
  final int intervals;
  final double maxBar;
  final bool stacked;

  /// Value printed above each bar (single-series charts).
  final String Function(double v)? topLabel;
  final bool compact;
  final bool zeroLine;
  final double tickGap;
  final double topPad;
  final double rightPad;
  final String? semanticLabel;

  /// A value the painter can always place: NaN / Infinity become 0, and dust
  /// (1e-9 next to 1e15, from odd legacy rows) too, which would otherwise
  /// make fl_chart build a rect with a NaN edge.
  static double _clean(double? v) => (v == null || !v.isFinite || v.abs() < 1e-6) ? 0.0 : v;

  NiceAxis _axisFor() {
    if (axis != null) return axis!;
    var hi = 0.0;
    var lo = 0.0;
    for (final p in points) {
      if (stacked) {
        var sum = 0.0;
        for (final v in p.values) {
          sum += _clean(v);
        }
        hi = math.max(hi, sum);
        lo = math.min(lo, sum);
      } else {
        for (final v in p.values) {
          hi = math.max(hi, _clean(v));
          lo = math.min(lo, _clean(v));
        }
      }
    }
    return niceAxis(lo, hi, intervals);
  }

  @override
  Widget build(BuildContext context) {
    return ChartTextScope(
      child: LayoutBuilder(builder: (context, box) => _chart(context, stageSize(box))),
    );
  }

  Widget _chart(BuildContext context, Size size) {
    final c = colors;
    final scaler = MediaQuery.textScalerOf(context);
    final fontSize = compact ? 10.0 : 11.0;
    final ax = _axisFor();
    final y = makeYAxis(context, c, ax, yText, size: fontSize);
    final bottomH = bottomAxisHeight(context, size: fontSize);
    final n = points.length;
    final labelHeadroom = topLabel != null ? scaler.scale(11) * 1.2 + 6 : 0.0;
    final plotW = math.max(24.0, size.width - y.width - rightPad);
    final pitch = plotW / math.max(1, n);
    final barW = (pitch * (compact ? 0.66 : 0.62)).clamp(2.0, maxBar).toDouble();
    final xStyle = chartText(context, size: fontSize, color: c.axis);
    final xLabelW = maxTextWidth([for (final p in points) xTick(p)], xStyle, scaler);
    final every = labelEvery(xLabelW, pitch, gap: tickGap);
    final surface = chartSurface(context);
    final labelStyle = chartText(context, size: 11, color: c.axis);
    final tipBase = chartText(context, size: 12, color: c.ink);

    final groups = <BarChartGroupData>[];
    for (var i = 0; i < n; i++) {
      final p = points[i];
      final op = opacityOf(p);
      final BarChartRodData rod;
      if (stacked && seriesColors.length > 1) {
        var run = 0.0;
        final items = <BarChartRodStackItem>[];
        for (var s = 0; s < seriesColors.length; s++) {
          final v = _clean(s < p.values.length ? p.values[s] : 0);
          items.add(BarChartRodStackItem(run, run + v, seriesColors[s].withValues(alpha: op), borderSide: BorderSide(color: surface, width: 1)));
          run += v;
        }
        rod = BarChartRodData(
          toY: run,
          width: barW,
          color: seriesColors.first.withValues(alpha: op),
          borderRadius: BorderRadius.vertical(top: Radius.circular(math.min(4, barW / 2))),
          rodStackItems: items,
        );
      } else {
        final v = _clean(p.values.isEmpty ? 0 : p.values.first);
        final r = Radius.circular(math.min(compact ? 2 : 4, barW / 2));
        rod = BarChartRodData(
          toY: v,
          width: barW,
          color: seriesColors.first.withValues(alpha: op),
          borderRadius: v >= 0 ? BorderRadius.vertical(top: r) : BorderRadius.vertical(bottom: r),
          label: topLabel == null
              ? const BarChartRodLabel(show: false)
              : BarChartRodLabel(show: true, text: topLabel!(v), style: labelStyle.copyWith(color: c.axis.withValues(alpha: math.max(op, 0.55))), offset: const Offset(0, 3)),
        );
      }
      groups.add(BarChartGroupData(x: i, barRods: [rod]));
    }

    final data = BarChartData(
      alignment: BarChartAlignment.spaceAround,
      minY: ax.lo,
      maxY: ax.hi,
      barGroups: groups,
      titlesData: indexTitles(
        context,
        c,
        y: y,
        bottomHeight: bottomH,
        size: fontSize,
        xLabel: (i) => i < 0 || i >= n || i % every != 0 ? null : xTickLabel(context, c, xTick(points[i]), size: fontSize),
      ),
      gridData: horizontalGrid(c, y),
      borderData: baselineBorder(c),
      extraLinesData: zeroLine ? ExtraLinesData(horizontalLines: [HorizontalLine(y: 0, color: c.muted, strokeWidth: 1)]) : null,
      barTouchData: BarTouchData(
        touchExtraThreshold: EdgeInsets.symmetric(horizontal: math.max(0, (pitch - barW) / 2), vertical: 2000),
        touchCallback: onTap == null
            ? null
            : (event, response) {
                final spot = response?.spot;
                if (event is FlTapUpEvent && spot != null) {
                  final i = spot.touchedBarGroupIndex;
                  if (i >= 0 && i < n) {
                    chartHaptic();
                    onTap!(points[i]);
                  }
                }
              },
        touchTooltipData: barTooltipData(
          context,
          c,
          maxWidth: math.min(240, size.width - 16),
          item: (group, groupIndex, rod, rodIndex) {
            final p = points[groupIndex];
            return BarTooltipItem(
              '${title(p)}\n',
              tipBase.copyWith(fontWeight: FontWeight.w700),
              textAlign: TextAlign.left,
              children: [
                for (var s = 0; s < seriesColors.length; s++) ...[
                  ...tooltipRow(c, tipBase, seriesColors.length > 1 || seriesNames.first.isNotEmpty ? seriesColors[s] : null, seriesNames[s], valueText(s < p.values.length ? (p.values[s] ?? 0) : 0)),
                  if (s < seriesColors.length - 1) TextSpan(text: '\n', style: tipBase),
                ],
              ],
            );
          },
        ),
      ),
    );

    return Semantics(
      container: true,
      label: semanticLabel,
      child: Padding(
        padding: EdgeInsets.only(top: topPad + labelHeadroom, right: rightPad),
        child: BarChart(data, duration: const Duration(milliseconds: 150)),
      ),
    );
  }
}
