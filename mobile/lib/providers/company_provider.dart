import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/api/api_client.dart';
import '../core/api/endpoints.dart';
import '../core/config.dart';

/// Company branding (name + logo + favicon) exactly as the Super Admin saved it
/// on the Company page — the app carries no brand of its own. The endpoint is
/// public, so the login screen can show it before anyone signs in.
///
/// The last answer is kept on the device so the brand is there the moment the
/// app opens (and when the network is down); every launch, every return to the
/// app and the login screen ask again, so a logo changed on the web shows up
/// without reinstalling. A failed request keeps what is already shown; only a
/// successful answer — including "no logo" after the Super Admin removed it —
/// changes it.
class CompanyProvider extends ChangeNotifier {
  static const _kName = 'company.name';
  static const _kLogo = 'company.logo';
  static const _kFavicon = 'company.favicon';

  String name = '';
  String? logo;
  String? favicon;

  /// The server has answered at least once since the app opened.
  bool loaded = false;

  bool _loading = false;
  bool _cacheRead = false;

  Future<void> load() async {
    if (_loading) return;
    _loading = true;
    try {
      if (!_cacheRead) {
        _cacheRead = true;
        await _readCache();
      }
      await _fetch();
    } finally {
      _loading = false;
    }
  }

  Future<void> _readCache() async {
    try {
      final p = await SharedPreferences.getInstance();
      // A fresher answer may have landed while the disk was read: never overwrite it.
      if (loaded) return;
      _apply(p.getString(_kName), p.getString(_kLogo), p.getString(_kFavicon));
      notifyListeners();
    } catch (_) {/* no cache is fine */}
  }

  Future<void> _fetch() async {
    try {
      final res = await Api.get(Endpoints.companyDetails);
      final d = asMap(res);
      final n = (d['name'] ?? d['companyName'] ?? '').toString();
      final l = d['logo']?.toString();
      final f = d['favicon']?.toString();
      _apply(n, l, f);
      loaded = true;
      notifyListeners();
      await _writeCache(n, l, f);
    } catch (_) {
      // Branding is optional: keep whatever is showing (cached or nothing).
    }
  }

  void _apply(String? n, String? l, String? f) {
    name = (n ?? '').trim();
    logo = (l == null || l.isEmpty) ? null : AppConfig.toBackendUrl(l);
    favicon = (f == null || f.isEmpty) ? null : AppConfig.toBackendUrl(f);
  }

  Future<void> _writeCache(String n, String? l, String? f) async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_kName, n);
      for (final e in {_kLogo: l, _kFavicon: f}.entries) {
        final v = e.value;
        if (v == null || v.isEmpty) {
          await p.remove(e.key);
        } else {
          await p.setString(e.key, v);
        }
      }
    } catch (_) {/* the cache is a convenience */}
  }
}
