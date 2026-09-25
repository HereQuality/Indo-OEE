import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart' show NumberFormat;
import 'package:provider/provider.dart';

import '../../../../core/widgets/states.dart';
import '../../../../providers/menu_provider.dart';
import '../charts/chart_props.dart';
import '../charts/charts_registry.dart';
import '../dashboard_engine.dart' as eng;
import '../data/dashboard_models.dart';
import '../data/dashboard_repository.dart';
import '../data/processes_controller.dart';
import '../sheets/date_range_sheet.dart';
import '../sheets/drill_sheet.dart';
import '../sheets/filter_sheet.dart';
import '../widgets/chart_maximize_page.dart';
import '../widgets/control_bar.dart';
import '../widgets/dash_card.dart';
import '../widgets/kpi_tile.dart';
import '../widgets/skeleton.dart';
import '../widgets/widget_card.dart';
import 'dashboard_controller.dart';
import 'dashboard_customize.dart';
import 'dashboard_layout.dart';

/// One process's dashboard, or every machine when [processId] is null (port of
/// ProcessDashboard.jsx). It is the CONTENT of the Dashboard tab — no Scaffold,
/// no app bar — with its own header: process [selector], period chip, Filters,
/// active-filter chips (phone), or the web's one-row header bar (tablet).
///
/// Phone: one column, 2-column KPI tiles, stacked chart cards. Tablet (width
/// >= [tabletMinWidth]): the full width, an auto-fill KPI grid and the web's
/// 12-column chart grid.
class ProcessDashboardPage extends StatefulWidget {
  const ProcessDashboardPage({
    super.key,
    this.processId,
    required this.processes,
    this.controller,
    this.repo = const DashboardRepository(),
    this.chartRegistry,
    this.tableOnlyKeys,
    this.selector,
  });

  final String? processId;
  final ProcessesController processes;

  /// The tab keeps one controller per process so switching chips does not
  /// refetch; it owns them. Null = this page makes (and disposes) its own.
  final DashboardController? controller;
  final DashboardRepository repo;

  /// Test hook: replaces the real chart widgets.
  final Map<String, DashboardChartBuilder>? chartRegistry;
  final Set<String>? tableOnlyKeys;

  /// Builds the process chips; `tabs` is true on a tablet (segmented strip).
  final Widget Function(bool tabs)? selector;

  @override
  State<ProcessDashboardPage> createState() => _ProcessDashboardPageState();
}

class _ProcessDashboardPageState extends State<ProcessDashboardPage> {
  late final DashboardController _ctl;
  late final bool _ownsCtl;

  /// A pull-to-refresh is running (its own spinner shows, so no dimming).
  bool _pulling = false;

  /// Tests poke the dashboard's state through this.
  @visibleForTesting
  DashboardController get debugController => _ctl;

  Map<String, DashboardChartBuilder> get _registry => widget.chartRegistry ?? dashboardCharts;
  Set<String> get _tableOnly => widget.tableOnlyKeys ?? tableOnlyCharts;

  @override
  void initState() {
    super.initState();
    final given = widget.controller;
    _ownsCtl = given == null;
    _ctl = given ?? DashboardController(repo: widget.repo, processId: widget.processId, machines: widget.processes.machines);
    if (_ownsCtl) {
      widget.processes.addListener(_onProcesses);
      _ctl.load();
    }
  }

  @override
  void dispose() {
    if (_ownsCtl) {
      widget.processes.removeListener(_onProcesses);
      _ctl.dispose();
    }
    super.dispose();
  }

  void _onProcesses() => _ctl.setMachines(widget.processes.machines);

  // ── Actions ──────────────────────────────────────────────────────────────
  void _toggle(String dim, String value) {
    HapticFeedback.selectionClick();
    _ctl.toggle(dim, value);
  }

  void _drill(BuildContext context, Map<String, dynamic> measure) {
    showDrillSheet(
      context,
      measure: measure,
      rows: _ctl.filtered,
      ctx: _ctl.ctx,
      // A row picked in the breakdown means "show me exactly this" — set, not
      // toggle: the rows are already filtered, so toggling could only ever
      // REMOVE the filter the user was looking at.
      onPick: (dim, key) => _ctl.setFilter(dim, [key]),
    );
  }

  void _openRange() {
    showDateRangeSheet(
      context,
      range: _ctl.range,
      extent: _ctl.extent,
      onChanged: (next) => _ctl.setRange(next),
    );
  }

  void _openFilters() {
    showFilterSheet(
      context,
      options: _ctl.filterOptions,
      filters: _ctl.filters,
      onFilterSet: _ctl.setFilter,
      onClearAll: _ctl.clearAll,
    );
  }

