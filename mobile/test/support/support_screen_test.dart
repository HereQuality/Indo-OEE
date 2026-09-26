import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/support/attachments.dart';
import 'package:indo/features/support/support_models.dart';
import 'package:indo/features/support/support_screen.dart';
import 'package:indo/models/menu_models.dart';

import 'fake_api.dart';

const _list = '/api/v1/tickets';

// 1x1 transparent PNG.
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');

String _ago(int minutes) => DateTime.now().subtract(Duration(minutes: minutes)).toUtc().toIso8601String();

Map<String, dynamic> _msg(String id, String sender, String name, String text, {bool system = false, bool read = false}) => {
      '_id': id,
      'senderId': sender,
      'senderName': name,
      'message': text,
      'attachments': <String>[],
      'isRead': read,
      'isSystem': system,
      'createdAt': _ago(20),
    };

Map<String, dynamic> _ticket(
  String id, {
  String subject = 'Printer jammed',
  String status = 'Pending',
  String tier = 'agent',
  String by = 'u1',
  String byName = 'Test User',
  String priority = 'Medium',
  int updated = 10,
  bool unread = false,
  bool withMessages = false,
}) =>
    {
      '_id': id,
      'ticketId': 'TKT-${1000 + id.codeUnitAt(0)}',
      'subject': subject,
      'description': 'It keeps jamming on tray 2',
      'status': status,
      'priority': priority,
      'platform': 'App',
      'tier': tier,
      'raisedById': by,
      'raisedByName': byName,
      'attachments': <String>[],
      'hasUnread': unread,
      'createdAt': _ago(120),
      'updatedAt': _ago(updated),
      if (withMessages)
        'messages': [
          _msg('m1', by, byName, 'It keeps jamming on tray 2', read: true),
          _msg('m2', 'agent9', 'Asha Support', 'Looking into it'),
          _msg('m3', 'agent9', 'Asha Support', 'Started working on this ticket.', system: true),
        ],
    };

const _long = 'A very long ticket subject that will wrap over several lines on a tiny phone';
const _agentPerms = PagePerms(view: true, create: true, edit: true);
const _userPerms = PagePerms(view: true, create: true);

final _operator = testUser(superAdmin: false, extra: {'_id': 'u1'});

class _FakeSource extends AttachmentSource {
  const _FakeSource(this.pick);
  final List<PendingAttachment> pick;
  @override
  Future<List<PendingAttachment>> camera() async => pick;
  @override
  Future<List<PendingAttachment>> files() async => pick;
  @override
  Future<List<PendingAttachment>> photos() async => pick;
}

/// Ticket server that remembers status changes, like the real one.
class _Server {
  _Server(this.api, List<Map<String, dynamic>> initial) : tickets = [...initial] {
    api.on('GET', _list, (_) => {'isOk': true, 'data': tickets.map((t) => {...t}..remove('messages')).toList()});
    for (final t in tickets) {
      final id = t['_id'] as String;
      api.on('GET', '$_list/$id', (_) => {'isOk': true, 'data': tickets.firstWhere((x) => x['_id'] == id)});
      api.on('PATCH', '$_list/$id/read', (_) => {'isOk': true, 'updated': false});
      api.on('POST', '$_list/$id/start-progress', (_) => _set(id, 'In Progress'));
      api.on('POST', '$_list/$id/ask-confirmation', (_) => _set(id, 'Confirmation'));
      api.on('POST', '$_list/$id/forward', (_) => _set(id, null, tier: 'admin'));
      api.on('POST', '$_list/$id/verify', (r) => _set(id, (r.body as Map)['action'] == 'Accept' ? 'Closed' : 'In Progress'));
      api.on('DELETE', '$_list/$id', (_) {
        tickets.removeWhere((x) => x['_id'] == id);
        return {'isOk': true, 'message': 'Ticket deleted.'};
      });
      api.on('POST', '$_list/$id/reply', (r) {
        final t = tickets.firstWhere((x) => x['_id'] == id);
        final msgs = [...(t['messages'] as List? ?? const [])];
        msgs.add(_msg('m${msgs.length + 1}', 'u1', 'Test User', (r.body as Map)['message'] as String));
        t['messages'] = msgs;
        return {'isOk': true, 'data': t};
      });
    }
  }

