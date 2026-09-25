import 'package:flutter/material.dart';

import '../dashboard_engine.dart' as eng;
import 'bar_charts.dart';
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'hbars.dart';
import 'mini_table.dart';
import 'oee_trend_chart.dart';
import 'run_time_treemap.dart';
import 'unreported_chart.dart';

/// Port of charts.jsx CHART_COMPONENTS: every dashboard visual keyed by its
/// chartCatalog key. The shell looks a card's builder up here.
final Map<String, DashboardChartBuilder> dashboardCharts = {
  'oeeTrend': (p) => OeeTrendChart(props: p),
  'runTimeByOperator': (p) => RunTimeByOperatorChart(props: p),
  'downtimeByMachine': (p) => DowntimeByMachineChart(props: p),
  'runTimeByMachine': (p) => RunTimeTreemapChart(props: p),
  'unreportedByMachine': (p) => UnreportedByMachineChart(props: p),
  'okRejectedTrend': (p) => OkRejectedTrendChart(props: p),
  'oeeByMachine': (p) => OeeByMachineChart(props: p),
  'rejectByReason': (p) => RejectByReasonChart(props: p),
  'okPctByOperator': (p) => OkPctByOperatorChart(props: p),
  'outputByItem': (p) => OutputByItemChart(props: p),
  'machineSummary': (p) => MachineSummaryChart(props: p),
};

/// Visuals that are already a table have no separate table view.
const Set<String> tableOnlyCharts = {'machineSummary'};

/// Shared body of the four sorted horizontal-bar visuals.
class _HBarsChart extends StatefulWidget {
  const _HBarsChart({
    required this.props,
    required this.dim,
    required this.measure,
    required this.color,
    required this.format,
    required this.dimLabel,
    required this.valueLabel,
    required this.emptyText,
    this.positiveOnly = true,
  });

  final DashboardChartProps props;
  final String dim;
  final double? Function(Map<String, dynamic> summary) measure;
  final Color Function(DashboardColors c) color;
  final String format;
  final String dimLabel;
  final String valueLabel;
  final String emptyText;
  final bool positiveOnly;

  @override
  State<_HBarsChart> createState() => _HBarsChartState();
}

class _HBarsChartState extends State<_HBarsChart> {
  final _memo = DataMemo<List<BarDatum>>();

  @override
  Widget build(BuildContext context) {
    final w = widget;
    final p = w.props;
    final rows = p.rowsFor(w.dim);
    final data = _memo.get(rows, p.ctx, w.dim, () => dimBars(rows, w.dim, p.ctx, w.measure, positiveOnly: w.positiveOnly));
    return HBars(
      data: data,
      colors: p.colors,
      color: w.color(p.colors),
      format: w.format,
      selected: p.filters[w.dim] ?? const <String>[],
      onSelect: (k) => p.onToggle(w.dim, k),
      expanded: p.expanded,
      view: p.view,
      dimLabel: w.dimLabel,
      valueLabel: w.valueLabel,
      emptyText: w.emptyText,
    );
  }
}

/// Effective Machine Run Time (Hour) by Operator.
class RunTimeByOperatorChart extends StatelessWidget {
  const RunTimeByOperatorChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) => _HBarsChart(
        props: props,
        dim: 'operator',
        measure: (s) => pick(s, 'effectiveHours'),
        color: (c) => c.ok,
        format: 'hours',
        dimLabel: 'Operator',
        valueLabel: 'Effective run time',
        emptyText: 'Needs cycle time and OK quantity.',
      );
}

/// Operator v/s OK QTY %.
class OkPctByOperatorChart extends StatelessWidget {
  const OkPctByOperatorChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) => _HBarsChart(
        props: props,
        dim: 'operator',
        measure: (s) => pick(s, 'okPct'),
        color: (c) => c.ok,
        format: 'pct',
        dimLabel: 'Operator',
        valueLabel: '% OK quantity',
        emptyText: 'No quantities entered.',
        positiveOnly: false,
      );
}

