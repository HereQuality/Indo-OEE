import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import 'chart_kit.dart';
import 'chart_props.dart';
import 'nice_axis.dart';

/// Pieces every fl_chart based visual shares: the y axis (labels measured so
/// nothing clips, gridlines on the same ticks), the bottom axis with
/// overlap-free labels, and the touch tooltip look.

class YAxisSpec {
  const YAxisSpec(this.axis, this.labels, this.width);
  final NiceAxis axis;
  final List<String> labels;

  /// Reserved width of the left titles (widest label + gap).
  final double width;

  int _indexOf(double v) {
    final tol = axis.step.abs() * 1e-6 + 1e-9;
    for (var i = 0; i < axis.ticks.length; i++) {
      if ((axis.ticks[i] - v).abs() <= tol) return i;
    }
    return -1;
  }

  String? labelAt(double v) {
    final i = _indexOf(v);
    return i < 0 ? null : labels[i];
  }
}

/// Measures the tick labels of [axis] once, at the chart text scale.
YAxisSpec makeYAxis(BuildContext context, DashboardColors c, NiceAxis axis, String Function(double) format, {double size = 11}) {
  final labels = [for (final t in axis.ticks) format(t)];
  final w = maxTextWidth(labels, chartText(context, size: size, color: c.axis), MediaQuery.textScalerOf(context));
  return YAxisSpec(axis, labels, w + 8);
}

/// Height reserved under the plot for one line of x labels.
double bottomAxisHeight(BuildContext context, {double size = 11}) =>
    MediaQuery.textScalerOf(context).scale(size) * 1.2 + 10;

/// Titles of an index-based chart (bar groups / line spots at x = 0, 1, 2 ...):
/// y labels on the left, one x label per index where [xLabel] returns one.
FlTitlesData indexTitles(
  BuildContext context,
  DashboardColors c, {
  required YAxisSpec y,
  required double bottomHeight,
  required Widget? Function(int index) xLabel,
  double size = 11,
}) {
  final style = chartText(context, size: size, color: c.axis);
  return FlTitlesData(
    topTitles: const AxisTitles(),
    rightTitles: const AxisTitles(),
    leftTitles: AxisTitles(
      sideTitles: SideTitles(
        showTitles: true,
        reservedSize: y.width,
        interval: y.axis.step,
        getTitlesWidget: (value, meta) {
          final text = y.labelAt(value);
          if (text == null) return const SizedBox.shrink();
          return SideTitleWidget(meta: meta, space: 6, child: Text(text, maxLines: 1, style: style));
        },
      ),
    ),
    bottomTitles: AxisTitles(
      sideTitles: SideTitles(
        showTitles: true,
        reservedSize: bottomHeight,
        interval: 1,
        getTitlesWidget: (value, meta) {
          final i = value.round();
          if ((value - i).abs() > 1e-6) return const SizedBox.shrink();
          final w = xLabel(i);
          if (w == null) return const SizedBox.shrink();
          return SideTitleWidget(meta: meta, space: 6, child: w);
        },
      ),
    ),
  );
}

FlGridData horizontalGrid(DashboardColors c, YAxisSpec y) => FlGridData(
      drawVerticalLine: false,
      horizontalInterval: y.axis.step,
      getDrawingHorizontalLine: (_) => FlLine(color: c.grid, strokeWidth: 1),
      checkToShowHorizontalLine: (v) => y.labelAt(v) != null,
    );

FlBorderData baselineBorder(DashboardColors c) =>
    FlBorderData(show: true, border: Border(bottom: BorderSide(color: c.grid)));

/// x-axis label widget (one line, centred on its tick).
Widget xTickLabel(BuildContext context, DashboardColors c, String text, {double size = 11}) => Text(
      text,
      maxLines: 1,
      softWrap: false,
      overflow: TextOverflow.visible,
      textAlign: TextAlign.center,
      style: chartText(context, size: size, color: c.axis),
    );

/// The touch tooltip card shared by every fl_chart visual.
BarTouchTooltipData barTooltipData(
  BuildContext context,
  DashboardColors c, {
  required GetBarTooltipItem item,
  double maxWidth = 240,
}) =>
    BarTouchTooltipData(
      getTooltipColor: (_) => chartSurface(context),
      tooltipBorder: BorderSide(color: c.grid),
      tooltipBorderRadius: BorderRadius.circular(8),
      tooltipPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      tooltipMargin: 6,
      maxContentWidth: maxWidth,
      fitInsideHorizontally: true,
      fitInsideVertically: true,
      getTooltipItem: item,
    );

LineTouchTooltipData lineTooltipData(
  BuildContext context,
  DashboardColors c, {
  required GetLineTooltipItems items,
  double maxWidth = 240,
}) =>
    LineTouchTooltipData(
      getTooltipColor: (_) => chartSurface(context),
      tooltipBorder: BorderSide(color: c.grid),
      tooltipBorderRadius: BorderRadius.circular(8),
      tooltipPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      tooltipMargin: 8,
      maxContentWidth: maxWidth,
      fitInsideHorizontally: true,
      fitInsideVertically: true,
      getTooltipItems: items,
    );

/// A rich tooltip line: a coloured dot, the name and the value.
List<TextSpan> tooltipRow(DashboardColors c, TextStyle base, Color? dot, String name, String value) => [
      if (dot != null) TextSpan(text: '● ', style: base.copyWith(color: dot)),
      TextSpan(text: '$name  ', style: base.copyWith(color: c.ink)),
      TextSpan(text: value, style: base.copyWith(color: c.ink, fontWeight: FontWeight.w700)),
    ];
