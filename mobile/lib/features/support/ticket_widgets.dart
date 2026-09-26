import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../core/api/socket_service.dart';
import '../../core/utils/formatters.dart';
import '../../core/theme/app_colors.dart';
import '../profile/compact_field.dart';
import 'support_models.dart';

/// Relative time for the last 24 h ("5 minutes ago"), a date after that.
String stamp(DateTime? d) {
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (!diff.isNegative && diff.inHours < 24) return timeago.format(d);
  return Fmt.dateTime(d);
}

/// Keeps socket listeners attached across (re)connects and removes them on
/// [dispose]. [SocketService.on] is a no-op while the socket is down, so this
/// re-binds when it comes back up and calls [onConnected] (e.g. to re-join a room).
class TicketSocket {
  TicketSocket(this.handlers, {this.onConnected});

  final Map<String, void Function(dynamic)> handlers;
  final VoidCallback? onConnected;
  final List<VoidCallback> _unsubs = [];
  bool _disposed = false;

  void start() {
    SocketService.instance.connected.addListener(_bind);
    _bind();
  }

  void _bind() {
    if (_disposed) return;
    _unbind();
    if (!SocketService.instance.connected.value) return;
    onConnected?.call();
    handlers.forEach(
      (event, cb) => _unsubs.add(SocketService.instance.on(event, cb)),
    );
  }

  void _unbind() {
    for (final u in _unsubs) {
      u();
    }
    _unsubs.clear();
  }

  void dispose() {
    _disposed = true;
    SocketService.instance.connected.removeListener(_bind);
    _unbind();
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final c = statusTone(status);
    return MiniPill(status, color: c, fg: AppColors.readable(context, c));
  }
}

class PriorityPill extends StatelessWidget {
  const PriorityPill(this.priority, {super.key});
  final String priority;
  @override
  Widget build(BuildContext context) {
    final c = priorityTone(priority);
    return MiniPill(priority, color: c, fg: AppColors.readable(context, c), icon: Icons.flag_rounded);
  }
}

class PlatformPill extends StatelessWidget {
  const PlatformPill(this.platform, {super.key});
  final String platform;
  @override
  Widget build(BuildContext context) {
    final c = platformTone(platform);
    return MiniPill(
      platform,
      color: c,
      fg: AppColors.readable(context, c),
      icon: platform == 'App' ? Icons.phone_iphone_rounded : Icons.desktop_windows_outlined,
    );
  }
}

enum TicketAction { forward, delete }

/// Filters shown above the list: search + status / priority / platform chips
/// (+ "All / Raised by me" for support agents).
class TicketFilters extends StatelessWidget {
  const TicketFilters({
    super.key,
    required this.searchController,
    required this.onSearch,
    required this.tickets,
    required this.status,
    required this.priority,
    required this.platform,
    required this.onStatus,
    required this.onPriority,
    required this.onPlatform,
    this.showScope = false,
    this.mineOnly = false,
    this.onScope,
  });

  final TextEditingController searchController;
  final ValueChanged<String> onSearch;
  final List<Ticket> tickets;
  final String status; // 'all' or a status
  final String? priority;
  final String? platform;
  final ValueChanged<String> onStatus;
  final ValueChanged<String?> onPriority;
  final ValueChanged<String?> onPlatform;
  final bool showScope;
  final bool mineOnly;
  final ValueChanged<bool>? onScope;

