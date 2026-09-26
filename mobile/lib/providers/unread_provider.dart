import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';
import '../core/api/socket_service.dart';
import 'auth_provider.dart';

/// Unread counters for the app-bar bell and the Support drawer dot. Loads at
/// sign-in and follows the socket (`new_notification`, `refresh_unread_count`).
/// Screens that mark things read call [refresh].
class UnreadProvider extends ChangeNotifier {
  int notifications = 0;
  int tickets = 0;

  String? _userId;
  final List<VoidCallback> _unsubs = [];

  void attach(AuthProvider auth) {
    final id = auth.isAuthenticated ? auth.user!.id : null;
    if (id == _userId) return;
    _userId = id;
    for (final u in _unsubs) {
      u();
    }
    _unsubs.clear();
    if (id == null) {
      SocketService.instance.connected.removeListener(_bind);
      notifications = 0;
      tickets = 0;
      Future.microtask(notifyListeners);
      return;
    }
    Future.microtask(refresh);
    // The socket connects right after login; (re)bind once it is up.
    SocketService.instance.connected.removeListener(_bind);
    SocketService.instance.connected.addListener(_bind);
    _bind();
  }

  void _bind() {
    for (final u in _unsubs) {
      u();
    }
    _unsubs.clear();
    if (!SocketService.instance.connected.value) return;
    _unsubs.add(SocketService.instance.on('new_notification', (n) {
      if (n is Map && n['isRead'] != true) {
        notifications += 1;
        notifyListeners();
      }
    }));
    _unsubs.add(SocketService.instance.on('refresh_unread_count', (_) => refresh()));
    refresh();
  }

  bool _refreshing = false;
  bool _refreshAgain = false;

  /// Reads both counters. A socket burst (or a reconnect on top of a screen's own
  /// refresh) must not become a burst of requests: while one is running, any
  /// number of further calls collapse into ONE more run afterwards. The two
  /// counters load in parallel, and listeners hear about it only when a number
  /// really changed (the bell and the account button rebuild on it).
  Future<void> refresh() async {
    if (_userId == null) return;
    if (_refreshing) {
      _refreshAgain = true;
      return;
    }
    _refreshing = true;
    try {
      do {
        _refreshAgain = false;
        final counts = await Future.wait([
          _count('/api/v1/notifications/unread-count'),
          _count('/api/v1/tickets/unread-count'),
        ]);
        if (_userId == null) return; // signed out while waiting
        final n = counts[0] ?? notifications; // a failed read keeps the last figure
        final t = counts[1] ?? tickets;
        if (n != notifications || t != tickets) {
          notifications = n;
          tickets = t;
          notifyListeners();
        }
      } while (_refreshAgain);
    } finally {
      _refreshing = false;
    }
  }

  Future<int?> _count(String path) async {
    try {
      final r = await Api.get(path);
      return (r['unreadCount'] as num?)?.toInt() ?? 0;
    } catch (_) {
      return null;
    }
  }

  void setNotifications(int n) {
    notifications = n < 0 ? 0 : n;
    notifyListeners();
  }
}
