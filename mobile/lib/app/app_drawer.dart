import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/config.dart';
import '../core/utils/alerts.dart';
import '../core/utils/role_slug.dart';
import '../core/widgets/common_widgets.dart';
import '../core/widgets/dynamic_icon.dart';
import '../models/menu_models.dart';
import '../providers/auth_provider.dart';
import '../providers/menu_provider.dart';
import '../providers/theme_provider.dart';
import '../providers/unread_provider.dart';
import 'navigation.dart';

/// The role's sidebar as a drawer, built from the server's menu tree
/// (Menu Master / Menu Group / Manage Role) — nothing is hard-coded.
class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final menu = context.watch<MenuProvider>();
    final theme = context.watch<ThemeProvider>();
    final ticketsUnread = context.select<UnreadProvider, int>((u) => u.tickets);
    final user = auth.user;
    final scheme = Theme.of(context).colorScheme;

    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            _Header(name: user?.name ?? '', role: user?.roleName, pic: user?.profilePic),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  ListTile(
                    leading: const Icon(Icons.home_outlined),
                    title: const Text('Home'),
                    onTap: () => AppNav.goHome(context),
                  ),
                  if (menu.loading && menu.groups.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5))),
                    ),
                  if (menu.error != null && menu.groups.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text(menu.error!, style: TextStyle(color: scheme.error)),
                          TextButton(onPressed: menu.reload, child: const Text('Retry')),
                        ],
                      ),
                    ),
                  for (final g in menu.groups) ..._group(context, g, ticketsUnread),
                ],
              ),
            ),
            const Divider(height: 1),
            ListTile(
              dense: true,
              leading: const Icon(Icons.person_outline),
              title: const Text('My profile'),
              onTap: () => AppNav.go(context, '/profile'),
            ),
            ListTile(
              dense: true,
              leading: const Icon(Icons.settings_outlined),
              title: const Text('Settings'),
              onTap: () => AppNav.go(context, '/settings'),
            ),
            SwitchListTile(
              dense: true,
              secondary: Icon(theme.isDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined),
              title: const Text('Dark mode'),
              value: theme.isDark,
              onChanged: (v) => theme.setDark(v),
            ),
            ListTile(
              dense: true,
              leading: Icon(Icons.logout_rounded, color: scheme.error),
              title: Text('Sign out', style: TextStyle(color: scheme.error)),
              onTap: () async {
                final ok = await Alerts.confirm(
                  context,
                  'You will need to sign in again.',
                  title: 'Sign out?',
                  confirmText: 'Sign out',
                );
                if (ok) await auth.logout();
              },
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '${AppConfig.appName} · ${AppConfig.apiHost}',
                style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _group(BuildContext context, MenuGroup g, int ticketsUnread) {
    if (g.isLink) {
      // "Home" is always shown above; don't repeat it.
      if (normalizeMenuPath(g.url) == '/home') return const [];
      final isSupport = normalizeMenuPath(g.url) == '/support';
      return [
        ListTile(
          leading: DynamicIcon(g.icon),
          title: Text(g.groupName),
          trailing: isSupport && ticketsUnread > 0
              ? Badge(label: Text('$ticketsUnread'), backgroundColor: Theme.of(context).colorScheme.error)
              : null,
          onTap: () => AppNav.go(context, g.url),
        ),
      ];
    }
    return [
      Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: DynamicIcon(g.icon),
          title: Text(g.groupName, style: const TextStyle(fontWeight: FontWeight.w600)),
          shape: const Border(),
          collapsedShape: const Border(),
          childrenPadding: EdgeInsets.zero,
          children: [for (final m in g.menus) _menu(context, m, 1)],
        ),
      ),
    ];
  }

  Widget _menu(BuildContext context, MenuItem m, int depth) {
    final left = 16.0 + depth * 14;
    if (m.children.isNotEmpty) {
      return Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: EdgeInsets.only(left: left, right: 16),
          leading: m.icon != null ? DynamicIcon(m.icon, size: 18) : null,
          title: Text(m.name),
          shape: const Border(),
          collapsedShape: const Border(),
          children: [for (final c in m.children) _menu(context, c, depth + 1)],
        ),
      );
    }
    final available = AppNav.canOpen(m.url);
    return ListTile(
      contentPadding: EdgeInsets.only(left: left, right: 16),
      dense: true,
      leading: m.icon != null && m.icon!.isNotEmpty
          ? DynamicIcon(m.icon, size: 18)
          : const Icon(Icons.circle, size: 7),
      minLeadingWidth: 24,
      title: Text(m.name, style: TextStyle(color: available ? null : Theme.of(context).disabledColor)),
      onTap: () => AppNav.go(context, m.url),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.name, this.role, this.pic});
  final String name;
  final String? role;
  final String? pic;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      child: Row(
        children: [
          UserAvatar(imageUrl: pic, name: name, radius: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                if (role != null)
                  Text(role!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: s.onSurfaceVariant, fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
