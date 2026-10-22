import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'oee_trend_chart.dart';

const String _apqEmpty = "Needs machine ON/OFF times, Planned Operator Shift, a part's cycle time and quantities.";

/// The red the web marks an over-100% figure with (an entry held for Admin review).
const Color kOverHundred = Color(0xFFE34948);

/// Availability - Performance - Quality for the period as three concentric
/// rings (a full ring is 100%), with the exact figures beside them (charts.jsx
/// `ApqRings`). A figure over 100% fills its ring and is marked - that is an
/// entry held for Admin review. The table view keeps the by-date numbers.
class ApqRingsChart extends StatefulWidget {
  const ApqRingsChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<ApqRingsChart> createState() => _ApqRingsChartState();
}

class _ApqRingsChartState extends State<ApqRingsChart> {
  final _memo = DataMemo<Map<String, dynamic>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    if (p.view == ChartView.table) {
      return PctTrendChart(
        props: p,
        series: apqSeries,
        emptyText: _apqEmpty,
        semanticName: 'Availability, performance and quality over time',
        ceiling: true,
      );
    }
    final c = p.colors;
    final rows = p.rowsFor(null);
    final sum = _memo.get(rows, p.ctx, null, () => eng.summarize(rows));
    final items = [
      for (var i = 0; i < apqSeries.length; i++)
        _Ring(apqSeries[i].label, c.series[i], pct100(sum[apqSeries[i].key])),
    ];
    if (items.every((d) => d.value == null)) return const ChartEmpty(_apqEmpty);

    return ChartTextScope(
      child: Semantics(
        container: true,
        label: 'Availability, performance and quality: ${[
          for (final d in items) '${d.label} ${d.value == null ? 'no figure' : '${d.value!.toStringAsFixed(1)}%'}',
        ].join(', ')}',
        child: LayoutBuilder(builder: (context, box) {
          final size = stageSize(box);
          final scale = MediaQuery.textScalerOf(context).scale(1);
          // Rings beside the figures when there is room, above them otherwise.
          final sideBySide = size.width >= 360 && scale <= 1.15;
          final rings = _Rings(items: items, colors: c);
          final figures = _Figures(items: items, colors: c);
          if (sideBySide) {
            return Row(
              children: [
                Expanded(flex: 5, child: Center(child: rings)),
                const SizedBox(width: 12),
                Expanded(flex: 6, child: Center(child: SingleChildScrollView(child: figures))),
              ],
            );
          }
          return Column(
            children: [
              Expanded(flex: 5, child: Center(child: rings)),
              Expanded(flex: 6, child: SingleChildScrollView(child: figures)),
            ],
          );
        }),
      ),
    );
  }
}

class _Ring {
  const _Ring(this.label, this.color, this.value);
  final String label;
  final Color color;

  /// Percent (0-100+) or null when the period has no figure.
  final double? value;
}

class _Rings extends StatelessWidget {
  const _Rings({required this.items, required this.colors});
  final List<_Ring> items;
  final DashboardColors colors;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        final side = math.min(box.hasBoundedWidth ? box.maxWidth : 200.0, box.hasBoundedHeight ? box.maxHeight : 200.0);
        return SizedBox.square(
          dimension: math.max(60.0, math.min(side, 260.0)),
          child: ExcludeSemantics(child: CustomPaint(painter: _RingsPainter(items: items, track: colors.grid))),
        );
      });
}

class _RingsPainter extends CustomPainter {
  _RingsPainter({required this.items, required this.track});
  final List<_Ring> items;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final outer = math.min(size.width, size.height) / 2;
    final inner = outer * 0.28;
    final n = items.length;
    final band = (outer - inner) / n;
    final thick = math.min(16.0, band * 0.68);
    // The web draws the first item innermost; the figures list reads
    // Availability first, so it is the outermost ring.
    for (var i = 0; i < n; i++) {
      final item = items[n - 1 - i];
      final r = inner + band * (i + 0.5);
      final rect = Rect.fromCircle(center: center, radius: r);
      canvas.drawCircle(
        center,
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = thick
          ..color = track,
      );
      final v = (item.value ?? 0).clamp(0.0, 100.0);
      if (v <= 0) continue;
      canvas.drawArc(
        rect,
        -math.pi / 2,
        2 * math.pi * v / 100,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = thick
          ..strokeCap = StrokeCap.round
          ..color = item.color,
      );
    }
  }

  @override
  bool shouldRepaint(_RingsPainter old) => old.track != track || old.items.length != items.length || _differs(old.items);

  bool _differs(List<_Ring> other) {
    for (var i = 0; i < items.length; i++) {
      if (other[i].value != items[i].value || other[i].color != items[i].color) return true;
    }
    return false;
  }
}

class _Figures extends StatelessWidget {
  const _Figures({required this.items, required this.colors});
  final List<_Ring> items;
  final DashboardColors colors;

  @override
  Widget build(BuildContext context) {
    final label = chartText(context, size: 13, color: colors.axis, tabular: false);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final d in items)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(border: Border(bottom: BorderSide(color: colors.grid))),
            child: Row(
              children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: d.color, borderRadius: BorderRadius.circular(3))),
                const SizedBox(width: 8),
                Flexible(flex: 2, child: Text(d.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: label)),
                const Spacer(),
                const SizedBox(width: 8),
                // Absurd entries (millions of percent) shrink instead of overflowing.
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      d.value == null ? '—' : '${d.value!.toStringAsFixed(1)}%${_over(d) ? ' ▲' : ''}',
                      maxLines: 1,
                      style: chartText(context, size: 18, color: _over(d) ? kOverHundred : colors.ink, weight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ),
          ),
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text(
            'A full ring is 100%. ▲ = over 100%, held for Admin review.',
            style: chartText(context, size: 12, color: colors.muted, tabular: false).copyWith(height: 1.3),
          ),
        ),
      ],
    );
  }

  bool _over(_Ring d) => d.value != null && d.value! > 100 + 1e-9;
}
