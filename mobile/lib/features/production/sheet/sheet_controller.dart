import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../app/routes.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import '../../../core/utils/alerts.dart';
import '../shared/production_sheet_calc.dart';
import 'sheet_model.dart';
import 'sheet_period.dart';
import 'working_days.dart';

/// The route this page is mounted at; a process whose Data Entry Page resolves
/// to it scopes the machine picker (see [SheetController.lockedProcess]).
const String sheetPagePath = '/production/cnc-data-entry';

const int _reloadBatch = 4;

/// State and server calls behind the Data Entry list — the list half of
/// client/src/pages/ProductionSheet.jsx: pages of dates from
/// GET /production-sheet (10 dates a page, newest first), the period and
/// machine/operator/part filters, search, the 2-working-day lock preview and
/// the delete / unlock calls.
///
/// Rows are kept exactly as the server sends them (the editor and the calc
/// functions read the same JS keys); only `date` / `machine` / `_id` are
/// normalised so a bad row can never crash the list.
class SheetController extends ChangeNotifier {
  SheetController({List<String>? initialRange}) : range = initialRange ?? defaultEntryRange() {
    baseRange = range;
  }

  // ── reference data (loaded once) ─────────────────────────────────────────
  List<Json> machines = const [];
  List<Json> items = const [];
  List<Json> operators = const [];
  List<Json> processes = const [];
  WorkingCalendar calendar = WorkingCalendar.fallback();
  Json? extent;
  bool referenceLoaded = false;
  bool referenceFailed = false;

  Map<String, String> _machineName = const {};
  Map<String, int> _machineRank = const {};
  Map<String, String> get machineName => _machineName;

  Json? machineOf(String id) {
    for (final m in machines) {
      if ('${m['_id']}' == id) return m;
    }
    return null;
  }

  /// Where a machine sits in the sheet order the API returns (a machine that
  /// has since been deactivated ranks after every listed one).
  int rankOf(String machineId) => _machineRank[machineId] ?? 1 << 30;

  /// Machine ids the entries of the loaded range use (for the picker options).
  Map<String, List<String>> rangeOptions = const {'machine': [], 'operator': [], 'item': []};

  // ── query ────────────────────────────────────────────────────────────────
  List<String> range;
  late List<String> baseRange;
  SheetFilters filters = SheetFilters.empty;
  String search = '';

  bool get isDefaultRange => listEquals(range, baseRange);
  bool get filtersActive => !isDefaultRange || filters.isNotEmpty;

  // ── data ─────────────────────────────────────────────────────────────────
  List<Json> _rows = const [];
  List<Json> get rows => _rows;
  int page = 0;
  int totalPages = 1;
  int totalDays = 0;
  bool loading = true;
  bool loadingMore = false;
  bool refreshing = false;
  String? error;
  String? moreError;
  String? unlockingId;
  String? deletingId;

  bool get hasMore => page < totalPages;

  int _gen = 0;
  bool _disposed = false;

  Map<String, Json> _dayResults = const {};
  final Map<String, Json> _calcCache = {};
  List<SheetDay>? _days;

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  // ── derived ──────────────────────────────────────────────────────────────

  /// The process whose Data Entry Page is this page, when exactly one is —
  /// then only its machines can be picked (two, or none, means every machine).
  Json? get lockedProcess {
    final owners = processes.where((p) {
      final url = p['dataEntryMenu'];
      return url is String && url.isNotEmpty && AppRoutes.match(url)?.path == sheetPagePath;
    }).toList();
    return owners.length == 1 ? owners.first : null;
  }

  List<Json> get scopedMachines {
    final p = lockedProcess;
    if (p == null) return machines;
    final pid = '${p['_id']}';
    return machines.where((m) => _idOf(m['process']) == pid).toList();
  }

  /// The date/machine groups the list draws (filters and search applied).
  List<SheetDay> get days => _days ??= buildSheetDays(
        rows: _rows,
        filters: filters,
        search: search,
        machineName: _machineName,
        rankOf: rankOf,
      );

