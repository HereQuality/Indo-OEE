import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/storage/auth_storage.dart';

class _Mem extends FlutterSecureStorage {
  _Mem();
  final data = <String, String>{};
  @override
  Future<String?> read({required String key, AppleOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, AppleOptions? mOptions, WindowsOptions? wOptions}) async => data[key];
  @override
  Future<void> write({required String key, required String? value, AppleOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, AppleOptions? mOptions, WindowsOptions? wOptions}) async {
    if (value == null) {
      data.remove(key);
    } else {
      data[key] = value;
    }
  }

  @override
  Future<void> delete({required String key, AppleOptions? iOptions, AndroidOptions? aOptions, LinuxOptions? lOptions, WebOptions? webOptions, AppleOptions? mOptions, WindowsOptions? wOptions}) async => data.remove(key);
}

void main() {
  test('the session is always kept on the device, with the last profile for offline opening', () async {
    final mem = _Mem();
    final a = AuthStorage.withStore(mem);
    await a.save(token: 't1', role: 'Operator');
    await a.saveUser({'_id': 'u1', 'name': 'Asha'});

    final b = AuthStorage.withStore(mem); // the next app launch
    await b.init();
    expect(b.token, 't1');
    expect(b.cachedUser?['name'], 'Asha');

    // A renewed token replaces the old one and keeps the role.
    await b.save(token: 't2');
    final c = AuthStorage.withStore(mem);
    await c.init();
    expect(c.token, 't2');
    expect(c.role, 'Operator');

    // Sign out removes everything.
    await c.clear();
    final d = AuthStorage.withStore(mem);
    await d.init();
    expect(d.token, isNull);
    expect(d.cachedUser, isNull);
  });
}