/// OK QTY by Part.
class OutputByItemChart extends StatelessWidget {
  const OutputByItemChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) => _HBarsChart(
        props: props,
        dim: 'item',
        measure: (s) => pick(s, 'okQty'),
        color: (c) => c.ok,
        format: 'qty',
        dimLabel: 'Part',
        valueLabel: 'OK quantity',
        emptyText: 'No OK quantity entered.',
      );
}

/// Rejected QTY by Reason: tapping a bar opens the reason's drill-down (it is
/// not a dashboard dimension, so it cannot cross-filter).
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
    final rows = p.rowsFor(null);
    final data = _memo.get(rows, p.ctx, null, () => rejectReasons(rows));
    return HBars(
      data: data,
      colors: p.colors,
      color: p.colors.reject,
      format: 'qty',
      selected: const [],
      onSelect: (k) => p.onDrill(eng.reasonMeasure(k)),
      expanded: p.expanded,
      view: p.view,
      dimLabel: 'Reason',
      valueLabel: 'Rejected',
      emptyText: 'Nothing rejected in this period.',
    );
  }
}

/// MC No. Summary: one row per machine, always a table.
class MachineSummaryChart extends StatefulWidget {
  const MachineSummaryChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<MachineSummaryChart> createState() => _MachineSummaryChartState();
}

/// (label, hint) of every column, as in charts.jsx SUMMARY_COLUMNS.
const List<(String, String?)> summaryColumns = [
  ('Machine', null),
  ('Actual', 'Actual quantity produced'),
  ('OK', 'Pieces that passed'),
  ('% OK', 'OK ÷ (OK + Rejected)'),
  ('Rejected', 'Actual − OK'),
  ('% Rejected', 'Rejected ÷ Actual'),
  ('Effective Run', 'OK × cycle time'),
  ('Downtime', 'All stoppage causes'),
  ('Unreported', 'Shift − effective run − downtime, per machine-day'),
  ('OEE · Losses', "OEE considering losses — averaged over the machine's days"),
  ('OEE · Lunch', "OEE not considering losses, but lunch — averaged over the machine's days"),
  ('OEE · Lunch + Setup Time', "OEE not considering losses, but lunch and setup time — averaged over the machine's days"),
];

class _MachineSummaryChartState extends State<MachineSummaryChart> {
  final _memo = DataMemo<List<MiniRow>>();
  final List<String> _columns = [for (final c in summaryColumns) c.$1];
  final List<String?> _hints = [for (final c in summaryColumns) c.$2];

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final rows = p.rowsFor('machine');
    final data = _memo.get(rows, p.ctx, 'machine', () {
      final f = eng.formats;
      return [
        for (final r in machineSummaryRows(rows, p.ctx))
          MiniRow(r.key, [
            r.label,
            eng.formatExact('qty', pick(r.summary, 'totalQty')),
            eng.formatExact('qty', pick(r.summary, 'okQty')),
            f['pct']!(pick(r.summary, 'okPct')),
            eng.formatExact('qty', pick(r.summary, 'rejectedQty')),
            f['pct']!(pick(r.summary, 'rejectionPct')),
            f['hours']!(pick(r.summary, 'effectiveHours')),
            f['minutes']!(pick(r.summary, 'downtimeMin')),
            f['minutes']!(pick(r.summary, 'unreportedMin')),
            f['pct']!(pick(r.summary, 'oeeLosses')),
            f['pct']!(pick(r.summary, 'oeeLunch')),
            f['pct']!(pick(r.summary, 'oeeLunchCot')),
          ]),
      ];
    });
    if (data.isEmpty) return const ChartEmpty('No entries for this period.');
    return MiniTable(
      columns: _columns,
      hints: _hints,
      rows: data,
      selected: p.filters['machine'] ?? const <String>[],
      onRowClick: (k) => p.onToggle('machine', k),
      colors: p.colors,
    );
  }
}
