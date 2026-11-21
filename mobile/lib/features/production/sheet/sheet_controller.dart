import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import '../../../core/utils/alerts.dart';
import '../process/process_spec.dart';
import '../processes/cnc/cnc_spec.dart' show cncSpec;
import '../shared/production_sheet_calc.dart' show jsTruthy, sortByMachineOn;
import '../shared/vendors.dart' show anyVendorFor;
import 'table/sheet_columns.dart' show SheetColumns, SheetEnv;
import 'machine_day_status.dart';
import 'sheet_model.dart';
import 'sheet_period.dart';
import 'working_days.dart';

/// The CNC page's route. A process whose Data Entry Page resolves to a spec's
/// route scopes the machine picker (see [SheetController.lockedProcess]).
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
///
/// Which process this is — its endpoints, formulas and the page that scopes its
/// machines — comes from [spec] (CNC by default).
class SheetController extends ChangeNotifier {
  SheetController({List<String>? initialRange, this.spec = cncSpec}) : range = initialRange ?? defaultEntryRange() {
    baseRange = range;
  }

  /// The process whose Data Entry list this is.
  final ProcessSpec spec;

  /// The spec's `extraReference` lists by name, loaded once with the rest.
  Map<String, List<Json>> extra = const {};

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

  // "Machines" the spec offers that the machine list does not hold (Powder
  // Coating's workers) — named and ranked after the real ones.
  Map<String, String> _extraName = const {};
  Map<String, int> _extraRank = const {};
  List<Json> _extraMachines = const [];

  // Names the API itself sends for the machines (workers) its rows mention
  // (`machineNames`) — a worker deactivated since still has one.
  Map<String, String> _serverNames = const {};

  Map<String, String> get machineName =>
      (_extraName.isEmpty && _serverNames.isEmpty) ? _machineName : {..._serverNames, ..._extraName, ..._machineName};

  void _absorbNames(Object? res) {
    final names = res is Map ? res['machineNames'] : null;
    if (names is! Map || names.isEmpty) return;
    final next = {for (final e in names.entries) '${e.key}': '${e.value}'};
    if (next.entries.every((e) => _serverNames[e.key] == e.value)) return;
    _serverNames = {..._serverNames, ...next};
    _days = null;
  }

  Json? machineOf(String id) {
    for (final m in machines) {
      if ('${m['_id']}' == id) return m;
    }
    for (final m in _extraMachines) {
      if ('${m['_id']}' == id) return m;
    }
    return null;
  }

  /// Where a machine sits in the sheet order the API returns (a machine that
  /// has since been deactivated ranks after every listed one).
  int rankOf(String machineId) => _machineRank[machineId] ?? _extraRank[machineId] ?? 1 << 30;

