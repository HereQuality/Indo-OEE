import '../models/app_user.dart';
import '../providers/menu_provider.dart';
import '../core/utils/role_slug.dart';
import 'routes.dart';

/// Whether the signed-in user may open a menu URL — the same rules PageGuard
/// applies when the page is actually opened (role lock-down, exempt account
/// pages, Manage Role "view"), so launchers never lead to a "No access" page.
class PageAccess {
  PageAccess._();

  static bool canOpen(AppUser? user, MenuProvider menu, String? menuUrl) {
    if (user == null) return false;
    final route = AppRoutes.match(menuUrl);
    if (route == null) return false;
    if (route.roles != null && !route.roles!.contains(user.roleType)) return false;
    if (menu.isAdmin || route.exempt) return true;
    if (route.menuAccess != null) return route.menuAccess!(user, menu);
    final id = menu.menuIdForPath(route.path) ??
        route.aliases.map(menu.menuIdForPath).firstWhere((e) => e != null, orElse: () => null);
    if (id == null) return false;
    return menu.permissionsForMenu(id).view;
  }

  /// Whether the user may view the menu page at [menuUrl] — Manage Role's "view"
  /// on that menu — whether or not the phone app has a screen for it yet.
  /// Admins may view everything; a URL no menu carries is not viewable.
  static bool canViewMenuUrl(MenuProvider menu, String? menuUrl) {
    if (menu.isAdmin) return true;
    final clean = normalizeMenuPath(menuUrl);
    if (clean.isEmpty) return false;
    final id = menu.menuIdForPath(clean);
    return id != null && menu.permissionsForMenu(id).view;
  }
}
