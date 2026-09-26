import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../app/app_scaffold.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/page_permissions.dart';
import '../../core/widgets/states.dart';
import '../../providers/auth_provider.dart';
import 'shared/production_sheet_calc.dart' show jsNumber;
import 'sheet/editor/entry_editor_screen.dart';
import 'sheet/sheet_controller.dart';
import 'sheet/sheet_model.dart';
import 'sheet/sheet_period.dart';
import 'sheet/table/sheet_table.dart';
import 'sheet/widgets/machine_day_card.dart';
import 'sheet/widgets/sheet_day_header.dart';
import 'sheet/widgets/sheet_filter_bar.dart';
import 'sheet/widgets/sheet_filter_sheet.dart';
import 'sheet/widgets/sheet_states.dart';
import 'sheet/widgets/sheet_view_toggle.dart';

const double _headerExtent = 36;
const String _viewPref = 'sheet_view_mode';

/// Data Entry — the production sheet (client/src/pages/ProductionSheet.jsx):
/// pages of dates from the server, shown as the web-style table (default) or
/// as one card per machine-day, with filters + search, the 2-working-day lock,
/// and the entry editor for add / edit.
///
/// Phone (shortest side < 600): one compact column, the table scrolls sideways
/// under frozen Date + Machine columns. iPad / wide: the full width, the
/// toolbar on one row like the web, the editor as a centred dialog.
class ProductionSheetScreen extends StatefulWidget {
  const ProductionSheetScreen({super.key});

  @override
  State<ProductionSheetScreen> createState() => _ProductionSheetScreenState();
}

class _ProductionSheetScreenState extends State<ProductionSheetScreen> with AutomaticKeepAliveClientMixin {
  late final SheetController _c = SheetController();
  final TextEditingController _search = TextEditingController();
  final ScrollController _scroll = ScrollController(); // cards
  final ScrollController _tableV = ScrollController();
  final ScrollController _tableH = ScrollController();
  final GlobalKey _viewportKey = GlobalKey();
  final Set<String> _expanded = {};
  final Map<String, GlobalKey> _anchorKeys = {};
  final Map<String, GlobalKey> _cardKeys = {};

  Timer? _debounce;
  SheetView _view = SheetView.table;
  bool _opening = false;
  bool _checkQueued = false;
  bool _tablet = false;