  void _refreshExtraMachines() {
    final extras = [
      for (final m in scopedMachines)
        if (!_machineName.containsKey('${m['_id']}')) m,
    ];
    _extraMachines = extras;
    _extraName = {for (final m in extras) '${m['_id']}': '${m['machineName'] ?? '—'}'};
    _extraRank = {for (var i = 0; i < extras.length; i++) '${extras[i]['_id']}': _machineRank.length + i};
  }

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
    final owners = processes.where(spec.ownsProcess).toList();
    return owners.length == 1 ? owners.first : null;
  }

  List<Json> get scopedMachines =>
      spec.scopeMachines(machines: machines, operators: operators, lockedProcess: lockedProcess);

  /// The parts the Part picker offers: with this page linked to a process, its
  /// parts plus any not given a process yet (like the web) — or every part when
  /// the spec keeps the unscoped behaviour.
  List<Json> get scopedItems {
    final p = lockedProcess;
    if (p == null || !spec.scopeItemsToProcess) return items;
    final pid = '${p['_id']}';
    return items.where((it) {
      final owner = it['process'];
      return owner == null || owner == '' || _idOf(owner) == pid;
    }).toList();
  }

  // ── vendors (specs with `usesVendors`) ────────────────────────────────────

  /// Vendor Master, loaded with the other reference lists when the spec uses
  /// vendors (empty otherwise).
  List<Json> get vendors => extra['vendors'] ?? const [];

  /// The web's `showVendorColumn`: the page's process (or, unlinked, any of the
  /// machines' processes) has vendors, or a loaded entry already names one.
  bool get showVendorColumn {
    if (!spec.usesVendors) return false;
    final p = lockedProcess;
    final ids = p != null ? [p['_id']] : [for (final m in machines) m['process']];
    return anyVendorFor(vendors, ids) || _rows.any((r) => jsTruthy(r['vendorName']));
  }

  /// The page's facts a column may depend on (see [SheetCol.shownWhen]).
  SheetEnv get env => SheetEnv(showVendor: showVendorColumn);

  /// The spec's table columns for the open breakdowns [open], minus the optional
  /// ones this page hides. A spec without optional columns gets its own object.
  SheetColumns columnsFor(Set<String> open) => spec.columns(open).where(env);

  /// The loaded pages' dates (server meta.dates): every working day up to
  /// today, so a day with nothing entered still shows — see [days].
  List<String> _dates = const [];

  /// The machines expected on every day: the page's scoped machines on a
  /// machine sheet; none on a worker sheet (its row key is a person).
  List<Json> get placeholderMachines {
    if (spec.machineNoun != 'machine') return const [];
    final picked = filters.machine.toSet();
    return [for (final m in scopedMachines) if (picked.isEmpty || picked.contains('${m['_id']}')) m];
  }

  /// The date/machine groups the list draws (filters and search applied),
  /// with a "Not filled yet" card for every machine missing from a day.
  List<SheetDay> get days => _days ??= buildSheetDays(
        rows: _rows,
        filters: filters,
        search: search,
        machineName: machineName,
        rankOf: rankOf,
        searchKeys: spec.searchKeys,
        byMachineOn: spec.entriesByMachineOn,
        dates: _dates,
        placeholderMachines: placeholderMachines,
        dayPlaceholder: spec.machineNoun != 'machine',
      );

  // ── "Not running" marks (machine-day-status) ─────────────────────────────

  late final DayStatusRepository dayStatus = DayStatusRepository(dayStatusSheetKey(spec.key));

  /// The reasons a day can be marked with (the server's list once loaded).
  List<DayStatusReason> reasons = DayStatusReason.fallback;
  bool _reasonsLoaded = false;

  Map<String, DayMark> _marks = const {};
  int _marksGen = 0;

  /// The "Not running" mark of an empty card, if any.
  DayMark? markOf(String date, String machineId) => _marks[markKey(date, machineId)];

  /// The unmarked empty cards' row keys on [date] (machines that could still be
  /// marked together).
  List<String> unfilledOn(String date) {
    for (final d in days) {
      if (d.date != date) continue;
      return [
        for (final m in d.machines)
          if (m.entries.isEmpty && m.totalEntries == 0 && markOf(date, m.machineId) == null) m.machineId,
      ];
    }
    return const [];
  }

  Future<void> ensureReasons() async {
    if (_reasonsLoaded) return;
    try {
      final list = await dayStatus.reasons();
      if (list.isNotEmpty) reasons = list;
      _reasonsLoaded = true;
      notifyListeners();
    } catch (_) {
      // Keep the built-in list; the server re-checks the reason anyway.
    }
  }

  /// Marks for every loaded date (silently empty when the call fails).
  Future<void> loadMarks() async {
    if (_dates.isEmpty) return;
    final sorted = [..._dates]..sort();
    final gen = ++_marksGen;
    try {
      final list = await dayStatus.marks(sorted.first, sorted.last);
      if (_disposed || gen != _marksGen) return;
      _marks = {for (final m in list) m.key: m};
      notifyListeners();
    } catch (_) {
      // The cards just read "Not filled yet".
    }
  }

  /// PUT /machine-day-status. Throws [ApiException] with the server's message.
  Future<void> saveMark({required String date, required List<String> machines, required List<String> reasons, required String remarks}) async {
    final msg = await dayStatus.save(date: date, machines: machines, reasons: reasons, remarks: remarks);
    Alerts.success(msg ?? 'Marked as not running');
    await loadMarks();
  }

  /// DELETE /machine-day-status — the card reads "Not filled yet" again.
  Future<bool> removeMark(DayMark mark) async {
    try {
      await dayStatus.remove(date: mark.date, machine: mark.machine);
      _marks = {..._marks}..remove(mark.key);
      notifyListeners();
      Alerts.success('Not running mark removed');
      unawaited(loadMarks());
      return true;
    } on ApiException catch (e) {
      Alerts.error(e.message.isEmpty ? 'Could not remove the mark' : e.message);
    } catch (_) {
      Alerts.error('Could not remove the mark');
    }
    return false;
  }

  /// dayCalc figures of an entry (Unutilized, Unreported, the three OEEs, gap).
  /// Worked out over the machine's WHOLE date as fetched — never just the
  /// entries the operator/part filters leave visible.
  Json dayOf(Json row) => _dayResults['${row['_id']}'] ?? const {};

  /// rowCalc figures of an entry, cached per row.
  Json calcOf(Json row) => _calcCache.putIfAbsent('${row['_id']}', () => spec.rowCalc(row));

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
        'machine' => machineName[value] ?? '—',
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

  /// Super Admin / Full access: edits a locked row anyway (server:
  /// utils/adminAccess.js decides the same). Set by the screen.
  bool isAdmin = false;

  /// "" while the entry is still open to everyone, else why it is locked: an
  /// entry is open for [lockHours] after it was saved (createdAt); one with a
  /// still-current `unlockedUntil` is never locked. An admin is let through
  /// a locked row ([canChange]) and offered Unlock for it, for everyone else.
  /// Preview only — the server re-checks on every save / delete.
  String lockInfo(Json row) {
    if (_unlockedUntil(row) != null) return '';
    final created = DateTime.tryParse('${row['createdAt'] ?? ''}');
    if (created == null) return '';
    final until = created.add(lockWindow).toLocal();
    if (until.isAfter(DateTime.now())) return '';
    String two(int n) => n.toString().padLeft(2, '0');
    return 'Locked — saved more than $lockHours hours ago (was editable until ${two(until.day)}/${two(until.month)}/${until.year} ${two(until.hour)}:${two(until.minute)})';
  }

  bool isLocked(Json row) => lockInfo(row).isNotEmpty;

  /// Whether this user may edit / delete the row despite its lock.
  bool canChange(Json row) => isAdmin || !isLocked(row);

  /// Whether this user may edit / undo a Not running mark: on the day it was
  /// saved anyone who can add entries may; after that only an Admin.
  bool canChangeMark(DayMark m) => isAdmin || !m.locked;

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
      soft(() async => asMap(await Api.get(spec.api.extent))),
      for (final path in spec.referenceLists.values) soft(() => list(path)),
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
    final extraNames = spec.referenceLists.keys.toList();
    extra = {
      for (var i = 0; i < extraNames.length; i++) extraNames[i]: (results[7 + i] as List<Json>?) ?? extra[extraNames[i]] ?? const <Json>[],
    };
    extent = (ext != null && ext['from'] != null && ext['to'] != null) ? ext : null;

    _refreshExtraMachines();
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
    final res = await Api.get(spec.api.filterOptions, query: {'from': from, 'to': to});
    _absorbNames(res);
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

  Future<Json> _fetchPage(int p) async {
    final res = await Api.get(spec.api.list, query: {
      'from': range[0],
      'to': range[1],
      'page': p,
      if (filters.machine.isNotEmpty) spec.api.machineParam: filters.machine.join(','),
      if (filters.operator.isNotEmpty) 'operator': filters.operator.join(','),
      if (filters.item.isNotEmpty) 'item': filters.item.join(','),
    });
    _absorbNames(res);
    return res;
  }

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

  ({int page, int totalPages, int totalDays, List<String> dates}) _meta(Json res, int asked) {
    final meta = res['meta'];
    int intOf(Object? v, int d) => v is num ? (v.isFinite ? v.toInt() : d) : (int.tryParse('$v') ?? d);
    if (meta is! Map) return (page: asked, totalPages: 1, totalDays: 0, dates: const []);
    final tp = intOf(meta['totalPages'], 1);
    final dates = [for (final d in (meta['dates'] as List? ?? const [])) if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch('$d')) '$d'];
    return (page: intOf(meta['page'], asked), totalPages: tp < 1 ? 1 : tp, totalDays: intOf(meta['totalDays'], 0), dates: dates);
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
      final results = spec.dayCalc(sorted);
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
      _dates = meta.dates;
      _setRows(_normalize(res));
      page = meta.page;
      totalPages = meta.totalPages;
      totalDays = meta.totalDays;
      unawaited(loadMarks());
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
        _dates = {..._dates, ...meta.dates}.toList();
        _setRows([..._rows, ..._normalize(res).where((r) => !seen.contains('${r['_id']}'))]);
        page = meta.page;
        totalPages = meta.totalPages;
        totalDays = meta.totalDays;
        unawaited(loadMarks());
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
      var last = (page: 1, totalPages: totalPages, totalDays: totalDays, dates: const <String>[]);
      var loaded = 0;
      final dates = <String>{};
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
          dates.addAll(meta.dates);
        }
        if (clamped) break;
      }
      _dates = dates.toList();
      _setRows(merged.values.toList());
      page = loaded < 1 ? 1 : loaded;
      totalPages = last.totalPages;
      totalDays = last.totalDays;
      error = null;
      unawaited(loadMarks());
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

  /// DELETE {sheet}/row/:id. True when the entry is gone.
  Future<bool> deleteRow(Json row) async {
    if (deletingId != null) return false;
    deletingId = '${row['_id']}';
    notifyListeners();
    var ok = false;
    try {
      final res = await Api.delete('${spec.api.row}/${row['_id']}');
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

  /// PUT {sheet}/row/:id/unlock (Super Admin) — 24 hours of edit /
  /// delete access on this one entry. True when it worked.
  Future<bool> unlockRow(Json row) async {
    if (unlockingId != null) return false;
    unlockingId = '${row['_id']}';
    notifyListeners();
    var ok = false;
    try {
      final res = await Api.put('${spec.api.row}/${row['_id']}/unlock');
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
