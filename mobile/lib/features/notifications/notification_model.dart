import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/formatters.dart';

/// One row of `GET /api/v1/notifications`
/// (server/models/Notification.js: title, message, type, referenceId, isRead, createdAt).
class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.message,
    required this.type,
    required this.createdAt,
    required this.isRead,
    this.referenceId,
    this.link,
  });

  final String id;
  final String title;
  final String message;

  /// Free text set by whoever raised it ("general" by default; the support
  /// flow uses ticket-ish names). Only used to pick an icon / a target page.
  final String type;
  final DateTime? createdAt;
  final bool isRead;
  final dynamic referenceId;

  /// Explicit target the server put on the row (not in today's schema, but
  /// tolerated so the app keeps working if it is added).
  final String? link;

  factory AppNotification.fromJson(Map<String, dynamic> j) {
    String str(dynamic v) => v == null ? '' : v.toString().trim();
    // A Mongo id can arrive as a string, a populated object or {"$oid": ...}.
    String id(dynamic v) => v is Map ? str(v['_id'] ?? v['id'] ?? v[r'$oid']) : str(v);
    String? link;
    for (final k in const ['link', 'url', 'path', 'route']) {
      final v = j[k];
      if (v is String && v.trim().isNotEmpty) {
        link = v.trim();
        break;
      }
    }
    final read = j['isRead'];
    return AppNotification(
      id: id(j['_id'] ?? j['id']),
      title: str(j['title']).isEmpty ? 'Notification' : str(j['title']),
      message: str(j['message']),
      type: str(j['type']).isEmpty ? 'general' : str(j['type']),
      createdAt: Fmt.parse(j['createdAt']),
      isRead: read == true || read == 1 || read.toString().toLowerCase() == 'true',
      referenceId: j['referenceId'],
      link: link,
    );
  }

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        title: title,
        message: message,
        type: type,
        createdAt: createdAt,
        isRead: isRead ?? this.isRead,
        referenceId: referenceId,
        link: link,
      );

  /// Menu URL this notification opens, or null when it has no page.
  /// Today every notification comes from the support-ticket flow.
  String? get menuUrl {
    if (link != null) return link;
    final ref = referenceId;
    if (ref is String && ref.startsWith('/')) return ref;
    final t = type.toLowerCase();
    if (t.contains('ticket') || t.contains('support')) return '/support';
    return null;
  }

  /// Icon + tone for the leading tile, chosen from [type].
  ({IconData icon, Color tone}) get look {
    final t = type.toLowerCase();
    bool has(List<String> words) => words.any(t.contains);
    if (has(['resolv', 'closed', 'complete', 'approved'])) {
      return (icon: Icons.check_circle_outline_rounded, tone: AppColors.ok);
    }
    if (has(['reject', 'error', 'critical', 'fail'])) {
      return (icon: Icons.error_outline_rounded, tone: AppColors.critical);
    }
    if (has(['alert', 'warn', 'breakdown', 'overdue', 'remind'])) {
      return (icon: Icons.warning_amber_rounded, tone: AppColors.warn);
    }
    if (has(['forward'])) return (icon: Icons.forward_to_inbox_rounded, tone: AppColors.brand600);
    if (has(['reply', 'message', 'chat', 'comment'])) {
      return (icon: Icons.chat_bubble_outline_rounded, tone: AppColors.brand600);
    }
    if (has(['ticket', 'support'])) return (icon: Icons.support_agent_rounded, tone: AppColors.brand600);
    if (has(['production', 'entry', 'sheet', 'machine', 'oee'])) {
      return (icon: Icons.factory_outlined, tone: AppColors.brand600);
    }
    if (has(['holiday', 'leave', 'calendar'])) return (icon: Icons.event_outlined, tone: AppColors.brand600);
    return (icon: Icons.notifications_none_rounded, tone: AppColors.brand600);
  }
}
