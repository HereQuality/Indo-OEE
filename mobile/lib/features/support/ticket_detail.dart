import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api/api_client.dart';
import '../../core/api/socket_service.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/states.dart';
import '../../providers/unread_provider.dart';
import 'attachments.dart';
import '../profile/compact_field.dart';
import 'support_models.dart';
import 'support_repository.dart';
import 'ticket_widgets.dart';

/// Pushed on phones / iPad portrait: a normal page with a Back arrow (iOS
/// edge-swipe back works — nothing here blocks the pop).
class TicketDetailPage extends StatelessWidget {
  const TicketDetailPage({
    super.key,
    required this.summary,
    required this.access,
    this.repo = const SupportRepository(),
  });

  final Ticket summary;
  final TicketAccess access;
  final SupportRepository repo;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        summary.ticketId,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    ),
    body: TapToDismiss(
      child: SafeArea(
        top: false,
        child: TicketDetail(
          key: ValueKey(summary.id),
          summary: summary,
          access: access,
          repo: repo,
          onDeleted: () => Navigator.of(context).maybePop(true),
        ),
      ),
    ),
  );
}

/// The ticket conversation: header + status actions, the thread, and either the
/// "was it resolved?" panel or the reply composer. Used inside a pushed page
/// and as the right-hand pane of the iPad master-detail layout.
class TicketDetail extends StatefulWidget {
  const TicketDetail({
    super.key,
    required this.summary,
    required this.access,
    this.repo = const SupportRepository(),
    this.onChanged,
    this.onDeleted,
  });

  /// Row from the list (shown while the full ticket loads).
  final Ticket summary;
  final TicketAccess access;
  final SupportRepository repo;

  /// Something changed on the server (status, reply): refresh the list.
  final VoidCallback? onChanged;
  final VoidCallback? onDeleted;

  @override
  State<TicketDetail> createState() => _TicketDetailState();
}

class _TicketDetailState extends State<TicketDetail> with WidgetsBindingObserver {
  final _scroll = ScrollController();
  final _reply = TextEditingController();
  final _reason = TextEditingController();

  Ticket? _t;
  String? _error;
  bool _busy = false;
  bool _sending = false;
  bool _rejecting = false;
  List<PendingAttachment> _files = [];
  late final TicketSocket _socket;

  String get _id => widget.summary.id;
  TicketAccess get _acc => widget.access;

  bool _keyboardWasUp = false;

  /// When the keyboard opens the thread shrinks: keep the newest message in view.
  @override
  void didChangeMetrics() {
    if (!mounted) return;
    final views = WidgetsBinding.instance.platformDispatcher.views;
    final up = views.isNotEmpty && views.first.viewInsets.bottom > 0;
    if (up && !_keyboardWasUp) _toBottom();
    _keyboardWasUp = up;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _socket = TicketSocket(
      {
        'new_message': _onNewMessage,
        'ticket_updated': (_) => _load(silent: true),
        'messages_read': _onMessagesRead,
      },
      onConnected: () => SocketService.instance.emit('join_ticket', _id),
    )..start();
    _load(first: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    SocketService.instance.emit('leave_ticket', _id);
    _socket.dispose();
    _scroll.dispose();
    _reply.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false, bool first = false}) async {
    if (!silent && mounted) {
      setState(() => _error = null);
    }
    try {
      final t = await widget.repo.details(_id);
      if (!mounted) return;
      final grew = (_t?.messages.length ?? 0) != t.messages.length;
      setState(() {
        _t = t;
        _error = null;
      });
      if (first || grew) _toBottom(animate: !first);
      _markRead();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (silent && _t != null) return;
      setState(() => _error = e.message);
    } catch (_) {
      if (!mounted) return;
      if (silent && _t != null) return;
      setState(() => _error = 'Could not load this ticket. Please try again.');
    }
  }

  Future<void> _markRead() async {
    try {
      await widget.repo.markRead(_id);
      if (!mounted) return;
      context.read<UnreadProvider>().refresh();
      widget.onChanged?.call();
    } catch (_) {}
  }

  void _onNewMessage(dynamic data) {
    if (!mounted || _t == null || data is! Map) return;
    final m = TicketMessage.fromJson(data);
    if (m.id.isNotEmpty && _t!.messages.any((x) => x.id == m.id)) return;
    setState(() => _t = _t!.copyWith(messages: [..._t!.messages, m]));
    _toBottom(animate: true);
    if (m.senderId != _acc.myId) _markRead();
  }

  void _onMessagesRead(dynamic data) {
    if (!mounted || _t == null || data is! Map) return;
    if (data['readBy']?.toString() == _acc.myId) return;
    setState(
      () => _t = _t!.copyWith(
        messages: [
          for (final m in _t!.messages)
            m.senderId == _acc.myId ? m.copyWith(isRead: true) : m,
        ],
      ),
    );
  }

