import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'hbars.dart' show BarDatum;
import 'mini_table.dart';
import 'stoppage_treemap.dart' show TileTipLayout;

/// Rejection by Reason (Qty) (charts.jsx `RejectByReason`): a donut with the total
/// in its hole and a list of reasons beside it. A reason is not a dashboard
/// dimension, so tapping a slice or a row opens that reason's drill-down
/// instead of cross-filtering. Press and hold a slice for its share.
class RejectByReasonChart extends StatefulWidget {
  const RejectByReasonChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<RejectByReasonChart> createState() => _RejectByReasonChartState();
}

class _RejectByReasonChartState extends State<RejectByReasonChart> {
  final _memo = DataMemo<List<BarDatum>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final c = p.colors;
    final rows = p.rowsFor(null);
    final data = _memo.get(rows, p.ctx, null, () => rejectReasons(rows));
    if (data.isEmpty) return const ChartEmpty('Nothing rejected in this period.');
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: const ['Reason', 'Rejected'],
        rows: [for (final d in data) MiniRow(d.key, [d.label, eng.formatExact('qty', d.value)])],
        onRowClick: (k) => p.onDrill(eng.reasonMeasure(k)),
        colors: c,
      );
    }
    final total = data.fold<double>(0, (s, d) => s + d.value);
    return ChartTextScope(
      child: Semantics(
        container: true,
        label: 'Rejected quantity by reason, ${data.length} reasons, ${eng.formatExact('qty', total)} in all',
        child: LayoutBuilder(builder: (context, box) {
          final size = stageSize(box);
          final sideBySide = size.width >= 360 && MediaQuery.textScalerOf(context).scale(1) <= 1.15;
          final donut = _Donut(data: data, total: total, colors: c, onPick: (k) => p.onDrill(eng.reasonMeasure(k)));
          final list = _ReasonList(data: data, colors: c, onPick: (k) => p.onDrill(eng.reasonMeasure(k)));
          if (sideBySide) {
            return Row(
              children: [
                Expanded(flex: 5, child: Center(child: donut)),
                const SizedBox(width: 12),
                Expanded(flex: 6, child: list),
              ],
            );
          }
          return Column(
            children: [
              Expanded(flex: 5, child: Center(child: donut)),
              Expanded(flex: 6, child: list),
            ],
          );
        }),
      ),
    );
  }
}

class _Donut extends StatefulWidget {
  const _Donut({required this.data, required this.total, required this.colors, required this.onPick});
  final List<BarDatum> data;
  final double total;
  final DashboardColors colors;
  final void Function(String key) onPick;

  @override
  State<_Donut> createState() => _DonutState();
}

class _DonutState extends State<_Donut> {
  int? _pressed;

