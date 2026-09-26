import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/unread_provider.dart';

import '../support/fake_api.dart';

const _notif = '/api/v1/notifications/unread-count';
const _tickets = '/api/v1/tickets/unread-count';

AuthProvider _signedIn() => AuthProvider()
  ..status = AuthStatus.authenticated
  ..user = testUser();

void main() {
  test('a burst of refreshes while one is running becomes exactly one more run', () async {
    final api = FakeApi.install();
    final gate = Completer<void>();
    var calls = 0;
    api.on('GET', _notif, (_) async {
      if (++calls == 1) await gate.future; // the first read is slow
      return {'isOk': true, 'unreadCount': 3};
    });
    api.on('GET', _tickets, (_) => {'isOk': true, 'unreadCount': 1});

    final u = UnreadProvider()..attach(_signedIn()); // starts the first refresh
    await pumpEventQueue();
    expect(calls, 1, reason: 'the first read is in flight');

    // Five socket events arrive meanwhile.
    for (var i = 0; i < 5; i++) {
      unawaited(u.refresh());
    }
    gate.complete();
    await pumpEventQueue();

    expect(calls, 2, reason: 'one run, plus ONE follow-up — not six requests');
    expect(api.called('GET', _tickets), hasLength(2));
    expect(u.notifications, 3);
    expect(u.tickets, 1);
  });

  test('listeners hear about a change, not about an unchanged answer', () async {
    final api = FakeApi.install();
    api.on('GET', _notif, (_) => {'isOk': true, 'unreadCount': 3});
    api.on('GET', _tickets, (_) => {'isOk': true, 'unreadCount': 0});

    final u = UnreadProvider()..attach(_signedIn());
    var heard = 0;
    u.addListener(() => heard++);
    await pumpEventQueue();
    expect(u.notifications, 3);
    expect(heard, 1);

    await u.refresh();
    await u.refresh();
    expect(heard, 1, reason: 'same numbers: nobody rebuilds');

    api.on('GET', _notif, (_) => {'isOk': true, 'unreadCount': 4});
    await u.refresh();
    expect(u.notifications, 4);
    expect(heard, 2);
  });

  test('a failed read keeps the last figure instead of zeroing it', () async {
    final api = FakeApi.install();
    api.on('GET', _notif, (_) => {'isOk': true, 'unreadCount': 5});
    api.on('GET', _tickets, (_) => {'isOk': true, 'unreadCount': 2});
    final u = UnreadProvider()..attach(_signedIn());
    await pumpEventQueue();
    expect((u.notifications, u.tickets), (5, 2));

    api.on('GET', _notif, (_) => throw StateError('offline'));
    await u.refresh();
    expect((u.notifications, u.tickets), (5, 2));

    api.on('GET', _notif, (_) => throw StateError('offline'));
    api.on('GET', _tickets, (_) => {'isOk': true, 'unreadCount': 0});
    await u.refresh();
    expect((u.notifications, u.tickets), (5, 0), reason: 'the counter that did answer is still applied');
  });

  test('signing out clears both counters and stops refreshing', () async {
    final api = FakeApi.install();
    api.on('GET', _notif, (_) => {'isOk': true, 'unreadCount': 5});
    api.on('GET', _tickets, (_) => {'isOk': true, 'unreadCount': 2});
    final auth = _signedIn();
    final u = UnreadProvider()..attach(auth);
    await pumpEventQueue();

    auth.status = AuthStatus.unauthenticated;
    auth.user = null;
    u.attach(auth);
    await pumpEventQueue();
    expect((u.notifications, u.tickets), (0, 0));

    final before = api.called('GET', _notif).length;
    await u.refresh();
    expect(api.called('GET', _notif).length, before, reason: 'no requests once signed out');
  });
}
