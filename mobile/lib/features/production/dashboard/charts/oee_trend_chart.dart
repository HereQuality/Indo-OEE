import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'axis_kit.dart';
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'mini_table.dart';
import 'nice_axis.dart';

/// OEE (over time): the three OEE figures by date (by month on long ranges).
/// Tap a legend entry to hide / show that line; touch or drag on the plot for
/// the exact figures; tap to cross-filter that date / month.
class OeeTrendChart extends StatefulWidget {
  const OeeTrendChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<OeeTrendChart> createState() => _OeeTrendChartState();
}

class _OeeTrendChartState extends State<OeeTrendChart> {
  // Legend toggles hide a series: separate from the date / month cross-filter.
  final Set<String> _hidden = {};

  Rows? _rows;
  DashboardCtx? _ctx;
  String? _dim;
  List<TimePoint> _data = const [];

  List<TimePoint> _dataFor(Rows rows, String dim, DashboardCtx ctx) {
    if (!sameRows(rows, _rows) || !sameCtx(ctx, _ctx) || dim != _dim) {
      _data = oeeTrend(rows, dim, ctx);
      _rows = rows;
      _ctx = ctx;
      _dim = dim;
    }
    return _data;
  }

  void _toggleSeries(String key) {
    chartHaptic();
    setState(() {
      if (!_hidden.remove(key)) _hidden.add(key);
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final dim = p.ctx.bucket;
    final data = _dataFor(p.rowsFor(dim), dim, p.ctx);
    if (data.isEmpty) return const ChartEmpty('Needs machine ON/OFF times and OK quantity.');

    final selected = p.filters[dim] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: [eng.dimensions[dim]!.label, for (final s in oeeSeries) s.label],
        rows: [
          for (final d in data)
            MiniRow(d.key, [d.label, for (final v in d.values) v == null ? '—' : '${v.toStringAsFixed(2)}%']),
        ],
        selected: selected,
        onRowClick: (k) => p.onToggle(dim, k),
        colors: p.colors,
      );
    }

    return ChartTextScope(
      child: Builder(builder: (context) {
        final legend = ChartLegend(
          colors: p.colors,
          items: [
            for (var i = 0; i < oeeSeries.length; i++)
              LegendItem(
                p.expanded ? oeeSeries[i].label : oeeSeries[i].shortLabel,
                p.colors.series[i],
                hidden: _hidden.contains(oeeSeries[i].key),
                line: true,
                semanticLabel: oeeSeries[i].label,
                onTap: () => _toggleSeries(oeeSeries[i].key),
              ),
          ],
        );
        return Semantics(
          container: true,
          label: 'OEE over time, ${data.length} ${dim == 'date' ? 'days' : 'months'}',
          child: Column(
            children: [
              Expanded(child: LayoutBuilder(builder: (context, box) => _plot(context, stageSize(box), data, dim, selected))),
              legend,
            ],
          ),
        );
      }),
    );
  }