  void _customize() => openDashboardCustomize(context, processes: widget.processes, processId: widget.processId);

  Future<void> _refresh() async {
    setState(() => _pulling = true);
    try {
      await Future.wait([_ctl.load(), widget.processes.load(silent: true)]);
    } finally {
      if (mounted) setState(() => _pulling = false);
    }
  }

  // ── Build ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final isAdmin = context.select<MenuProvider, bool>((m) => m.isAdmin);
    final media = MediaQuery.sizeOf(context);
    final tablet = isTabletWidth(media.width);
    // A short landscape phone scrolls its header away with the content
    // instead of giving a third of the screen to it.
    final shortScreen = media.height < 520;
    return ListenableBuilder(
      listenable: Listenable.merge([_ctl, widget.processes]),
      builder: (context, _) {
        final id = widget.processId;
        final process = id == null ? null : widget.processes.byId(id);
        if (id != null && process == null) return const _MissingProcess();

        final stats = widget.processes.statsFor(id);
        final charts = widget.processes.chartsFor(id);
        final selector = widget.selector?.call(tablet);

        final Widget header = tablet
            ? Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                child: TabletHeaderBar(
                  selector: selector,
                  periodLabel: _ctl.periodLabel,
                  isDefaultRange: _ctl.isDefaultRange,
                  onPickRange: _openRange,
                  onResetRange: _ctl.resetRange,
                  filterCount: _ctl.activeFilterCount,
                  onOpenFilters: _openFilters,
                  filtersActive: _ctl.filtersActive,
                  onClearAll: _ctl.clearAll,
                  onCustomize: isAdmin ? _customize : null,
                  chips: _ctl.activeFilters,
                  onRemoveChip: (c) => _toggle(c.dim, c.value),
                  refreshing: _ctl.loading && _ctl.rows.isNotEmpty,
                ),
              )
            : DashboardControlBar(
                leading: selector,
                periodLabel: _ctl.periodLabel,
                isDefaultRange: _ctl.isDefaultRange,
                onPickRange: _openRange,
                onResetRange: _ctl.resetRange,
                filterCount: _ctl.activeFilterCount,
                onOpenFilters: _openFilters,
                chips: _ctl.activeFilters,
                onRemoveChip: (c) => _toggle(c.dim, c.value),
                onClearAll: _ctl.clearAll,
                refreshing: _ctl.loading && _ctl.rows.isNotEmpty,
              );

        return Material(
          color: Theme.of(context).scaffoldBackgroundColor,
          child: Column(
            children: [
              if (!shortScreen) header,
              Expanded(
                child: LayoutBuilder(
                  builder: (context, box) => RefreshIndicator(
                    onRefresh: _refresh,
                    child: CustomScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      slivers: [
                        if (shortScreen) SliverToBoxAdapter(child: header),
                        ..._contentSlivers(
                          context,
                          width: box.maxWidth,
                          tablet: tablet,
                          process: process,
                          stats: stats,
                          charts: charts,
                          isAdmin: isAdmin,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _contentSlivers(
    BuildContext context, {
    required double width,
    required bool tablet,
    required ProcessInfo? process,
    required List<Map<String, dynamic>> stats,
    required List<Map<String, dynamic>> charts,
    required bool isAdmin,
  }) {
    final bottom = MediaQuery.paddingOf(context).bottom + 28;
    final gutter = tablet ? 20.0 : 16.0;
    final density = tablet ? densityFor(width - 2 * gutter) : GridDensity.single;
    Widget pad(Widget child, {double below = 12}) =>
        Padding(padding: EdgeInsets.fromLTRB(gutter, 0, gutter, below), child: child);

    if (_ctl.loading && _ctl.rows.isEmpty && _ctl.error == null) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.fromLTRB(gutter, 14, gutter, bottom),
            child: DashboardSkeleton(tablet: tablet, density: density),
          ),
        ),
      ];
    }
    if (_ctl.error != null && _ctl.rows.isEmpty) {
      return [
        SliverFillRemaining(
          hasScrollBody: false,
          child: ErrorView(message: _ctl.error!, onRetry: _ctl.load),
        ),
      ];
    }
    if (_ctl.rows.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.fromLTRB(gutter, 14, gutter, bottom),
            child: _NoEntries(
              name: process?.name,
              period: _ctl.periodLabel,
              extent: _ctl.extent,
              noMachines: process != null && process.machines.isEmpty,
              onChangePeriod: _openRange,
            ),
          ),
        ),
      ];
    }

    final summary = _ctl.summary;
    final colors = DashboardColors.of(context);
    Color? tone(String? key) => switch (key) {
          'ok' => colors.ok,
          'reject' => colors.reject,
          'downtime' => colors.downtime,
          _ => null,
        };

    Widget kpi(Map<String, dynamic> stat) => KpiTile(
          key: ValueKey('kpi:${stat['key']}'),
          label: stat['label'] as String,
          value: (eng.formats[stat['format']] ?? eng.formats['qty']!)(summary[stat['key']] as num?),
          hint: stat['hint'] as String?,
          tone: tone(stat['tone'] as String?),
          web: tablet,
          onTap: () {
            HapticFeedback.lightImpact();
            _drill(context, eng.statMeasure(stat));
          },
        );

    final blocks = <Widget>[
      _EntriesCaption(entries: (summary['entries'] as num?)?.round() ?? _ctl.filtered.length, total: _ctl.rows.length),
      if (_ctl.filtered.isEmpty) _NoMatches(onClear: _ctl.clearAll),
      if (stats.isNotEmpty) tablet ? KpiFlowGrid(children: [for (final s in stats) kpi(s)]) : KpiGrid(children: [for (final s in stats) kpi(s)]),
      if (tablet)
        for (final row in packRows(
          [
            for (final w in charts)
              SpanItem(span: spanFor(w['size'] as String?, density), child: _chartCard(context, w, fixedHeader: !_tableOnly.contains(w['key']))),
          ],
          dense: density == GridDensity.medium,
        ))
          SpanRow(items: row)
      else
        for (final w in charts) _chartCard(context, w),
      if (stats.isEmpty && charts.isEmpty) _NothingSelected(canCustomize: isAdmin, onCustomize: _customize),
    ];

    return [
      SliverAnimatedOpacity(
        opacity: _ctl.loading && !_pulling ? 0.55 : 1,
        duration: const Duration(milliseconds: 150),
        sliver: SliverPadding(
          padding: EdgeInsets.only(top: tablet ? 0 : 12, bottom: bottom),
          sliver: SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, i) => pad(blocks[i]),
              childCount: blocks.length,
            ),
          ),
        ),
      ),
    ];
  }

  Widget _chartCard(BuildContext context, Map<String, dynamic> w, {bool fixedHeader = false}) {
    final key = w['key'] as String;
    final title = w['label'] as String;
    final hint = w['hint'] as String?;
    final tableOnly = _tableOnly.contains(key);
    final measureKey = w['measure'] as String?;
    final measureStat = measureKey == null ? null : eng.statsByKey[measureKey];
    VoidCallback? onDrill(BuildContext c) => measureStat == null ? null : () => _drill(c, eng.statMeasure(measureStat));

    return WidgetCard(
      key: ValueKey('chart:$key'),
      title: title,
      hint: hint,
      fixedHeader: fixedHeader,
      view: _ctl.chartViews[key] ?? ChartView.chart,
      onViewChanged: (v) => setState(() => _ctl.chartViews[key] = v),
      tableOnly: tableOnly,
      onDrill: onDrill(context),
      onMaximize: () => ChartMaximizePage.open(
        context,
        title: title,
        hint: hint,
        tableOnly: tableOnly,
        onDrill: onDrill(context),
        refresh: _ctl,
        builder: (c, view, expanded) => _chart(c, w, view, expanded),
      ),
      builder: (c, view, expanded) => _chart(c, w, view, expanded),
    );
  }

  Widget _chart(BuildContext context, Map<String, dynamic> w, ChartView view, bool expanded) {
    final build = _registry[w['key']];
    if (build == null) return _ChartUnavailable(title: w['label'] as String);
    return build(
      DashboardChartProps(
        rowsFor: _ctl.rowsFor,
        ctx: _ctl.ctx,
        colors: DashboardColors.of(context),
        filters: _ctl.filters,
        onToggle: _toggle,
        onDrill: (m) => _drill(context, m),
        view: view,
        expanded: expanded,
      ),
    );
  }
}