  @override
  Widget build(BuildContext context) {
    final c = widget.colors;
    return LayoutBuilder(builder: (context, box) {
      final side = math.max(
        60.0,
        math.min(math.min(box.hasBoundedWidth ? box.maxWidth : 200.0, box.hasBoundedHeight ? box.maxHeight : 200.0), 260.0),
      );
      final geo = _DonutGeometry(widget.data, side);
      return SizedBox.square(
        dimension: side,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapUp: (d) {
            final i = geo.sliceAt(d.localPosition);
            if (i != null) {
              chartHaptic();
              widget.onPick(widget.data[i].key);
            }
          },
          onLongPressStart: (d) => setState(() => _pressed = geo.sliceAt(d.localPosition)),
          onLongPressMoveUpdate: (d) {
            final i = geo.sliceAt(d.localPosition);
            if (i != _pressed) setState(() => _pressed = i);
          },
          onLongPressEnd: (_) => setState(() => _pressed = null),
          onLongPressCancel: () => setState(() => _pressed = null),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Positioned.fill(
                child: ExcludeSemantics(
                  child: CustomPaint(painter: _DonutPainter(geometry: geo, gap: chartSurface(context), pressed: _pressed)),
                ),
              ),
              IgnorePointer(
                child: Padding(
                  padding: EdgeInsets.all(side * 0.22),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          eng.formatExact('qty', widget.total),
                          maxLines: 1,
                          style: chartText(context, size: 20, color: c.ink, weight: FontWeight.w700),
                        ),
                        Text('rejected', style: chartText(context, size: 11, color: c.muted, tabular: false)),
                      ],
                    ),
                  ),
                ),
              ),
              if (_pressed != null && _pressed! < widget.data.length)
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomSingleChildLayout(
                      delegate: TileTipLayout(Rect.fromCenter(center: geo.middleOf(_pressed!), width: 8, height: 8)),
                      child: ChartTooltipCard(
                        colors: c,
                        title: widget.data[_pressed!].label,
                        lines: [
                          TooltipLine(
                            eng.formatExact('qty', widget.data[_pressed!].value),
                            color: machineHues[_pressed! % machineHues.length],
                            value: '${(widget.data[_pressed!].value / widget.total * 100).toStringAsFixed(1)}%',
                          ),
                        ],
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

/// Slice angles of the donut: from the top, clockwise, 2 degrees apart.
class _DonutGeometry {
  _DonutGeometry(this.data, this.side) {
    final total = data.fold<double>(0, (s, d) => s + d.value);
    final pad = data.length > 1 ? 2 * math.pi / 180 : 0.0;
    var at = -math.pi / 2;
    for (final d in data) {
      final sweep = total > 0 ? 2 * math.pi * d.value / total : 0.0;
      starts.add(at + pad / 2);
      sweeps.add(math.max(0.0, sweep - pad));
      at += sweep;
    }
  }

  final List<BarDatum> data;
  final double side;
  final List<double> starts = [];
  final List<double> sweeps = [];

  Offset get center => Offset(side / 2, side / 2);
  double get outer => side / 2 * 0.92;
  double get inner => side / 2 * 0.58;

  Offset middleOf(int i) {
    final a = starts[i] + sweeps[i] / 2;
    final r = (inner + outer) / 2;
    return center + Offset(math.cos(a), math.sin(a)) * r;
  }

  int? sliceAt(Offset p) {
    final d = p - center;
    final r = d.distance;
    if (r < inner - 4 || r > outer + 6) return null;
    var a = math.atan2(d.dy, d.dx);
    for (var i = 0; i < starts.length; i++) {
      // Compare modulo a full turn, from the slice's start.
      var rel = (a - starts[i]) % (2 * math.pi);
      if (rel < 0) rel += 2 * math.pi;
      if (rel <= sweeps[i] + 0.02) return i;
    }
    return null;
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter({required this.geometry, required this.gap, required this.pressed});
  final _DonutGeometry geometry;
  final Color gap;
  final int? pressed;

  @override
  void paint(Canvas canvas, Size size) {
    final g = geometry;
    final mid = (g.inner + g.outer) / 2;
    final thick = g.outer - g.inner;
    final rect = Rect.fromCircle(center: g.center, radius: mid);
    for (var i = 0; i < g.starts.length; i++) {
      if (g.sweeps[i] <= 0) continue;
      final hue = machineHues[i % machineHues.length];
      canvas.drawArc(
        rect,
        g.starts[i],
        g.sweeps[i],
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = pressed == i ? thick + 6 : thick
          ..color = hue,
      );
    }
    // The 2px card-colour edge the web draws around every slice.
    final edge = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = gap;
    for (var i = 0; i < g.starts.length; i++) {
      if (g.sweeps[i] <= 0) continue;
      for (final r in [g.inner, g.outer]) {
        canvas.drawArc(Rect.fromCircle(center: g.center, radius: r), g.starts[i], g.sweeps[i], false, edge);
      }
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.pressed != pressed || old.gap != gap || old.geometry.data != geometry.data || old.geometry.side != geometry.side;
}

class _ReasonList extends StatelessWidget {
  const _ReasonList({required this.data, required this.colors, required this.onPick});
  final List<BarDatum> data;
  final DashboardColors colors;
  final void Function(String key) onPick;

  @override
  Widget build(BuildContext context) {
    final label = chartText(context, size: 12.5, color: colors.axis, tabular: false);
    final value = chartText(context, size: 12.5, color: colors.ink, weight: FontWeight.w700);
    return Material(
      type: MaterialType.transparency,
      child: ListView.builder(
        padding: EdgeInsets.zero,
        itemCount: data.length,
        itemBuilder: (context, i) {
          final d = data[i];
          final exact = eng.formatExact('qty', d.value);
          return Semantics(
            button: true,
            label: '${d.label}, rejected $exact. Opens the breakdown.',
            excludeSemantics: true,
            onTap: () => onPick(d.key),
            child: InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: () {
                chartHaptic();
                onPick(d.key);
              },
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 36),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
                  child: Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(color: machineHues[i % machineHues.length], borderRadius: BorderRadius.circular(3)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Text(d.label, maxLines: 2, overflow: TextOverflow.ellipsis, style: label)),
                      const SizedBox(width: 8),
                      Flexible(
                        child: FittedBox(fit: BoxFit.scaleDown, child: Text(exact, maxLines: 1, style: value)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
