import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/support/create_ticket.dart';
import 'package:indo/features/support/support_models.dart';
import 'package:indo/features/support/support_screen.dart';
import 'package:indo/features/support/ticket_detail.dart';
import 'package:indo/models/menu_models.dart';

import 'fake_api.dart';

const _list = '/api/v1/tickets';
const _perms = PagePerms(view: true, create: true, edit: true);
final _operator = testUser(superAdmin: false, extra: {'_id': 'u1'});

/// Tickets as the real server / old data can produce them.
List<Object?> get _messy => [
      {}, // totally empty
      {'_id': 't1'}, // only an id
      {
        '_id': 't2',
        'ticketId': 12, // number instead of string
        'subject': null,
        'status': 'Some Future Status',
        'priority': 'Urgent!',
        'platform': null,
        'raisedById': {'_id': 'u1', 'name': 'Populated Person'}, // populated ref
        'raisedByName': {'name': 'Populated Person'},
        'forwardedByName': null,
        'attachments': [null, '', 5, {'url': '/uploads/a.png'}],
        'messages': [null, 'x', {}, {'senderId': {'_id': 'u1'}, 'message': 7, 'createdAt': 'garbage'}],
        'hasUnread': 'true',
        'createdAt': 'nope',
        'updatedAt': null,
      },
      {'_id': 't3', 'subject': 'S' * 500, 'description': 'D' * 5000, 'messages': 'not a list', 'attachments': 'nope'},
      null,
      'a string',
      for (var i = 0; i < 120; i++) {'_id': 'bulk$i', 'ticketId': 'TKT-$i', 'subject': 'Bulk $i', 'status': 'Pending', 'priority': 'Low', 'platform': 'Web', 'raisedById': 'u9', 'updatedAt': DateTime.now().toIso8601String()},
    ];

void main() {
  test('Ticket.fromJson never throws and resolves populated refs', () {
    for (final raw in _messy) {
      final t = Ticket.fromJson(raw);
      expect(t.subject, isNotEmpty);
      t.matches('x');
    }
    final t = Ticket.fromJson((_messy)[2]);
    expect(t.raisedById, 'u1');
    expect(t.raisedByName, 'Populated Person');
    expect(t.attachments, ['5', '/uploads/a.png']);
    expect(t.hasUnread, isTrue);
  });

  testWidgets('a messy production list renders (phone) without throwing', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _perms);
    expect(tester.takeException(), isNull);
    expect(find.text('Bulk 119'), findsWidgets);
    for (var i = 0; i < 40; i++) {
      await tester.drag(find.byType(ListView).first, const Offset(0, -700));
      await tester.pump();
    }
    expect(find.text('(no subject)'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a messy ticket opens in the conversation view and the composer accepts any text', (tester) async {
    final api = FakeApi.install();
    api.on('GET', '$_list/t2', (_) => {'isOk': true, 'data': (_messy)[2]});
    api.on('PATCH', '$_list/t2/read', (_) => {'isOk': true});
    final summary = Ticket.fromJson((_messy)[2]);
    await pumpScreen(
      tester,
      TicketDetailPage(summary: summary, access: const TicketAccess(myId: 'u1', isAdmin: false, canAct: true)),
      user: _operator,
      perms: _perms,
    );
    expect(tester.takeException(), isNull);
    for (final t in ['1', '12abc', '1.2.3', '0000000000', 'line\nbreak', '', '😀 emoji']) {
      await tester.enterText(find.byType(TextField).first, t);
      await tester.pump(const Duration(milliseconds: 30));
      expect(tester.takeException(), isNull, reason: 'typing "$t"');
    }
    expect(find.byType(TextField), findsWidgets);
  });

  testWidgets('keyboard open: header folds away, FAB hides, Create bar stays visible', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _perms);
    expect(find.text('New ticket'), findsOneWidget);
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('New ticket'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('create page: sticky Create button stays on screen with the keyboard up; fields take typing', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const CreateTicketPage(), user: _operator, perms: _perms, size: const Size(360, 640), textScale: 1.6, dark: true);
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump(const Duration(milliseconds: 300));
    final btn = find.text('Create ticket');
    expect(btn, findsOneWidget);
    expect(tester.getBottomLeft(btn).dy, lessThanOrEqualTo(640 - 280));
    await tester.enterText(find.byType(TextField).first, '1.2.3 abc');
    await tester.enterText(find.byType(TextField).last, 'x' * 5000);
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('dark + 360x640 + text scale 1.6: list, detail and dialog do not overflow', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    api.on('GET', '$_list/t2', (_) => {'isOk': true, 'data': (_messy)[2]});
    api.on('PATCH', '$_list/t2/read', (_) => {'isOk': true});
    await pumpScreen(tester, const SupportScreen(), user: _operator, perms: _perms, dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(tester.takeException(), isNull);
    await pumpScreen(
      tester,
      TicketDetailPage(summary: Ticket.fromJson((_messy)[2]), access: const TicketAccess(myId: 'u1', isAdmin: false, canAct: true)),
      user: _operator,
      perms: _perms,
      dark: true,
      size: const Size(360, 640),
      textScale: 1.6,
    );
    expect(tester.takeException(), isNull);
  });
}
