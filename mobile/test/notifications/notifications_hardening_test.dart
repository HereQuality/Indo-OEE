import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/notifications/notification_model.dart';
import 'package:indo/features/notifications/notifications_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _list = '/api/v1/notifications';

/// Rows shaped like what the server / legacy data can really send.
List<Object?> get _messy => [
      {'_id': 'a1', 'title': null, 'message': null, 'type': null, 'isRead': null, 'createdAt': null},
      {'_id': 'a2', 'title': 'Numbers', 'message': 12345, 'type': 42, 'isRead': 1, 'createdAt': 1700000000000},
      {'_id': {r'$oid': 'a3'}, 'title': 'Oid id', 'message': '', 'isRead': 'true', 'createdAt': 'not a date'},
      {'id': 'a4', 'title': 'Plain id key', 'referenceId': {'_id': 'x'}, 'createdAt': '2030-01-01T00:00:00Z'},
      {'title': 'No id at all'},
      {'_id': 'a1', 'title': 'Duplicate of a1'},
      'a string row',
      null,
      7,
      {'_id': 'a5', 'title': 'Ticket reply', 'type': 'ticket_reply', 'link': '/no/such/page', 'extra': {'deep': [1, 2]}},
      {'_id': 'a6', 'title': 'Z' * 400, 'message': 'M' * 3000, 'isRead': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
      for (var i = 0; i < 150; i++) {'_id': 'bulk$i', 'title': 'Bulk $i', 'createdAt': DateTime.now().subtract(Duration(minutes: i)).toUtc().toIso8601String()},
    ];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('AppNotification.fromJson never throws on odd values', () {
    for (final j in <Map<String, dynamic>>[
      {},
      {'_id': null},
      {'_id': [], 'title': [], 'createdAt': {}},
      {'_id': 5, 'isRead': 'yes', 'type': false, 'referenceId': 3},
    ]) {
      final n = AppNotification.fromJson(j);
      expect(n.title, isNotEmpty);
      expect(n.look.icon, isNotNull);
      n.menuUrl;
    }
  });

  testWidgets('a messy production list renders, skips broken rows, and never throws', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    await pumpScreen(tester, const NotificationsScreen());
    expect(tester.takeException(), isNull);
    // Scroll all the way down: every row builds without an exception.
    await tester.dragUntilVisible(find.text('Numbers'), find.byType(Scrollable).first, const Offset(0, -400));
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -3000));
    await tester.pump();
    expect(find.text('Notification'), findsWidgets); // the row with a null title
    expect(find.text('No id at all'), findsNothing);
    expect(find.text('Duplicate of a1'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('search: typing anything (digits, letters, paste-like) is safe; tap outside closes the keyboard', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    await pumpScreen(tester, const NotificationsScreen());
    final field = find.byType(TextField);
    for (final t in ['1', '12abc', '1.2.3', '0000000000', r'(*[\', '  ', 'Bulk 7', '']) {
      await tester.enterText(field, t);
      await tester.pump(const Duration(milliseconds: 50));
      expect(tester.takeException(), isNull, reason: 'typing "$t"');
    }
    await tester.enterText(field, 'zzzz-no-match');
    await tester.pump();
    expect(find.text('No matches'), findsOneWidget);
    // Tapping empty space drops focus.
    await tester.tap(find.text('No matches'));
    await tester.pump();
    expect(FocusManager.instance.primaryFocus?.hasFocus == true && FocusManager.instance.primaryFocus?.context?.widget is EditableText, isFalse);
  });

  testWidgets('dark + 360x640 + text scale 1.6 does not overflow', (tester) async {
    final api = FakeApi.install();
    api.list(_list, _messy);
    await pumpScreen(tester, const NotificationsScreen(), dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(tester.takeException(), isNull);
  });
}