  Widget _plot(BuildContext context, Size size, List<TimePoint> data, String dim, List<String> selected) {
    final p = widget.props;
    final c = p.colors;
    final scaler = MediaQuery.textScalerOf(context);
    final n = data.length;
    final visible = [for (var i = 0; i < oeeSeries.length; i++) if (!_hidden.contains(oeeSeries[i].key)) i];

    // The web's domain rule: 0 to max(100, next 10 above the data).
    var dMax = 0.0;
    var dMin = 0.0;
    for (final d in data) {
      for (final s in visible) {
        final v = d.values[s];
        if (v == null) continue;
        dMax = math.max(dMax, v);
        dMin = math.min(dMin, v);
      }
    }
    final yHi = math.max(100.0, (dMax / 10).ceil() * 10.0);
    final yLo = math.min(0.0, (dMin / 10).floor() * 10.0);
    final axis = fixedDomainAxis(yLo, yHi, 4);
    final y = makeYAxis(context, c, axis, (v) => '${tickText(v)}%');
    final bottomH = bottomAxisHeight(context);
    const rightPad = 12.0;
    final plotW = math.max(24.0, size.width - y.width - rightPad);
    final pitch = n > 1 ? plotW / (n - 1) : plotW;
    final xStyle = chartText(context, size: 11, color: c.axis);
    final ticks = [for (final d in data) bucketTick(d.key, dim)];
    final every = labelEvery(maxTextWidth(ticks, xStyle, scaler), pitch, gap: 24);
    final few = n <= 45;
    final surface = chartSurface(context);
    final tipBase = chartText(context, size: 12, color: c.ink);

    final bars = <LineChartBarData>[
      for (final s in visible)
        LineChartBarData(
          spots: [
            for (var i = 0; i < n; i++)
              if (data[i].values[s] != null) FlSpot(i.toDouble(), data[i].values[s]!),
          ],
          isCurved: true,
          curveSmoothness: 0.2,
          preventCurveOverShooting: true,
          color: c.series[s],
          barWidth: 2.2,
          isStrokeCapRound: true,
          dotData: FlDotData(
            show: few,
            getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(radius: 3, color: c.series[s], strokeWidth: 0),
          ),
        ),
    ];

    final selectedX = [
      for (final k in selected)
        for (var i = 0; i < n; i++)
          if (data[i].key == k) i.toDouble(),
    ];

    final chart = LineChart(
      LineChartData(
        minX: n > 1 ? 0 : -1,
        maxX: n > 1 ? (n - 1).toDouble() : 1,
        minY: axis.lo,
        maxY: axis.hi,
        lineBarsData: bars,
        titlesData: indexTitles(
          context,
          c,
          y: y,
          bottomHeight: bottomH,
          xLabel: (i) => i < 0 || i >= n || i % every != 0 ? null : xTickLabel(context, c, ticks[i]),
        ),
        gridData: horizontalGrid(c, y),
        borderData: baselineBorder(c),
        extraLinesData: ExtraLinesData(
          verticalLines: [for (final x in selectedX) VerticalLine(x: x, color: c.muted, strokeWidth: 1, dashArray: [3, 3])],
        ),
        lineTouchData: LineTouchData(
          touchSpotThreshold: math.max(10, pitch / 2 + 2),
          touchCallback: (event, response) {
            final spots = response?.lineBarSpots;
            if (event is FlTapUpEvent && spots != null && spots.isNotEmpty) {
              final i = spots.first.x.round();
              if (i >= 0 && i < n) {
                chartHaptic();
                p.onToggle(dim, data[i].key);
              }
            }
          },
          getTouchedSpotIndicator: (bar, indexes) => [
            for (final _ in indexes)
              TouchedSpotIndicatorData(
                FlLine(color: c.muted, strokeWidth: 1),
                FlDotData(
                  getDotPainter: (spot, percent, b, index) =>
                      FlDotCirclePainter(radius: 5, color: b.color ?? c.ok, strokeWidth: 2, strokeColor: surface),
                ),
              ),
          ],
          touchTooltipData: lineTooltipData(
            context,
            c,
            maxWidth: math.min(260, size.width - 16),
            items: (touched) {
              return [
                for (var k = 0; k < touched.length; k++)
                  _tooltipItem(touched[k], k == 0, data, dim, visible, tipBase, c),
              ];
            },
          ),
        ),
      ),
      duration: const Duration(milliseconds: 150),
    );
    return Padding(padding: const EdgeInsets.only(top: 8, right: rightPad), child: chart);
  }

  LineTooltipItem _tooltipItem(LineBarSpot spot, bool first, List<TimePoint> data, String dim, List<int> visible, TextStyle base, DashboardColors c) {
    final s = visible[spot.barIndex];
    final ser = oeeSeries[s];
    final idx = spot.x.round().clamp(0, data.length - 1);
    final title = bucketText(data[idx].key, dim, widget.props.ctx);
    return LineTooltipItem(
      first ? '$title\n' : '',
      base.copyWith(fontWeight: FontWeight.w700),
      textAlign: TextAlign.left,
      children: tooltipRow(c, base, c.series[s], ser.label, '${spot.y.toStringAsFixed(2)}%'),
    );
  }
}
