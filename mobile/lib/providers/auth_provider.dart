import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

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
class AuthProvider extends ChangeNotifier {
  AuthProvider() {
    ApiClient.instance.onUnauthorized = () => _endSession(AuthStatus.unauthenticated);
    ApiClient.instance.onBlocked = () => _endSession(AuthStatus.blocked);
  }

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
      user = AppUser(asMap(res));
      status = AuthStatus.authenticated;
      SocketService.instance.connect(token);
    } on ApiException catch (e) {
      // 403 = blocked or inactive; 401 already handled by the interceptor.
      if (e.statusCode == 403) {
        await AuthStorage.instance.clear();
        status = AuthStatus.blocked;
      } else if (e.statusCode == 401) {
        await AuthStorage.instance.clear();
        status = AuthStatus.unauthenticated;
      } else {
        // Offline at launch: keep the token, show login so the person can retry.
        status = AuthStatus.unauthenticated;
      }
    } catch (_) {
      status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<LoginResult> login(String username, String password, {bool remember = false}) async {
    try {
      final res = await ApiClient.instance.dio.post(
        Endpoints.login,
        data: {'username': username.trim(), 'password': password, 'remember': remember},
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
        await AuthStorage.instance.save(token: data['token'].toString(), role: roleType, remember: remember);
        // /auth/me is the canonical user shape (login's is partly populated).
        final me = await Api.get(Endpoints.me);
        user = AppUser(asMap(me));
        status = AuthStatus.authenticated;
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
    await _endSession(AuthStatus.unauthenticated);
  }

  Future<void> _endSession(AuthStatus next) async {
    await AuthStorage.instance.clear();
    SocketService.instance.disconnect();
    user = null;
    status = next;
    notifyListeners();
  }

  /// Re-reads /auth/me (after the person edits their profile).
  Future<void> refreshUser() async {
    try {
      final res = await Api.get(Endpoints.me);
      user = AppUser(asMap(res));
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