  /// dayCalc figures of an entry (Unutilized, Unreported, the three OEEs, gap).
  /// Worked out over the machine's WHOLE date as fetched — never just the
  /// entries the operator/part filters leave visible.
  Json dayOf(Json row) => _dayResults['${row['_id']}'] ?? const {};

  /// rowCalc figures of an entry, cached per row.
  Json calcOf(Json row) => _calcCache.putIfAbsent('${row['_id']}', () => rowCalc(row));

  /// Picker options: the values present in the period plus anything already
  /// picked, so a pick never vanishes from its own list.
  Map<String, List<Map<String, String>>> get filterOptions => optionsFor(rangeOptions, filters);

  Map<String, List<Map<String, String>>> optionsFor(Map<String, List<String>> present, SheetFilters selected) {
    List<Map<String, String>> build(String dim) {
      final values = <String>{...(present[dim] ?? const []), ...selected.of(dim)};
      final out = [
        for (final v in values) {'value': v, 'label': optionLabel(dim, v)},
      ];
      out.sort((a, b) {
        if (dim == 'machine') {
          final byRank = rankOf(a['value']!).compareTo(rankOf(b['value']!));
          if (byRank != 0) return byRank;
        }
        return naturalCompare(a['label']!, b['label']!);
      });
      return out;
    }

    return {for (final d in SheetFilters.dims) d: build(d)};
  }

  String optionLabel(String dim, String value) => switch (dim) {
        'machine' => _machineName[value] ?? '—',
        'operator' => value.isEmpty ? '(no operator)' : value,
        _ => value.isEmpty ? '(no part)' : value,
      };

  // ── lock preview ─────────────────────────────────────────────────────────

  DateTime? _unlockedUntil(Json row) {
    final v = row['unlockedUntil'];
    if (v == null) return null;
    final d = DateTime.tryParse('$v');
    if (d == null) return null;
    return d.isAfter(DateTime.now()) ? d.toLocal() : null;
  }

  /// When a Super-Admin unlock on this entry still runs, until when.
  DateTime? unlockedUntilOf(Json row) => _unlockedUntil(row);

  /// "" while the entry can still be edited / deleted, else why it is locked
  /// (an entry with a still-current `unlockedUntil` is never locked).
  String lockInfo(Json row) {
    if (_unlockedUntil(row) != null) return '';
    final date = '${row['date']}';
    final deadline = calendar.lockDeadline(date);
    if (isoDay(DateTime.now()).compareTo(deadline) <= 0) return '';
    return 'Locked — more than $lockWorkingDays working days old (editable through ${dmy(deadline)})';
  }

  bool isLocked(Json row) => lockInfo(row).isNotEmpty;

  // ── loading ──────────────────────────────────────────────────────────────

  /// Everything the screen needs on first open: the reference lists, the
  /// company calendar, the extent and the first page of dates.
  Future<void> start() async {
    await Future.wait([_loadReference(), loadFirst(), loadRangeOptions()]);
  }

  Future<void> _loadReference() async {
    Future<List<Json>> list(String path) async {
      final res = await Api.get(path);
      return asList(res);
    }

    var failed = false;
    Future<T?> soft<T>(Future<T> Function() f) async {
      try {
        return await f();
      } catch (_) {
        return null;
      }
    }

    final results = await Future.wait<Object?>([
      soft(() => list(Endpoints.machines)),
      soft(() => list(Endpoints.items)),
      soft(() => list(Endpoints.machineOperators)),
      soft(() => list(Endpoints.processes)),
      soft(() => list(Endpoints.companyHolidays)),
      soft(() async => asMap(await Api.get(Endpoints.weeklyOff))),
      soft(() async => asMap(await Api.get(Endpoints.productionSheetExtent))),
    ]);
    if (_disposed) return;

    final m = results[0] as List<Json>?;
    final it = results[1] as List<Json>?;
    final op = results[2] as List<Json>?;
    final pr = results[3] as List<Json>?;
    if (m == null || it == null || op == null) failed = true;
    if (m != null) _setMachines(m);
    items = it ?? items;
    operators = op ?? operators;
    processes = pr ?? processes;

    final holidays = results[4] as List<Json>?;
    final weekly = results[5] as Json?;
    final off = weekly?['weeklyOffDays'];
    calendar = WorkingCalendar(
      weeklyOffDays: off is List ? [for (final e in off) if (e is num && e.isFinite) e.toInt()] : null,
      holidays: holidays,
    );
    final ext = results[6] as Json?;
    extent = (ext != null && ext['from'] != null && ext['to'] != null) ? ext : null;

    referenceLoaded = !failed;
    referenceFailed = failed;
    _days = null;
    notifyListeners();
  }

