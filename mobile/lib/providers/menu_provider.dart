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

  /// The signed-in person's menus and permissions have loaded at least once.
  /// Until then the app shows "Loading your workspace…", never "No access" —
  /// an empty menu before the first answer only means "not loaded yet".
  bool ready = false;
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
    ready = true;
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
        ready = false;
        notifyListeners();
      }
      return;
    }
    final key = '${u.id}:${u.roleId}';
    if (_loadedFor == key) return;
    _loadedFor = key;
    _isAdmin = u.isSuperAdmin;
    // Loading from this moment (set without notifying: attach runs during a
    // build), so no frame shows an empty menu as "No access".
    ready = false;
    loading = true;
    error = null;
    // Defer so we never notify during a build.
    Future.microtask(() => refresh(roleId: u.roleId));
  }

  Future<void> refresh({String? roleId}) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      // Both answers are applied together, so the menus never show for a
      // moment without the permissions that go with them.
      final res = await Api.get(Endpoints.menusByGroups);
      final nextGroups = asList(res).map(MenuGroup.fromJson).toList();
      var nextRoles = const <Map<String, dynamic>>[];
      if (!_isAdmin && roleId != null && roleId.isNotEmpty) {
        final r = await Api.get(Endpoints.operatorRolesById(roleId));
        final data = r['data'];
        final first = data is List && data.isNotEmpty ? data.first : (data is Map ? data : null);
        nextRoles = (first is Map && first['roles'] is List)
            ? (first['roles'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
            : const [];
      }
      groups = nextGroups;
      _roles = nextRoles;
      ready = true;
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
