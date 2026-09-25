import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';
import '../core/api/endpoints.dart';
import '../core/utils/role_slug.dart';
import '../models/menu_models.dart';
import 'auth_provider.dart';

/// The role's sidebar + per-page permissions (mirrors
/// client/src/context/MenuContext.jsx). SuperAdmin gets everything; an
/// Operator gets the menus the server already filtered for their role, plus the
/// view/create/edit/delete flags from Manage Role.
class MenuProvider extends ChangeNotifier {
  List<MenuGroup> groups = const [];
  bool loading = false;
  String? error;
  bool _isAdmin = false;
  String? _loadedFor;
  List<Map<String, dynamic>> _roles = const [];

  bool get isAdmin => _isAdmin;

  /// Test hook: set the menu state without calling the server.
  @visibleForTesting
  void setForTest({bool isAdmin = true, List<MenuGroup> groups = const [], List<Map<String, dynamic>> roles = const []}) {
    _isAdmin = isAdmin;
    this.groups = groups;
    _roles = roles;
    loading = false;
    notifyListeners();
  }

  /// Wired by ChangeNotifierProxyProvider: loads on sign-in, clears on sign-out.
  void attach(AuthProvider auth) {
    final u = auth.user;
    if (!auth.isAuthenticated || u == null) {
      if (_loadedFor != null) {
        _loadedFor = null;
        groups = const [];
        _roles = const [];
        _isAdmin = false;
        error = null;
        loading = false;
        notifyListeners();
      }
      return;
    }
    final key = '${u.id}:${u.roleId}';
    if (_loadedFor == key) return;
    _loadedFor = key;
    _isAdmin = u.isSuperAdmin;
    // Defer so we never notify during a build.
    Future.microtask(() => refresh(roleId: u.roleId));
  }

  Future<void> refresh({String? roleId}) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      final res = await Api.get(Endpoints.menusByGroups);
      groups = asList(res).map(MenuGroup.fromJson).toList();

      if (!_isAdmin && roleId != null && roleId.isNotEmpty) {
        final r = await Api.get(Endpoints.operatorRolesById(roleId));
        final data = r['data'];
        final first = data is List && data.isNotEmpty ? data.first : (data is Map ? data : null);
        _roles = (first is Map && first['roles'] is List)
            ? (first['roles'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
            : const [];
      } else {
        _roles = const [];
      }
    } on ApiException catch (e) {
      error = e.message;
    } catch (_) {
      error = 'Failed to load your menu.';
    }
    loading = false;
    notifyListeners();
  }

  /// Bumps the cache after Manage Role edits the signed-in role.
  Future<void> reload() => refresh(roleId: _loadedFor?.split(':').last);

  // ── lookups ──────────────────────────────────────────────────────────

  /// The menu (or link group) id that owns [path] — a page path WITHOUT the
  /// role segment ("/production/machines"), i.e. an [AppRoute.path].
  String? menuIdForPath(String path) {
    final clean = path.split('?').first.replaceAll(RegExp(r'/+$'), '');
    if (clean.isEmpty) return null;

    for (final g in groups) {
      if (g.isLink && g.url != null) {
        final gu = normalizeMenuPath(g.url);
        if (gu.isNotEmpty && (gu == clean || clean.endsWith(gu))) return g.groupId;
      }
    }
    String? found;
    void search(List<MenuItem> items) {
      for (final m in items) {
        if (found != null) return;
        final mu = normalizeMenuPath(m.url);
        if (mu.isNotEmpty && (mu == clean || clean.endsWith(mu))) {
          found = m.id;
          return;
        }
        if (m.children.isNotEmpty) search(m.children);
      }
    }

    for (final g in groups) {
      search(g.menus);
      if (found != null) break;
    }
    return found;
  }

  PagePerms permissionsForMenu(String? menuId) {
    if (_isAdmin) return PagePerms.all;
    if (menuId == null) return PagePerms.none;
    for (final r in _roles) {
      if (r['menuId']?.toString() == menuId || r['menuGroupId']?.toString() == menuId) {
        return PagePerms.fromRole(r);
      }
    }
    return PagePerms.none;
  }

  PagePerms permissionsForPath(String url) => permissionsForMenu(menuIdForPath(url));
}
