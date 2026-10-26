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

/// OEE Trend: the three OEE figures by date (by month on long ranges).
/// Tap a legend entry to hide / show that line; touch or drag on the plot for
/// the exact figures; tap to cross-filter that date / month.
class OeeTrendChart extends StatelessWidget {
  const OeeTrendChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) => PctTrendChart(
        props: props,
        series: oeeSeries,
        emptyText: 'Needs machine ON/OFF times and OK quantity.',
        semanticName: 'OEE over time',
      );
}

/// Unutilized Machine Time Trend: one filled area (every entry's own
/// figure, averaged per date, or per month on long ranges). The axis fits the
/// data instead of stretching to 100%.
class UnutilizedTrendChart extends StatelessWidget {
  const UnutilizedTrendChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) => PctTrendChart(
        props: props,
        series: utilSeries,
        emptyText: 'Needs machine ON/OFF times.',
        semanticName: 'Unutilized machine time over time',
        fit: true,
        area: true,
      );
}

/// Several percentage series over time (date, or month on long ranges) - the
/// shape both OEE trend charts and the unutilized area share (charts.jsx
/// `PctTrend`). [ceiling] draws a dashed 100% line: anything above it is an
/// entry held for Admin review. [fit] keeps the axis to the data instead of
/// stretching it to 100%; [area] fills under each line.
class PctTrendChart extends StatefulWidget {
  const PctTrendChart({
    super.key,
    required this.props,
    required this.series,
    required this.emptyText,
    required this.semanticName,
    this.ceiling = false,
    this.fit = false,
    this.area = false,
  });
  final DashboardChartProps props;
  final List<OeeSeries> series;
  final String emptyText;
  final String semanticName;
  final bool ceiling;
  final bool fit;
  final bool area;

  @override
  State<PctTrendChart> createState() => _PctTrendChartState();
}

class _PctTrendChartState extends State<PctTrendChart> {
  // Legend toggles hide a series: separate from the date / month cross-filter.
  final Set<String> _hidden = {};

  Rows? _rows;
  DashboardCtx? _ctx;
  String? _dim;
  List<TimePoint> _data = const [];

  List<TimePoint> _dataFor(Rows rows, String dim, DashboardCtx ctx) {
    if (!sameRows(rows, _rows) || !sameCtx(ctx, _ctx) || dim != _dim) {
      _data = oeeTrend(rows, dim, ctx, widget.series);
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
    final series = widget.series;
    if (data.isEmpty) return ChartEmpty(widget.emptyText);

    final selected = p.filters[dim] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: [eng.dimensions[dim]!.label, for (final s in series) s.label],
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
            for (var i = 0; i < series.length; i++)
              LegendItem(
                p.expanded ? series[i].label : series[i].shortLabel,
                series[i].colorIn(p.colors, i),
                hidden: _hidden.contains(series[i].key),
                line: !widget.area,
                semanticLabel: series[i].label,
                onTap: () => _toggleSeries(series[i].key),
              ),
          ],
        );
        return Semantics(
          container: true,
          label: '${widget.semanticName}, ${data.length} ${dim == 'date' ? 'days' : 'months'}',
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
    final series = widget.series;
    final visible = [for (var i = 0; i < series.length; i++) if (!_hidden.contains(series[i].key)) i];

    // The web's domain rule: 0 to max(100, next 10 above the data); a `fit`
    // chart (unutilized) stops at max(10, next 10 above the data) instead.
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
    final yHi = math.max(widget.fit ? 10.0 : 100.0, (dMax / 10).ceil() * 10.0);
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
          color: series[s].colorIn(c, s),
          barWidth: 2.2,
          isStrokeCapRound: true,
          belowBarData: BarAreaData(show: widget.area, color: series[s].colorIn(c, s).withValues(alpha: 0.22)),
          dotData: FlDotData(
            show: few,
            getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(radius: 3, color: series[s].colorIn(c, s), strokeWidth: 0),
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
          horizontalLines: [
            if (widget.ceiling && axis.hi >= 100)
              HorizontalLine(
                y: 100,
                color: c.muted,
                strokeWidth: 1,
                dashArray: [4, 4],
                label: HorizontalLineLabel(
                  show: true,
                  alignment: Alignment.topRight,
                  padding: const EdgeInsets.only(right: 2, bottom: 2),
                  style: chartText(context, size: 10, color: c.muted),
                  labelResolver: (_) => '100%',
                ),
              ),
          ],
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
    final ser = widget.series[s];
    final idx = spot.x.round().clamp(0, data.length - 1);
    final title = bucketText(data[idx].key, dim, widget.props.ctx);
    return LineTooltipItem(
      first ? '$title\n' : '',
      base.copyWith(fontWeight: FontWeight.w700),
      textAlign: TextAlign.left,
      children: tooltipRow(c, base, ser.colorIn(c, s), ser.label, '${spot.y.toStringAsFixed(2)}%'),
    );
  }
}
