import 'package:flutter/material.dart';

import '../core/utils/alerts.dart';
import 'page_guard.dart';
import 'routes.dart';

/// Top-level navigation between the app's pages (drawer, Home tiles,
/// shortcuts, notification taps). The signed-in root is Home, so going
/// anywhere else replaces everything above Home and Back returns to Home —
/// the phone equivalent of clicking a sidebar link.
///
/// Detail screens / forms inside a page are plain `Navigator.push`es.
class AppNav {
  AppNav._();

  static Route<T> routeFor<T>(AppRoute r) => MaterialPageRoute<T>(
        settings: RouteSettings(name: r.path),
        builder: (_) => PageGuard(route: r),
      );

  /// Whether the app has a screen for this menu URL.
  static bool canOpen(String? menuUrl) => AppRoutes.match(menuUrl) != null;

  /// Opens the page for a menu URL. Returns false when the app has no such page.
  static bool go(BuildContext context, String? menuUrl) {
    final r = AppRoutes.match(menuUrl);
    if (r == null) {
      Alerts.info("This page isn't available in the app yet.");
      return false;
    }
    final nav = Navigator.of(context);
    // Close the drawer first when it is open.
    final scaffold = Scaffold.maybeOf(context);
    if (scaffold != null && scaffold.isDrawerOpen) nav.pop();

    String? current;
    nav.popUntil((route) {
      current = route.settings.name;
      return true; // just peeks at the top route
    });
    if (current == r.path) return true;

    if (r.path == AppRoutes.home.path) {
      nav.popUntil((route) => route.isFirst);
    } else {
      nav.pushAndRemoveUntil(routeFor(r), (route) => route.isFirst);
    }
    return true;
  }

  static void goHome(BuildContext context) => go(context, AppRoutes.home.path);
}
