import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../app/navigation.dart';
import '../../core/api/api_client.dart' show ApiException;
import '../../core/utils/alerts.dart';
import '../../core/widgets/common_widgets.dart';
import '../../core/widgets/page_permissions.dart';
import '../../core/widgets/states.dart';
import '../../models/menu_models.dart' show PagePerms;
import '../../providers/menu_provider.dart';
import 'process_master/process_form_screen.dart';
import 'process_master/process_master_logic.dart';
import 'process_master/process_master_repository.dart';

/// Production > Processes (web `pages/ProcessMaster.jsx`): list, add, edit and
/// remove processes with their machines, planned-shift setting and — for a Super
/// Admin — the linked Data Entry page and the dashboard's KPI tiles / graphs.
/// What each person can do follows the page's Manage Role permissions; the admin-only
/// parts follow `MenuProvider.isAdmin` (Super Admin) and the review access
/// (Admin / Super Admin may change the planned shift), exactly like the web.
class ProcessMasterScreen extends StatefulWidget {
  const ProcessMasterScreen({super.key, this.repo = const ProcessMasterRepository()});

  final ProcessMasterRepository repo;

  @override
  State<ProcessMasterScreen> createState() => _ProcessMasterScreenState();
}

class _ProcessMasterScreenState extends State<ProcessMasterScreen> {
  static const _perPage = 100;

  final List<Json> _rows = [];
  int _total = 0;
  int _page = 1;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String _query = '';
  bool _activeOnly = true;
  String? _sortOn;
  String? _sortDir;
  bool _canSetShift = false;
  Timer? _debounce;
  int _token = 0;

  bool get _isAdmin {
    try {
      return Provider.of<MenuProvider>(context, listen: false).isAdmin;
    } catch (_) {
      return false;
    }
  }

  @override
  void initState() {
    super.initState();
    _fetch();
    widget.repo.canSetShift().then((v) {
      if (mounted) setState(() => _canSetShift = v);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _fetch({bool more = false}) async {
    final token = ++_token;
    setState(() {
      if (more) {
        _loadingMore = true;
      } else {
        _loading = true;
        _page = 1;
      }
      _error = null;
    });
    try {
      final page = await widget.repo.search(
        skip: more ? _page * _perPage : 0,
        perPage: _perPage,
        sortOn: _sortOn,
        sortDir: _sortDir,
        match: _query,
        activeOnly: _activeOnly,
      );
      if (!mounted || token != _token) return;
      setState(() {
        if (more) {
          _rows.addAll(page.rows);
          _page++;
        } else {
          _rows
            ..clear()
            ..addAll(page.rows);
        }
        _total = page.total;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted || token != _token) return;
      setState(() {
        if (!more) _rows.clear();
        _loading = false;
        _loadingMore = false;
        _error = e is ApiException ? e.message : 'Failed to load processes';
      });
    }
  }

  void _onSearch(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      _query = q.trim();
      _fetch();
    });
  }

  Future<void> _open({String? id}) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ProcessFormScreen(
          processId: id,
          isAdmin: _isAdmin,
          canSetShift: _canSetShift,
          repo: widget.repo,
        ),
      ),
    );
    if (saved == true && mounted) _fetch();
  }

  Future<void> _remove(Json row) async {
    final ok = await Alerts.confirm(
      context,
      'Are you sure you want to remove this record? This action cannot be undone.',
      confirmText: 'Yes, Delete It!',
      cancelText: 'Close',
    );
    if (!ok || !mounted) return;
    try {
      final msg = await widget.repo.delete('${row['_id']}');
      Alerts.success(msg ?? 'Process Removed Successfully!');
      if (mounted) _fetch();
    } catch (_) {
      Alerts.error('Failed to delete process. Please try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final perms = PagePermissions.of(context);
    final s = Theme.of(context).colorScheme;
    return AppScaffold(
      title: 'Processes',
      actions: [
        PopupMenuButton<String>(
          key: const ValueKey('process/sort'),
          tooltip: 'Sort',
          icon: const Icon(Icons.sort_rounded),
          onSelected: (v) {
            _sortOn = v == 'created' ? null : 'processName';
            _sortDir = v == 'created' ? null : (v == 'desc' ? 'desc' : 'asc');
            _fetch();
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'created', child: Text('Order created')),
            PopupMenuItem(value: 'asc', child: Text('Process A–Z')),
            PopupMenuItem(value: 'desc', child: Text('Process Z–A')),
          ],
        ),
      ],
      floatingActionButton: perms.create
          ? FloatingActionButton.extended(
              key: const ValueKey('process/add'),
              onPressed: () => _open(),
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add Processes'),
            )
          : null,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: TextField(
              key: const ValueKey('process/search'),
              textInputAction: TextInputAction.search,
              onChanged: _onSearch,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search...', isDense: true),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Flexible(
                  child: Text('Active only', style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant)),
                ),
                Switch(
                  key: const ValueKey('process/active-only'),
                  value: _activeOnly,
                  onChanged: (v) {
                    _activeOnly = v;
                    _fetch();
                  },
                ),
              ],
            ),
          ),
          Expanded(child: _body(context, perms)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, PagePerms perms) {
    // Scrollable, so a big text size on a small phone never overflows.
    Widget roomy(Widget child) => LayoutBuilder(
      builder: (_, box) => SingleChildScrollView(
        child: ConstrainedBox(constraints: BoxConstraints(minHeight: box.maxHeight), child: Center(child: child)),
      ),
    );
    if (_loading) return const LoadingView();
    if (_error != null) return roomy(ErrorView(message: _error!, onRetry: _fetch));
    if (_rows.isEmpty) {
      return roomy(const EmptyView(message: 'No processes found.', icon: Icons.account_tree_outlined));
    }
    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView.separated(
        key: const ValueKey('process/list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        itemCount: _rows.length + (_rows.length < _total ? 1 : 0),
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          if (i >= _rows.length) {
            return Center(
              child: _loadingMore
                  ? const Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator(strokeWidth: 2))
                  : TextButton(
                      key: const ValueKey('process/more'),
                      onPressed: () => _fetch(more: true),
                      child: Text('Load more (${_rows.length} of $_total)'),
                    ),
            );
          }
          return _ProcessCard(
            row: _rows[i],
            index: i + 1,
            isAdmin: _isAdmin,
            canEdit: perms.edit,
            canDelete: perms.delete,
            onEdit: () => _open(id: '${_rows[i]['_id']}'),
            onDelete: () => _remove(_rows[i]),
          );
        },
      ),
    );
  }
}