class DashboardSkeleton extends StatelessWidget {
  const DashboardSkeleton({super.key, required this.tablet, required this.density});
  final bool tablet;
  final GridDensity density;

  @override
  Widget build(BuildContext context) {
    if (!tablet) {
      return Semantics(
        label: 'Loading dashboard',
        child: const Column(
          children: [
            KpiGrid(children: [KpiTileSkeleton(), KpiTileSkeleton(), KpiTileSkeleton(), KpiTileSkeleton()]),
            SizedBox(height: 12),
            ChartCardSkeleton(),
            SizedBox(height: 12),
            ChartCardSkeleton(),
          ],
        ),
      );
    }
    final wide = density == GridDensity.wide;
    return Semantics(
      label: 'Loading dashboard',
      child: Column(
        children: [
          KpiFlowGrid(children: [for (var i = 0; i < 6; i++) const KpiTileSkeleton()]),
          const SizedBox(height: 12),
          SpanRow(items: [
            SpanItem(span: wide ? 8 : 6, child: const ChartCardSkeleton()),
            SpanItem(span: wide ? 4 : 6, child: const ChartCardSkeleton()),
          ]),
        ],
      ),
    );
  }
}

// Fmt.number(x, decimals: 0) leaves a trailing "." ("3."), so whole counts use
// their own pattern.
final _countFormat = NumberFormat('#,##,##0', 'en_IN');
String _count(int n) => _countFormat.format(n);

