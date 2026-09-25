import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_kit.dart';
import 'chart_props.dart';
import 'mini_table.dart';
import 'nice_axis.dart';

/// One bar of a sorted horizontal bar list.
class BarDatum {
  const BarDatum(this.key, this.label, this.value);
  final String key;
  final String label;
  final double value;
}

/// Cards show the top rows; maximizing shows all of them in a scrolling body.
const int kCardRows = 12;

/// Sorted horizontal bars (RunTimeByOperator, OkPctByOperator, OutputByItem,
/// RejectByReason). Drawn with widgets rather than a canvas chart so the
/// category labels never clip, every row is a real tap / long-press target
/// and the text follows the system font size. Same content as the web's
/// Recharts version: top [kCardRows] rows + "+N more", truncated labels,
/// value labels at the bar end, unselected bars dimmed to 0.28.
class HBars extends StatelessWidget {
  const HBars({
    super.key,
    required this.data,
    required this.colors,
    required this.color,
    required this.format,
    required this.selected,
    required this.onSelect,
    required this.expanded,
    required this.view,
    required this.dimLabel,
    required this.valueLabel,
    required this.emptyText,
  });

  final List<BarDatum> data;
  final DashboardColors colors;
  final Color color;

  /// 'qty' | 'pct' | 'hours' — picks the value / axis formatting.
  final String format;
  final List<String> selected;
  final void Function(String key)? onSelect;
  final bool expanded;
  final ChartView view;
  final String dimLabel;
  final String valueLabel;
  final String emptyText;

