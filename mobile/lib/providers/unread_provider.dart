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

  Future<void> refresh() async {
    if (_userId == null) return;
    try {
      final n = await Api.get('/api/v1/notifications/unread-count');
      notifications = (n['unreadCount'] as num?)?.toInt() ?? 0;
    } catch (_) {}
    try {
      final t = await Api.get('/api/v1/tickets/unread-count');
      tickets = (t['unreadCount'] as num?)?.toInt() ?? 0;
    } catch (_) {}
    notifyListeners();
  }

  void setNotifications(int n) {
    notifications = n < 0 ? 0 : n;
    notifyListeners();
  }
}
