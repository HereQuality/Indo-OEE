import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'bar_series_chart.dart';
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'mini_table.dart';
import 'nice_axis.dart';

/// OEE by MC No.: one bar per machine (sheet order), % above each bar.
class OeeByMachineChart extends StatefulWidget {
  const OeeByMachineChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<OeeByMachineChart> createState() => _OeeByMachineChartState();
}

class _OeeByMachineChartState extends State<OeeByMachineChart> {
  final _memo = DataMemo<List<TimePoint>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final c = p.colors;
    final rows = p.rowsFor('machine');
    final data = _memo.get(rows, p.ctx, 'machine', () => [
          for (final d in dimBars(rows, 'machine', p.ctx, (s) => pct100(s['oeeLosses']), sort: 'machine', positiveOnly: false))
            TimePoint(d.key, d.label, [d.value]),
        ]);
    if (data.isEmpty) return const ChartEmpty('Needs machine ON/OFF times and OK quantity.');
    final selected = p.filters['machine'] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: const ['Machine', 'OEE considering losses'],
        rows: [for (final d in data) MiniRow(d.key, [d.label, '${d.values.first!.toStringAsFixed(2)}%'])],
        selected: selected,
        onRowClick: (k) => p.onToggle('machine', k),
        colors: c,
      );
    }
    return BarSeriesChart(
      points: data,
      colors: c,
      seriesColors: [c.ok],
      seriesNames: const ['OEE'],
      title: (d) => d.label,
      xTick: (d) => truncateLabel(d.label, 10),
      yText: (v) => '${tickText(v)}%',
      valueText: (v) => '${v.toStringAsFixed(2)}%',
      topLabel: (v) => '${v.toStringAsFixed(0)}%',
      opacityOf: (d) => markOpacity(selected, d.key),
      onTap: (d) => p.onToggle('machine', d.key),
      maxBar: 38,
      topPad: 4,
      semanticLabel: 'OEE by machine, ${data.length} machines',
    );
  }
}

/// OK vs Rejected QTY over time: stacked bars, the full bar is the actual quantity.
class OkRejectedTrendChart extends StatefulWidget {
  const OkRejectedTrendChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<OkRejectedTrendChart> createState() => _OkRejectedTrendChartState();
}

class _OkRejectedTrendChartState extends State<OkRejectedTrendChart> {
  final _memo = DataMemo<List<TimePoint>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final c = p.colors;
    final dim = p.ctx.bucket;
    final rows = p.rowsFor(dim);
    final data = _memo.get(rows, p.ctx, dim, () => okRejectedTrend(rows, dim, p.ctx));
    if (data.isEmpty) return const ChartEmpty('No quantities entered for this period.');
    final selected = p.filters[dim] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: [eng.dimensions[dim]!.label, 'OK', 'Rejected'],
        rows: [for (final d in data) MiniRow(d.key, [d.label, eng.formatExact('qty', d.values[0]), eng.formatExact('qty', d.values[1])])],
        selected: selected,
        onRowClick: (k) => p.onToggle(dim, k),
        colors: c,
      );
    }
    return ChartTextScope(
      child: Column(
        children: [
          Expanded(
            child: BarSeriesChart(
              points: data,
              colors: c,
              seriesColors: [c.ok, c.reject],
              seriesNames: const ['OK', 'Rejected'],
              title: (d) => bucketText(d.key, dim, p.ctx),
              xTick: (d) => bucketTick(d.key, dim),
              yText: (v) => eng.formats['qty']!(v),
              valueText: (v) => eng.formatExact('qty', v),
              opacityOf: (d) => markOpacity(selected, d.key),
              onTap: (d) => p.onToggle(dim, d.key),
              maxBar: 34,
              semanticLabel: 'OK versus rejected quantity, ${data.length} ${dim == 'date' ? 'days' : 'months'}',
            ),
          ),
          ChartLegend(colors: c, items: [LegendItem('OK', c.ok), LegendItem('Rejected', c.reject)]),
        ],
      ),
    );
  }
}

/// B.D. Backup - Stoppage by MC No.: minutes lost per machine in the four
/// stoppage groups, stacked.
class DowntimeByMachineChart extends StatefulWidget {
  const DowntimeByMachineChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<DowntimeByMachineChart> createState() => _DowntimeByMachineChartState();
}

class _DowntimeByMachineChartState extends State<DowntimeByMachineChart> {
  final _memo = DataMemo<List<TimePoint>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final c = p.colors;
    final rows = p.rowsFor('machine');
    final data = _memo.get(rows, p.ctx, 'machine', () => downtimeByMachine(rows, p.ctx));
    if (data.isEmpty) return const ChartEmpty('No downtime recorded.');
    final selected = p.filters['machine'] ?? const <String>[];
    final names = [for (final g in eng.stoppageGroups) g['label'] as String];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: ['Machine', for (final n in names) '$n (min)'],
        rows: [for (final d in data) MiniRow(d.key, [d.label, for (final v in d.values) eng.formatExact('qty', v)])],
        selected: selected,
        onRowClick: (k) => p.onToggle('machine', k),
        colors: c,
      );
    }
    final colorsBySeries = [for (var i = 0; i < names.length; i++) c.series[i % c.series.length]];
    return ChartTextScope(
      child: Column(
        children: [
          Expanded(
            child: BarSeriesChart(
              points: data,
              colors: c,
              seriesColors: colorsBySeries,
              seriesNames: names,
              title: (d) => d.label,
              xTick: (d) => truncateLabel(d.label, 10),
              yText: (v) => eng.formats['qty']!(v),
              valueText: (v) => eng.formatExact('minutes', v),
              opacityOf: (d) => markOpacity(selected, d.key),
              onTap: (d) => p.onToggle('machine', d.key),
              maxBar: 42,
              semanticLabel: 'Stoppage minutes by machine, ${data.length} machines',
            ),
          ),
          ChartLegend(colors: c, items: [for (var i = 0; i < names.length; i++) LegendItem(names[i], colorsBySeries[i])]),
        ],
      ),
    );
  }
}