  List<SheetDay>? _itemsDays;
  List<SheetTableItem> _items = const [];

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    unawaited(_c.start());
    _tableV.addListener(_onTableScroll);
    unawaited(_loadView());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _c.dispose();
    _search.dispose();
    _scroll.dispose();
    _tableV.removeListener(_onTableScroll);
    _tableV.dispose();
    _tableH.dispose();
    super.dispose();
  }

  Future<void> _loadView() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_viewPref);
      if (!mounted || saved == null) return;
      final next = saved == 'cards' ? SheetView.cards : SheetView.table;
      if (next != _view) setState(() => _view = next);
    } catch (_) {
      // No stored choice: the table stays.
    }
  }

  Future<void> _setView(SheetView v) async {
    if (v == _view) return;
    // Keep the same date at the top when the layout changes underneath.
    final keep = _topDateNow();
    setState(() => _view = v);
    if (keep != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_scrollToDate(keep));
      });
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_viewPref, v.name);
    } catch (_) {
      // Remembering the choice is a convenience only.
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  void _onSearch(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) _c.setSearch(value);
    });
  }

  void _openFilters() {
    showSheetFilters(
      context,
      range: _c.range,
      extent: _c.extent,
      filters: _c.filters,
      options: _c.filterOptions,
      loadOptions: (range, selected) async {
        final present = await _c.fetchFilterOptions(range[0], range[1]);
        return _c.optionsFor(present, selected);
      },
      onApply: (range, filters) => unawaited(_c.applyQuery(range, filters)),
    );
  }

  void _clearAll() {
    _debounce?.cancel();
    _search.clear();
    _c.setSearch('');
    unawaited(_c.clearAll());
  }

  String? _initialMachine() {
    final picked = _c.filters.machine;
    if (picked.length != 1) return null;
    return _c.scopedMachines.any((m) => '${m['_id']}' == picked.first) ? picked.first : null;
  }

  /// The editor as a full-screen route on a phone, as a large centred dialog on
  /// an iPad (the form itself is capped at 720 px wide inside).
  Future<bool?> _presentEditor(Widget editor) {
    final size = MediaQuery.sizeOf(context);
    if (size.shortestSide < 600) {
      return Navigator.of(context).push<bool>(MaterialPageRoute<bool>(builder: (_) => editor));
    }
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        final s = MediaQuery.sizeOf(ctx);
        final w = math.min(900.0, s.width - 48);
        final h = math.min(900.0, s.height - 48);
        return Dialog(
          insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: SizedBox(
            width: w,
            height: h,
            // The dialog already lifts itself above the keyboard.
            child: MediaQuery.removeViewInsets(context: ctx, removeBottom: true, child: editor),
          ),
        );
      },
    );
  }

  Future<void> _openEditor(Json? row) async {
    if (_opening) return;
    _opening = true;
    try {
      final ready = await _c.ensureReference();
      if (!mounted) return;
      if (!ready) {
        Alerts.error('Could not load machines, parts and operators. Check the connection and try again.');
        return;
      }
      final saved = await _presentEditor(
        EntryEditorScreen(
          row: row,
          initialMachineId: row == null ? _initialMachine() : null,
          machines: _c.scopedMachines,
          items: _c.items,
          operators: _c.operators,
        ),
      );
      if (!mounted) return;
      if (saved == true) await _c.reloadLoaded();
    } finally {
      _opening = false;
    }
  }

  Future<void> _edit(Json row) async {
    final lock = _c.lockInfo(row);
    if (lock.isNotEmpty) {
      Alerts.error(lock);
      return;
    }
    await _openEditor(row);
  }

  String _describe(Json row) {
    final name = _c.machineName['${row['machine']}'] ?? 'machine';
    final n = jsNumber(row['slot']);
    final slot = (n == null || !n.isFinite) ? 0 : n.truncate();
    return '$name, entry #$slot on ${dmy('${row['date']}')}';
  }

  Future<void> _delete(Json row) async {
    final lock = _c.lockInfo(row);
    if (lock.isNotEmpty) {
      Alerts.error(lock);
      return;
    }
    final ok = await Alerts.confirm(
      context,
      "Delete ${_describe(row)}? This can't be undone.",
      title: 'Delete entry',
      confirmText: 'Delete',
    );
    if (!ok || !mounted) return;
    await _c.deleteRow(row);
  }

  Future<void> _unlock(Json row) async {
    final ok = await Alerts.confirm(
      context,
      'Unlock ${_describe(row)} for 24 hours? Anyone with edit access can then change or delete it until it locks again.',
      title: 'Unlock entry',
      confirmText: 'Unlock',
      danger: false,
    );
    if (!ok || !mounted) return;
    await _c.unlockRow(row);
  }

  // ── scrolling ────────────────────────────────────────────────────────────

  bool get _isTable => _view == SheetView.table;
  ScrollController get _activeScroll => _isTable ? _tableV : _scroll;

  GlobalKey _keyFor(Map<String, GlobalKey> map, String id) => map.putIfAbsent(id, GlobalKey.new);

  List<SheetTableItem> _tableItems() {
    final days = _c.days;
    if (!identical(days, _itemsDays)) {
      _itemsDays = days;
      _items = buildTableItems(days);
    }
    return _items;
  }

  double get _rowH => TableMetrics.rowHeight(_tablet);

  void _scheduleCheck() {
    if (_checkQueued) return;
    _checkQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkQueued = false;
      if (mounted) _autoLoad();
    });
  }

  void _autoLoad({bool scrolled = false}) {
    final pos = soleScrollPosition(_activeScroll);
    if (pos == null || !pos.hasContentDimensions || _c.moreError != null || !_c.hasMore) return;
    if (_c.search.isNotEmpty && !scrolled) return;
    if (pos.extentAfter > 700) return;
    unawaited(_c.loadMore());
  }

  void _onTableScroll() {
    if (!_isTable) return;
    _autoLoad(scrolled: true);
  }

  bool _onScroll(ScrollNotification n) {
    if (n.depth != 0) return false;
    if (n is ScrollUpdateNotification || n is ScrollEndNotification) {
      _scheduleCheck();
      _autoLoad(scrolled: true);
    }
    return false;
  }

  /// The date of the first row / card showing at the top of the list right now
  /// (null when there is nothing to measure yet).
  String? _topDateNow() {
    final days = _c.days;
    if (days.isEmpty) return null;
    if (_isTable) {
      final items = _tableItems();
      final pos = soleScrollPosition(_tableV);
      if (items.isEmpty || pos == null || !pos.hasPixels) return null;
      final idx = (pos.pixels / _rowH).floor().clamp(0, items.length - 1);
      return items[idx].date;
    }
    final vbox = _viewportKey.currentContext?.findRenderObject();
    if (vbox is! RenderBox || !vbox.attached) return null;
    final top = vbox.localToGlobal(Offset.zero).dy;
    for (final d in days) {
      final keys = [_anchorKeys[d.date], for (final m in d.machines) _cardKeys[m.key]];
      for (final k in keys) {
        final rb = k?.currentContext?.findRenderObject();
        if (rb is! RenderBox || !rb.attached || !rb.hasSize) continue;
        if (rb.localToGlobal(Offset.zero).dy + rb.size.height > top + 1) return d.date;
      }
    }
    return days.last.date;
  }

  Future<void> _scrollToDate(String date) async {
    if (_isTable) {
      final idx = _tableItems().indexWhere((i) => i.date == date);
      final pos = soleScrollPosition(_tableV);
      if (idx < 0 || pos == null || !pos.hasContentDimensions) return;
      pos.jumpTo((idx * _rowH).clamp(0.0, pos.maxScrollExtent));
      return;
    }
    final ctx = _anchorKeys[date]?.currentContext;
    if (ctx == null || !ctx.mounted) return;
    await Scrollable.ensureVisible(ctx);
  }

  // ── build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final perms = PagePermissions.of(context);
    final isAdmin = context.select<AuthProvider, bool>((a) => a.isSuperAdmin);
    final access = SheetAccess(canEdit: perms.edit, canDelete: perms.delete, isAdmin: isAdmin);
    final size = MediaQuery.sizeOf(context);
    _tablet = size.shortestSide >= 600;
    final wide = size.width >= 700;
    // The keyboard takes the floating button out of the way (it would sit on
    // top of the list, right above the keys).
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
    return AppScaffold(
      title: 'Data entry',
      // Wide screens carry an Add Entry button in the toolbar instead.
      floatingActionButton: perms.create && !wide && !keyboardUp
          ? FloatingActionButton.extended(
              key: const ValueKey('sheet-add'),
              onPressed: () => _openEditor(null),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add entry'),
            )
          : null,
      body: ListenableBuilder(
        listenable: _c,
        builder: (context, _) => _content(context, access, perms.create, size.width, wide),
      ),
    );
  }

  List<ActiveFilterChip> _chips() {
    final out = <ActiveFilterChip>[];
    void add(String id, String label, VoidCallback onRemove) =>
        out.add(ActiveFilterChip(id: id, label: label, onTap: _openFilters, onRemove: onRemove));
    if (!_c.isDefaultRange) {
      add('range', describeRange(_c.range), () => unawaited(_c.applyQuery(_c.baseRange, _c.filters)));
    }
    String summary(String prefix, String plural, String dim) {
      final v = _c.filters.of(dim);
      return v.length == 1 ? '$prefix: ${_c.optionLabel(dim, v.first)}' : '$plural: ${v.length} selected';
    }

    if (_c.filters.machine.isNotEmpty) add('machine', summary('MC', 'MC No.', 'machine'), () => unawaited(_c.clearDim('machine')));
    if (_c.filters.operator.isNotEmpty) add('operator', summary('Operator', 'Operators', 'operator'), () => unawaited(_c.clearDim('operator')));
    if (_c.filters.item.isNotEmpty) add('item', summary('Part', 'Parts', 'item'), () => unawaited(_c.clearDim('item')));
    return out;
  }

  Widget _content(BuildContext context, SheetAccess access, bool canCreate, double width, bool wide) {
    final days = _c.days;
    final chips = _chips();
    final showSkeleton = _c.loading && _c.rows.isEmpty && _c.error == null;
    final showError = _c.error != null && _c.rows.isEmpty;
    if (!showSkeleton && !showError) _scheduleCheck();

    Widget body;
    if (showSkeleton) {
      body = _isTable ? SheetTableSkeleton(tablet: _tablet) : const SheetSkeleton();
    } else if (showError) {
      body = ErrorView(message: _c.error!, onRetry: () => unawaited(_c.loadFirst()));
    } else if (days.isEmpty) {
      body = _emptyState(canCreate);
    } else {
      body = _isTable ? _table(days, access, wide) : _list(days, access, width);
    }

    // Judge the width in text-scaled terms: big text needs more room per control.
    final eff = width / math.max(1.0, MediaQuery.textScalerOf(context).scale(16) / 16);

    final extras = <Widget>[
      SheetViewToggle(value: _view, onChanged: (v) => unawaited(_setView(v)), labels: wide && eff >= 800),
      if (wide && canCreate)
        FilledButton.icon(
          key: const ValueKey('sheet-add'),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
          onPressed: () => _openEditor(null),
          icon: const Icon(Icons.add_rounded, size: 18),
          label: const Text('Add Entry'),
        ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetFilterBar(
          controller: _search,
          onSearchChanged: _onSearch,
          onOpenFilters: _openFilters,
          activeCount: (_c.isDefaultRange ? 0 : 1) + _c.filters.activeDims,
          chips: chips,
          onClearAll: _clearAll,
          wide: wide,
          extras: extras,
        ),
        Expanded(
          child: Stack(
            children: [
              // With the keyboard up in landscape the list can be left with a
              // few pixels: keep it mounted but skip drawing it (no overflow).
              Positioned.fill(
                key: _viewportKey,
                child: LayoutBuilder(builder: (context, box) => Offstage(offstage: box.maxHeight < 110, child: body)),
              ),
              if (_c.refreshing || (_c.loading && _c.rows.isNotEmpty))
                const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 2)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _emptyState(bool canCreate) {
    final s = Theme.of(context).colorScheme;
    final searching = _c.search.trim().isNotEmpty;
    final hiddenByFilter = _c.rows.isNotEmpty;
    final period = describeRange(_c.range);
    final String message;
    if (hiddenByFilter && searching) {
      message = 'No loaded entries match “${_c.search.trim()}”.';
    } else if (hiddenByFilter) {
      message = 'No loaded entries match the selected operator / part.';
    } else if (_c.filters.isNotEmpty) {
      message = 'No entries for $period with these filters.';
    } else {
      message = 'No entries for $period.${canCreate ? ' Tap “Add entry” to start.' : ''}';
    }
    return RefreshIndicator(
      onRefresh: _c.refresh,
      child: LayoutBuilder(
        builder: (context, box) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(minHeight: box.maxHeight),
              child: Center(
                child: EmptyView(
                  message: message,
                  icon: Icons.fact_check_outlined,
                  action: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      if (hiddenByFilter && _c.hasMore)
                        OutlinedButton.icon(
                          key: const ValueKey('empty-load-more'),
                          onPressed: () => unawaited(_c.loadMore()),
                          icon: const Icon(Icons.expand_more_rounded),
                          label: const Text('Load more days'),
                        ),
                      if (_c.filtersActive || searching)
                        TextButton.icon(
                          key: const ValueKey('empty-clear'),
                          onPressed: _clearAll,
                          style: TextButton.styleFrom(foregroundColor: s.error),
                          icon: const Icon(Icons.close_rounded, size: 18),
                          label: const Text('Clear filters'),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── table view ───────────────────────────────────────────────────────────

  Widget _table(List<SheetDay> days, SheetAccess access, bool wide) {
    final footer = SheetListFooter(
      loadingMore: _c.loadingMore,
      moreError: _c.moreError,
      hasMore: _c.hasMore,
      loadedDays: days.length,
      totalDays: _c.totalDays,
      searching: _c.search.trim().isNotEmpty,
      onLoadMore: () => unawaited(_c.loadMore()),
      bottomPad: wide ? 12 : 64,
    );
    return SheetTable(
      controller: _c,
      items: _tableItems(),
      access: access,
      tablet: _tablet,
      vController: _tableV,
      hController: _tableH,
      onEdit: _edit,
      onDelete: _delete,
      onUnlock: _unlock,
      onRefresh: _c.refresh,
      footer: footer,
      footerExtent: wide ? 96 : 132,
    );
  }

  // ── card view ────────────────────────────────────────────────────────────

  Widget _list(List<SheetDay> days, SheetAccess access, double width) {
    final now = DateTime.now();
    final cols = width >= 1000 ? 3 : (width >= 700 ? 2 : 1);
    // One flat list: a header row per date, then its machine cards (in rows of
    // [cols] on a wide screen). (Pinned headers inside SliverMainAxisGroup trip
    // a SliverGeometry assertion on Flutter 3.47, so the headers just scroll.)
    final items = <(SheetDay, List<SheetMachineDay>?)>[];
    for (final day in days) {
      items.add((day, null));
      for (var i = 0; i < day.machines.length; i += cols) {
        items.add((day, day.machines.sublist(i, math.min(i + cols, day.machines.length))));
      }
    }
    Widget card(SheetMachineDay group, {required bool multi}) => KeyedSubtree(
          key: _keyFor(_cardKeys, group.key),
          child: MachineDayCard(
            group: group,
            controller: _c,
            access: access,
            expanded: _expanded,
            margin: multi ? const EdgeInsets.fromLTRB(6, 0, 6, 8) : const EdgeInsets.fromLTRB(12, 0, 12, 8),
            onToggle: (id) => setState(() => _expanded.contains(id) ? _expanded.remove(id) : _expanded.add(id)),
            onEdit: _edit,
            onDelete: _delete,
            onUnlock: _unlock,
          ),
        );
    return RefreshIndicator(
      onRefresh: _c.refresh,
      child: NotificationListener<ScrollNotification>(
        onNotification: _onScroll,
        child: CustomScrollView(
          key: const ValueKey('sheet-list'),
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverList.builder(
              itemCount: items.length,
              itemBuilder: (context, i) {
                final (day, group) = items[i];
                if (group == null) {
                  return Padding(
                    padding: EdgeInsets.only(top: i == 0 ? 2 : 6),
                    child: KeyedSubtree(
                      key: _keyFor(_anchorKeys, day.date),
                      child: SizedBox(
                        height: _headerExtent,
                        child: SheetDayHeader(day: day, calendar: _c.calendar, now: now),
                      ),
                    ),
                  );
                }
                if (cols == 1) return card(group.first, multi: false);
                return Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var c = 0; c < cols; c++) Expanded(child: c < group.length ? card(group[c], multi: true) : const SizedBox.shrink()),
                    ],
                  ),
                );
              },
            ),
            SliverToBoxAdapter(
              child: SheetListFooter(
                loadingMore: _c.loadingMore,
                moreError: _c.moreError,
                hasMore: _c.hasMore,
                loadedDays: days.length,
                totalDays: _c.totalDays,
                searching: _c.search.trim().isNotEmpty,
                onLoadMore: () => unawaited(_c.loadMore()),
                bottomPad: width >= 700 ? 16 : 72,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
