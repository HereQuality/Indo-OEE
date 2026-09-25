import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/formatters.dart';

/// Values the server enforces (models/Ticket.js). There is no "category" or
/// "assignee" on a ticket: work is routed by `tier` (agent queue vs SuperAdmin).
const kTicketStatuses = ['Pending', 'In Progress', 'Confirmation', 'Resolved', 'Closed'];
const kTicketPriorities = ['Low', 'Medium', 'High'];
const kTicketPlatforms = ['Web', 'App'];

/// upload.middleware.js: 5 files per message, 5 MB each.
const kMaxAttachments = 5;
const kMaxAttachmentBytes = 5 * 1024 * 1024;

const _violet = Color(0xFF6D28D9);
const _pink = Color(0xFFBE185D);

Color statusTone(String s) => switch (s) {
      'In Progress' => AppColors.warn,
      'Confirmation' => _pink,
      'Resolved' => _violet,
      'Closed' => AppColors.ok,
      _ => AppColors.brand600,
    };

Color priorityTone(String p) => switch (p) {
      'High' => AppColors.critical,
      'Medium' => AppColors.warn,
      _ => AppColors.slate500,
    };

Color platformTone(String p) => p == 'App' ? _violet : AppColors.brand600;

String _s(dynamic v, [String fallback = '']) {
  if (v == null) return fallback;
  final t = v.toString();
  return t.isEmpty ? fallback : t;
}

List<String> _urls(dynamic v) =>
    v is List ? v.map((e) => e?.toString() ?? '').where((e) => e.isNotEmpty).toList() : const [];

final _imageExt = RegExp(r'\.(jpe?g|png|gif|webp)', caseSensitive: false);
bool isImageUrl(String url) => _imageExt.hasMatch(url);

/// One chat message. System messages ("Started working on this ticket.") are
/// centred notes, not bubbles.
class TicketMessage {
  const TicketMessage({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.message,
    this.attachments = const [],
    this.isRead = false,
    this.isSystem = false,
    this.createdAt,
  });

  final String id;
  final String senderId;
  final String senderName;
  final String message;
  final List<String> attachments;
  final bool isRead;
  final bool isSystem;
  final DateTime? createdAt;

  factory TicketMessage.fromJson(dynamic j) {
    final m = j is Map ? j : const {};
    return TicketMessage(
      id: _s(m['_id']),
      senderId: _s(m['senderId']),
      senderName: _s(m['senderName']),
      message: _s(m['message']),
      attachments: _urls(m['attachments']),
      isRead: m['isRead'] == true,
      isSystem: m['isSystem'] == true,
      createdAt: Fmt.parse(m['createdAt']),
    );
  }

  TicketMessage copyWith({bool? isRead}) => TicketMessage(
        id: id,
        senderId: senderId,
        senderName: senderName,
        message: message,
        attachments: attachments,
        isRead: isRead ?? this.isRead,
        isSystem: isSystem,
        createdAt: createdAt,
      );
}

class Ticket {
  const Ticket({
    required this.id,
    required this.ticketId,
    required this.subject,
    required this.description,
    required this.status,
    required this.priority,
    required this.platform,
    required this.tier,
    required this.raisedById,
    required this.raisedByName,
    this.forwardedByName,
    this.attachments = const [],
    this.messages = const [],
    this.hasUnread = false,
    this.createdAt,
    this.updatedAt,
  });

  final String id; // Mongo _id (used in URLs)
  final String ticketId; // "TKT-1001"
  final String subject;
  final String description;
  final String status;
  final String priority;
  final String platform;
  final String tier; // agent | admin
  final String raisedById;
  final String raisedByName;
  final String? forwardedByName;
  final List<String> attachments;
  final List<TicketMessage> messages;
  final bool hasUnread;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// Never throws: a malformed row still renders.
  factory Ticket.fromJson(dynamic j) {
    final m = j is Map ? j : const {};
    final msgs = m['messages'];
    return Ticket(
      id: _s(m['_id'] ?? m['id']),
      ticketId: _s(m['ticketId'], '—'),
      subject: _s(m['subject'], '(no subject)'),
      description: _s(m['description']),
      status: _s(m['status'], 'Pending'),
      priority: _s(m['priority'], 'Medium'),
      platform: _s(m['platform'], 'Web'),
      tier: _s(m['tier'], 'agent'),
      raisedById: _s(m['raisedById']),
      raisedByName: _s(m['raisedByName']),
      forwardedByName: m['forwardedByName'] == null ? null : _s(m['forwardedByName']),
      attachments: _urls(m['attachments']),
      messages: msgs is List ? msgs.map(TicketMessage.fromJson).toList() : const [],
      hasUnread: m['hasUnread'] == true,
      createdAt: Fmt.parse(m['createdAt']),
      updatedAt: Fmt.parse(m['updatedAt']) ?? Fmt.parse(m['createdAt']),
    );
  }

  Ticket copyWith({List<TicketMessage>? messages}) => Ticket(
        id: id,
        ticketId: ticketId,
        subject: subject,
        description: description,
        status: status,
        priority: priority,
        platform: platform,
        tier: tier,
        raisedById: raisedById,
        raisedByName: raisedByName,
        forwardedByName: forwardedByName,
        attachments: attachments,
        messages: messages ?? this.messages,
        hasUnread: hasUnread,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );

  /// Same search fields as the web page.
  bool matches(String q) {
    if (q.isEmpty) return true;
    return [ticketId, subject, raisedByName, priority, status, platform, forwardedByName]
        .whereType<String>()
        .any((v) => v.toLowerCase().contains(q));
  }
}

/// Who may do what on a ticket — the same rules as Support.jsx and
/// ticket.controller.js, so the UI never offers an action the server refuses.
///
///  * SuperAdmin handles only `tier == admin` tickets.
///  * A support agent (edit permission on the Support page) handles
///    `tier == agent` tickets and may forward them up to SuperAdmin.
///  * Only the person who raised a ticket can accept / reject the fix, and can
///    delete it (only while it is still Pending).
class TicketAccess {
  const TicketAccess({required this.myId, required this.isAdmin, required this.canAct});

  final String myId;
  final bool isAdmin;
  final bool canAct;

  bool isCreator(Ticket t) => t.raisedById == myId;

  bool canHandle(Ticket t) => isAdmin ? t.tier == 'admin' : (canAct && t.tier == 'agent');
  bool canStart(Ticket t) => canHandle(t) && t.status == 'Pending';
  bool canAskConfirmation(Ticket t) => canHandle(t) && t.status == 'In Progress';
  bool canForward(Ticket t) => canHandle(t) && t.tier == 'agent' && t.status != 'Closed';
  bool canDelete(Ticket t) => t.status == 'Pending' && isCreator(t);
  bool needsMyVerification(Ticket t) => t.status == 'Confirmation' && isCreator(t);
  bool canReply(Ticket t) => t.status != 'Closed' && !needsMyVerification(t);

  /// SuperAdmin has nobody above to raise a ticket to (server answers 400).
  bool get canCreate => !isAdmin;
}
