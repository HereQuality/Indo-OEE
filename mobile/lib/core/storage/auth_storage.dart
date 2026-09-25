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
  AuthStorage._();
  static final AuthStorage instance = AuthStorage._();

  static const _tokenKey = 'token';
  static const _roleKey = 'role';

  final FlutterSecureStorage _store = const FlutterSecureStorage();

  String? _token;
  String? _role;

  String? get token => _token;
  String? get role => _role;

  Future<void> init() async {
    try {
      _token = await _store.read(key: _tokenKey);
      _role = await _store.read(key: _roleKey);
    } catch (_) {
      // Keychain / keystore unreadable (e.g. restored backup): start signed out.
      _token = null;
      _role = null;
    }
  }

  Future<void> save({required String token, String role = '', bool remember = false}) async {
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
    _token = null;
    _role = null;
    try {
      await _store.delete(key: _tokenKey);
      await _store.delete(key: _roleKey);
    } catch (_) {}
  }
}
