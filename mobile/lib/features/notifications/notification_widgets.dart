import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../core/theme/app_colors.dart';
import '../../core/utils/formatters.dart';
import 'notification_model.dart';

/// "5 minutes ago" for recent rows, a full date once it is a week old.
String notificationTime(DateTime? d, {DateTime? now}) {
  if (d == null) return '';
  final n = now ?? DateTime.now();
  if (n.difference(d).inDays >= 7) return Fmt.dateTime(d);
  // A slightly fast device clock must not print "in 2 minutes".
  return timeago.format(d.isAfter(n) ? n : d, clock: n);
}

/// Day bucket used for the section labels of the list.
String notificationSection(DateTime? d, {DateTime? now}) {
  if (d == null) return 'Earlier';
  final n = now ?? DateTime.now();
  final today = DateTime(n.year, n.month, n.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff <= 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return 'Earlier';
}

/// One notification: tinted icon tile, title, message, time, unread dot.
class NotificationCard extends StatelessWidget {
  const NotificationCard({
    super.key,
    required this.item,
    required this.onTap,
    required this.onLongPress,
    required this.onRemove,
  });

  final AppNotification item;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = theme.colorScheme;
    final dark = theme.brightness == Brightness.dark;
    final unread = !item.isRead;
    final base = theme.cardTheme.color ?? s.surface;
    final bg = unread ? Color.alphaBlend(s.primary.withValues(alpha: dark ? 0.16 : 0.07), base) : base;
    final look = item.look;
    final tone = AppColors.readable(context, look.tone);
    final time = notificationTime(item.createdAt);
    final hasPage = item.menuUrl != null;

    return Semantics(
      customSemanticsActions: {const CustomSemanticsAction(label: 'Remove notification'): onRemove},
      child: Material(
        color: bg,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: unread ? s.primary.withValues(alpha: 0.40) : s.outlineVariant),
        ),
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 56),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: look.tone.withValues(alpha: dark ? 0.22 : 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(look.icon, size: 18, color: tone),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                item.title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  height: 1.25,
                                  fontWeight: unread ? FontWeight.w700 : FontWeight.w500,
                                  color: s.onSurface,
                                ),
                              ),
                            ),
                            if (unread) ...[
                              const SizedBox(width: 8),
                              Padding(
                                padding: const EdgeInsets.only(top: 5),
                                child: Semantics(
                                  label: 'Unread',
                                  child: Container(
                                    width: 8,
                                    height: 8,
                                    decoration: BoxDecoration(color: s.primary, shape: BoxShape.circle),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        if (item.message.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            item.message,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12.5,
                              height: 1.3,
                              color: unread ? s.onSurface.withValues(alpha: 0.85) : s.onSurfaceVariant,
                            ),
                          ),
                        ],
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(Icons.schedule_rounded, size: 12, color: s.onSurfaceVariant),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                time,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant),
                              ),
                            ),
                            if (hasPage) ...[
                              const Spacer(),
                              Icon(Icons.chevron_right_rounded, size: 18, color: s.onSurfaceVariant),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Red panel that shows behind a card while it is swiped away.
class DismissBackground extends StatelessWidget {
  const DismissBackground({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fg = AppColors.readable(context, AppColors.critical);
    return Container(
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.only(right: 20),
      decoration: BoxDecoration(
        color: AppColors.critical.withValues(alpha: dark ? 0.25 : 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: s.error.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Remove', style: TextStyle(fontSize: 13, color: fg, fontWeight: FontWeight.w700)),
          const SizedBox(width: 6),
          Icon(Icons.delete_outline_rounded, size: 20, color: fg),
        ],
      ),
    );
  }
}

/// Small "Today / Yesterday / Earlier" label above a group.
class SectionLabel extends StatelessWidget {
  const SectionLabel(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 6, 2, 6),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          color: t.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// Icon + headline + hint, used for every empty state.
class NotificationsEmpty extends StatelessWidget {
  const NotificationsEmpty({super.key, required this.icon, required this.title, this.subtitle});
  final IconData icon;
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final s = t.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(color: s.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: Icon(icon, size: 26, color: s.primary),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Grey placeholder cards while the first page loads.
class NotificationSkeleton extends StatefulWidget {
  const NotificationSkeleton({super.key, this.count = 6});
  final int count;

  @override
  State<NotificationSkeleton> createState() => _NotificationSkeletonState();
}

class _NotificationSkeletonState extends State<NotificationSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final base = Theme.of(context).cardTheme.color ?? s.surface;
    final block = s.onSurface.withValues(alpha: 0.10);

    Widget bar(double? w, double h) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(color: block, borderRadius: BorderRadius.circular(6)),
        );

    return FadeTransition(
      opacity: Tween<double>(begin: 0.45, end: 1).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut)),
      child: Semantics(
        label: 'Loading notifications',
        excludeSemantics: true,
        child: Column(
          children: [
            for (var i = 0; i < widget.count; i++)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: base,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: s.outlineVariant),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(color: block, borderRadius: BorderRadius.circular(10)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          bar(150, 12),
                          const SizedBox(height: 6),
                          bar(double.infinity, 10),
                          const SizedBox(height: 4),
                          bar(110, 10),
                        ],
                      ),
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