  int _count(String s) =>
      s == 'all' ? tickets.length : tickets.where((t) => t.status == s).length;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    Widget chip(String label, bool selected, VoidCallback onTap) => Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        showCheckmark: false,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        labelStyle: TextStyle(fontSize: 12.5, fontWeight: selected ? FontWeight.w700 : FontWeight.w500),
      ),
    );
    Widget sep() => Container(
      width: 1,
      height: 18,
      margin: const EdgeInsets.only(right: 6),
      color: s.outlineVariant,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: searchController,
          onChanged: onSearch,
          textInputAction: TextInputAction.search,
          keyboardType: TextInputType.text,
          autocorrect: false,
          scrollPadding: const EdgeInsets.fromLTRB(20, 20, 20, 120),
          style: const TextStyle(fontSize: 14),
          decoration: const InputDecoration(
            hintText: 'Search tickets…',
            prefixIcon: Icon(Icons.search, size: 20),
            isDense: true,
            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          ),
        ),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final st in ['all', ...kTicketStatuses])
                chip(
                  st == 'all' ? 'All (${_count('all')})' : '$st (${_count(st)})',
                  status == st,
                  () => onStatus(st),
                ),
            ],
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              if (showScope) ...[
                chip('Raised by me', mineOnly, () => onScope?.call(!mineOnly)),
                sep(),
              ],
              for (final p in kTicketPriorities.reversed)
                chip(p, priority == p, () => onPriority(priority == p ? null : p)),
              sep(),
              for (final p in kTicketPlatforms)
                chip(p, platform == p, () => onPlatform(platform == p ? null : p)),
            ],
          ),
        ),
      ],
    );
  }
}

/// Card row used on phones and in the iPad list pane.
class TicketCard extends StatelessWidget {
  const TicketCard({
    super.key,
    required this.ticket,
    required this.onTap,
    required this.actions,
    required this.onAction,
    this.selected = false,
    this.showRaisedBy = false,
  });

