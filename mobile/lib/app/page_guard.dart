import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/widgets/page_permissions.dart';
import '../core/widgets/states.dart';
import '../features/auth/no_access_screen.dart';
import '../models/menu_models.dart';
import '../providers/auth_provider.dart';
import '../providers/menu_provider.dart';
import 'routes.dart';

/// Per-page gate (mirrors PageGuard in client/src/Routes/RoleRoute.jsx):
///  * role lock-down (`route.roles`),
///  * Manage Role "view" permission on the menu that owns this page,
/// and hands the page its [PagePerms] through [PagePermissions].
/// SuperAdmin bypasses the menu check; the account pages (`exempt`) are open to
/// every signed-in user.
class PageGuard extends StatelessWidget {
  const PageGuard({super.key, required this.route});
  final AppRoute route;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final menu = context.watch<MenuProvider>();
    final user = auth.user;
    if (user == null) return const Scaffold(body: SizedBox.shrink());

    if (route.roles != null && !route.roles!.contains(user.roleType)) {
      return const NoAccessScreen();
    }

    if (menu.isAdmin || route.exempt) {
      return PagePermissions(perms: PagePerms.all, child: Builder(builder: route.builder));
    }

    if (menu.loading && menu.groups.isEmpty) {
      return const Scaffold(body: LoadingView(label: 'Loading your workspace…'));
    }
    final menuId = menu.menuIdForPath(route.path) ??
        route.aliases.map(menu.menuIdForPath).firstWhere((e) => e != null, orElse: () => null);
    if (menuId == null) return const NoAccessScreen();
    final perms = menu.permissionsForMenu(menuId);
    if (!perms.view) return const NoAccessScreen();
    return PagePermissions(perms: perms, child: Builder(builder: route.builder));
  }
}
