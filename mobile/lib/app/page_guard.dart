import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/widgets/page_permissions.dart';
import '../core/widgets/states.dart';
import '../features/auth/no_access_screen.dart';
import '../models/menu_models.dart';
import '../providers/auth_provider.dart';
import '../providers/menu_provider.dart';
import 'routes.dart';

/// Shown until the menus and permissions have loaded: a spinner, or Retry if
/// loading failed (never "No access" for a menu that simply isn't loaded).
class WorkspaceLoading extends StatelessWidget {
  const WorkspaceLoading({super.key});

  @override
  Widget build(BuildContext context) {
    final menu = context.watch<MenuProvider>();
    if (!menu.loading && menu.error != null) {
      return Scaffold(
        body: ErrorView(
          message: "Couldn't load your workspace. Check the connection and try again.",
          onRetry: menu.reload,
        ),
      );
    }
    return const Scaffold(body: LoadingView(label: 'Loading your workspace…'));
  }
}

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

    if (!menu.ready) return const WorkspaceLoading();
    final fronts = route.menuAccess;
    if (fronts != null) {
      return fronts(user, menu)
          ? PagePermissions(perms: const PagePerms(view: true), child: Builder(builder: route.builder))
          : const NoAccessScreen();
    }
    final menuId = menu.menuIdForPath(route.path) ??
        route.aliases.map(menu.menuIdForPath).firstWhere((e) => e != null, orElse: () => null);
    if (menuId == null) return const NoAccessScreen();
    final perms = menu.permissionsForMenu(menuId);
    if (!perms.view) return const NoAccessScreen();
    return PagePermissions(perms: perms, child: Builder(builder: route.builder));
  }
}