/// "128 entries" under the control bar; says so when filters narrowed it.
class _EntriesCaption extends StatelessWidget {
  const _EntriesCaption({required this.entries, required this.total});
  final int entries;
  final int total;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final text = entries == total
        ? '${_count(total)} ${total == 1 ? 'entry' : 'entries'}'
        : '${_count(entries)} of ${_count(total)} entries';
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: cs.onSurfaceVariant)),
    );
  }
}

/// Entries exist for the period but the picked filters exclude all of them.
class _NoMatches extends StatelessWidget {
  const _NoMatches({required this.onClear});
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DashCard(
      child: Row(
        children: [
          Icon(Icons.filter_alt_off_outlined, color: cs.onSurfaceVariant),
          const SizedBox(width: 12),
          Expanded(child: Text('No entries match these filters.', style: TextStyle(color: cs.onSurfaceVariant))),
          TextButton(onPressed: onClear, child: const Text('Clear all')),
        ],
      ),
    );
  }
}

/// No entries at all in the loaded period.
class _NoEntries extends StatelessWidget {
  const _NoEntries({
    required this.name,
    required this.period,
    required this.extent,
    required this.noMachines,
    required this.onChangePeriod,
  });

  final String? name;
  final String period;
  final Map<String, dynamic>? extent;
  final bool noMachines;
  final VoidCallback onChangePeriod;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final small = TextStyle(fontSize: 13, height: 1.4, color: cs.onSurfaceVariant);
    final from = extent?['from'];
    final to = extent?['to'];
    return DashCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.insights_outlined, size: 40, color: cs.onSurfaceVariant.withValues(alpha: 0.7)),
          const SizedBox(height: 12),
          Text(
            'No entries for ${name ?? 'any machine'} in $period.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: cs.onSurface),
          ),
          if (from is String && to is String) ...[
            const SizedBox(height: 8),
            Text(
              'This process has entries from ${eng.describeRange([from, from])} to ${eng.describeRange([to, to])} — pick a period inside that.',
              textAlign: TextAlign.center,
              style: small,
            ),
          ],
          if (noMachines) ...[
            const SizedBox(height: 8),
            Text('This process has no machines yet — assign them in Production › Processes.', textAlign: TextAlign.center, style: small),
          ],
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: onChangePeriod,
            icon: const Icon(Icons.calendar_month_rounded, size: 18),
            label: const Text('Change period'),
          ),
        ],
      ),
    );
  }
}

/// A process whose stats and charts are both emptied.
class _NothingSelected extends StatelessWidget {
  const _NothingSelected({required this.canCustomize, required this.onCustomize});
  final bool canCustomize;
  final VoidCallback onCustomize;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DashCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.dashboard_customize_outlined, size: 36, color: cs.onSurfaceVariant),
          const SizedBox(height: 10),
          Text(
            canCustomize
                ? 'No KPI tiles or graphs are selected for this process — use Customize to add some.'
                : 'No KPI tiles or graphs are selected for this process.',
            textAlign: TextAlign.center,
            style: TextStyle(color: cs.onSurfaceVariant, height: 1.4),
          ),
          if (canCustomize) ...[
            const SizedBox(height: 14),
            FilledButton.tonalIcon(onPressed: onCustomize, icon: const Icon(Icons.tune_rounded, size: 18), label: const Text('Customize')),
          ],
        ],
      ),
    );
  }
}

/// Stands in for a chart the registry has no builder for (never crashes the page).
class _ChartUnavailable extends StatelessWidget {
  const _ChartUnavailable({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) => Center(
        child: Text('"$title" is not available in this version of the app.', textAlign: TextAlign.center, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );
}

/// The open process was deleted or deactivated while its dashboard was up (the
/// tab normally switches to another chip before this shows).
class _MissingProcess extends StatelessWidget {
  const _MissingProcess();

  @override
  Widget build(BuildContext context) => const Material(
        type: MaterialType.transparency,
        child: EmptyView(
          message: 'This process is no longer available.',
          icon: Icons.layers_clear_outlined,
        ),
      );
}