  final FakeApi api;
  final List<Map<String, dynamic>> tickets;

  Map<String, dynamic> _set(String id, String? status, {String? tier}) {
    final t = tickets.firstWhere((x) => x['_id'] == id);
    if (status != null) t['status'] = status;
    if (tier != null) t['tier'] = tier;
    return {'isOk': true, 'data': t};
  }
}

Future<void> _open(WidgetTester tester, String subject) async {
  await tester.ensureVisible(find.text(subject));
  await tester.pumpAndSettle();
  await tester.tap(find.text(subject));
  await tester.pumpAndSettle();
}

Future<void> _tapVisible(WidgetTester tester, String text) async {
  await tester.ensureVisible(find.text(text));
  await tester.pumpAndSettle();
  await tester.tap(find.text(text));
  await tester.pumpAndSettle();
}

void main() {
  tearDown(() => attachmentSource = const DeviceAttachmentSource());

  group('list', () {
    testWidgets('loads tickets newest first with unread dot, counts and filters', (tester) async {
      final api = FakeApi.install();
      _Server(api, [
        _ticket('a', subject: 'Printer jammed', updated: 30),
        _ticket('b', subject: 'Login fails', updated: 5, unread: true, status: 'In Progress'),
        _ticket('c', subject: 'Slow report', updated: 90, status: 'Closed', priority: 'High'),
      ]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);

      expect(find.text('Login fails'), findsOneWidget);
      expect(find.text('Printer jammed'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Login fails')).dy, lessThan(tester.getTopLeft(find.text('Printer jammed')).dy));
      expect(find.byWidgetPredicate((w) => w is Semantics && w.properties.label == 'Unread'), findsOneWidget);
      expect(find.text('All (3)'), findsOneWidget);
      expect(find.text('In Progress (1)'), findsOneWidget);
      expect(find.text('Raised by me'), findsNothing); // only for support agents

      await _tapVisible(tester, 'Closed (1)');
      expect(find.text('Slow report'), findsOneWidget);
      expect(find.text('Login fails'), findsNothing);

      await _tapVisible(tester, 'All (3)');
      await tester.enterText(find.byType(TextField).first, 'login');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('Login fails'), findsOneWidget);
      expect(find.text('Printer jammed'), findsNothing);

      await tester.enterText(find.byType(TextField).first, 'zzzz');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(find.text('No tickets match your filters.'), findsOneWidget);
    });

    testWidgets('support agent can narrow the queue to tickets they raised', (tester) async {
      final api = FakeApi.install();
      _Server(api, [
        _ticket('a', subject: 'Mine one', by: 'u1'),
        _ticket('b', subject: 'Queue one', by: 'u7', byName: 'Ravi', updated: 40),
      ]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _agentPerms);
      expect(find.text('Queue one'), findsOneWidget);
      await tester.tap(find.text('Raised by me'));
      await tester.pumpAndSettle();
      expect(find.text('Mine one'), findsOneWidget);
      expect(find.text('Queue one'), findsNothing);
    });

    testWidgets('empty state', (tester) async {
      final api = FakeApi.install();
      api.list(_list, []);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      expect(find.text('No tickets found.'), findsOneWidget);
    });

    testWidgets('error shows the server message and Try again reloads', (tester) async {
      final api = FakeApi.install();
      var calls = 0;
      api.on('GET', _list, (_) {
        calls++;
        return calls == 1
            ? FakeResponse({'isOk': false, 'message': 'Boom'}, status: 500)
            : {'isOk': true, 'data': [_ticket('a')]};
      });
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      expect(find.text('Boom'), findsOneWidget);
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Printer jammed'), findsOneWidget);
      expect(calls, 2);
    });
  });

  group('create', () {
    testWidgets('sends JSON without files, validates first, then lists the new ticket', (tester) async {
      final api = FakeApi.install();
      final tickets = <Map<String, dynamic>>[];
      api.on('GET', _list, (_) => {'isOk': true, 'data': tickets});
      api.on('POST', _list, (r) {
        final t = _ticket('n', subject: (r.body as Map)['subject'] as String);
        tickets.add(t);
        return {'isOk': true, 'data': t};
      });
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms, size: const Size(430, 1300));

      await tester.tap(find.text('New ticket'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Create ticket'));
      await tester.pumpAndSettle();
      expect(find.text('Subject and description are required.'), findsOneWidget);
      expect(api.called('POST', _list), isEmpty);

      await tester.enterText(find.byType(TextFormField).at(0), '  Cannot print  ');
      await tester.enterText(find.byType(TextFormField).at(1), 'Tray 2 jams');
      await tester.tap(find.text('High'));
      await tester.tap(find.text('Web'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Create ticket'));
      await tester.pumpAndSettle();

      final req = api.called('POST', _list).single;
      expect(req.body, {'subject': 'Cannot print', 'description': 'Tray 2 jams', 'priority': 'High', 'platform': 'Web'});
      expect(find.text('Cannot print'), findsOneWidget); // back on the list, reloaded
    });

    testWidgets('sends multipart with attachments; rejects big / unsupported files', (tester) async {
      final api = FakeApi.install();
      api.list(_list, []);
      api.on('POST', _list, (r) => {'isOk': true, 'data': _ticket('n')});
      attachmentSource = _FakeSource([
        PendingAttachment(name: 'shot.png', bytes: _png, size: _png.length),
        PendingAttachment(name: 'log.pdf', bytes: _png, size: 1200),
        PendingAttachment(name: 'huge.png', bytes: _png, size: 6 * 1024 * 1024),
        PendingAttachment(name: 'run.exe', bytes: _png, size: 10),
      ]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms, size: const Size(430, 1300));

      await tester.tap(find.text('New ticket'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField).at(0), 'Screen frozen');
      await tester.enterText(find.byType(TextFormField).at(1), 'See screenshot');
      await tester.ensureVisible(find.text('Add photo or file'));
      await tester.tap(find.text('Add photo or file'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Photo library'));
      await tester.pumpAndSettle();

      expect(find.text('2/5'), findsOneWidget); // huge.png and run.exe were refused
      await tester.ensureVisible(find.text('Create ticket'));
      await tester.tap(find.text('Create ticket'));
      await tester.pumpAndSettle();

      final body = api.called('POST', _list).single.body as Map;
      expect(body['subject'], 'Screen frozen');
      expect(body['priority'], 'Medium');
      expect(body['platform'], 'App');
      expect(body['files'], ['attachments', 'attachments']);
    });

    testWidgets('SuperAdmin cannot raise tickets; the New ticket button is absent without create permission', (tester) async {
      final api = FakeApi.install();
      api.list(_list, []);
      await pumpScreen(tester, const SupportScreen());
      expect(find.text('New ticket'), findsNothing);
    });

    testWidgets('no New ticket button without the create permission', (tester) async {
      final api = FakeApi.install();
      api.list(_list, []);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: const PagePerms(view: true));
      expect(find.text('New ticket'), findsNothing);
    });
  });

  group('detail', () {
    testWidgets('loads the thread, marks it read, and posts a reply', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', status: 'In Progress', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      await _open(tester, 'Login fails');

      expect(find.text('Looking into it'), findsOneWidget);
      expect(find.text('Asha Support'), findsWidgets);
      expect(find.text('Asha Support: Started working on this ticket.'), findsOneWidget);
      expect(api.called('PATCH', '$_list/b/read'), isNotEmpty);

      await tester.enterText(find.byType(TextField), 'Thanks, still failing');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pumpAndSettle();

      expect(api.called('POST', '$_list/b/reply').single.body, {'message': 'Thanks, still failing'});
      expect(find.text('Thanks, still failing'), findsOneWidget);
    });

    testWidgets('agent starts progress then asks for confirmation (status round-trip)', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', by: 'u7', byName: 'Ravi', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _agentPerms);
      await _open(tester, 'Login fails');

      expect(find.text('Start progress'), findsOneWidget);
      expect(find.text('Forward to admin'), findsOneWidget);
      expect(find.text('Delete'), findsNothing); // only the person who raised it, only while Pending

      await tester.tap(find.text('Start progress'));
      await tester.pumpAndSettle();
      expect(api.called('POST', '$_list/b/start-progress'), hasLength(1));
      expect(find.text('Start progress'), findsNothing);
      expect(find.text('Ask confirmation'), findsOneWidget);

      await tester.tap(find.text('Ask confirmation'));
      await tester.pumpAndSettle();
      expect(api.called('POST', '$_list/b/ask-confirmation'), hasLength(1));
      expect(find.text('Ask confirmation'), findsNothing);
    });

    testWidgets('agent forwards to SuperAdmin after confirming', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', by: 'u7', byName: 'Ravi', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _agentPerms);
      await _open(tester, 'Login fails');

      await tester.tap(find.text('Forward to admin'));
      await tester.pumpAndSettle();
      expect(find.text('Forward to SuperAdmin?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Forward'));
      await tester.pumpAndSettle();
      expect(api.called('POST', '$_list/b/forward'), hasLength(1));
      expect(find.text('Forward to admin'), findsNothing); // now tier admin: gone
    });

    testWidgets('raiser accepts or rejects a fix waiting for confirmation', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', status: 'Confirmation', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      await _open(tester, 'Login fails');

      expect(find.text('Has your issue been resolved?'), findsOneWidget);
      expect(find.text('Type a message…'), findsNothing); // composer replaced by the verify panel

      await tester.tap(find.text('Not resolved'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'still broken');
      await tester.tap(find.text('Reopen ticket'));
      await tester.pumpAndSettle();
      expect(api.called('POST', '$_list/b/verify').single.body, {'action': 'Reject', 'reason': 'still broken'});
      expect(find.text('Type a message…'), findsOneWidget); // In Progress again -> composer is back
    });

    testWidgets('raiser accepts: closes the ticket', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', status: 'Confirmation', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      await _open(tester, 'Login fails');
      await tester.tap(find.text('Accept & close'));
      await tester.pumpAndSettle();
      expect(api.called('POST', '$_list/b/verify').single.body, {'action': 'Accept'});
      expect(find.text('This ticket is closed.'), findsOneWidget);
    });

    testWidgets('raiser deletes a Pending ticket after confirming', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', withMessages: true), _ticket('a', subject: 'Other one', updated: 50)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      await _open(tester, 'Login fails');

      await tester.tap(find.widgetWithText(OutlinedButton, 'Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete this ticket?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
      await tester.pumpAndSettle();

      expect(api.called('DELETE', '$_list/b'), hasLength(1));
      expect(find.text('Login fails'), findsNothing); // popped back, list reloaded
      expect(find.text('Other one'), findsOneWidget);
    });

    testWidgets('plain user gets no handler actions (only Delete on own Pending ticket)', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('b', subject: 'Login fails', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _userPerms);
      await _open(tester, 'Login fails');
      expect(find.text('Start progress'), findsNothing);
      expect(find.text('Forward to admin'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Delete'), findsOneWidget); // creator + Pending
    });

    testWidgets('SuperAdmin handles admin-tier tickets only', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('z', subject: 'Escalated', tier: 'admin', by: 'u7', byName: 'Ravi', withMessages: true)]);
      await pumpScreen(tester, const SupportScreen()); // SuperAdmin
      await _open(tester, 'Escalated');
      expect(find.text('Start progress'), findsOneWidget);
      expect(find.text('Forward to admin'), findsNothing);
    });
  });

  group('access rules', () {
    Ticket t(Map<String, dynamic> j) => Ticket.fromJson(j);
    const user = TicketAccess(myId: 'u1', isAdmin: false, canAct: false);
    const agent = TicketAccess(myId: 'u1', isAdmin: false, canAct: true);
    const admin = TicketAccess(myId: 'root', isAdmin: true, canAct: true);

    test('handler, forward, delete, verify and reply gating', () {
      final mine = t(_ticket('a'));
      final theirs = t(_ticket('a', by: 'u7'));
      final escalated = t(_ticket('a', tier: 'admin', by: 'u7'));
      final waiting = t(_ticket('a', status: 'Confirmation'));

      expect(user.canStart(mine), isFalse);
      expect(agent.canStart(theirs), isTrue);
      expect(agent.canStart(escalated), isFalse); // already with SuperAdmin
      expect(agent.canForward(theirs), isTrue);
      expect(admin.canStart(escalated), isTrue);
      expect(admin.canForward(escalated), isFalse);
      expect(admin.canCreate, isFalse);

      expect(user.canDelete(mine), isTrue);
      expect(user.canDelete(t(_ticket('a', status: 'In Progress'))), isFalse);
      expect(agent.canDelete(theirs), isFalse);

      expect(user.needsMyVerification(waiting), isTrue);
      expect(agent.needsMyVerification(t(_ticket('a', status: 'Confirmation', by: 'u7'))), isFalse);
      expect(user.canReply(waiting), isFalse);
      expect(user.canReply(t(_ticket('a', status: 'Closed'))), isFalse);
      expect(user.canReply(mine), isTrue);
    });

    test('tolerates malformed rows', () {
      final x = Ticket.fromJson({'_id': 5, 'messages': 'nope', 'attachments': [null, 'a.png']});
      expect(x.id, '5');
      expect(x.status, 'Pending');
      expect(x.attachments, ['a.png']);
      expect(x.messages, isEmpty);
      expect(Ticket.fromJson(null).subject, '(no subject)');
    });
  });

  group('layouts', () {
    testWidgets('dark, 360x640, text scale 1.6: list, detail and create form do not overflow', (tester) async {
      final api = FakeApi.install();
      _Server(api, [
        _ticket('a', subject: _long, status: 'Confirmation', unread: true, updated: 3, withMessages: true),
        _ticket('b', subject: 'Second', status: 'In Progress', priority: 'High', by: 'u7', byName: 'Somebody With A Long Name', updated: 4),
      ]);
      await pumpScreen(tester, const SupportScreen(),
          user: _operator, perms: _agentPerms, dark: true, textScale: 1.6, size: const Size(360, 640));
      expect(tester.takeException(), isNull);

      await _open(tester, 'Second');
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();

      await _open(tester, _long);
      expect(tester.takeException(), isNull);
      expect(find.text('Has your issue been resolved?'), findsOneWidget);
      await tester.tap(find.text('Not resolved'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();

      await tester.tap(find.text('New ticket'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Raise support ticket'), findsOneWidget);
    });

    testWidgets('iPad portrait shows the web table', (tester) async {
      final api = FakeApi.install();
      _Server(api, [_ticket('a', subject: 'Login fails', by: 'u7', byName: 'Ravi')]);
      await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _agentPerms, size: const Size(820, 1180));
      for (final h in ['TICKET', 'SUBJECT', 'RAISED BY', 'PLATFORM', 'PRIORITY', 'STATUS', 'UPDATED']) {
        expect(find.text(h), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await _open(tester, 'Login fails');
      expect(find.text('Start progress'), findsOneWidget);
    });

    testWidgets('iPad: dark + text scale 1.6 table and the create dialog do not overflow', (tester) async {
      final api = FakeApi.install();
      api.list(_list, [_ticket('a', subject: 'Login fails', status: 'Confirmation', by: 'u7', byName: 'Ravi Kumar Sharma', unread: true)]);
      await pumpScreen(tester, const SupportScreen(),
          user: _operator, perms: _agentPerms, dark: true, textScale: 1.6, size: const Size(820, 1180));
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('New ticket'));
      await tester.pumpAndSettle();
      expect(find.text('Raise support ticket'), findsOneWidget);
      expect(find.byType(Dialog), findsOneWidget); // centred dialog on iPad, not a full page
      expect(tester.takeException(), isNull);
    });

    for (final dark in [false, true]) {
      testWidgets('iPad landscape is list + conversation side by side (dark: $dark)', (tester) async {
        final api = FakeApi.install();
        _Server(api, [
          _ticket('a', subject: 'Login fails', by: 'u7', byName: 'Ravi', withMessages: true),
          _ticket('b', subject: 'Printer jammed', updated: 40),
        ]);
        await pumpScreen(tester, const SupportScreen(),
            user: _operator, perms: _agentPerms, dark: dark, size: const Size(1180, 820));
        expect(find.text('Select a ticket to see the conversation.'), findsOneWidget);
        expect(find.text('New ticket'), findsOneWidget); // app bar button, not a floating one
        expect(find.byType(FloatingActionButton), findsNothing);

        await tester.tap(find.text('Login fails'));
        await tester.pumpAndSettle();
        expect(find.text('Select a ticket to see the conversation.'), findsNothing);
        expect(find.text('DESCRIPTION'), findsOneWidget); // web-style left column
        expect(find.text('Looking into it'), findsOneWidget);
        expect(find.text('Login fails'), findsWidgets); // list row + header
        expect(tester.takeException(), isNull);
      });
    }
  });
}