  final Ticket ticket;
  final VoidCallback onTap;
  final List<TicketAction> actions;
  final ValueChanged<TicketAction> onAction;
  final bool selected;
  final bool showRaisedBy;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final meta = [
      if (showRaisedBy && ticket.raisedByName.isNotEmpty) ticket.raisedByName,
      if (ticket.forwardedByName != null) 'fwd by ${ticket.forwardedByName}',
      stamp(ticket.updatedAt),
    ].where((e) => e.isNotEmpty).join(' · ');
    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: selected ? s.primary : s.outlineVariant,
          width: selected ? 1.6 : 1,
        ),
      ),
      color: selected
          ? Color.alphaBlend(s.primary.withValues(alpha: 0.07), s.surface)
          : null,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    // Wraps instead of overflowing when the text size is huge.
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (ticket.hasUnread) ...[
                              Semantics(
                                label: 'Unread',
                                child: Container(
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(
                                    color: s.error,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                            ],
                            Text(
                              ticket.ticketId,
                              maxLines: 1,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: s.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                        StatusPill(ticket.status),
                      ],
                    ),
                  ),
                  if (actions.isEmpty)
                    const SizedBox(width: 8, height: 40)
                  else
                    _RowMenu(actions: actions, onAction: onAction),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Text(
                  ticket.subject,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.25,
                    fontWeight: ticket.hasUnread
                        ? FontWeight.w700
                        : FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              // Pills and the "who · when" line share a row when they fit.
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    PriorityPill(ticket.priority),
                    PlatformPill(ticket.platform),
                    if (meta.isNotEmpty)
                      Text(
                        meta,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RowMenu extends StatelessWidget {
  const _RowMenu({required this.actions, required this.onAction});
  final List<TicketAction> actions;
  final ValueChanged<TicketAction> onAction;

  @override
  Widget build(BuildContext context) => PopupMenuButton<TicketAction>(
    tooltip: 'Ticket actions',
    icon: const Icon(Icons.more_vert_rounded, size: 20),
    padding: EdgeInsets.zero,
    style: IconButton.styleFrom(minimumSize: const Size(40, 40), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
    constraints: const BoxConstraints(minWidth: 180),
    onSelected: onAction,
    itemBuilder: (_) => [
      for (final a in actions)
        PopupMenuItem(
          value: a,
          child: Row(
            children: [
              Icon(
                a == TicketAction.forward
                    ? Icons.arrow_circle_up_rounded
                    : Icons.delete_outline_rounded,
                size: 20,
                color: a == TicketAction.delete
                    ? Theme.of(context).colorScheme.error
                    : null,
              ),
              const SizedBox(width: 10),
              Text(
                a == TicketAction.forward ? 'Forward to SuperAdmin' : 'Delete',
              ),
            ],
          ),
        ),
    ],
  );
}

/// Web-style table for iPad portrait / wide windows without a detail pane.
class TicketTable extends StatelessWidget {
  const TicketTable({
    super.key,
    required this.tickets,
    required this.onOpen,
    required this.actionsFor,
    required this.onAction,
    this.showRaisedBy = false,
    this.selectedId,
  });

  final List<Ticket> tickets;
  final ValueChanged<Ticket> onOpen;
  final List<TicketAction> Function(Ticket) actionsFor;
  final void Function(Ticket, TicketAction) onAction;
  final bool showRaisedBy;
  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final head = TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.3,
      color: s.onSurfaceVariant,
    );
    Widget cell(double? w, Widget child) =>
        w == null ? Expanded(child: child) : SizedBox(width: w, child: child);
    Widget h(String t, [double? w]) => cell(
      w,
      Text(t, style: head, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
    Widget pill(Widget p) => Align(
      alignment: Alignment.centerLeft,
      child: FittedBox(fit: BoxFit.scaleDown, child: p),
    );

    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Container(
            color: s.surfaceContainer,
            padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
            child: Row(
              children: [
                h('TICKET', 84),
                h('SUBJECT'),
                if (showRaisedBy) h('RAISED BY', 108),
                h('PLATFORM', 80),
                h('PRIORITY', 84),
                h('STATUS', 108),
                h('UPDATED', 100),
                const SizedBox(width: 48),
              ],
            ),
          ),
          for (var i = 0; i < tickets.length; i++) ...[
            if (i > 0) Divider(height: 1, color: s.outlineVariant),
            Builder(
              builder: (context) {
                final t = tickets[i];
                final acts = actionsFor(t);
                return Material(
                  color: t.id == selectedId
                      ? s.primary.withValues(alpha: 0.08)
                      : Colors.transparent,
                  child: InkWell(
                    onTap: () => onOpen(t),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 44),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
                        child: Row(
                          children: [
                            cell(
                              84,
                              Row(
                                children: [
                                  if (t.hasUnread)
                                    Container(
                                      width: 8,
                                      height: 8,
                                      margin: const EdgeInsets.only(right: 6),
                                      decoration: BoxDecoration(
                                        color: s.error,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                  Flexible(
                                    child: Text(
                                      t.ticketId,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            cell(
                              null,
                              Padding(
                                padding: const EdgeInsets.only(right: 12),
                                child: Text(
                                  t.subject,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 13.5,
                                    fontWeight: t.hasUnread
                                        ? FontWeight.w700
                                        : FontWeight.w500,
                                  ),
                                ),
                              ),
                            ),
                            if (showRaisedBy)
                              cell(
                                108,
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: Text(
                                    t.raisedByName,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12.5),
                                  ),
                                ),
                              ),
                            cell(80, pill(PlatformPill(t.platform))),
                            cell(84, pill(PriorityPill(t.priority))),
                            cell(108, pill(StatusPill(t.status))),
                            cell(
                              100,
                              Text(
                                stamp(t.updatedAt),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: s.onSurfaceVariant,
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 48,
                              child: acts.isEmpty
                                  ? null
                                  : _RowMenu(
                                      actions: acts,
                                      onAction: (a) => onAction(t, a),
                                    ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// Grey placeholder cards while the first load is in flight.
class TicketListSkeleton extends StatelessWidget {
  const TicketListSkeleton({super.key, this.count = 5});
  final int count;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = s.onSurface.withValues(alpha: 0.08);
    Widget bar(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        color: tone,
        borderRadius: BorderRadius.circular(6),
      ),
    );
    return Semantics(
      label: 'Loading tickets',
      child: ListView.separated(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
        itemCount: count,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (_, _) => Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [bar(70, 12), bar(72, 18)],
                ),
                const SizedBox(height: 10),
                bar(double.infinity, 13),
                const SizedBox(height: 6),
                bar(180, 13),
                const SizedBox(height: 10),
                Row(
                  children: [
                    bar(64, 20),
                    const SizedBox(width: 6),
                    bar(56, 20),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
