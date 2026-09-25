import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/notifications/notification_model.dart';
import 'package:indo/features/notifications/notification_widgets.dart';
import 'package:indo/features/notifications/notifications_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _list = '/api/v1/notifications';

String _ago(Duration d) => DateTime.now().subtract(d).toUtc().toIso8601String();

Map<String, dynamic> _n(
  String id,
  String title, {
  bool read = false,
  String type = 'general',
  Duration ago = const Duration(minutes: 5),
  String message = 'Something happened.',
  Map<String, dynamic> extra = const {},
}) =>
    {
      '_id': id,
      'title': title,
      'message': message,
      'type': type,
      'isRead': read,
      'createdAt': _ago(ago),
      ...extra,
    };

FakeApi _backend(List<Map<String, dynamic>> rows) {
  final api = FakeApi.install();
  api.list(_list, rows);
  api.on('PATCH', '$_list/read-all', (_) => {'isOk': true});
  for (final r in rows) {
    api.on('PATCH', '$_list/${r['_id']}/read', (_) => {'isOk': true, 'data': r});
  }
  return api;
}

List<Map<String, dynamic>> get _sample => [
      _n('n1', 'Ticket 12 has a new reply', type: 'ticket_reply', ago: const Duration(minutes: 3)),
      _n('n2', 'Ticket 9 resolved', read: true, type: 'ticket_resolved', ago: const Duration(hours: 2)),
      _n('n3', 'Welcome to Indo', ago: const Duration(days: 3), message: 'Your account is ready.'),
    ];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('loads the list newest first with unread count and day sections', (tester) async {
    _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    expect(find.text('Ticket 12 has a new reply'), findsOneWidget);
    expect(find.text('Ticket 9 resolved'), findsOneWidget);
    expect(find.text('Welcome to Indo'), findsOneWidget);
    expect(find.text('2 unread'), findsOneWidget);
    expect(find.text('Unread (2)'), findsOneWidget);
    expect(find.text('TODAY'), findsOneWidget);
    expect(find.text('EARLIER'), findsOneWidget);
    expect(find.text('3 minutes ago'), findsOneWidget);
    // Newest first.
    final a = tester.getTopLeft(find.text('Ticket 12 has a new reply')).dy;
    final b = tester.getTopLeft(find.text('Welcome to Indo')).dy;
    expect(a, lessThan(b));
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping an unread row sends PATCH /:id/read and clears its unread state', (tester) async {
    final api = _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.text('Welcome to Indo'));
    await tester.pumpAndSettle();

    expect(api.called('PATCH', '$_list/n3/read'), hasLength(1));
    expect(find.text('1 unread'), findsOneWidget);
    // Already-read rows do not hit the server again.
    await tester.tap(find.text('Ticket 9 resolved'));
    await tester.pumpAndSettle();
    expect(api.called('PATCH', '$_list/n2/read'), isEmpty);
  });

  testWidgets('a link the app has no page for is ignored quietly but still marks read', (tester) async {
    final api = _backend([
      _n('n1', 'Odd one', extra: {'link': '/no/such/page'}),
    ]);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.text('Odd one'));
    await tester.pumpAndSettle();

    expect(api.called('PATCH', '$_list/n1/read'), hasLength(1));
    expect(find.text('Notifications'), findsOneWidget); // still on this page
    expect(tester.takeException(), isNull);
  });

  testWidgets('Mark all read sends PATCH /read-all', (tester) async {
    final api = _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.text('Mark all read'));
    await tester.pumpAndSettle();

    expect(api.called('PATCH', '$_list/read-all'), hasLength(1));
    expect(find.text('All read'), findsOneWidget);
    expect(find.text('Mark all read'), findsNothing);
  });

  testWidgets('a failing mark-read is rolled back', (tester) async {
    final api = _backend(_sample);
    api.on('PATCH', '$_list/n3/read', (_) => FakeResponse({'isOk': false, 'message': 'nope'}, status: 500));
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.text('Welcome to Indo'));
    await tester.pumpAndSettle();

    expect(find.text('2 unread'), findsOneWidget);
  });

  testWidgets('Unread / Read chips and search filter the list', (tester) async {
    _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.text('Unread (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Ticket 9 resolved'), findsNothing);
    expect(find.text('Welcome to Indo'), findsOneWidget);

    await tester.tap(find.text('Read'));
    await tester.pumpAndSettle();
    expect(find.text('Ticket 9 resolved'), findsOneWidget);
    expect(find.text('Welcome to Indo'), findsNothing);

    await tester.tap(find.text('All'));
    await tester.enterText(find.byType(TextField), 'welcome');
    await tester.pumpAndSettle();
    expect(find.byType(NotificationCard), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'zzz');
    await tester.pumpAndSettle();
    expect(find.text('No matches'), findsOneWidget);
  });

  testWidgets('swipe removes a row (marks it read on the server, hides it here) and Undo brings it back',
      (tester) async {
    final api = _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.drag(find.byType(Dismissible).first, const Offset(-500, 0));
    await tester.pumpAndSettle();

    expect(find.text('Ticket 12 has a new reply'), findsNothing);
    expect(api.called('PATCH', '$_list/n1/read'), hasLength(1));
    expect(api.requests.where((r) => r.method == 'DELETE'), isEmpty); // the server has no delete endpoint
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getStringList('notifications_hidden_u1'), ['n1']);

    await tester.tap(find.text('Undo'));
    await tester.pumpAndSettle();
    expect(find.text('Ticket 12 has a new reply'), findsOneWidget);
    expect(prefs.getStringList('notifications_hidden_u1'), isEmpty);
  });

  testWidgets('rows hidden on this device stay hidden after a reload', (tester) async {
    SharedPreferences.setMockInitialValues({
      'notifications_hidden_u1': ['n2'],
    });
    _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    expect(find.text('Ticket 9 resolved'), findsNothing);
    expect(find.text('Welcome to Indo'), findsOneWidget);
  });

  testWidgets('Clear all asks first, then marks everything read and empties the list', (tester) async {
    final api = _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();
    expect(find.text('Are you sure?'), findsNothing);
    expect(find.textContaining('Remove all 3 notifications'), findsOneWidget);

    // Cancel: nothing happens.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.called('PATCH', '$_list/read-all'), isEmpty);
    expect(find.byType(NotificationCard), findsNWidgets(3));

    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Clear all'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Clear all'));
    await tester.pumpAndSettle();

    expect(api.called('PATCH', '$_list/read-all'), hasLength(1));
    expect(find.byType(NotificationCard), findsNothing);
    expect(find.text("You're all caught up"), findsOneWidget);
  });

  testWidgets('empty state', (tester) async {
    _backend([]);
    await pumpScreen(tester, const NotificationsScreen());

    expect(find.text("You're all caught up"), findsOneWidget);
    expect(find.byType(NotificationCard), findsNothing);
  });

  testWidgets('error shows Try again and recovers', (tester) async {
    final api = FakeApi.install();
    api.on('GET', _list, (_) => FakeResponse({'isOk': false, 'message': 'Database is down'}, status: 500));
    await pumpScreen(tester, const NotificationsScreen());

    expect(find.text('Database is down'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);

    api.list(_list, _sample);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();

    expect(find.text('Database is down'), findsNothing);
    expect(find.text('Welcome to Indo'), findsOneWidget);
    expect(api.called('GET', _list), hasLength(2));
  });

  testWidgets('pull to refresh reloads', (tester) async {
    final api = _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen());

    await tester.fling(find.byType(Scrollable).first, const Offset(0, 400), 1000);
    await tester.pumpAndSettle();

    expect(api.called('GET', _list), hasLength(2));
  });

  testWidgets('iPad: the list is one centred column no wider than 720', (tester) async {
    _backend(_sample);
    await pumpScreen(tester, const NotificationsScreen(), size: const Size(1024, 768));

    final w = tester.getSize(find.byType(NotificationCard).first).width;
    expect(w, lessThanOrEqualTo(720));
    expect(w, greaterThan(500));
    final center = tester.getCenter(find.byType(NotificationCard).first).dx;
    expect(center, closeTo(512, 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('smoke: dark, 360x640, text scale 1.6 (list, empty and error) without overflow', (tester) async {
    final rows = [
      ..._sample,
      _n('n4', 'A very long notification title that keeps going and going for several lines of text',
          message: 'And a message body that is even longer than the title so it has to wrap over many lines '
              'on a narrow phone at a large text size without ever overflowing its card.',
          type: 'alert',
          ago: const Duration(days: 12)),
    ];
    _backend(rows);
    await pumpScreen(tester, const NotificationsScreen(),
        dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(find.byType(NotificationCard), findsWidgets);
    expect(tester.takeException(), isNull);

    // Scroll to the bottom to lay out every row.
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // Empty (unmount first so the screen loads again).
    await tester.pumpWidget(const SizedBox());
    _backend([]);
    await pumpScreen(tester, const NotificationsScreen(),
        dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(find.text("You're all caught up"), findsOneWidget);
    expect(tester.takeException(), isNull);

    // Error.
    await tester.pumpWidget(const SizedBox());
    final api = FakeApi.install();
    api.on('GET', _list, (_) => FakeResponse({'isOk': false, 'message': 'Boom'}, status: 500));
    await pumpScreen(tester, const NotificationsScreen(),
        dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(find.text('Try again'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('smoke: skeleton while loading (dark, 360x640, text scale 1.6)', (tester) async {
    final api = FakeApi.install();
    api.on('GET', _list, (_) async {
      await Future<void>.delayed(const Duration(seconds: 1));
      return {'isOk': true, 'data': <Object>[]};
    });
    await pumpScreen(tester, const NotificationsScreen(),
        settle: false, dark: true, size: const Size(360, 640), textScale: 1.6);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(NotificationSkeleton), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
  });

  group('model', () {
    test('parses defensively and derives icon / target', () {
      final n = AppNotification.fromJson({'_id': 7, 'title': null, 'message': null, 'type': 'ticket_forwarded'});
      expect(n.id, '7');
      expect(n.title, 'Notification');
      expect(n.isRead, isFalse);
      expect(n.createdAt, isNull);
      expect(n.menuUrl, '/support');
      expect(AppNotification.fromJson({'_id': 'a', 'type': 'general'}).menuUrl, isNull);
      expect(AppNotification.fromJson({'_id': 'a', 'link': '/hqepl/support'}).menuUrl, '/hqepl/support');
      expect(AppNotification.fromJson({'_id': 'a', 'type': 'ticket_resolved'}).look.icon, Icons.check_circle_outline_rounded);
    });

    test('time labels', () {
      final now = DateTime(2026, 9, 25, 12);
      expect(notificationTime(now.subtract(const Duration(minutes: 5)), now: now), '5 minutes ago');
      expect(notificationTime(now.add(const Duration(minutes: 5)), now: now), 'a moment ago');
      expect(notificationTime(null), '');
      expect(notificationSection(now.subtract(const Duration(hours: 1)), now: now), 'Today');
      expect(notificationSection(now.subtract(const Duration(days: 1)), now: now), 'Yesterday');
      expect(notificationSection(now.subtract(const Duration(days: 4)), now: now), 'Earlier');
    });
  });
}
