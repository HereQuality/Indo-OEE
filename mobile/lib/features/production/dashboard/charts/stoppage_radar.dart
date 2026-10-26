import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'hbars.dart';
import 'mini_table.dart';
import 'nice_axis.dart';
import 'stoppage_treemap.dart' show TileTipLayout;

/// Downtime by Cause (min) (charts.jsx `RunTimeByMachine`): every stoppage
/// cause on one radar - a spoke per cause, the further out the more minutes
/// lost (every cause, PRINTING's own three included, none folded into "Other"). The table view adds each
/// machine's split with its effective run time beside it. Touch a spoke's dot
/// (or its label) for the exact minutes.
class StoppageRadarChart extends StatefulWidget {
  const StoppageRadarChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<StoppageRadarChart> createState() => _StoppageRadarChartState();
}

class _StoppageRadarChartState extends State<StoppageRadarChart> {
  final _memo = DataMemo<List<BarDatum>>();
  final _machineMemo = DataMemo<List<SummaryRow>>();
  int? _picked;

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final c = p.colors;
    final rows = p.rowsFor('machine');
    if (p.view == ChartView.table) {
      final machines = _machineMemo.get(rows, p.ctx, 'machine', () => machineSummaryRows(rows, p.ctx));
      if (machines.isEmpty) return const ChartEmpty('No entries for this period.');
      // The causes this process's sheet has, plus any other carrying minutes
      // (charts.jsx `causeColumns`) — PRINTING's own three among them.
      final causeCols = causeColumns(p.ctx, [for (final g in machines) g.summary]);
      return MiniTable(
        columns: [p.ctx.words.one, 'Effective Run Time', for (final f in causeCols) '${eng.causeLabel(f['key'] as String, p.ctx.causeLabels)} (min)'],
        selected: p.filters['machine'] ?? const <String>[],
        onRowClick: (k) => p.onToggle('machine', k),
        rows: [
          for (final g in machines)
            MiniRow(g.key, [
              g.label,
              eng.formatExact('hours', pick(g.summary, 'effectiveHours')),
              for (final f in causeCols) eng.formatExact('qty', _cause(g.summary, f['key'] as String)),
            ]),
        ],
        colors: c,
      );
    }
    final causes = _memo.get(rows, p.ctx, 'machine', () => stoppageCauses(rows, p.ctx));
    // A radar needs at least three spokes; with fewer causes the bars read better.
    if (causes.length < 3) {
      return HBars(
        data: causes,
        colors: c,
        color: c.downtime,
        format: 'minutes',
        selected: const [],
        onSelect: null,
        expanded: p.expanded,
        view: ChartView.chart,
        dimLabel: 'Stoppage',
        valueLabel: 'Time lost',
        emptyText: 'No stoppage recorded.',
      );
    }
    if (_picked != null && _picked! >= causes.length) _picked = null;
    return ChartTextScope(
      child: Semantics(
        container: true,
        label: 'Stoppages by cause, ${causes.length} causes: ${[
          for (final d in causes) '${d.label} ${eng.formatExact('minutes', d.value)}',
        ].join(', ')}',
        child: _RadarPlot(
          causes: causes,
          colors: c,
          picked: _picked,
          onPick: (i) => setState(() => _picked = i == _picked ? null : i),
        ),
      ),
    );
  }

  static double _cause(Map<String, dynamic> summary, String key) {
    final by = summary['downtimeByCause'];
    return by is Map && by[key] is num ? (by[key] as num).toDouble() : 0.0;
  }
}

