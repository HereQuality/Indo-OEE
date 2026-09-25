import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'auth_provider.dart';

/// Light / dark. The account's saved preference wins once signed in
/// (mirrors client/src/context/ThemeContext.jsx); the last choice is also
/// remembered on the device so the login screen and cold start match.
class ThemeProvider extends ChangeNotifier {
  ThemeProvider() {
    _load();
  }

  static const _key = 'theme';
  bool _dark = false;
  AuthProvider? _auth;

  bool get isDark => _dark;
  ThemeMode get mode => _dark ? ThemeMode.dark : ThemeMode.light;

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      _dark = p.getString(_key) == 'dark';
      notifyListeners();
    } catch (_) {}
  }

  /// Wired by ChangeNotifierProxyProvider whenever the user changes.
  void attach(AuthProvider auth) {
    _auth = auth;
    final u = auth.user;
    if (u != null) {
      final d = u.preferences.isDark;
      if (d != _dark) {
        _dark = d;
        _persist();
        notifyListeners();
      }
    }
  }

  Future<void> setDark(bool dark) async {
    if (dark == _dark) return;
    _dark = dark;
    notifyListeners();
    _persist();
    final auth = _auth;
    if (auth != null && auth.isAuthenticated) {
      await auth.updatePreferences({'themeMode': dark ? 'dark' : 'light'});
    }
  }

  Future<void> toggle() => setDark(!_dark);

  Future<void> _persist() async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_key, _dark ? 'dark' : 'light');
    } catch (_) {}
  }
}
