import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/app_scaffold.dart';
import '../../core/api/api_client.dart' show ApiException;
import '../../core/utils/alerts.dart';
import '../../core/widgets/states.dart';
import 'audit_models.dart';
import 'audit_repository.dart';
import 'audit_widgets.dart';

/// Width from which the filters sit in a left panel beside the list.
const double auditTabletMinWidth = 700;

/// Production › Audit Trail — every change made in the software: who created,
/// edited, deleted, unlocked or marked what, and when (ISO / IATF audit
/// style). Filters, infinite scroll (50 a page), pull-to-refresh and a CSV
/// export through the share sheet.
class AuditTrailScreen extends StatefulWidget {
  const AuditTrailScreen({super.key, this.initialFilters});

  /// Opened from a record's History sheet with that record pre-filtered.
  final AuditFilters? initialFilters;

  @override
  State<AuditTrailScreen> createState() => _AuditTrailScreenState();
}

class _AuditTrailScreenState extends State<AuditTrailScreen> {
  static const _repo = AuditRepository();

  late AuditFilters _filters = widget.initialFilters ?? AuditFilters.lastDays(30);
  AuditFilterOptions _options = const AuditFilterOptions();
  List<AuditLog> _logs = const [];
  int _total = 0;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String? _moreError;
  bool _exporting = false;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_loadOptions());
    unawaited(_load());
  }

  Future<void> _loadOptions() async {
    try {
      final o = await _repo.filterOptions();
      if (mounted) setState(() => _options = o);
    } catch (_) {
      // The dropdowns simply stay short; the list still loads.
    }
  }

  Future<void> _load() async {
    final id = ++_request;
    setState(() {
      _loading = true;
      _error = null;
      _moreError = null;
    });
    try {
      final page = await _repo.logs(_filters, skip: 0);
      if (!mounted || id != _request) return;
      setState(() {
        _logs = page.logs;
        _total = page.total;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || id != _request) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || id != _request) return;
      setState(() {
        _error = 'Could not load the audit trail.';
        _loading = false;
      });
    }
  }

  bool get _hasMore => _logs.length < _total;

  Future<void> _loadMore() async {
    if (_loadingMore || _loading || !_hasMore) return;
    final id = _request;
    setState(() {
      _loadingMore = true;
      _moreError = null;
    });
    try {
      final page = await _repo.logs(_filters, skip: _logs.length);
      if (!mounted || id != _request) return;
      setState(() {
        final seen = _logs.map((l) => l.id).toSet();
        _logs = [..._logs, ...page.logs.where((l) => l.id.isEmpty || !seen.contains(l.id))];
        _total = page.total;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      if (!mounted || id != _request) return;
      setState(() {
        _moreError = e.message;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted || id != _request) return;
      setState(() {
        _moreError = 'Could not load more.';
        _loadingMore = false;
      });
    }
  }

  void _apply(AuditFilters f) {
    if (f == _filters) return;
    setState(() => _filters = f);
    unawaited(_load());
  }

  Future<void> _openFilterSheet() async {
    final picked = await showModalBottomSheet<AuditFilters>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
          child: FiltersSheet(
            key: const ValueKey('audit-filters-sheet'),
            initial: _filters,
            options: _options,
            inSheet: true,
            onApply: (f) => Navigator.of(ctx).pop(f),
          ),
        ),
      ),
    );
    if (picked != null) _apply(picked);
  }

  Future<void> _export(BuildContext anchor) async {
    if (_exporting) return;
    setState(() => _exporting = true);
    // Where the share sheet pops from on iPad (read before the download).
    Rect? origin;
    final box = anchor.findRenderObject();
    if (box is RenderBox && box.hasSize) origin = box.localToGlobal(Offset.zero) & box.size;
    try {
      final bytes = await _repo.exportCsv(_filters);
      await shareCsv(bytes, auditExportFileName(_filters), origin: origin);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } catch (_) {
      Alerts.error('Could not export the CSV. Please try again.');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  // ── active filter chips ──────────────────────────────────────────────

  List<_Chip> _chips() {
    final f = _filters;
    final o = _options;
    final chips = <_Chip>[];
    if (f.hasDateRange) {
      final text = f.from.isNotEmpty && f.to.isNotEmpty
          ? '${displayDay(f.from)} – ${displayDay(f.to)}'
          : f.from.isNotEmpty
              ? 'From ${displayDay(f.from)}'
              : 'To ${displayDay(f.to)}';
      chips.add(_Chip('dates', text, () => _apply(f.copyWith(from: '', to: ''))));
    }
    for (final m in f.modules) {
      chips.add(_Chip('module-$m', o.moduleLabel(m), () => _apply(f.copyWith(modules: f.modules.where((x) => x != m).toList()))));
    }
    for (final a in f.actions) {
      chips.add(_Chip('action-$a', o.actionLabel(a), () => _apply(f.copyWith(actions: f.actions.where((x) => x != a).toList()))));
    }
    if (f.actor.isNotEmpty) chips.add(_Chip('actor', 'User: ${o.actorName(f.actor)}', () => _apply(f.copyWith(actor: ''))));
    if (f.q.isNotEmpty) chips.add(_Chip('q', '"${f.q}"', () => _apply(f.copyWith(q: ''))));
    if (f.sheet.isNotEmpty) chips.add(_Chip('sheet', 'Sheet: ${f.sheet}', () => _apply(f.copyWith(sheet: ''))));
    if (f.entity.isNotEmpty) chips.add(_Chip('entity', 'Record ${f.entity}', () => _apply(f.copyWith(entity: ''))));
    if (f.machine.isNotEmpty) chips.add(_Chip('machine', 'Machine ${f.machine}', () => _apply(f.copyWith(machine: ''))));
    if (f.date.isNotEmpty) chips.add(_Chip('date', 'Day ${displayDay(f.date)}', () => _apply(f.copyWith(date: ''))));
    return chips;
  }

  // ── build ────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final tablet = width >= auditTabletMinWidth;
    return AppScaffold(
      title: 'Audit Trail',
      actions: [
        if (!tablet)
          IconButton(key: const ValueKey('audit-filter-button'), tooltip: 'Filter', onPressed: _openFilterSheet, icon: const Icon(LucideIcons.listFilter)),
        PopupMenuButton<String>(
          key: const ValueKey('audit-more'),
          tooltip: 'More',
          onSelected: (v) {
            if (v == 'export') unawaited(_export(context));
            if (v == 'refresh') unawaited(_load());
          },
          itemBuilder: (_) => [
            PopupMenuItem(
              key: const ValueKey('audit-export-csv'),
              value: 'export',
              enabled: !_exporting,
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(LucideIcons.download, size: 18),
                const SizedBox(width: 10),
                Text(_exporting ? 'Exporting…' : 'Export CSV'),
              ]),
            ),
            const PopupMenuItem(
              value: 'refresh',
              child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.refresh, size: 18), SizedBox(width: 10), Text('Refresh')]),
            ),
          ],
        ),
      ],
      body: tablet
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 280,
                  child: Material(
                    key: const ValueKey('audit-filters-panel'),
                    color: Theme.of(context).colorScheme.surfaceContainerLow,
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: FiltersSheet(initial: _filters, options: _options, onApply: _apply),
                    ),
                  ),
                ),
                VerticalDivider(width: 1, thickness: 1, color: Theme.of(context).colorScheme.outlineVariant),
                Expanded(child: _list(context)),
              ],
            )
          : _list(context),
    );
  }

  Widget _list(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final chips = _chips();
    final header = <Widget>[
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
        child: Text(
          'Every change made in the software — who did it, what changed and when. Times are IST.',
          style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
        ),
      ),
      if (chips.isNotEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              for (final c in chips)
                InputChip(
                  key: ValueKey('audit-chip-${c.id}'),
                  label: Text(c.label, overflow: TextOverflow.ellipsis),
                  onDeleted: c.remove,
                  deleteButtonTooltipMessage: 'Remove',
                  visualDensity: VisualDensity.compact,
                  labelStyle: const TextStyle(fontSize: 12.5),
                ),
            ],
          ),
        ),
      Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
        child: Text(
          _loading ? 'Loading…' : '$_total ${_total == 1 ? 'record' : 'records'}',
          key: const ValueKey('audit-summary'),
          style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: s.onSurfaceVariant),
        ),
      ),
    ];

    Widget body;
    if (_loading && _logs.isEmpty) {
      body = const LoadingView(label: 'Loading the audit trail…');
    } else if (_error != null && _logs.isEmpty) {
      body = ErrorView(message: _error!, onRetry: _load);
    } else if (_logs.isEmpty) {
      body = EmptyView(
        icon: LucideIcons.history,
        message: _filters.hasNarrowing
            ? 'No change matches these filters. Remove a filter or widen the dates.'
            : 'No change recorded in this period. Widen the dates to see earlier ones.',
      );
    } else {
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.axis == Axis.vertical && n.metrics.pixels >= n.metrics.maxScrollExtent - 400) {
            unawaited(_loadMore());
          }
          return false;
        },
        child: ListView.builder(
          key: const ValueKey('audit-list'),
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 24),
          itemCount: _logs.length + 1,
          itemBuilder: (_, i) {
            if (i == _logs.length) return _footer(context);
            final l = _logs[i];
            return AuditLogTile(key: ValueKey('audit-log-${l.id.isEmpty ? i : l.id}'), log: l, actionLabel: _options.actions.isEmpty ? null : _options.actionLabel(l.action));
          },
        ),
      );
    }

    // The header scrolls with the list only when the list is a list; the
    // states (loading / error / empty) sit under a fixed header.
    final column = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...header,
        Expanded(child: body),
      ],
    );
    return RefreshIndicator(
      onRefresh: _load,
      child: _logs.isEmpty && !_loading
          ? LayoutBuilder(
              builder: (_, c) => SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                child: SizedBox(height: c.maxHeight, child: column),
              ),
            )
          : column,
    );
  }

  Widget _footer(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    if (_loadingMore) {
      return const Padding(
        key: ValueKey('audit-loading-more'),
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))),
      );
    }
    if (_moreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(children: [
          Text(_moreError!, style: TextStyle(color: s.error, fontSize: 12.5), textAlign: TextAlign.center),
          TextButton.icon(onPressed: _loadMore, icon: const Icon(Icons.refresh, size: 18), label: const Text('Try again')),
        ]),
      );
    }
    if (_hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Center(
          child: TextButton(key: const ValueKey('audit-load-more'), onPressed: _loadMore, child: Text('Load more (${_total - _logs.length} left)')),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Text('That is every record.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
    );
  }
}

class _Chip {
  const _Chip(this.id, this.label, this.remove);
  final String id;
  final String label;
  final VoidCallback remove;
}
