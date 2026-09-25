import 'package:flutter/material.dart';

import '../features/admin/company_management_screen.dart';
import '../features/admin/menu_group_screen.dart';
import '../features/admin/menu_master_screen.dart';
import '../features/employee_management/company_holidays_screen.dart';
import '../features/employee_management/department_screen.dart';
import '../features/employee_management/employee_screen.dart';
import '../features/employee_management/manage_role_screen.dart';
import '../features/employee_management/role_master_screen.dart';
import '../features/employee_management/team_members_screen.dart';
import '../features/home/home_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/production/item_master_screen.dart';
import '../features/production/machine_master_screen.dart';
import '../features/production/operator_master_screen.dart';
import '../features/production/process_master_screen.dart';
import '../features/production/production_dashboard_screen.dart';
import '../features/production/production_sheet_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/shortcuts/shortcuts_screen.dart';
import '../features/support/support_screen.dart';
import '../features/teams/teams_board_screen.dart';
import '../core/utils/role_slug.dart';

/// One page of the app. [path] is the menu URL WITHOUT the role slug
/// ("/production/machines") — menus stored in the DB start with a role
/// segment ("/hqepl/production/machines") which is ignored.
class AppRoute {
  const AppRoute({
    required this.path,
    required this.title,
    required this.builder,
    this.aliases = const [],
    this.roles,
    this.exempt = false,
  });

  final String path;
  final String title;
  final WidgetBuilder builder;

  /// Other menu URLs that open the same page (old bookmarks).
  final List<String> aliases;

  /// roleTypes allowed to open it; null = any signed-in role.
  final Set<String>? roles;

  /// Account pages every signed-in user may open regardless of Manage Role
  /// (home, profile, settings, shortcuts, notifications).
  final bool exempt;
}

/// Every page, defined ONCE (mirrors client/src/Routes/allRoutes.jsx).
class AppRoutes {
  AppRoutes._();

  static const _admin = {'SuperAdmin'};

  static final List<AppRoute> all = [
    AppRoute(path: '/home', title: 'Home', builder: (_) => const HomeScreen(), exempt: true),
    AppRoute(path: '/profile', title: 'My profile', builder: (_) => const ProfileScreen(), exempt: true),
    AppRoute(path: '/settings', title: 'Settings', builder: (_) => const SettingsScreen(), exempt: true),
    AppRoute(path: '/shortcuts', title: 'Shortcuts', builder: (_) => const ShortcutsScreen(), exempt: true),
    AppRoute(path: '/notifications', title: 'Notifications', builder: (_) => const NotificationsScreen(), exempt: true),

    // SuperAdmin only — defines the app's page/menu structure itself.
    AppRoute(path: '/menu-groups', title: 'Menu groups', builder: (_) => const MenuGroupScreen(), roles: _admin),
    AppRoute(path: '/menus', title: 'Menus', builder: (_) => const MenuMasterScreen(), roles: _admin),
    AppRoute(path: '/company', title: 'Company', builder: (_) => const CompanyManagementScreen(), roles: _admin),

    // Shared by SuperAdmin and Operators; what each sees is narrowed by Manage Role.
    AppRoute(path: '/employee-management/company-holidays', title: 'Company holidays', builder: (_) => const CompanyHolidaysScreen()),
    AppRoute(path: '/employee-management/department', title: 'Departments', builder: (_) => const DepartmentScreen()),
    AppRoute(path: '/employee-management/role', title: 'Roles', builder: (_) => const RoleMasterScreen()),
    AppRoute(path: '/employee-management/employee', title: 'Employees', builder: (_) => const EmployeeScreen()),
    AppRoute(path: '/employee-management/manage-role', title: 'Manage role', builder: (_) => const ManageRoleScreen()),
    AppRoute(path: '/employee-management/team-members', title: 'Team members', builder: (_) => const TeamMembersScreen()),

    // Production.
    AppRoute(path: '/production/items', title: 'Items', builder: (_) => const ItemMasterScreen()),
    AppRoute(path: '/production/machines', title: 'Machines', builder: (_) => const MachineMasterScreen()),
    AppRoute(path: '/production/processes', title: 'Processes', builder: (_) => const ProcessMasterScreen()),
    AppRoute(path: '/production/operators', title: 'Operators', builder: (_) => const OperatorMasterScreen()),
    AppRoute(
      path: '/production/cnc-data-entry',
      aliases: ['/production/data-entry'],
      title: 'Data entry',
      builder: (_) => const ProductionSheetScreen(),
    ),
    AppRoute(path: '/production/dashboard', title: 'Production dashboard', builder: (_) => const ProductionDashboardScreen()),

    // Other.
    AppRoute(path: '/teams', title: 'Teams', builder: (_) => const TeamsBoardScreen()),
    AppRoute(path: '/support', title: 'Support', builder: (_) => const SupportScreen()),
  ];

  static AppRoute get home => all.first;

  /// Finds the page for a menu URL. Accepts both forms: with the role segment
  /// the DB stores ("/hqepl/production/machines?x=1") and without it
  /// ("/production/machines"). Null when the app has no such page.
  static AppRoute? match(String? menuUrl) {
    if (menuUrl == null) return null;
    final bare = menuUrl.split('?').first.replaceAll(RegExp(r'/+$'), '');
    if (bare.isEmpty || bare == '#') return null;
    for (final r in all) {
      if (r.path == bare || r.aliases.contains(bare)) return r;
    }
    final clean = normalizeMenuPath(bare); // drops the role segment
    if (clean.isEmpty) return null;
    for (final r in all) {
      if (r.path == clean || r.aliases.contains(clean)) return r;
    }
    // Same tolerance as the web app: a URL that ends with the route path.
    for (final r in all) {
      if (clean.endsWith(r.path)) return r;
    }
    return null;
  }

  /// Same as [match] for an already role-stripped path ("/home").
  static AppRoute? byPath(String path) => match(path);
}
