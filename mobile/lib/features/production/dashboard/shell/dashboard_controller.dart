import 'package:flutter/foundation.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/utils/alerts.dart';
import '../charts/chart_props.dart';
import '../dashboard_engine.dart' as eng;
import '../data/dashboard_models.dart';
import '../data/dashboard_repository.dart';

/// One removable chip in the active-filters bar.
class ActiveFilter {
  const ActiveFilter(this.dim, this.value, this.label);
  final String dim;
  final String value;
  final String label;
}

/// The state and rules of one process's dashboard (port of the logic in
/// ProcessDashboard.jsx). Works like a Power BI page: the entries for the
/// chosen period are loaded once, and everything after that — the Filters
/// picks, tapping a bar to cross-filter, drill-downs — is computed here from
/// the loaded rows, so every tile and chart always agrees on the same slice.
class DashboardController extends ChangeNotifier {
  DashboardController({
    this.repo = const DashboardRepository(),
    this.processId,
    this.machines = const [],
  }) : range = eng.defaultRange() {
    baseRange = range;
  }

  final DashboardRepository repo;

  /// Null = "All machines".
  final String? processId;

  // ── State ────────────────────────────────────────────────────────────────
  /// ['YYYY-MM-DD', 'YYYY-MM-DD'] being shown.
  List<String> range;

  /// The range "no period filter" means, fixed when it was taken. Comparing
  /// against a freshly computed default instead would turn an untouched
  /// dashboard into an "active filter" the moment the date rolls past midnight.
  late List<String> baseRange;

  /// First and last date this process has any entry on (feeds the Year tab).
  Map<String, dynamic>? extent;

  /// Names for the machines in the loaded entries, including deactivated ones.
  Map<String, String> entryMachineNames = const {};

  List<Map<String, dynamic>> rows = const [];
  bool loading = true;

  /// Message of the last failed load; cleared by the next load.
  String? error;
  Map<String, List<String>> filters = eng.newEmptyFilters();

  /// Chart / table choice per card. Lives here (not in a widget) so it survives
  /// scrolling a card away and switching to another process chip and back.
  final Map<String, ChartView> chartViews = {};

  /// When the rows last arrived (null until the first successful load). The
  /// tab reloads a cached dashboard that has gone stale while another chip was open.
  DateTime? loadedAt;

  // ── Load ─────────────────────────────────────────────────────────────────
  int _token = 0;
  bool _disposed = false;

  /// Loads the entries for [range]. A response that arrives after a newer
  /// request was made (rapid range changes, pull-to-refresh) is discarded.
  Future<void> load() async {
    if (range.length != 2) return;
    final from = range[0];
    final to = range[1];
    if (from.isEmpty || to.isEmpty || to.compareTo(from) < 0) return;
    final token = ++_token;
    loading = true;
    error = null;
    _notify();
    try {
      final res = await repo.entries(from: from, to: to, processId: processId);
      if (token != _token || _disposed) return;
      // A date/month clicked on the old (dimmed) view while this was loading
      // belongs to the old period — drop it together with the swap.
      _dropPeriodFilters();
      rows = res.rows;
      extent = res.extent;
      entryMachineNames = res.machineNames;
      loadedAt = DateTime.now();
      _invalidate();
    } on ApiException catch (e) {
      if (token != _token || _disposed) return;
      _failed(e.message);
    } catch (_) {
      if (token != _token || _disposed) return;
      _failed('');
    }
    if (token != _token || _disposed) return;
    loading = false;
    _notify();
  }

  void _failed(String message) {
    final text = message.trim().isEmpty ? 'Failed to load entries' : message;
    error = text;
    rows = const [];
    _invalidate();
    Alerts.error(text);
  }

  // ── Derived data (memoised until rows / filters / machines change) ──────
  DashboardCtx? _ctx;
  Map<String, List<Map<String, dynamic>>>? _rowsByDim;
  Map<String, dynamic>? _summary;
  Map<String, List<Map<String, String>>>? _options;

  /// Active machines in sheet order.
  List<Map<String, dynamic>> machines;

  /// The machine list changed (a refresh landed, or a Customize was saved).
  void setMachines(List<Map<String, dynamic>> next) {
    if (identical(next, machines)) return;
    machines = next;
    _invalidate();
    _notify();
  }

  void _invalidate() {
    _ctx = null;
    _rowsByDim = null;
    _summary = null;
    _options = null;
  }

  /// `machines` arrives in sheet order, so a machine's index is its place on
  /// every machine-by-machine chart and in the Machine filter list.
  DashboardCtx get ctx => _ctx ??= DashboardCtx(
        machineName: {
          ...entryMachineNames,
          for (final m in machines) machineId(m): machineName(m),
        },
        machineOrder: {for (var i = 0; i < machines.length; i++) machineId(machines[i]): i},
        bucket: eng.timeBucket(rows),
      );