class _RadarPlot extends StatelessWidget {
  const _RadarPlot({required this.causes, required this.colors, required this.picked, required this.onPick});
  final List<BarDatum> causes;
  final DashboardColors colors;
  final int? picked;
  final void Function(int? index) onPick;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final size = stageSize(box);
      final scaler = MediaQuery.textScalerOf(context);
      final nameStyle = chartText(context, size: 11, color: colors.axis, tabular: false);
      final valueStyle = chartText(context, size: 11, color: colors.muted);
      final geometry = _RadarGeometry(
        size: size,
        causes: causes,
        scaler: scaler,
        nameStyle: nameStyle,
        valueStyle: valueStyle,
      );
      final pick = picked == null ? null : geometry.dot(picked!);
      return SizedBox(
        width: size.width,
        height: size.height,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapUp: (d) => onPick(geometry.nearest(d.localPosition)),
          onLongPressStart: (d) => onPick(geometry.nearest(d.localPosition)),
          child: Stack(
            children: [
              Positioned.fill(
                child: CustomPaint(
                  painter: _RadarPainter(geometry: geometry, colors: colors, picked: picked),
                ),
              ),
              if (pick != null)
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomSingleChildLayout(
                      delegate: TileTipLayout(Rect.fromCenter(center: pick, width: 8, height: 8)),
                      child: ChartTooltipCard(
                        colors: colors,
                        title: causes[picked!].label,
                        lines: [TooltipLine('Time lost', color: colors.downtime, value: eng.formatExact('minutes', causes[picked!].value))],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    });
  }
}

/// Where everything of one radar sits. Spokes start at the top and run
/// clockwise, like Recharts' RadarChart.
class _RadarGeometry {
  _RadarGeometry({
    required this.size,
    required this.causes,
    required this.scaler,
    required this.nameStyle,
    required this.valueStyle,
  }) {
    final n = causes.length;
    final maxValue = causes.fold<double>(0, (m, d) => math.max(m, d.value));
    axis = niceMaxAxis(maxValue, 4);
    labels = [for (final d in causes) truncateLabel(d.label, 16)];
    valueTexts = [for (final d in causes) eng.formats['minutes']!(d.value)];
    final labelW = math.min(
      86.0,
      math.max(
        maxTextWidth(labels, nameStyle, scaler),
        maxTextWidth(valueTexts, valueStyle, scaler),
      ),
    );
    final lineH = scaler.scale(11) * 1.2;
    center = size.center(Offset.zero);
    // Leave room for the widest label sideways and two label lines above and below.
    radius = math.max(24.0, math.min(size.width / 2 - labelW - 8, size.height / 2 - 2 * lineH - 8));
    angles = [for (var i = 0; i < n; i++) -math.pi / 2 + 2 * math.pi * i / n];
    this.labelW = labelW;
    this.lineH = lineH;
  }

  final Size size;
  final List<BarDatum> causes;
  final TextScaler scaler;
  final TextStyle nameStyle;
  final TextStyle valueStyle;
  late final NiceAxis axis;
  late final List<String> labels;
  late final List<String> valueTexts;
  late final Offset center;
  late final double radius;
  late final List<double> angles;
  late final double labelW;
  late final double lineH;

  Offset at(int i, double r) => center + Offset(math.cos(angles[i]), math.sin(angles[i])) * r;

  /// The dot of spoke [i].
  Offset dot(int i) => at(i, radius * (causes[i].value / axis.hi).clamp(0.0, 1.0));

  /// The spoke whose dot or label is closest to [p] (null when nothing is near).
  int? nearest(Offset p) {
    int? best;
    var bestD = double.infinity;
    for (var i = 0; i < causes.length; i++) {
      final d = math.min((dot(i) - p).distance, (at(i, radius + 16) - p).distance);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= 40 ? best : null;
  }
}

class _RadarPainter extends CustomPainter {
  _RadarPainter({required this.geometry, required this.colors, required this.picked});
  final _RadarGeometry geometry;
  final DashboardColors colors;
  final int? picked;

  @override
  void paint(Canvas canvas, Size size) {
    final g = geometry;
    final n = g.causes.length;
    final grid = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = colors.grid;
    // Rings (a polygon per axis tick) and the spokes.
    for (final t in g.axis.ticks) {
      if (t <= 0) continue;
      final r = g.radius * t / g.axis.hi;
      final path = Path()..moveTo(g.at(0, r).dx, g.at(0, r).dy);
      for (var i = 1; i < n; i++) {
        path.lineTo(g.at(i, r).dx, g.at(i, r).dy);
      }
      canvas.drawPath(path..close(), grid);
    }
    for (var i = 0; i < n; i++) {
      canvas.drawLine(g.center, g.at(i, g.radius), grid);
    }
    // The shape: downtime colour at 30% fill, 2px edge, a dot per spoke.
    final shape = Path()..moveTo(g.dot(0).dx, g.dot(0).dy);
    for (var i = 1; i < n; i++) {
      shape.lineTo(g.dot(i).dx, g.dot(i).dy);
    }
    shape.close();
    canvas.drawPath(shape, Paint()..color = colors.downtime.withValues(alpha: 0.3));
    canvas.drawPath(
      shape,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..color = colors.downtime,
    );
    for (var i = 0; i < n; i++) {
      canvas.drawCircle(g.dot(i), i == picked ? 5 : 3, Paint()..color = colors.downtime);
      if (i == picked) {
        canvas.drawCircle(
          g.dot(i),
          5,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..color = colors.surface,
        );
      }
    }
    // Spoke labels: the cause, with its minutes under it.
    for (var i = 0; i < n; i++) {
      final cos = math.cos(g.angles[i]);
      final name = _paragraph(g.labels[i], g.nameStyle, g.labelW);
      final value = _paragraph(g.valueTexts[i], g.valueStyle, g.labelW);
      final anchor = g.at(i, g.radius + 10);
      final blockH = name.height + value.height;
      final double x;
      if (cos > 0.01) {
        x = anchor.dx;
      } else if (cos < -0.01) {
        x = anchor.dx - math.max(name.width, value.width);
      } else {
        x = anchor.dx - math.max(name.width, value.width) / 2;
      }
      final sin = math.sin(g.angles[i]);
      // Above the dot for the top spoke, below for the bottom one, centred on the sides.
      final y = sin < -0.9 ? anchor.dy - blockH : (sin > 0.9 ? anchor.dy : anchor.dy - blockH / 2);
      final cx = x.clamp(0.0, math.max(0.0, g.size.width - math.max(name.width, value.width))).toDouble();
      name.paint(canvas, Offset(cx, y));
      value.paint(canvas, Offset(cx, y + name.height));
      name.dispose();
      value.dispose();
    }
  }

  TextPainter _paragraph(String text, TextStyle style, double maxWidth) => TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: TextDirection.ltr,
        textScaler: geometry.scaler,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: math.max(0, maxWidth));

  @override
  bool shouldRepaint(_RadarPainter old) =>
      old.picked != picked ||
      old.colors != colors ||
      old.geometry.size != geometry.size ||
      old.geometry.scaler != geometry.scaler ||
      old.geometry.causes.length != geometry.causes.length ||
      !_sameValues(old.geometry.causes);

  bool _sameValues(List<BarDatum> other) {
    for (var i = 0; i < other.length; i++) {
      if (other[i].key != geometry.causes[i].key || other[i].value != geometry.causes[i].value) return false;
    }
    return true;
  }
}
