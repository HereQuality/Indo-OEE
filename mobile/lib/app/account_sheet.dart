import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_colors.dart';
import '../core/utils/alerts.dart';
import '../core/widgets/common_widgets.dart';
import '../models/app_user.dart';
import '../providers/auth_provider.dart';
import '../providers/menu_provider.dart';
import '../providers/theme_provider.dart';
import '../providers/unread_provider.dart';
import 'navigation.dart';
import 'page_access.dart';

enum _Pick { profile, support, notifications, signOut }

/// The user-icon menu: account card, My profile / Support / Notifications, the
/// Light / Dark choice and sign out.
/// A bottom sheet on phones, a ~380 px popover under the app bar on wide
/// screens. The sheet closes first, then the chosen action runs.
Future<void> showAccountSheet(BuildContext context) async {
  HapticFeedback.selectionClick();
  final auth = context.read<AuthProvider>();
  final wide = MediaQuery.sizeOf(context).width >= 700;

  final _Pick? pick;
  if (wide) {
    pick = await showDialog<_Pick>(
      context: context,
      barrierColor: Colors.black38,
      builder: (ctx) => Align(
        alignment: Alignment.topRight,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, kToolbarHeight, 12, 16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: Material(
              color: Theme.of(ctx).bottomSheetTheme.backgroundColor ?? Theme.of(ctx).colorScheme.surface,
              elevation: 12,
              borderRadius: BorderRadius.circular(18),
              clipBehavior: Clip.antiAlias,
              child: const Padding(padding: EdgeInsets.only(top: 12), child: _AccountPanel()),
            ),
          ),
        ),
      ),
    );
  } else {
    pick = await showModalBottomSheet<_Pick>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      constraints: const BoxConstraints(maxWidth: 560),
      builder: (_) => const _AccountPanel(),
    );
  }
  if (pick == null || !context.mounted) return;

  switch (pick) {
    case _Pick.profile:
      AppNav.go(context, '/profile');
    case _Pick.notifications:
      AppNav.go(context, '/notifications');
    case _Pick.support:
      AppNav.go(context, '/support');
    case _Pick.signOut:
      final ok = await Alerts.confirm(
        context,
        'You will need to sign in again.',
        title: 'Sign out?',
        confirmText: 'Sign out',
      );
      if (ok) await auth.logout();
  }
}

class _AccountPanel extends StatelessWidget {
  const _AccountPanel();

  void _close(BuildContext context, _Pick p) => Navigator.of(context).pop(p);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final menu = context.watch<MenuProvider>();
    final unread = context.select<UnreadProvider, int>((u) => u.notifications);
    final user = auth.user;
    final s = Theme.of(context).colorScheme;
    final bottom = MediaQuery.viewPaddingOf(context).bottom;

    bool can(String path) => PageAccess.canOpen(user, menu, path);

    final tickets = context.select<UnreadProvider, int>((u) => u.tickets);
    final nav = <Widget>[
      _NavRow(icon: Icons.person_outline_rounded, title: 'My profile', onTap: () => _close(context, _Pick.profile)),
      if (can('/support'))
        _NavRow(icon: Icons.support_agent_rounded, title: 'Support', badge: tickets, onTap: () => _close(context, _Pick.support)),
      if (can('/notifications'))
        _NavRow(
          icon: Icons.notifications_none_rounded,
          title: 'Notifications',
          badge: unread,
          onTap: () => _close(context, _Pick.notifications),
        ),
    ];

    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(16, 4, 16, 16 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProfileCard(),
          const SizedBox(height: 10),
          _Group(children: nav),
          const SizedBox(height: 10),
          const _AppearanceRow(),
          const SizedBox(height: 10),
          Card(
            color: s.error.withValues(alpha: 0.08),
            clipBehavior: Clip.antiAlias,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: BorderSide(color: s.error.withValues(alpha: 0.25)),
            ),
            child: ListTile(
              minTileHeight: 48,
              leading: Icon(Icons.logout_rounded, color: s.error),
              title: Text('Sign out', style: TextStyle(color: s.error, fontWeight: FontWeight.w700)),
              onTap: () => _close(context, _Pick.signOut),
            ),
          ),
          const SizedBox(height: 12),
          const _Version(),
        ],
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final user = context.select<AuthProvider, AppUser?>((a) => a.user);
    final s = Theme.of(context).colorScheme;
    final name = user?.name ?? '';
    final role = user?.roleName;
    final email = user?.email ?? ((user?.username ?? '').isNotEmpty ? '@${user!.username}' : null);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: s.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: s.primary.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              UserAvatar(imageUrl: user?.profilePic, name: name, radius: 28),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                    if (role != null && role.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      _RoleChip(role),
                    ],
                    if (email != null) ...[
                      const SizedBox(height: 4),
                      Text(email, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: s.onSurfaceVariant)),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Like StatusChip, but the label may shrink so a long role name never overflows.
class _RoleChip extends StatelessWidget {
  const _RoleChip(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(color: s.primary.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.readable(context, s.primary)),
        ),
      ),
    );
  }
}

class _AppearanceRow extends StatelessWidget {
  const _AppearanceRow();

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final s = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 10, 8),
        child: Row(
          children: [
            Icon(theme.isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded, color: s.onSurfaceVariant, size: 22),
            const SizedBox(width: 12),
            const Expanded(child: Text('Appearance', style: TextStyle(fontWeight: FontWeight.w600))),
            SegmentedButton<bool>(
              showSelectedIcon: false,
              style: SegmentedButton.styleFrom(visualDensity: VisualDensity.compact, textStyle: const TextStyle(fontSize: 13)),
              segments: const [
                ButtonSegment(value: false, label: Text('Light')),
                ButtonSegment(value: true, label: Text('Dark')),
              ],
              selected: {theme.isDark},
              onSelectionChanged: (v) {
                if (v.first == theme.isDark) return;
                HapticFeedback.selectionClick();
                theme.setDark(v.first);
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// A rounded card whose children are separated by hairlines.
class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 16, endIndent: 16),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _NavRow extends StatelessWidget {
  const _NavRow({required this.icon, required this.title, required this.onTap, this.badge = 0});
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return ListTile(
      minTileHeight: 52,
      leading: Icon(icon, color: s.onSurfaceVariant),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      trailing: badge > 0
          ? Badge(label: Text(badge > 99 ? '99+' : '$badge'), backgroundColor: AppColors.critical, textColor: Colors.white)
          : Icon(Icons.chevron_right_rounded, color: s.onSurfaceVariant),
      onTap: onTap,
    );
  }
}

class _Version extends StatefulWidget {
  const _Version();

  @override
  State<_Version> createState() => _VersionState();
}

class _VersionState extends State<_Version> {
  late final Future<String> _label = PackageInfo.fromPlatform()
      .then((p) => 'Version ${p.version} (${p.buildNumber})')
      .catchError((_) => '');

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return FutureBuilder<String>(
      future: _label,
      initialData: '',
      builder: (_, snap) => Text(
        snap.data ?? '',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
      ),
    );
  }
}
