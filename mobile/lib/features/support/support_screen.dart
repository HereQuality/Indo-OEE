import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../core/api/api_client.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/page_permissions.dart';
import '../../core/widgets/states.dart';
import '../../providers/auth_provider.dart';
import '../../providers/unread_provider.dart';
import '../profile/compact_field.dart';
import 'create_ticket.dart';
import 'support_models.dart';
import 'support_repository.dart';
import 'ticket_detail.dart';
import 'ticket_widgets.dart';

/// Port of client/src/pages/Support.jsx (tickets). Opened from the account
/// menu as a normal pushed page.
///
///  * phone: one column of ticket cards, tap opens the conversation page;
///  * iPad portrait: the web's table, tap opens the conversation page;
///  * iPad landscape / wide (>= 900): list on the left, conversation on the right.
///
/// The server returns every ticket you may see in one call (no paging), so
/// search / status / priority / platform filters run on the device, exactly
/// like the web page.
class SupportScreen extends StatefulWidget {
  const SupportScreen({super.key});

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

class _SupportScreenState extends State<SupportScreen> {
  final _repo = const SupportRepository();
  final _search = TextEditingController();
  Timer? _debounce;
  Timer? _refreshDebounce;

  List<Ticket> _all = [];
  bool _loading = true;
  String? _error;

  String _q = '';
  String _status = 'all';
  String? _priority;
  String? _platform;
  bool _mineOnly = false;
  String? _selectedId;

  late final TicketSocket _socket;

  @override
  void initState() {
    super.initState();
    _socket = TicketSocket({
      'refresh_unread_count': (_) => _scheduleRefresh(),
      'ticket_updated': (_) => _scheduleRefresh(),
      'new_message': (_) => _scheduleRefresh(),
    })..start();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _refreshDebounce?.cancel();
    _socket.dispose();
    _search.dispose();
    super.dispose();
  }

  void _scheduleRefresh() {
    _refreshDebounce?.cancel();
    _refreshDebounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) _load(silent: true);
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final list = await _repo.list();
      if (!mounted) return;
      setState(() {
        _all = list;
        _loading = false;
        _error = null;
        if (_selectedId != null && !list.any((t) => t.id == _selectedId)) {
          _selectedId = null;
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (silent && _all.isNotEmpty) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      if (silent && _all.isNotEmpty) return;
      setState(() {
        _error = 'Could not load tickets. Please try again.';
        _loading = false;
      });
    }
  }

  TicketAccess _access() {
    final user = context.read<AuthProvider>().user;
    return TicketAccess(
      myId: user?.id ?? '',
      isAdmin: user?.isSuperAdmin ?? false,
      canAct: PagePermissions.of(context).edit,
    );
  }

  List<Ticket> _filtered(TicketAccess acc) {
    final q = _q.trim().toLowerCase();
    final out = _all.where((t) {
      if (_status != 'all' && t.status != _status) return false;
      if (_priority != null && t.priority != _priority) return false;
      if (_platform != null && t.platform != _platform) return false;
      if (_mineOnly && !acc.isCreator(t)) return false;
      return t.matches(q);
    }).toList();
    out.sort(
      (a, b) =>
          (b.updatedAt ?? DateTime(0)).compareTo(a.updatedAt ?? DateTime(0)),
    );
    return out;
  }

  List<TicketAction> _actionsFor(Ticket t, TicketAccess acc) => [
    if (acc.canForward(t)) TicketAction.forward,
    if (acc.canDelete(t)) TicketAction.delete,
  ];

  Future<void> _runAction(Ticket t, TicketAction a) async {
    final isDelete = a == TicketAction.delete;
    final yes = await Alerts.confirm(
      context,
      isDelete
          ? 'This cannot be undone.'
          : 'SuperAdmin will receive full access to this ticket.',
      title: isDelete ? 'Delete this ticket?' : 'Forward to SuperAdmin?',
      confirmText: isDelete ? 'Delete' : 'Forward',
      danger: isDelete,
    );
    if (!yes || !mounted) return;
    try {
      if (isDelete) {
        await _repo.delete(t.id);
        Alerts.success('Deleted.');
      } else {
        await _repo.forward(t.id);
        Alerts.success('Forwarded to SuperAdmin.');
      }
      if (!mounted) return;
      if (_selectedId == t.id && isDelete) setState(() => _selectedId = null);
      context.read<UnreadProvider>().refresh();
      _load(silent: true);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } catch (_) {
      Alerts.error('Something went wrong. Please try again.');
    }
  }

  Future<void> _open(Ticket t, TicketAccess acc, {required bool split}) async {
    if (split) {
      setState(() => _selectedId = t.id);
      return;
    }
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TicketDetailPage(summary: t, access: acc, repo: _repo),
      ),
    );
    if (mounted) _load(silent: true);
  }