  void _setMachines(List<Json> list) {
    machines = list;
    _machineName = {for (final m in list) '${m['_id']}': '${m['machineName'] ?? '—'}'};
    _machineRank = {for (var i = 0; i < list.length; i++) '${list[i]['_id']}': i};
    _days = null;
  }

  /// Makes sure the machines / items / operators the editor needs are here,
  /// asking again when the first attempt failed. False when they still are not.
  Future<bool> ensureReference() async {
    if (referenceLoaded) return true;
    await _loadReference();
    return referenceLoaded;
  }

  /// The distinct machines / operators / parts present in [from]..[to].
  Future<Map<String, List<String>>> fetchFilterOptions(String from, String to) async {
    final res = await Api.get(Endpoints.productionSheetFilterOptions, query: {'from': from, 'to': to});
    final data = asMap(res);
    List<String> strings(Object? v) => v is List ? [for (final e in v) if (e != null) '$e'] : <String>[];
    return {'machine': strings(data['machine']), 'operator': strings(data['operator']), 'item': strings(data['item'])};
  }

  Future<void> loadRangeOptions() async {
    final from = range[0];
    final to = range[1];
    try {
      final options = await fetchFilterOptions(from, to);
      if (_disposed || from != range[0] || to != range[1]) return;
      rangeOptions = options;
      notifyListeners();
    } catch (_) {
      // The pickers just keep what they had; nothing else depends on this.
    }
  }

  Future<Json> _fetchPage(int p) => Api.get(Endpoints.productionSheet, query: {
        'from': range[0],
        'to': range[1],
        'page': p,
        if (filters.machine.isNotEmpty) 'machine': filters.machine.join(','),
        if (filters.operator.isNotEmpty) 'operator': filters.operator.join(','),
        if (filters.item.isNotEmpty) 'item': filters.item.join(','),
      });

  List<Json> _normalize(Json res) {
    final out = <Json>[];
    final seen = <String>{};
    for (final r in asList(res)) {
      final id = r['_id'];
      final date = '${r['date'] ?? ''}';
      if (id == null || date.length < 10 || !seen.add('$id')) continue;
      final machine = r['machine'];
      out.add({
        ...r,
        '_id': '$id',
        'date': date.substring(0, 10),
        'machine': machine is Map ? '${machine['_id']}' : '${machine ?? ''}',
      });
    }
    return out;
  }

  ({int page, int totalPages, int totalDays}) _meta(Json res, int asked) {
    final meta = res['meta'];
    int intOf(Object? v, int d) => v is num ? (v.isFinite ? v.toInt() : d) : (int.tryParse('$v') ?? d);
    if (meta is! Map) return (page: asked, totalPages: 1, totalDays: 0);
    final tp = intOf(meta['totalPages'], 1);
    return (page: intOf(meta['page'], asked), totalPages: tp < 1 ? 1 : tp, totalDays: intOf(meta['totalDays'], 0));
  }

  void _setRows(List<Json> rows) {
    _rows = rows;
    _days = null;
    _calcCache.clear();
    final groups = <String, List<Json>>{};
    for (final r in rows) {
      (groups['${r['machine']}|${r['date']}'] ??= []).add(r);
    }
    final out = <String, Json>{};
    for (final group in groups.values) {
      // dayCalc sorts by Machine ON time internally; sorting the same way here
      // (the same helper) keeps result i lined up with sorted[i].
      final sorted = sortByMachineOn(group);
      final results = dayCalc(sorted);
      for (var i = 0; i < sorted.length; i++) {
        out['${sorted[i]['_id']}'] = results[i];
      }
    }
    _dayResults = out;
  }

