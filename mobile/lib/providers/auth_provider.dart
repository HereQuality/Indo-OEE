import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';

import '../core/api/api_client.dart';
import '../core/api/endpoints.dart';
import '../core/api/socket_service.dart';
import '../core/storage/auth_storage.dart';
import '../models/app_user.dart';

enum AuthStatus { unknown, unauthenticated, authenticated, blocked }

class LoginResult {
  const LoginResult.ok() : ok = true, message = null;
  const LoginResult.fail(this.message) : ok = false;
  final bool ok;
  final String? message;
}

/// Session state: who is signed in (mirrors client/src/context/AuthContext.jsx).
///
/// Stays signed in like Instagram / Facebook: no "Remember me"; the session is
/// kept on the device and renewed with the server whenever the app is opened
/// or comes back to the foreground (at most every few hours), so a person who
/// uses the app is never signed out. It ends on Sign out, when an admin blocks
/// or removes the account, or after about two months without opening the app
/// — then the sign-in screen says the session ended.
class AuthProvider extends ChangeNotifier with WidgetsBindingObserver {
  AuthProvider({this.onSessionEnd}) {
    ApiClient.instance.onUnauthorized = () {
      if (status == AuthStatus.authenticated) sessionExpired = true;
      _endSession(AuthStatus.unauthenticated);
    };
    ApiClient.instance.onBlocked = () => _endSession(AuthStatus.blocked);
    WidgetsFlutterBinding.ensureInitialized().addObserver(this);
  }

  /// The server ended the session (not a sign-out): the sign-in screen says so.
  bool sessionExpired = false;

