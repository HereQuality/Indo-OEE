import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'bar_series_chart.dart';
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'mini_table.dart';
import 'nice_axis.dart';

/// Up to this many machines the panels split the card between them; past it
/// they go into a scrolling grid of small fixed-height panels.
const int kFitPanels = 6;

/// Rows x columns of the fit layout, or null when the panels would be too
/// small (they then scroll). On a wide stage this is exactly the web's rule:
/// 1-3 machines = that many equal columns filling the stage, 4-6 = 3 x 2.
/// A phone is too narrow for three side-by-side charts, so there the grid is
/// whichever of 1, 2 or 3 columns gives panels closest to a wide, readable
/// shape (time series want width, not height).
({int cols, int rows})? fitGrid(int n, double w, double h, {double gap = 12}) {
  const minW = 130.0;
  const minH = 96.0;
  ({double pw, double ph}) panel(int cols) {
    final rows = (n / cols).ceil();
    return (pw: (w - gap * (cols - 1)) / cols, ph: (h - gap * (rows - 1)) / rows);
  }

  final spec = math.min(n, 3);
  final s = panel(spec);
  if (s.pw >= 150 && s.ph >= minH) return (cols: spec, rows: (n / spec).ceil());

  ({int cols, int rows})? best;
  var bestScore = double.infinity;
  for (var cols = 1; cols <= math.min(n, 3); cols++) {
    final p = panel(cols);
    if (p.pw < minW || p.ph < minH) continue;
    final score = (math.log(p.pw / p.ph / 1.7)).abs();
    if (score < bestScore) {
      bestScore = score;
      best = (cols: cols, rows: (n / cols).ceil());
    }
  }
  return best;
}

/// Unreported Time (min) by MC No.: one small chart per machine, all on one
/// shared "nice" scale so the panels compare honestly.
class UnreportedByMachineChart extends StatefulWidget {
  const UnreportedByMachineChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<UnreportedByMachineChart> createState() => _UnreportedByMachineChartState();
}

class _UnreportedByMachineChartState extends State<UnreportedByMachineChart> {
  final _memo = DataMemo<List<MachinePanel>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final dim = p.ctx.bucket;
    final rows = p.rowsFor(null);
    final panels = _memo.get(rows, p.ctx, dim, () => unreportedPanels(rows, dim, p.ctx));
    if (panels.isEmpty) return const ChartEmpty('Needs machine ON/OFF times.');
    final selected = p.filters['machine'] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: const ['Machine', 'Unreported time'],
        rows: [for (final m in panels) MiniRow(m.key, [m.label, eng.formatExact('minutes', m.total)])],
        selected: selected,
        onRowClick: (k) => p.onToggle('machine', k),
        colors: p.colors,
      );
    }
    return ChartTextScope(
      child: LayoutBuilder(builder: (context, box) => _panels(context, stageSize(box), panels, dim)),
    );
  }

  Widget _panels(BuildContext context, Size size, List<MachinePanel> panels, String dim) {
    final p = widget.props;
    final n = panels.length;
    final fit = n <= kFitPanels ? fitGrid(n, size.width, size.height) : null;
    var lo = 0.0;
    var hi = 0.0;
    for (final m in panels) {
      for (final pt in m.points) {
        lo = math.min(lo, pt.$2);
        hi = math.max(hi, pt.$2);
      }
    }
    final axis = niceAxis(lo, hi, n <= kFitPanels ? 3 : 2);
    const gap = 12.0;

    if (fit != null) {
      final panelW = (size.width - gap * (fit.cols - 1)) / fit.cols;
      final roomy = panelW >= 210;
      return Column(
        children: [
          for (var r = 0; r < fit.rows; r++) ...[
            if (r > 0) const SizedBox(height: gap),
            Expanded(
              child: Row(
                children: [
                  for (var col = 0; col < fit.cols; col++) ...[
                    if (col > 0) const SizedBox(width: gap),
                    Expanded(
                      child: r * fit.cols + col < n
                          ? _panel(context, panels[r * fit.cols + col], axis, dim, roomy: roomy, maxBar: roomy ? 36 : 28, fill: true)
                          : const SizedBox.shrink(),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      );
    }

    // Many machines: fixed-height panels in a scrolling grid.
    final minPanel = 150.0;
    final cols = math.max(1, ((size.width + gap) / (minPanel + gap)).floor());
    final scaler = MediaQuery.textScalerOf(context);
    final titleH = math.max(30.0, scaler.scale(12) * 1.2 + 14);
    final plotH = p.expanded ? 176.0 : 116.0;
    final panelW = (size.width - gap * (cols - 1)) / cols;
    return GridView.builder(
      padding: const EdgeInsets.only(bottom: 4),
      physics: const ClampingScrollPhysics(),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: cols,
        mainAxisExtent: titleH + plotH,
        mainAxisSpacing: 8,
        crossAxisSpacing: gap,
      ),
      itemCount: n,
      itemBuilder: (context, i) => _panel(context, panels[i], axis, dim, roomy: panelW >= 210, maxBar: 14, fill: true),
    );
  }

  Widget _panel(BuildContext context, MachinePanel m, NiceAxis axis, String dim,
      {required bool roomy, required double maxBar, required bool fill}) {
    final p = widget.props;
    final c = p.colors;
    final cs = Theme.of(context).colorScheme;
    final points = [for (final pt in m.points) TimePoint(pt.$1, pt.$1, [pt.$2])];
    String tick(TimePoint t) =>
        dim == 'date' ? (roomy ? '${jsSlice(t.key, 8)}/${jsSlice(t.key, 5, 7)}' : jsSlice(t.key, 8)) : jsSlice(eng.monthLabel(t.key), 0, 3);
    final titleStyle = chartText(context, size: 12, color: c.ink, weight: FontWeight.w700, tabular: false);
    final totalStyle = chartText(context, size: 12, color: cs.onSurfaceVariant, tabular: true);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          button: true,
          label: 'Filter the dashboard to ${m.label}',
          excludeSemantics: true,
          onTap: () => p.onToggle('machine', m.key),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(6),
              onTap: () {
                chartHaptic();
                p.onToggle('machine', m.key);
              },
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 30),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text.rich(
                    TextSpan(children: [
                      TextSpan(text: m.label, style: titleStyle),
                      TextSpan(text: ' · ${eng.formats['minutes']!(m.total)}', style: totalStyle),
                    ]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ),
          ),
        ),
        Expanded(
          child: BarSeriesChart(
            points: points,
            colors: c,
            seriesColors: [c.ok],
            seriesNames: const ['Unreported'],
            title: (t) => bucketText(t.key, dim, p.ctx),
            xTick: tick,
            yText: tickText,
            valueText: (v) => eng.formatExact('minutes', v),
            opacityOf: (_) => 1,
            axis: axis,
            stacked: false,
            maxBar: maxBar,
            compact: true,
            zeroLine: true,
            tickGap: roomy ? 16 : 12,
            topPad: 6,
            rightPad: 8,
            semanticLabel: 'Unreported time, ${m.label}',
          ),
        ),
      ],
    );
  }
}
