import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/navigation.dart';
import '../../app/routes.dart';
import '../../core/api/api_client.dart';
import '../../core/api/socket_service.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/states.dart';
import '../../providers/auth_provider.dart';
import '../../providers/unread_provider.dart';
import 'notification_model.dart';
import 'notification_widgets.dart';
import 'notifications_repository.dart';

enum _Filter { all, unread, read }

/// Port of client/src/pages/Notifications.jsx (+ the bell in NotificationBell.jsx).
/// Opened from the account menu, so it is an ordinary pushed page with Back.
///
/// Server limits worth knowing: `GET /notifications` returns the newest 50
/// only (no paging) and there is no delete endpoint. "Remove" / "Clear all"
/// therefore mark the rows read on the server and hide them on this device.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> with WidgetsBindingObserver {
  static const _serverCap = 50;

  final _search = TextEditingController();
  final List<VoidCallback> _unsubs = [];

  List<AppNotification> _all = [];
  Set<String> _hidden = {};
  bool _loading = true;
  bool _inFlight = false;
  String? _error;
  _Filter _filter = _Filter.all;
  String _query = '';
  HiddenNotifications? _store;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final userId = context.read<AuthProvider>().user?.id ?? '';
    _store = HiddenNotifications(userId);
    SocketService.instance.connected.addListener(_onConnection);
    _bindSocket();
    _start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    SocketService.instance.connected.removeListener(_onConnection);
    for (final u in _unsubs) {
      u();
    }
    _unsubs.clear();
    _search.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_loading) _load();
  }

  // ---- data -------------------------------------------------------------

  Future<void> _start() async {
    final hidden = await _store!.load();
    if (!mounted) return;
    _hidden = hidden;
    await _load(blocking: true);
  }

  /// [blocking]: show the skeleton (first load / Try again). Otherwise the
  /// current list stays on screen and a failure only raises a toast.
  Future<void> _load({bool blocking = false}) async {
    if (_inFlight) return;
    _inFlight = true;
    if (blocking && mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final items = await NotificationsRepository.list();
      if (!mounted) return;
      setState(() {
        _all = items;
        _loading = false;
        _error = null;
      });
      _pruneHidden(items);
      // Keep the avatar badge in step with what the server just said.
      unawaited(context.read<UnreadProvider>().refresh());
    } catch (e) {
      if (!mounted) return;
      final msg = _messageOf(e);
      if (_all.isEmpty) {
        setState(() {
          _loading = false;
          _error = msg;
        });
      } else {
        setState(() => _loading = false);
        if (!blocking) Alerts.error(msg);
      }
    } finally {
      _inFlight = false;
    }
  }

  String _messageOf(Object e, [String fallback = 'Could not load notifications. Please try again.']) =>
      e is ApiException ? e.message : fallback;

  /// Hidden ids that fell out of the server's newest-50 window can never come
  /// back, so they are forgotten.
  void _pruneHidden(List<AppNotification> items) {
    final ids = items.map((n) => n.id).toSet();
    final kept = _hidden.intersection(ids);
    if (kept.length != _hidden.length) {
      _hidden = kept;
      unawaited(_store!.save(kept));
    }
  }

  void _bindSocket() {
    for (final u in _unsubs) {
      u();
    }
    _unsubs
      ..clear()
      ..add(SocketService.instance.on('new_notification', _onNew));
  }

  void _onConnection() {
    if (!mounted) return;
    _bindSocket();
    // Anything raised while the socket was down.
    if (SocketService.instance.connected.value && !_loading) _load();
  }

  void _onNew(dynamic data) {
    if (!mounted || data is! Map) return;
    final n = AppNotification.fromJson(Map<String, dynamic>.from(data));
    if (n.id.isEmpty || _all.any((x) => x.id == n.id)) return;
    setState(() => _all = [n, ..._all]);
  }

  List<AppNotification> get _visible => _all.where((n) => !_hidden.contains(n.id)).toList();

  // ---- actions ----------------------------------------------------------

  void _setRead(Set<String> ids, bool read) {
    if (!mounted) return;
    setState(() {
      _all = [for (final n in _all) ids.contains(n.id) ? n.copyWith(isRead: read) : n];
    });
  }

  Future<void> _markRead(AppNotification n) async {
    if (n.isRead) return;
    final unread = context.read<UnreadProvider>();
    _setRead({n.id}, true);
    unread.setNotifications(unread.notifications - 1);
    try {
      await NotificationsRepository.markRead(n.id);
    } catch (e) {
      _setRead({n.id}, false);
      if (mounted) Alerts.error(_messageOf(e, 'Could not update notifications. Please try again.'));
    }
    unawaited(unread.refresh());
  }

  Future<bool> _markAllRead() async {
    final changed = _all.where((n) => !n.isRead).map((n) => n.id).toSet();
    final unread = context.read<UnreadProvider>();
    _setRead(changed, true);
    unread.setNotifications(0);
    var ok = true;
    try {
      await NotificationsRepository.markAllRead();
    } catch (e) {
      ok = false;
      _setRead(changed, false);
      if (mounted) Alerts.error(_messageOf(e, 'Could not update notifications. Please try again.'));
    }
    unawaited(unread.refresh());
    return ok;
  }

  void _setHidden(Set<String> ids) {
    setState(() => _hidden = ids);
    unawaited(_store!.save(ids));
  }

  void _remove(AppNotification n) {
    _setHidden({..._hidden, n.id});
    unawaited(_markRead(n));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: const Text('Notification removed'),
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () {
              if (mounted) _setHidden({..._hidden}..remove(n.id));
            },
          ),
        ),
      );
  }

  Future<void> _clearAll() async {
    final ids = _visible.map((n) => n.id).toSet();
    if (ids.isEmpty) return;
    final ok = await Alerts.confirm(
      context,
      'Remove all ${ids.length} notification${ids.length == 1 ? '' : 's'} from this list? They will be marked as read.',
      title: 'Clear all',
      confirmText: 'Clear all',
    );
    if (!ok || !mounted) return;
    if (_all.any((n) => !n.isRead) && !await _markAllRead()) return;
    if (!mounted) return;
    _setHidden({..._hidden, ...ids});
  }

  void _open(AppNotification n) {
    final url = n.menuUrl;
    if (!n.isRead) unawaited(_markRead(n));
    // Unknown pages are ignored quietly: the row is still marked read.
    if (url != null && AppRoutes.match(url) != null) AppNav.go(context, url);
  }

  Future<void> _showActions(AppNotification n) async {
    final url = n.menuUrl;
    final canOpen = url != null && AppRoutes.match(url) != null;
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (canOpen)
                ListTile(
                  leading: const Icon(Icons.open_in_new_rounded),
                  title: const Text('Open'),
                  onTap: () => Navigator.pop(ctx, 'open'),
                ),
              if (!n.isRead)
                ListTile(
                  leading: const Icon(Icons.done_rounded),
                  title: const Text('Mark as read'),
                  onTap: () => Navigator.pop(ctx, 'read'),
                ),
              ListTile(
                leading: const Icon(Icons.delete_outline_rounded),
                title: const Text('Remove'),
                onTap: () => Navigator.pop(ctx, 'remove'),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    switch (choice) {
      case 'open':
        _open(n);
      case 'read':
        unawaited(_markRead(n));
      case 'remove':
        _remove(n);
    }
  }

  // ---- build ------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    final unreadCount = visible.where((n) => !n.isRead).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (visible.isNotEmpty)
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (v) {
                if (v == 'read') _markAllRead();
                if (v == 'clear') _clearAll();
              },
              itemBuilder: (_) => [
                if (unreadCount > 0) const PopupMenuItem(value: 'read', child: Text('Mark all as read')),
                const PopupMenuItem(value: 'clear', child: Text('Clear all')),
              ],
            ),
        ],
      ),
      body: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, c) {
            // iPad / wide: one centred ~720 px column; phones keep a 16 px gutter.
            final side = math.max(16.0, (c.maxWidth - 720) / 2);
            return _body(visible, unreadCount, side);
          },
        ),
      ),
    );
  }

  Widget _body(List<AppNotification> visible, int unreadCount, double side) {
    if (_loading && _all.isEmpty) {
      return ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(side, 16, side, 16),
        children: const [NotificationSkeleton()],
      );
    }
    if (_error != null && _all.isEmpty) {
      return ErrorView(message: _error!, onRetry: () => _load(blocking: true));
    }

    final filtered = _applyFilter(visible);
    final rows = <Object>[];
    String? section;
    for (final n in filtered) {
      final label = notificationSection(n.createdAt);
      if (label != section) {
        section = label;
        rows.add(label);
      }
      rows.add(n);
    }

    return RefreshIndicator(
      onRefresh: () => _load(),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        slivers: [
          SliverPadding(
            padding: EdgeInsets.fromLTRB(side, 12, side, 4),
            sliver: SliverToBoxAdapter(child: _header(visible, unreadCount)),
          ),
          if (filtered.isEmpty)
            SliverFillRemaining(hasScrollBody: false, child: _empty(visible))
          else
            SliverPadding(
              padding: EdgeInsets.fromLTRB(side, 0, side, 24),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, i) {
                    if (i == rows.length) return _cap();
                    final row = rows[i];
                    if (row is String) return SectionLabel(row);
                    return _row(row as AppNotification);
                  },
                  childCount: rows.length + (_all.length >= _serverCap ? 1 : 0),
                ),
              ),
            ),
        ],
      ),
    );
  }

  List<AppNotification> _applyFilter(List<AppNotification> items) {
    final q = _query.trim().toLowerCase();
    return items.where((n) {
      if (_filter == _Filter.unread && n.isRead) return false;
      if (_filter == _Filter.read && !n.isRead) return false;
      if (q.isNotEmpty && !'${n.title} ${n.message}'.toLowerCase().contains(q)) return false;
      return true;
    }).toList();
  }

  Widget _row(AppNotification n) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Dismissible(
          key: ValueKey(n.id),
          direction: DismissDirection.endToStart,
          background: const DismissBackground(),
          onDismissed: (_) => _remove(n),
          child: NotificationCard(
            item: n,
            onTap: () => _open(n),
            onLongPress: () => _showActions(n),
            onRemove: () => _remove(n),
          ),
        ),
      );

  Widget _cap() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          'Showing your latest $_serverCap notifications.',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
      );

  Widget _header(List<AppNotification> visible, int unreadCount) {
    final t = Theme.of(context);
    final s = t.colorScheme;
    if (visible.isEmpty) return const SizedBox.shrink();

    Widget chip(_Filter f, String label) {
      final selected = _filter == f;
      final dark = t.brightness == Brightness.dark;
      return ChoiceChip(
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        selectedColor: s.primary.withValues(alpha: dark ? 0.22 : 0.10),
        side: BorderSide(color: selected ? s.primary : s.outlineVariant),
        labelStyle: TextStyle(
          color: selected ? s.primary : s.onSurfaceVariant,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
        ),
        onSelected: (_) => setState(() => _filter = f),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                unreadCount > 0 ? '$unreadCount unread' : 'All read',
                style: t.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            if (unreadCount > 0)
              TextButton.icon(
                onPressed: _markAllRead,
                icon: const Icon(Icons.done_all_rounded, size: 18),
                label: const Text('Mark all read'),
                style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
              ),
          ],
        ),
        const SizedBox(height: 4),
        TextField(
          controller: _search,
          onChanged: (v) => setState(() => _query = v),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search notifications',
            prefixIcon: const Icon(Icons.search),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            suffixIcon: _query.isEmpty
                ? null
                : IconButton(
                    tooltip: 'Clear search',
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () {
                      _search.clear();
                      setState(() => _query = '');
                    },
                  ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            chip(_Filter.all, 'All'),
            chip(_Filter.unread, unreadCount > 0 ? 'Unread ($unreadCount)' : 'Unread'),
            chip(_Filter.read, 'Read'),
          ],
        ),
        const SizedBox(height: 12),
      ],
    );
  }

  Widget _empty(List<AppNotification> visible) {
    if (visible.isEmpty) {
      return const NotificationsEmpty(
        icon: Icons.done_all_rounded,
        title: "You're all caught up",
        subtitle: 'New notifications will show up here.',
      );
    }
    if (_query.trim().isNotEmpty) {
      return NotificationsEmpty(
        icon: Icons.search_off_rounded,
        title: 'No matches',
        subtitle: 'Nothing found for "${_query.trim()}".',
      );
    }
    if (_filter == _Filter.unread) {
      return const NotificationsEmpty(
        icon: Icons.done_all_rounded,
        title: "You're all caught up",
        subtitle: 'No unread notifications.',
      );
    }
    return const NotificationsEmpty(
      icon: Icons.notifications_none_rounded,
      title: 'Nothing here yet',
      subtitle: "Notifications you've read will appear here.",
    );
  }
}
