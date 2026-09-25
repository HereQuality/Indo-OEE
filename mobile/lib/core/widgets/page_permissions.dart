import 'package:flutter/widgets.dart';

import '../../models/menu_models.dart';

/// The signed-in role's permissions on the page being shown (view / create /
/// edit / delete), provided by the route guard. Pages read it to hide buttons
/// the role wasn't granted:
///
///   final perms = PagePermissions.of(context);
///   if (perms.create) FloatingActionButton(...)
///
/// Screens pushed on top of a page (forms, details) are separate routes, so
/// they should receive [PagePerms] as a constructor argument instead.
class PagePermissions extends InheritedWidget {
  const PagePermissions({super.key, required this.perms, required super.child});

  final PagePerms perms;

  static PagePerms of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PagePermissions>()?.perms ?? PagePerms.all;

  @override
  bool updateShouldNotify(PagePermissions old) =>
      perms.view != old.perms.view ||
      perms.create != old.perms.create ||
      perms.edit != old.perms.edit ||
      perms.delete != old.perms.delete;
}
