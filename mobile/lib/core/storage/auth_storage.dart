import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the login token lives.
///
/// Reads must be synchronous for the Dio interceptor's hot path, so [init]
/// loads the saved token into memory once before the first frame and
/// [token] serves that copy. [save] / [clear] update memory immediately and
/// await the durable write.
///
/// The app stays signed in like Instagram: the token (and the last known
/// profile, so the app still opens signed in when offline) is always kept
/// until sign-out or the server ends the session.
class AuthStorage {
  AuthStorage._() : _store = const FlutterSecureStorage();

  @visibleForTesting
  AuthStorage.withStore(this._store);

  static final AuthStorage instance = AuthStorage._();

  static const _tokenKey = 'token';
  static const _roleKey = 'role';
  static const _userKey = 'user';

  final FlutterSecureStorage _store;

  String? _token;
  String? _role;
  Map<String, dynamic>? _user;

  /// [save] / [clear] ran: a slow [init] that finishes afterwards must not put
  /// an older stored token over the one just set.
  bool _written = false;

  String? get token => _token;
  String? get role => _role;

  /// The profile from the last /auth/me, for opening signed in while offline.
  Map<String, dynamic>? get cachedUser => _user;

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
        final user = await _store.read(key: _userKey);
        if (abandoned || _written) return;
        _token = token;
        _role = role;
        try {
          final u = user == null ? null : jsonDecode(user);
          _user = u is Map ? Map<String, dynamic>.from(u) : null;
        } catch (_) {
          _user = null;
        }
      }).timeout(timeout);
    } on TimeoutException {
      abandoned = true;
    } catch (_) {
      // Keychain / keystore unreadable (e.g. restored backup): start signed out.
      _token = null;
      _role = null;
    }
  }

  Future<void> save({required String token, String? role}) async {
    _written = true;
    _token = token;
    if (role != null) _role = role;
    try {
      await _store.write(key: _tokenKey, value: token);
      if (role != null) await _store.write(key: _roleKey, value: role);
    } catch (_) {/* memory copy still works for this session */}
  }

  Future<void> saveUser(Map<String, dynamic> user) async {
    _user = user;
    try {
      await _store.write(key: _userKey, value: jsonEncode(user));
    } catch (_) {/* not JSON-safe or keychain busy: offline launch falls back to sign-in */}
  }

  Future<void> clear() async {
    _written = true;
    _token = null;
    _role = null;
    _user = null;
    try {
      await _store.delete(key: _tokenKey);
      await _store.delete(key: _roleKey);
      await _store.delete(key: _userKey);
    } catch (_) {}
  }
}
