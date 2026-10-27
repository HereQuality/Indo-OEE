import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the login token lives.
///
/// Reads must be synchronous for the Dio interceptor's hot path, so [init]
/// loads the saved token into memory once before the first frame and
/// [token] serves that copy. [save] / [clear] update memory immediately and
/// await the durable write.
///
/// "Remember me" off keeps the token in memory only, i.e. it is dropped when
/// the app is closed (same as the web/tablet behaviour).
class AuthStorage {
  AuthStorage._() : _store = const FlutterSecureStorage();

  @visibleForTesting
  AuthStorage.withStore(this._store);

  static final AuthStorage instance = AuthStorage._();

  static const _tokenKey = 'token';
  static const _roleKey = 'role';

  final FlutterSecureStorage _store;

  String? _token;
  String? _role;

  /// [save] / [clear] ran: a slow [init] that finishes afterwards must not put
  /// an older stored token over the one just set.
  bool _written = false;

  String? get token => _token;
  String? get role => _role;

  /// Runs before the first frame, so it must never block it: the Keychain can
  /// be slow or unavailable (fresh boot, locked device, restored backup), and a
  /// read that never returns would leave the app on the launch screen forever.
  /// After [timeout] the app starts signed out (the stored token is untouched
  /// and is read again next launch) and a late answer is discarded.
  Future<void> init({Duration timeout = const Duration(seconds: 5)}) async {
    var abandoned = false;
    try {
      await Future<void>(() async {
        final token = await _store.read(key: _tokenKey);
        final role = await _store.read(key: _roleKey);
        if (abandoned || _written) return;
        _token = token;
        _role = role;
      }).timeout(timeout);
    } on TimeoutException {
      abandoned = true;
    } catch (_) {
      // Keychain / keystore unreadable (e.g. restored backup): start signed out.
      _token = null;
      _role = null;
    }
  }

  Future<void> save({required String token, String role = '', bool remember = false}) async {
    _written = true;
    _token = token;
    _role = role;
    try {
      if (remember) {
        await _store.write(key: _tokenKey, value: token);
        await _store.write(key: _roleKey, value: role);
      } else {
        // Session-only: make sure no earlier "remembered" token outlives this one.
        await _store.delete(key: _tokenKey);
        await _store.delete(key: _roleKey);
      }
    } catch (_) {/* memory copy still works for this session */}
  }

  Future<void> clear() async {
    _written = true;
    _token = null;
    _role = null;
    try {
      await _store.delete(key: _tokenKey);
      await _store.delete(key: _roleKey);
    } catch (_) {}
  }
}