  void _toBottom({bool animate = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final max = _scroll.position.maxScrollExtent;
      if (!max.isFinite) return;
      if (animate) {
        _scroll.animateTo(
          max,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      } else {
        _scroll.jumpTo(max);
      }
    });
  }

  /// Runs a status action; toasts the server's message on failure.
  Future<void> _act(
    Future<void> Function() call, {
    String? ok,
    bool leave = false,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await call();
      if (!mounted) return;
      if (ok != null) Alerts.success(ok);
      context.read<UnreadProvider>().refresh();
      widget.onChanged?.call();
      if (leave) {
        widget.onDeleted?.call();
        return;
      }
      await _load(silent: true);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } catch (_) {
      Alerts.error('Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forward() async {
    final yes = await Alerts.confirm(
      context,
      'SuperAdmin will receive full access to this ticket.',
      title: 'Forward to SuperAdmin?',
      confirmText: 'Forward',
      danger: false,
    );
    if (!yes || !mounted) return;
    await _act(() => widget.repo.forward(_id), ok: 'Forwarded to SuperAdmin.');
  }

  Future<void> _delete() async {
    final yes = await Alerts.confirm(
      context,
      'This cannot be undone.',
      title: 'Delete this ticket?',
      confirmText: 'Delete',
    );
    if (!yes || !mounted) return;
    await _act(
      () => widget.repo.delete(_id),
      ok: 'Ticket deleted.',
      leave: true,
    );
  }

  Future<void> _reject() async {
    final reason = _reason.text.trim();
    await _act(() => widget.repo.verify(_id, accept: false, reason: reason));
    if (!mounted) return;
    setState(() {
      _rejecting = false;
      _reason.clear();
    });
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if ((text.isEmpty && _files.isEmpty) || _sending) return;
    setState(() => _sending = true);
    try {
      final t = await widget.repo.reply(
        _id,
        text.isEmpty ? '(attachment)' : text,
        files: _files,
      );
      if (!mounted) return;
      setState(() {
        // The response is the whole ticket (new message + any status change).
        _t = t.messages.isEmpty ? _t : t;
        _reply.clear();
        _files = [];
      });
      _toBottom(animate: true);
      widget.onChanged?.call();
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } catch (_) {
      Alerts.error('Could not send your message. Please try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _attach() async {
    final next = await chooseAttachments(context, _files);
    if (next != null && mounted) setState(() => _files = next);
  }

  @override
  Widget build(BuildContext context) {
    final t = _t;
    if (t == null) {
      if (_error != null) {
        return ErrorView(message: _error!, onRetry: () => _load());
      }
      return const LoadingView();
    }
    return LayoutBuilder(
      builder: (context, c) {
        final sidebar = c.maxWidth >= 720 && c.maxHeight >= 460;
        final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
        final header = _Header(
          ticket: t,
          access: _acc,
          busy: _busy,
          onStart: () => _act(() => widget.repo.startProgress(_id)),
          onAsk: () => _act(() => widget.repo.askForConfirmation(_id)),
          onForward: _forward,
          onDelete: _delete,
        );
        final thread = LayoutBuilder(
          builder: (context, tc) => Column(
            children: [
              Expanded(
                child: _Thread(ticket: t, myId: _acc.myId, controller: _scroll),
              ),
              // The panel scrolls inside 60 % of the pane, so a huge text size or the
              // keyboard can never push the thread off screen or overflow.
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: tc.maxHeight * 0.6),
                child: SingleChildScrollView(reverse: true, child: _bottom(t)),
              ),
            ],
          ),
        );
        if (sidebar) {
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: header,
              ),
              const Divider(height: 1),
              Expanded(
                child: Row(
                  children: [
                    SizedBox(width: 240, child: _DescriptionPanel(ticket: t)),
                    const VerticalDivider(width: 1),
                    Expanded(child: thread),
                  ],
                ),
              ),
            ],
          );
        }
        return Column(
          children: [
            // Pinned header; folds away smoothly while typing so the thread keeps its room.
            AnimatedSize(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              alignment: Alignment.topCenter,
              child: keyboardUp
                  ? const SizedBox(width: double.infinity)
                  : Column(
                      children: [
                        ConstrainedBox(
                          constraints: BoxConstraints(maxHeight: c.maxHeight * 0.42),
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                            child: header,
                          ),
                        ),
                        const Divider(height: 1),
                      ],
                    ),
            ),
            Expanded(child: thread),
          ],
        );
      },
    );
  }

  Widget _bottom(Ticket t) {
    final s = Theme.of(context).colorScheme;
    if (_acc.needsMyVerification(t)) return _verifyPanel(s);
    if (!_acc.canReply(t)) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: s.outlineVariant)),
        ),
        child: Text(
          'This ticket is closed.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
        ),
      );
    }
    return _composer(s);
  }

  Widget _verifyPanel(ColorScheme s) {
    const tone = Color(0xFF7C3AED);
    final fg = AppColors.readable(context, tone);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Color.alphaBlend(tone.withValues(alpha: 0.10), s.surface),
        border: Border(top: BorderSide(color: s.outlineVariant)),
      ),
      child: _rejecting
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  "What's still wrong?",
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: fg),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: _reason,
                  minLines: 2,
                  maxLines: 4,
                  keyboardType: TextInputType.multiline,
                  textInputAction: TextInputAction.newline,
                  textCapitalization: TextCapitalization.sentences,
                  scrollPadding: const EdgeInsets.fromLTRB(20, 20, 20, 120),
                  style: const TextStyle(fontSize: 14),
                  decoration: const InputDecoration(
                    hintText: 'Tell them what needs fixing…',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  alignment: WrapAlignment.end,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: _busy
                          ? null
                          : () => setState(() => _rejecting = false),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: s.error,
                        foregroundColor: s.onError,
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: _busy ? null : _reject,
                      child: const Text('Reopen ticket'),
                    ),
                  ],
                ),
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.verified_outlined, color: fg, size: 24),
                const SizedBox(height: 4),
                const Text(
                  'Has your issue been resolved?',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 2),
                Text(
                  'The support team marked this as resolved. Please confirm.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant),
                ),
                const SizedBox(height: 8),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: tone,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: _busy
                          ? null
                          : () => _act(
                              () => widget.repo.verify(_id, accept: true),
                              ok: 'Ticket closed!',
                            ),
                      child: const Text('Accept & close'),
                    ),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size(0, 44),
                      ),
                      onPressed: _busy
                          ? null
                          : () => setState(() => _rejecting = true),
                      child: const Text('Not resolved'),
                    ),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _composer(ColorScheme s) {
    return Container(
      padding: const EdgeInsets.fromLTRB(4, 6, 8, 6),
      decoration: BoxDecoration(
        color: s.surface,
        border: Border(top: BorderSide(color: s.outlineVariant)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_files.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4, left: 4),
              child: PendingAttachmentStrip(
                files: _files,
                enabled: !_sending,
                onRemove: (i) => setState(() => _files = [..._files]..removeAt(i)),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              IconButton(
                tooltip: 'Attach',
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                padding: EdgeInsets.zero,
                onPressed: _sending || _files.length >= kMaxAttachments ? null : _attach,
                icon: const Icon(Icons.attach_file_rounded, size: 20),
              ),
              Expanded(
                child: TextField(
                  controller: _reply,
                  minLines: 1,
                  maxLines: 5,
                  keyboardType: TextInputType.multiline,
                  textInputAction: TextInputAction.newline,
                  textCapitalization: TextCapitalization.sentences,
                  scrollPadding: const EdgeInsets.fromLTRB(20, 20, 20, 100),
                  style: const TextStyle(fontSize: 14),
                  decoration: const InputDecoration(
                    hintText: 'Type a message…',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              // Only the send button follows the text, not the whole conversation.
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: _reply,
                builder: (_, v, _) {
                  final canSend = !_sending && (v.text.trim().isNotEmpty || _files.isNotEmpty);
                  return IconButton.filled(
                    tooltip: 'Send',
                    constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                    padding: EdgeInsets.zero,
                    onPressed: canSend ? _send : null,
                    icon: _sending
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: s.onPrimary),
                          )
                        : const Icon(Icons.send_rounded, size: 18),
                  );
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.ticket,
    required this.access,
    required this.busy,
    required this.onStart,
    required this.onAsk,
    required this.onForward,
    required this.onDelete,
  });

  final Ticket ticket;
  final TicketAccess access;
  final bool busy;
  final VoidCallback onStart;
  final VoidCallback onAsk;
  final VoidCallback onForward;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final t = ticket;
    final by = [
      if (t.raisedByName.isNotEmpty) 'by ${t.raisedByName}',
      if (t.forwardedByName != null) 'forwarded by ${t.forwardedByName}',
      if (t.createdAt != null) 'opened ${stamp(t.createdAt)}',
    ].join(' · ');
    final btn = ButtonStyle(
      minimumSize: WidgetStateProperty.all(const Size(0, 40)),
      visualDensity: VisualDensity.compact,
      padding: WidgetStateProperty.all(const EdgeInsets.symmetric(horizontal: 12)),
      textStyle: WidgetStateProperty.all(const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${t.ticketId} — ${t.subject}',
          style: const TextStyle(fontSize: 15, height: 1.25, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            StatusPill(t.status),
            PriorityPill(t.priority),
            PlatformPill(t.platform),
          ],
        ),
        if (by.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(by, style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
        ],
        if (access.canStart(t) ||
            access.canAskConfirmation(t) ||
            access.canForward(t) ||
            access.canDelete(t)) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              if (access.canStart(t))
                FilledButton.tonalIcon(
                  style: btn,
                  onPressed: busy ? null : onStart,
                  icon: const Icon(Icons.schedule_rounded, size: 16),
                  label: const Text('Start progress'),
                ),
              if (access.canAskConfirmation(t))
                FilledButton.tonalIcon(
                  style: btn,
                  onPressed: busy ? null : onAsk,
                  icon: const Icon(
                    Icons.check_circle_outline_rounded,
                    size: 16,
                  ),
                  label: const Text('Ask confirmation'),
                ),
              if (access.canForward(t))
                OutlinedButton.icon(
                  style: btn,
                  onPressed: busy ? null : onForward,
                  icon: const Icon(Icons.arrow_circle_up_rounded, size: 16),
                  label: const Text('Forward to admin'),
                ),
              if (access.canDelete(t))
                OutlinedButton.icon(
                  style: btn.copyWith(
                    foregroundColor: WidgetStateProperty.all(s.error),
                  ),
                  onPressed: busy ? null : onDelete,
                  icon: const Icon(Icons.delete_outline_rounded, size: 16),
                  label: const Text('Delete'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

/// iPad sidebar: the description + ticket-level attachments (the web's left column).
class _DescriptionPanel extends StatelessWidget {
  const _DescriptionPanel({required this.ticket});
  final Ticket ticket;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final label = TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.4,
      color: s.onSurfaceVariant,
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('DESCRIPTION', style: label),
          const SizedBox(height: 8),
          Text(
            ticket.description,
            style: const TextStyle(fontSize: 13.5, height: 1.35),
          ),
          if (ticket.attachments.isNotEmpty) ...[
            const SizedBox(height: 16),
            Divider(color: s.outlineVariant),
            const SizedBox(height: 8),
            Text('ATTACHMENTS', style: label),
            const SizedBox(height: 8),
            AttachmentGallery(urls: ticket.attachments, thumb: 56),
          ],
        ],
      ),
    );
  }
}

class _Thread extends StatelessWidget {
  const _Thread({
    required this.ticket,
    required this.myId,
    required this.controller,
  });
  final Ticket ticket;
  final String myId;
  final ScrollController controller;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final msgs = ticket.messages;
    if (msgs.isEmpty) {
      return Center(
        child: Text(
          'No messages yet.',
          style: TextStyle(color: s.onSurfaceVariant),
        ),
      );
    }
    return ListView.builder(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      itemCount: msgs.length,
      itemBuilder: (_, i) {
        final m = msgs[i];
        if (m.isSystem) return _SystemNote(m);
        return _Bubble(message: m, mine: myId.isNotEmpty && m.senderId == myId);
      },
    );
  }
}

class _SystemNote extends StatelessWidget {
  const _SystemNote(this.m);
  final TicketMessage m;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: s.surfaceContainerHigh,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            '${m.senderName}: ${m.message}',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.mine});
  final TicketMessage message;
  final bool mine;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final maxW = (MediaQuery.sizeOf(context).width * 0.78).clamp(0.0, 560.0);
    final m = message;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxW),
          child: Column(
            crossAxisAlignment: mine
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              if (!mine && m.senderName.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3, left: 2),
                  child: Text(
                    m.senderName,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: s.onSurfaceVariant,
                    ),
                  ),
                ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 11,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: mine ? s.primary : s.surfaceContainerHigh,
                  border: mine ? null : Border.all(color: s.outlineVariant),
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(16),
                    topRight: const Radius.circular(16),
                    bottomLeft: Radius.circular(mine ? 16 : 4),
                    bottomRight: Radius.circular(mine ? 4 : 16),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      m.message,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.3,
                        color: mine ? s.onPrimary : s.onSurface,
                      ),
                    ),
                    if (m.attachments.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      AttachmentGallery(
                        urls: m.attachments,
                        thumb: 84,
                        onFilled: mine,
                      ),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(top: 3, left: 2, right: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        stamp(m.createdAt),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: s.onSurfaceVariant,
                        ),
                      ),
                    ),
                    if (mine) ...[
                      const SizedBox(width: 4),
                      Icon(
                        m.isRead ? Icons.done_all_rounded : Icons.done_rounded,
                        size: 14,
                        semanticLabel: m.isRead ? 'Read' : 'Sent',
                        color: m.isRead
                            ? AppColors.brand500
                            : s.onSurfaceVariant,
                      ),
                    ],
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
