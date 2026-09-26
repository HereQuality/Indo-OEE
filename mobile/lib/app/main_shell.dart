import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../core/widgets/states.dart';
import '../features/auth/no_access_screen.dart';
import '../models/app_user.dart';
import '../providers/auth_provider.dart';
import '../providers/menu_provider.dart';
import 'page_access.dart';
import 'page_guard.dart';
import 'routes.dart';

class _ShellTab {
  const _ShellTab(this.path, this.label, this.icon, this.selectedIcon);
  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// The phone / iPad app's two main sections, in bottom-bar order.
const _allTabs = [
  _ShellTab('/production/dashboard', 'Dashboard', Icons.space_dashboard_outlined, Icons.space_dashboard_rounded),
  _ShellTab('/production/cnc-data-entry', 'Data entry', Icons.edit_note_outlined, Icons.edit_note_rounded),
];

/// The signed-in root: the bottom navigation bar with the Dashboard and Data
/// entry tabs. Swipe sideways to change tab, or tap the bar. Only the tabs the
/// person may open are shown (one tab = no bar). Everything else — profile,
/// support, notifications, the entry form — is pushed on top, so the iOS
/// edge-swipe (or the Back arrow) returns here.
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  static _MainShellState? _current;

  /// Switches to the tab that owns [path] and returns true; false when [path]
  /// is not one of the bottom-bar tabs.
  static bool goToTab(String path) => _current?._goTo(path) ?? false;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  final PageController _controller = PageController();
  List<_ShellTab> _visible = const [];
  int _index = 0;

  @override
  void initState() {
    super.initState();
    MainShell._current = this;
  }

  @override
  void dispose() {
    if (MainShell._current == this) MainShell._current = null;
    _controller.dispose();
    super.dispose();
  }

  bool _goTo(String path) {
    final bare = AppRoutes.match(path)?.path ?? path;
    final i = _visible.indexWhere((t) => t.path == bare);
    if (i < 0) return false;
    if (_controller.hasClients && _index != i) {
      _controller.animateToPage(i, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final user = context.select<AuthProvider, AppUser?>((a) => a.user);
    final menu = context.watch<MenuProvider>();
    if (menu.loading && menu.groups.isEmpty && !menu.isAdmin) {
      return const Scaffold(body: LoadingView(label: 'Loading your workspace…'));
    }
    final visible = [
      for (final t in _allTabs)
        if (PageAccess.canOpen(user, menu, t.path)) t,
    ];
    _visible = visible;
    if (visible.isEmpty) return const NoAccessScreen();

    final selected = _index.clamp(0, visible.length - 1);
    final pages = PageView(
      controller: _controller,
      onPageChanged: (i) {
        HapticFeedback.selectionClick();
        setState(() => _index = i);
      },
      children: [
        for (final t in visible) _KeepAlive(key: ValueKey(t.path), child: PageGuard(route: AppRoutes.byPath(t.path)!)),
      ],
    );
    if (visible.length == 1) return pages;

    // The pages are Scaffolds of their own and deal with the keyboard themselves,
    // so this outer one must not shrink for it — and the bar has no business
    // riding up above the keyboard, so it steps out of the way while one is open.
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    return Scaffold(
      resizeToAvoidBottomInset: false,
      body: pages,
      bottomNavigationBar: keyboardOpen
          ? null
          : DecoratedBox(
              decoration: BoxDecoration(border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant))),
              child: NavigationBar(
                selectedIndex: selected,
                onDestinationSelected: (i) {
                  if (i == selected) return;
                  _controller.animateToPage(i, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
                },
                destinations: [
                  for (final t in visible)
                    NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: t.label),
                ],
              ),
            ),
    );
  }
}

/// Keeps a tab's page (and its loaded data / scroll position) alive while the
/// other tab is showing.
class _KeepAlive extends StatefulWidget {
  const _KeepAlive({super.key, required this.child});
  final Widget child;

  @override
  State<_KeepAlive> createState() => _KeepAliveState();
}

class _KeepAliveState extends State<_KeepAlive> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return widget.child;
  }
}