  String _axisText(double v) => eng.formats[format == 'pct' ? 'pct' : 'qty']!(v).replaceAll('.00%', '%');

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) return ChartEmpty(emptyText);
    if (view == ChartView.table) {
      return MiniTable(
        columns: [dimLabel, valueLabel],
        rows: [for (final d in data) MiniRow(d.key, [d.label, eng.formatExact(format, d.value)])],
        onRowClick: onSelect,
        selected: selected,
        colors: colors,
      );
    }
    return ChartTextScope(
      child: Material(
        type: MaterialType.transparency,
        child: LayoutBuilder(builder: (context, box) => _body(context, stageSize(box))),
      ),
    );
  }

  Widget _body(BuildContext context, Size size) {
    final scaler = MediaQuery.textScalerOf(context);
    final labelStyle = chartText(context, size: 11.5, color: colors.axis, tabular: false);
    final valueStyle = chartText(context, size: 11.5, color: colors.ink, weight: FontWeight.w600);
    final tickStyle = chartText(context, size: 10.5, color: colors.axis);
    final lineH = scaler.scale(11.5) * 1.2;
    final rowMin = math.max(22.0, lineH + 6);

    final maxV = data.fold<double>(0, (m, d) => math.max(m, d.value));
    final axis = format == 'pct' && maxV <= 1 ? fixedDomainAxis(0, 1, 4) : niceMaxAxis(maxV, 4);
    final hi = axis.hi > 0 ? axis.hi : 1.0;

    final tickTexts = [for (final t in axis.ticks) _axisText(t)];
    final tickH = scaler.scale(10.5) * 1.2 + 6;
    final axisH = expanded ? tickH : 0.0;

    // How many rows fit. Cards keep the top 12; maximize shows them all.
    late final int shown;
    late final double rowH;
    var footerH = 0.0;
    if (expanded) {
      shown = data.length;
      rowH = math.max(34.0, lineH + 16);
    } else {
      final note = scaler.scale(11) * 1.2 + 6;
      int fit(double h) => math.max(1, (h / rowMin).floor());
      var s = math.min(math.min(data.length, kCardRows), fit(size.height - axisH));
      if (data.length > s) {
        footerH = note;
        s = math.min(s, fit(size.height - axisH - footerH));
      }
      shown = s;
      rowH = math.min(40.0, (size.height - axisH - footerH) / shown);
    }
    final hidden = data.length - shown;

    final valueTexts = [for (var i = 0; i < shown; i++) eng.formats[format]!(data[i].value)];
    final labelTexts = [for (var i = 0; i < shown; i++) truncateLabel(data[i].label, 20)];
    final labelW = (maxTextWidth(labelTexts, labelStyle.copyWith(fontWeight: FontWeight.w700), scaler) + 2)
        .clamp(56.0, math.max(56.0, math.min(150.0, size.width * 0.42)))
      .toDouble();
    final valueW = maxTextWidth(valueTexts, valueStyle, scaler) + 8;
    const gap = 8.0;
    final barAreaW = math.max(24.0, size.width - labelW - gap - valueW - 6);
    final barH = math.min(18.0, rowH * 0.62);

    Widget row(int i) {
      final d = data[i];
      final isSel = selected.contains(d.key);
      final opacity = markOpacity(selected, d.key);
      final frac = (d.value / hi).clamp(0.0, 1.0);
      final barW = frac * barAreaW;
      final exact = eng.formatExact(format, d.value);
      final content = SizedBox(
        height: rowH,
        child: Row(
          children: [
            SizedBox(
              width: labelW,
              child: Text(
                labelTexts.length > i ? labelTexts[i] : truncateLabel(d.label, 20),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: isSel ? labelStyle.copyWith(color: colors.ink, fontWeight: FontWeight.w700) : labelStyle,
              ),
            ),
            const SizedBox(width: gap),
            SizedBox(
              width: barAreaW + 6 + valueW,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned(
                    left: 0,
                    top: (rowH - barH) / 2,
                    width: barAreaW,
                    height: barH,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.grid.withValues(alpha: 0.55),
                        borderRadius: const BorderRadius.horizontal(right: Radius.circular(4)),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 0,
                    top: (rowH - barH) / 2,
                    width: barW,
                    height: barH,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: color.withValues(alpha: opacity),
                        borderRadius: const BorderRadius.horizontal(right: Radius.circular(4)),
                      ),
                    ),
                  ),
                  Positioned(
                    left: barW + 6,
                    top: 0,
                    bottom: 0,
                    child: Center(
                      child: Text(
                        i < valueTexts.length ? valueTexts[i] : eng.formats[format]!(d.value),
                        maxLines: 1,
                        style: valueStyle.copyWith(color: colors.ink.withValues(alpha: math.max(opacity, 0.6))),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
      final tapped = onSelect == null
          ? content
          : InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: () {
                chartHaptic();
                onSelect!(d.key);
              },
              child: content,
            );
      return ChartPressTip(
        message: '${d.label}\n$valueLabel: $exact',
        colors: colors,
        child: Semantics(
          button: onSelect != null,
          selected: isSel,
          label: '${d.label}, $valueLabel $exact',
          excludeSemantics: true,
          onTap: onSelect == null ? null : () => onSelect!(d.key),
          child: tapped,
        ),
      );
    }

    final list = expanded
        ? ListView.builder(
            padding: EdgeInsets.zero,
            itemExtent: rowH,
            itemCount: shown,
            itemBuilder: (context, i) => row(i),
          )
        : Column(children: [for (var i = 0; i < shown; i++) row(i)]);

    final gridLeft = labelW + gap;
    Widget stack = list;
    if (expanded) {
      stack = Stack(
        children: [
          Positioned.fill(
            left: gridLeft,
            right: valueW + 6,
            child: CustomPaint(painter: _GridPainter(axis.ticks.map((t) => t / hi).toList(), colors.grid)),
          ),
          Positioned.fill(child: list),
        ],
      );
    }

    return Semantics(
      container: true,
      label: '$valueLabel by $dimLabel, ${data.length} bars',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: expanded ? stack : Align(alignment: Alignment.topCenter, child: stack)),
          if (expanded)
            SizedBox(
              height: tickH,
              child: Padding(
                padding: EdgeInsets.only(left: gridLeft),
                child: LayoutBuilder(
                  builder: (context, tb) {
                    final w = barAreaW;
                    return Stack(
                      clipBehavior: Clip.none,
                      children: [
                        for (var i = 0; i < axis.ticks.length; i++)
                          Positioned(
                            left: (axis.ticks[i] / hi) * w - 30,
                            width: 60,
                            top: 4,
                            child: Text(tickTexts[i], textAlign: TextAlign.center, maxLines: 1, style: tickStyle),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
          if (hidden > 0)
            SizedBox(
              height: footerH,
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Text(
                  '+$hidden more — maximize to see all',
                  style: chartText(context, size: 11, color: Theme.of(context).colorScheme.onSurfaceVariant, tabular: false),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter(this.fractions, this.color);
  final List<double> fractions;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = color
      ..strokeWidth = 1;
    for (final f in fractions) {
      final x = (f * size.width).roundToDouble() + 0.5;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), p);
    }
  }

  @override
  bool shouldRepaint(_GridPainter old) => old.color != color || old.fractions.length != fractions.length;
}
