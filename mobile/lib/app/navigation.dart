import 'package:flutter/material.dart';

import '../core/utils/alerts.dart';
import 'main_shell.dart';
import 'page_guard.dart';
import 'routes.dart';

/// Top-level navigation between the app's pages (account menu, notification
/// taps, deep links). The signed-in root is the bottom-bar shell: going to one
/// of its tabs switches tab; any other page is pushed on top of the shell, so
/// Back (or the iOS edge-swipe) returns to it.
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

    // The two bottom-bar sections: drop whatever is pushed on top and switch tab.
    if (MainShell.goToTab(r.path)) {
      nav.popUntil((route) => route.isFirst);
      return true;
    }

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
