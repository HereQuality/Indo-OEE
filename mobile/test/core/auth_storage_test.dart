import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/storage/auth_storage.dart';

/// A Keychain whose `read` the test controls.
class _FakeStore extends Fake implements FlutterSecureStorage {
  _FakeStore(this._read);

  final Future<String?> Function(String key) _read;
  final Map<String, String?> written = {};
  final List<String> deleted = [];

  @override
  dynamic noSuchMethod(Invocation i) {
    final key = i.namedArguments[#key] as String;
    switch (i.memberName) {
      case #read:
        return _read(key);
      case #write:
        written[key] = i.namedArguments[#value] as String?;
        return Future<void>.value();
      case #delete:
        deleted.add(key);
        return Future<void>.value();
    }
    return super.noSuchMethod(i);
  }
}

void main() {
  const quick = Duration(milliseconds: 50);

  test('init restores the saved token and role', () async {
    final s = AuthStorage.withStore(_FakeStore((k) async => k == 'token' ? 'tok' : 'admin'));
    await s.init();
    expect(s.token, 'tok');
    expect(s.role, 'admin');
  });

  test('init does not hang when the Keychain never answers: starts signed out', () async {
    final never = Completer<String?>();
    final s = AuthStorage.withStore(_FakeStore((_) => never.future));
    await s.init(timeout: quick); // would never return without the timeout
    expect(s.token, isNull);
    expect(s.role, isNull);
  });

  test('a Keychain answer that arrives after the timeout is discarded', () async {
    final late = Completer<String?>();
    final s = AuthStorage.withStore(_FakeStore((_) => late.future));
    await s.init(timeout: quick);
    late.complete('stale-token');
    await Future<void>.delayed(Duration.zero);
    expect(s.token, isNull);
  });

  test('a late init never overwrites a token saved in the meantime', () async {
    final late = Completer<String?>();
    final store = _FakeStore((_) => late.future);
    final s = AuthStorage.withStore(store);
    final init = s.init(); // still waiting on the Keychain
    await s.save(token: 'fresh', role: 'op');
    late.complete('stale-token');
    await init;
    expect(s.token, 'fresh');
    expect(s.role, 'op');
  });

  test('a Keychain error starts signed out instead of throwing', () async {
    final s = AuthStorage.withStore(_FakeStore((_) => Future<String?>.error(StateError('keychain'))));
    await s.init();
    expect(s.token, isNull);
  });
}