  /// First page of the current selection (used on open, after a filter change
  /// and by pull-to-refresh). [keepRows] leaves the old rows on screen until
  /// the answer arrives.
  Future<void> loadFirst({bool keepRows = false}) async {
    final gen = ++_gen;
    loading = true;
    loadingMore = false;
    refreshing = false;
    error = null;
    moreError = null;
    if (!keepRows) {
      _setRows(const []);
      page = 0;
      totalPages = 1;
      totalDays = 0;
    }
    notifyListeners();
    try {
      final res = await _fetchPage(1);
      if (gen != _gen) return;
      final meta = _meta(res, 1);
      _setRows(_normalize(res));
      page = meta.page;
      totalPages = meta.totalPages;
      totalDays = meta.totalDays;
    } on ApiException catch (e) {
      if (gen != _gen) return;
      error = e.message;
      _setRows(const []);
    } catch (_) {
      if (gen != _gen) return;
      error = 'Failed to load entries';
      _setRows(const []);
    }
    loading = false;
    notifyListeners();
  }

  /// The next page of dates, appended below what is loaded.
  Future<void> loadMore() async {
    if (loading || loadingMore || refreshing || !hasMore || error != null) return;
    final gen = _gen;
    final asked = page + 1;
    loadingMore = true;
    moreError = null;
    notifyListeners();
    try {
      final res = await _fetchPage(asked);
      if (gen != _gen) return;
      final meta = _meta(res, asked);
      if (meta.page < asked) {
        // The server clamps a page past its last one back to it — nothing new.
        totalPages = page;
      } else {
        final seen = {for (final r in _rows) '${r['_id']}'};
        _setRows([..._rows, ..._normalize(res).where((r) => !seen.contains('${r['_id']}'))]);
        page = meta.page;
        totalPages = meta.totalPages;
        totalDays = meta.totalDays;
      }
    } on ApiException catch (e) {
      if (gen != _gen) return;
      moreError = e.message;
    } catch (_) {
      if (gen != _gen) return;
      moreError = 'Could not load more days';
    }
    loadingMore = false;
    notifyListeners();
  }

  /// Fetches every page loaded so far again and swaps the rows in place — used
  /// after an add / edit / delete so the scroll position survives and the
  /// pages (which are whole dates) stay consistent.
  Future<void> reloadLoaded() async {
    final gen = ++_gen;
    final upTo = page < 1 ? 1 : page;
    refreshing = true;
    loadingMore = false;
    moreError = null;
    notifyListeners();
    try {
      final merged = <String, Json>{};
      var last = (page: 1, totalPages: totalPages, totalDays: totalDays);
      var loaded = 0;
      for (var start = 1; start <= upTo; start += _reloadBatch) {
        final end = (start + _reloadBatch - 1) < upTo ? start + _reloadBatch - 1 : upTo;
        final answers = await Future.wait([for (var p = start; p <= end; p++) _fetchPage(p)]);
        if (gen != _gen) return;
        var clamped = false;
        for (var i = 0; i < answers.length; i++) {
          final asked = start + i;
          final meta = _meta(answers[i], asked);
          if (meta.page < asked) {
            clamped = true;
            continue;
          }
          for (final r in _normalize(answers[i])) {
            merged.putIfAbsent('${r['_id']}', () => r);
          }
          last = meta;
          loaded = meta.page;
        }
        if (clamped) break;
      }
      _setRows(merged.values.toList());
      page = loaded < 1 ? 1 : loaded;
      totalPages = last.totalPages;
      totalDays = last.totalDays;
      error = null;
    } on ApiException catch (e) {
      if (gen != _gen) return;
      Alerts.error(e.message);
    } catch (_) {
      if (gen != _gen) return;
      Alerts.error('Failed to load entries');
    }
    refreshing = false;
    loading = false;
    notifyListeners();
    unawaited(loadRangeOptions());
  }

  /// Pull-to-refresh: back to the first page of the same selection, and the
  /// calendar / reference lists again.
  Future<void> refresh() async {
    await Future.wait([
      loadFirst(keepRows: true),
      if (!referenceLoaded) _loadReference() else _reloadCalendar(),
      loadRangeOptions(),
    ]);
  }

