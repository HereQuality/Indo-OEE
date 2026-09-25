import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api/api_client.dart';
import 'notification_model.dart';

/// server/routes/notification.routes.js. The server has NO delete endpoint and
/// no paging: `GET /` returns the newest 50 for the signed-in person.
class NotificationsRepository {
  NotificationsRepository._();

  static const _base = '/api/v1/notifications';

  /// Newest first.
  static Future<List<AppNotification>> list() async {
    final res = await Api.get(_base);
    final items = asList(res).map(AppNotification.fromJson).where((n) => n.id.isNotEmpty).toList();
    items.sort((a, b) {
      final x = a.createdAt, y = b.createdAt;
      if (x == null || y == null) return 0;
      return y.compareTo(x);
    });
    return items;
  }

  static Future<void> markRead(String id) async {
    await Api.patch('$_base/${Uri.encodeComponent(id)}/read');
  }

  static Future<void> markAllRead() async {
    await Api.patch('$_base/read-all');
  }
}

/// Because the server cannot delete a notification, "delete"/"clear all" hides
/// rows on THIS device: their ids are remembered per user.
class HiddenNotifications {
  HiddenNotifications(this.userId);

  final String userId;
  String get _key => 'notifications_hidden_$userId';

  Future<Set<String>> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      return (p.getStringList(_key) ?? const <String>[]).toSet();
    } catch (_) {
      return <String>{};
    }
  }

  Future<void> save(Set<String> ids) async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setStringList(_key, ids.toList());
    } catch (_) {
      // Storage unavailable: hiding just lasts until the screen closes.
    }
  }
}
