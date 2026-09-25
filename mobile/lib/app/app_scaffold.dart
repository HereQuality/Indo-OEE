import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/unread_provider.dart';
import 'app_drawer.dart';
import 'navigation.dart';

/// Scaffold for every top-level page: hamburger -> menu drawer, title, the
/// notification bell, and your own [actions]. Use it as the root of a page
/// reached from the drawer; detail screens / forms use a plain [Scaffold].
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.title,
    required this.body,
    this.actions = const [],
    this.floatingActionButton,
    this.floatingActionButtonLocation,
    this.bottom,
    this.bottomNavigationBar,
    this.showBell = true,
    this.resizeToAvoidBottomInset = true,
  });

  final String title;
  final Widget body;
  final List<Widget> actions;
  final Widget? floatingActionButton;
  final FloatingActionButtonLocation? floatingActionButtonLocation;
  final PreferredSizeWidget? bottom;
  final Widget? bottomNavigationBar;
  final bool showBell;
  final bool resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: Builder(
          builder: (ctx) => IconButton(
            tooltip: 'Menu',
            icon: const Icon(Icons.menu_rounded),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        actions: [
          ...actions,
          if (showBell) const _Bell(),
          const SizedBox(width: 4),
        ],
        bottom: bottom,
      ),
      drawer: const AppDrawer(),
      // Swiping from the left edge is iOS's Back gesture — the hamburger opens the menu.
      drawerEnableOpenDragGesture: false,
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      body: SafeArea(top: false, child: body),
    );
  }
}

class _Bell extends StatelessWidget {
  const _Bell();

  @override
  Widget build(BuildContext context) {
    final count = context.select<UnreadProvider, int>((u) => u.notifications);
    return IconButton(
      tooltip: 'Notifications',
      onPressed: () => AppNav.go(context, '/notifications'),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: const Icon(Icons.notifications_none_rounded),
      ),
    );
  }
}