  /// How often an open session is renewed at most.
  static const renewEvery = Duration(hours: 6);
  DateTime? _renewedAt;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && isAuthenticated) renewSession();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Swaps the token for a fresh one so a session in use never runs out.
  /// Quiet on failure (offline): the current token keeps working.
  Future<void> renewSession({bool force = false}) async {
    final last = _renewedAt;
    if (!force && last != null && DateTime.now().difference(last) < renewEvery) return;
    _renewedAt = DateTime.now();
    try {
      final res = await Api.post(Endpoints.refreshSession);
      final token = res['token'];
      if (token is String && token.isNotEmpty && isAuthenticated) {
        await AuthStorage.instance.save(token: token);
      }
    } catch (_) {
      _renewedAt = last; // try again next time
    }
  }

  /// Sets the user; the offline copy is saved in the background (never waited on).
  Future<void> _setUser(Map<String, dynamic> raw) async {
    user = AppUser(raw);
    unawaited(AuthStorage.instance.saveUser(raw));
  }

  /// Runs whenever a session ends (logout, 401, blocked) so per-user local data
  /// (unsaved entry-form drafts) never reaches the next person on this device.
  final Future<void> Function()? onSessionEnd;

  AuthStatus status = AuthStatus.unknown;
  AppUser? user;

  bool get isAuthenticated => status == AuthStatus.authenticated && user != null;
  bool get isSuperAdmin => user?.isSuperAdmin ?? false;

  /// Called once at launch: restores the saved session (if any).
  Future<void> bootstrap() async {
    final token = AuthStorage.instance.token;
    if (token == null || token.isEmpty) {
      status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }
    try {
      final res = await Api.get(Endpoints.me);
      await _setUser(asMap(res));
      status = AuthStatus.authenticated;
      SocketService.instance.connect(token);
      renewSession(force: true);
    } on ApiException catch (e) {
      // 403 = blocked or inactive; 401 already handled by the interceptor.
      if (e.statusCode == 403) {
        await AuthStorage.instance.clear();
        await _runSessionEnd();
        status = AuthStatus.blocked;
      } else if (e.statusCode == 401) {
        await AuthStorage.instance.clear();
        await _runSessionEnd();
        status = AuthStatus.unauthenticated;
      } else {
        _openOffline(token);
      }
    } catch (_) {
      _openOffline(token);
    }
    notifyListeners();
  }

  /// No connection at launch: open signed in with the last known profile (the
  /// screens show their own offline states and retry); without one, sign in.
  void _openOffline(String token) {
    final cached = AuthStorage.instance.cachedUser;
    if (cached != null && cached.isNotEmpty) {
      user = AppUser(cached);
      status = AuthStatus.authenticated;
      SocketService.instance.connect(token);
    } else {
      status = AuthStatus.unauthenticated;
    }
  }

  Future<LoginResult> login(String username, String password) async {
    try {
      final res = await ApiClient.instance.dio.post(
        Endpoints.login,
        data: {'username': username.trim(), 'password': password, 'remember': true, 'client': 'app'},
        options: Options(validateStatus: (s) => s != null && s >= 200 && s < 500),
      );
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      final code = res.statusCode ?? 0;
      if (code == 423) {
        final mins = data['remainingTime'];
        return LoginResult.fail(
          'Account locked. ${mins != null ? '$mins min(s) remaining.' : (data['message'] ?? '')}'.trim(),
        );
      }
      if (code == 403) {
        return LoginResult.fail(
          (data['message'] ?? 'Access denied. Your account may be blocked or inactive.').toString(),
        );
      }
      if (code == 401) {
        if (data['attemptsRemaining'] != null) {
          return LoginResult.fail('Invalid credentials. ${data['attemptsRemaining']} attempt(s) left.');
        }
        return LoginResult.fail((data['message'] ?? 'Authentication failed').toString());
      }
      if (code == 200 && data['token'] != null) {
        final u = (data['data'] is Map ? (data['data'] as Map)['user'] : null);
        final roleType = u is Map ? (u['roleType'] ?? '').toString() : '';
        await AuthStorage.instance.save(token: data['token'].toString(), role: roleType);
        // /auth/me is the canonical user shape (login's is partly populated).
        final me = await Api.get(Endpoints.me);
        await _setUser(asMap(me));
        status = AuthStatus.authenticated;
        sessionExpired = false;
        _renewedAt = DateTime.now();
        SocketService.instance.connect(data['token'].toString());
        notifyListeners();
        return const LoginResult.ok();
      }
      return LoginResult.fail((data['message'] ?? 'Authentication failed').toString());
    } on DioException catch (e) {
      return LoginResult.fail(Api.fromDio(e).message);
    } on ApiException catch (e) {
      return LoginResult.fail(e.message);
    } catch (_) {
      return const LoginResult.fail('Something went wrong. Please try again.');
    }
  }

  Future<void> logout() async {
    try {
      await Api.post(Endpoints.logout);
    } catch (_) {/* best effort */}
    sessionExpired = false;
    await _endSession(AuthStatus.unauthenticated);
  }

  Future<void> _runSessionEnd() async {
    try {
      await onSessionEnd?.call();
    } catch (_) {/* best effort: never block sign-out */}
  }

  Future<void> _endSession(AuthStatus next) async {
    await AuthStorage.instance.clear();
    await _runSessionEnd();
    SocketService.instance.disconnect();
    user = null;
    _renewedAt = null;
    status = next;
    notifyListeners();
  }

  /// Re-reads /auth/me (after the person edits their profile).
  Future<void> refreshUser() async {
    try {
      final res = await Api.get(Endpoints.me);
      await _setUser(asMap(res));
      notifyListeners();
    } catch (_) {}
  }

  void setUser(AppUser u) {
    user = u;
    notifyListeners();
  }

  /// PUT /auth/me/preferences (theme, clock, shortcuts) and merge the answer.
  Future<bool> updatePreferences(Map<String, dynamic> prefs) async {
    try {
      final res = await Api.put(Endpoints.updatePreferences, body: prefs);
      if (user != null) {
        user = user!.copyWithPreferences(res['data']);
        notifyListeners();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Back to the login screen after "blocked".
  void acknowledgeBlocked() {
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