  Future<void> _create({required bool tablet, required bool split}) async {
    final created = tablet
        ? await showCreateTicketDialog(context, repo: _repo)
        : await Navigator.of(context).push<Ticket>(
            MaterialPageRoute(builder: (_) => CreateTicketPage(repo: _repo)),
          );
    if (created == null || !mounted) return;
    context.read<UnreadProvider>().refresh();
    if (split && created.id.isNotEmpty) {
      setState(() => _selectedId = created.id);
    }
    _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final acc = _access();
    final perms = PagePermissions.of(context);
    final size = MediaQuery.sizeOf(context);
    final tablet = size.shortestSide >= 600;
    final split = tablet && size.width >= 900;
    final showNew = perms.create && acc.canCreate;
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;

    return AppScaffold(
      title: 'Support',
      actions: [
        if (showNew && split)
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 40),
                visualDensity: VisualDensity.compact,
              ),
              onPressed: () => _create(tablet: tablet, split: split),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('New ticket'),
            ),
          ),
      ],
      floatingActionButton: showNew && !split && !keyboardOpen
          ? FloatingActionButton.extended(
              onPressed: () => _create(tablet: tablet, split: split),
              icon: const Icon(Icons.add_rounded, size: 20),
              label: const Text('New ticket'),
            )
          : null,
      body: TapToDismiss(
        child: LayoutBuilder(
          builder: (context, c) {
            final table = tablet && !split && c.maxWidth >= 640;
            final filtered = _filtered(acc);
            final filters = Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
              child: TicketFilters(
                searchController: _search,
                onSearch: (v) {
                  _debounce?.cancel();
                  _debounce = Timer(const Duration(milliseconds: 300), () {
                    if (mounted) setState(() => _q = v);
                  });
                },
                tickets: _all,
                status: _status,
                priority: _priority,
                platform: _platform,
                onStatus: (v) => setState(() => _status = v),
                onPriority: (v) => setState(() => _priority = v),
                onPlatform: (v) => setState(() => _platform = v),
                showScope: acc.canAct && !acc.isAdmin,
                mineOnly: _mineOnly,
                onScope: (v) => setState(() => _mineOnly = v),
              ),
            );
            final list = _listBody(acc, filtered, split: split, table: table);

            if (split) {
              final leftW = (c.maxWidth * 0.36).clamp(360.0, 460.0);
              final sel = _all.where((t) => t.id == _selectedId).firstOrNull;
              return Row(
                children: [
                  SizedBox(
                    width: leftW,
                    child: Column(
                      children: [
                        filters,
                        Expanded(child: list),
                      ],
                    ),
                  ),
                  VerticalDivider(
                    width: 1,
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                  Expanded(
                    child: sel == null
                        ? const EmptyView(
                            message: 'Select a ticket to see the conversation.',
                            icon: Icons.forum_outlined,
                          )
                        : TicketDetail(
                            key: ValueKey(sel.id),
                            summary: sel,
                            access: acc,
                            repo: _repo,
                            onChanged: () => _load(silent: true),
                            onDeleted: () {
                              setState(() => _selectedId = null);
                              _load(silent: true);
                            },
                          ),
                  ),
                ],
              );
            }
            return Column(
              children: [
                filters,
                Expanded(child: list),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _listBody(
    TicketAccess acc,
    List<Ticket> tickets, {
    required bool split,
    required bool table,
  }) {
    if (_loading && _all.isEmpty) return const TicketListSkeleton();
    if (_error != null && _all.isEmpty) {
      return ErrorView(message: _error!, onRetry: _load);
    }

    final filtersOn =
        _q.trim().isNotEmpty ||
        _status != 'all' ||
        _priority != null ||
        _platform != null ||
        _mineOnly;
    if (tickets.isEmpty) {
      // Scrollable so pull-to-refresh still works on an empty list.
      return RefreshIndicator(
        onRefresh: () => _load(silent: true),
        child: LayoutBuilder(
          builder: (context, c) => ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              SizedBox(
                height: c.maxHeight,
                child: EmptyView(
                  message: filtersOn
                      ? 'No tickets match your filters.'
                      : 'No tickets found.',
                  icon: Icons.support_agent_rounded,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final bottomPad = split ? 12.0 : 76.0; // room for the New ticket button
    if (table) {
      return RefreshIndicator(
        onRefresh: () => _load(silent: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: EdgeInsets.fromLTRB(12, 4, 12, bottomPad),
          children: [
            TicketTable(
              tickets: tickets,
              selectedId: _selectedId,
              showRaisedBy: acc.canAct || acc.isAdmin,
              onOpen: (t) => _open(t, acc, split: false),
              actionsFor: (t) => _actionsFor(t, acc),
              onAction: _runAction,
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(12, 4, 12, bottomPad),
        itemCount: tickets.length,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          final t = tickets[i];
          return TicketCard(
            ticket: t,
            selected: split && t.id == _selectedId,
            showRaisedBy: acc.canAct || acc.isAdmin,
            actions: _actionsFor(t, acc),
            onAction: (a) => _runAction(t, a),
            onTap: () => _open(t, acc, split: split),
          );
        },
      ),
    );
  }
}