  /// rowsFor(dim): everything filtered except [dim] itself — see applyFilters.
  /// null = the fully filtered rows.
  List<Map<String, dynamic>> rowsFor(String? dim) {
    var cache = _rowsByDim;
    if (cache == null) {
      final all = eng.applyFilters(rows, filters);
      cache = {'': all};
      for (final d in eng.dimensions.keys) {
        cache[d] = (filters[d]?.isNotEmpty ?? false) ? eng.applyFilters(rows, filters, d) : all;
      }
      _rowsByDim = cache;
    }
    return cache[dim ?? ''] ?? cache['']!;
  }

  List<Map<String, dynamic>> get filtered => rowsFor(null);

  Map<String, dynamic> get summary => _summary ??= eng.summarize(filtered);

  /// What the Filters sheet offers: the values present in the loaded period,
  /// plus anything already picked (so a pick never vanishes from its own list).
  Map<String, List<Map<String, String>>> get filterOptions => _options ??= {
        'machine': _optionsFor('machine'),
        'operator': _optionsFor('operator'),
        'item': _optionsFor('item'),
      };

  List<Map<String, String>> _optionsFor(String dim) {
    final d = eng.dimensions[dim];
    if (d == null) return const [];
    // '' is a real bucket — "(no operator)" / "(no part)" — that a chart or
    // drill-down can pick, so it is offered like any other value.
    final values = <String>{for (final r in rows) d.value(r), ...?filters[dim]};
    final list = [for (final v in values) {'value': v, 'label': d.text(v, ctx)}];
    if (dim == 'machine') {
      final cmp = eng.compareMachines(ctx, (o) => o['value'] as String?);
      list.sort((a, b) => cmp(a, b));
    } else {
      list.sort((a, b) => eng.naturalCompare(a['label']!, b['label']!));
    }
    return list;
  }

  List<ActiveFilter> get activeFilters => [
        for (final e in filters.entries)
          for (final v in e.value)
            ActiveFilter(e.key, v, '${eng.dimensions[e.key]?.label ?? e.key}: ${eng.dimensions[e.key]?.text(v, ctx) ?? v}'),
      ];

  int get activeFilterCount => filters.values.fold(0, (n, v) => n + v.length);
  bool get hasActiveFilters => eng.hasFilters(filters);
  bool get isDefaultRange => range.join(',') == baseRange.join(',');

  /// The chip on the header. The untouched default is "this month", named
  /// after the actual month ("September 2026"); anything else uses its quick
  /// range name when it is one.
  String get periodLabel {
    if (isDefaultRange) return eng.describeRange(range);
    final key = eng.quickRangeKey(range);
    for (final q in eng.quickRanges) {
      if (q.key == key) return q.label;
    }
    return eng.describeRange(range);
  }

  bool get filtersActive => !isDefaultRange || hasActiveFilters;

  // ── Actions ──────────────────────────────────────────────────────────────
  /// Tap on a bar / slice / chip: toggles one value of a dimension.
  void toggle(String dim, String value) {
    filters = eng.toggleFilter(filters, dim, value);
    _invalidate();
    _notify();
  }

  /// Sets a dimension to exactly [values] (the Filters sheet, a drill-down row).
  void setFilter(String dim, List<String> values) {
    filters = {...filters, dim: List<String>.of(values)};
    _invalidate();
    _notify();
  }

  /// Applies a new period. Returns false (with the web's message) when it is
  /// longer than the API accepts. A new period keeps the machine / operator /
  /// part picks (like a slicer would) but drops a clicked date or month, which
  /// may not be in it at all.
  bool setRange(List<String> next) {
    if (eng.rangeDays(next) > eng.maxRangeDays) {
      Alerts.error('That period is longer than 5 years — pick a shorter one.');
      return false;
    }
    if (next.join(',') == range.join(',')) return true;
    range = List<String>.of(next);
    _dropPeriodFilters();
    _invalidate();
    load();
    return true;
  }

  /// Back to the untouched default period ("this month").
  void resetRange() {
    final fresh = eng.defaultRange();
    final changed = fresh.join(',') != range.join(',');
    baseRange = fresh;
    range = fresh;
    if (changed) {
      _dropPeriodFilters();
      _invalidate();
      load();
    } else {
      _notify();
    }
  }

  void clearAll() {
    filters = eng.newEmptyFilters();
    _invalidate();
    resetRange();
    _notify();
  }

  void _dropPeriodFilters() {
    if ((filters['date']?.isNotEmpty ?? false) || (filters['month']?.isNotEmpty ?? false)) {
      filters = {...filters, 'date': <String>[], 'month': <String>[]};
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