  Future<void> _reloadCalendar() async {
    try {
      final holidays = asList(await Api.get(Endpoints.companyHolidays));
      final weekly = asMap(await Api.get(Endpoints.weeklyOff));
      final off = weekly['weeklyOffDays'];
      if (_disposed) return;
      calendar = WorkingCalendar(
        weeklyOffDays: off is List ? [for (final e in off) if (e is num && e.isFinite) e.toInt()] : null,
        holidays: holidays,
      );
      notifyListeners();
    } catch (_) {
      // Keep the calendar we had.
    }
  }

  // ── filters ──────────────────────────────────────────────────────────────

  /// Applies a new period and machine/operator/part selection (from the
  /// Filters sheet) and starts again from the first page.
  Future<void> applyQuery(List<String> newRange, SheetFilters newFilters) async {
    final rangeChanged = !listEquals(newRange, range);
    if (!rangeChanged && newFilters == filters) return;
    range = List.unmodifiable(newRange);
    filters = newFilters;
    _days = null;
    await Future.wait([loadFirst(), if (rangeChanged) loadRangeOptions()]);
  }

  /// Drops one slicer (a chip's ✕).
  Future<void> clearDim(String dim) => applyQuery(range, filters.withDim(dim, const []));

  /// Back to a fresh default period with no filters.
  Future<void> clearAll() async {
    final fresh = defaultEntryRange();
    final rangeChanged = !listEquals(fresh, range);
    baseRange = fresh;
    range = fresh;
    filters = SheetFilters.empty;
    _days = null;
    await Future.wait([loadFirst(), if (rangeChanged) loadRangeOptions()]);
  }

  /// Search matches Part Name, Operator or Drawing No. among the LOADED rows —
  /// like the web, not the whole selection.
  void setSearch(String value) {
    if (value == search) return;
    search = value;
    _days = null;
    notifyListeners();
  }

  // ── mutations ────────────────────────────────────────────────────────────

  /// DELETE /production-sheet/row/:id. True when the entry is gone.
  Future<bool> deleteRow(Json row) async {
    if (deletingId != null) return false;
    deletingId = '${row['_id']}';
    notifyListeners();
    var ok = false;
    try {
      final res = await Api.delete('${Endpoints.productionSheetRow}/${row['_id']}');
      final msg = res['message'];
      Alerts.success(msg is String && msg.isNotEmpty ? msg : 'Entry deleted successfully!');
      ok = true;
    } on ApiException catch (e) {
      Alerts.error(e.message.isEmpty ? 'Failed to delete the entry. Please try again.' : e.message);
    } catch (_) {
      Alerts.error('Failed to delete the entry. Please try again.');
    }
    deletingId = null;
    notifyListeners();
    if (ok && !_disposed) await reloadLoaded();
    return ok;
  }

  /// PUT /production-sheet/row/:id/unlock (Super Admin) — 24 hours of edit /
  /// delete access on this one entry. True when it worked.
  Future<bool> unlockRow(Json row) async {
    if (unlockingId != null) return false;
    unlockingId = '${row['_id']}';
    notifyListeners();
    var ok = false;
    try {
      final res = await Api.put('${Endpoints.productionSheetRow}/${row['_id']}/unlock');
      final msg = res['message'];
      Alerts.success(msg is String && msg.isNotEmpty ? msg : 'Unlocked for 24 hours');
      final data = res['data'];
      final until = data is Map ? data['unlockedUntil'] : null;
      final at = _rows.indexWhere((r) => r['_id'] == row['_id']);
      if (at >= 0) {
        final next = [..._rows];
        next[at] = {...next[at], 'unlockedUntil': until ?? DateTime.now().add(const Duration(hours: 24)).toUtc().toIso8601String()};
        _setRows(next);
      }
      ok = true;
    } on ApiException catch (e) {
      Alerts.error(e.message.isEmpty ? 'Could not unlock this entry' : e.message);
    } catch (_) {
      Alerts.error('Could not unlock this entry');
    }
    unlockingId = null;
    notifyListeners();
    return ok;
  }
}

String _idOf(Object? v) => v is Map ? '${v['_id'] ?? ''}' : '${v ?? ''}';
