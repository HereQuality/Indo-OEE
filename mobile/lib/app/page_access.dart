import '../models/app_user.dart';
import '../providers/menu_provider.dart';
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
    final id = menu.menuIdForPath(route.path) ??
        route.aliases.map(menu.menuIdForPath).firstWhere((e) => e != null, orElse: () => null);
    if (id == null) return false;
    return menu.permissionsForMenu(id).view;
  }
}