class _ProcessCard extends StatelessWidget {
  const _ProcessCard({
    required this.row,
    required this.index,
    required this.isAdmin,
    required this.canEdit,
    required this.canDelete,
    required this.onEdit,
    required this.onDelete,
  });

  final Json row;
  final int index;
  final bool isAdmin;
  final bool canEdit;
  final bool canDelete;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final machines = machineNamesOf(row);
    final linked = '${row['dataEntryMenu'] ?? ''}';
    Widget line(String label, Widget value) => Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 108, child: Text(label, style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant))),
          Expanded(child: value),
        ],
      ),
    );
    return Card(
      key: ValueKey('process/card/${row['_id']}'),
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${row['processName'] ?? ''}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 8),
                StatusChip.active(row['isActive'] == true),
              ],
            ),
            if ('${row['description'] ?? ''}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('${row['description']}', style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant)),
              ),
            line(
              'Machines',
              machines.isEmpty
                  ? Text('None assigned', style: TextStyle(color: s.onSurfaceVariant))
                  : Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final m in machines)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: s.outlineVariant),
                            ),
                            child: Text(m, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                          ),
                      ],
                    ),
            ),
            // Dashboard customisation and the Data Entry Page link are Super Admin only.
            if (isAdmin) ...[
              line('Dashboard', Text(dashboardSummary(row))),
              line(
                'Data Entry Page',
                linked.isEmpty
                    ? Text('Not linked', style: TextStyle(color: s.onSurfaceVariant))
                    : InkWell(
                        onTap: () => AppNav.go(context, linked),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Flexible(
                              child: Text(
                                '${row['dataEntryMenuLabel'] ?? linked}',
                                style: TextStyle(color: s.primary, fontWeight: FontWeight.w600),
                              ),
                            ),
                            const SizedBox(width: 4),
                            Icon(Icons.open_in_new_rounded, size: 14, color: s.primary),
                          ],
                        ),
                      ),
              ),
            ],
            line('Planned Shift', Text(plannedShiftText(row))),
            if (canEdit || canDelete)
              Align(
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (canEdit)
                      IconButton(
                        key: ValueKey('process/edit/${row['_id']}'),
                        tooltip: 'Edit',
                        onPressed: onEdit,
                        icon: Icon(Icons.edit_outlined, color: s.primary),
                      ),
                    if (canDelete)
                      IconButton(
                        key: ValueKey('process/delete/${row['_id']}'),
                        tooltip: 'Remove',
                        onPressed: onDelete,
                        icon: Icon(Icons.delete_outline_rounded, color: s.error),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
