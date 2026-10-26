import 'package:flutter/material.dart';

/// Shared contract between the dashboard shell (dashboard/*) and the chart
/// widgets (dashboard/charts/*). Mirrors the props client/src/Components/
/// ProcessDashboard/charts.jsx receives. Owned by the lead — do not edit; ask
/// in your report if something is missing.

enum ChartView { chart, table }

/// Chart colours (port of chartTheme.js THEME). Colour follows the entity,
/// never its rank: OK / run time / OEE = blue, rejected = orange, downtime =
/// aqua. `series` slots are used in this fixed order wherever a chart needs
/// several series.
class DashboardColors {
  const DashboardColors({
    required this.series,
    required this.ok,
    required this.reject,
    required this.downtime,
    required this.surface,
    required this.grid,
    required this.axis,
    required this.muted,
    required this.ink,
  });

  final List<Color> series;
  final Color ok, reject, downtime, surface, grid, axis, muted, ink;

  static const light = DashboardColors(
    series: [Color(0xFF2A78D6), Color(0xFFEB6834), Color(0xFF1BAF7A), Color(0xFFEDA100)],
    ok: Color(0xFF2A78D6),
    reject: Color(0xFFEB6834),
    downtime: Color(0xFF1BAF7A),
    surface: Color(0xFFFFFFFF),
    grid: Color(0xFFE1E0D9),
    axis: Color(0xFF52514E),
    muted: Color(0xFF898781),
    ink: Color(0xFF0B0B0B),
  );

  static const dark = DashboardColors(
    series: [Color(0xFF3987E5), Color(0xFFD95926), Color(0xFF199E70), Color(0xFFC98500)],
    ok: Color(0xFF3987E5),
    reject: Color(0xFFD95926),
    downtime: Color(0xFF199E70),
    surface: Color(0xFF212121),
    grid: Color(0xFF2C2C2A),
    axis: Color(0xFFC3C2B7),
    muted: Color(0xFF898781),
    ink: Color(0xFFFFFFFF),
  );

  static DashboardColors of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;
}

/// What a dashboard calls the thing it is broken down by (web `UNIT_WORDS`):
/// machines, or workers on a process whose entries are made per worker
/// (`isWorkerProcess` — RUBBER, After Powder Coating, …). Words only: every
/// figure is worked out the same way.
class UnitWords {
  const UnitWords({required this.byWorker, required this.one, required this.many, required this.mcNo, required this.times});
  final bool byWorker;

  /// "Machine" / "Worker" — table headings, "By Worker".
  final String one;

  /// "machines" / "workers" — "All workers".
  final String many;

  /// The Filters slicer's title ("MC No." / "Worker").
  final String mcNo;

  /// What an entry's two times are called, for the empty-state hints.
  final String times;

  static const UnitWords machine =
      UnitWords(byWorker: false, one: 'Machine', many: 'machines', mcNo: 'MC No.', times: 'machine ON/OFF times');
  static const UnitWords worker =
      UnitWords(byWorker: true, one: 'Worker', many: 'workers', mcNo: 'Worker', times: 'working start / end times');
}

/// `ctx` in the web charts: machine id -> name / sheet order, and whether the
/// time axis buckets by "date" or "month" (utils/processDashboard.js timeBucket).
class DashboardCtx {
  const DashboardCtx({
    required this.machineName,
    required this.machineOrder,
    required this.bucket,
    this.stoppageKeys,
    this.words = UnitWords.machine,
    this.causeLabels = const {},
  });
  final Map<String, String> machineName;
  final Map<String, int> machineOrder;
  final String bucket; // 'date' | 'month'

  /// Machines or workers (web `ctx.words`, `unitWordsFor(process)`): what the
  /// headings and hints call the thing this dashboard is broken down by.
  final UnitWords words;

  /// The stoppage causes the process's sheet has (web `ctx.stoppageKeys`,
  /// `stoppageKeysFor(process)`) — the columns the cause tables always show.
  /// Null = the shared ten (a machine process, or "All machines").
  final List<String>? stoppageKeys;

  /// A cause in the process's own sheet wording, where it differs from the
  /// shared one (web `ctx.causeLabels`, `causeLabelsFor(process)`): BEFORE
  /// POWDER COATING's bdMechMin reads "B.D. (Breakdown)". Empty = shared words.
  final Map<String, String> causeLabels;
}

/// Everything a chart needs. Rows are the JS entry objects as maps.
class DashboardChartProps {
  const DashboardChartProps({
    required this.rowsFor,
    required this.ctx,
    required this.colors,
    required this.filters,
    required this.onToggle,
    required this.onDrill,
    this.view = ChartView.chart,
    this.expanded = false,
  });

  /// The filtered entries; pass the dimension the chart itself is sliced by so
  /// it keeps all its marks and dims the unselected ones, or null for the fully
  /// filtered rows.
  final List<Map<String, dynamic>> Function(String? dim) rowsFor;
  final DashboardCtx ctx;
  final DashboardColors colors;

  /// Active cross-filters: dimension ('machine'|'operator'|'item'|'month'|'date') -> selected keys.
  final Map<String, List<String>> filters;

  /// Cross-filter the whole dashboard (tap a bar / slice).
  final void Function(String dim, String value) onToggle;

  /// Open the breakdown sheet for a measure (a `statMeasure` / `causeMeasure` /
  /// `reasonMeasure` map from dashboard_engine.dart).
  final void Function(Map<String, dynamic> measure) onDrill;

  final ChartView view;

  /// True when the card is maximised (full screen).
  final bool expanded;
}

typedef DashboardChartBuilder = Widget Function(DashboardChartProps props);
