import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../app/navigation.dart';
import '../../app/page_access.dart';
import '../../app/routes.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/role_slug.dart';
import '../../core/widgets/states.dart';
import '../../models/app_user.dart';
import '../../models/menu_models.dart';
import '../../providers/auth_provider.dart';
import '../../providers/company_provider.dart';
import '../../providers/menu_provider.dart';
import '../../providers/unread_provider.dart';
import 'home_widgets.dart';

const _dashboardPath = '/production/dashboard';
const _entryPath = '/production/cnc-data-entry';

/// Landing page after sign-in: greeting, the two main workflows as big
/// launcher cards, then every other page the role may open, grouped like the
/// drawer (mirrors the intent of client/src/pages/Home.jsx).
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(BuildContext context) async {
    final menu = context.read<MenuProvider>();
    final unread = context.read<UnreadProvider>();
    final company = context.read<CompanyProvider>();
    await Future.wait([menu.reload(), unread.refresh(), company.load()]);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final menu = context.watch<MenuProvider>();
    final company = context.watch<CompanyProvider>();
    final user = auth.user;

    final loading = menu.loading && menu.groups.isEmpty;
    final failed = !loading && menu.error != null && menu.groups.isEmpty;

    final showDashboard = !loading && PageAccess.canOpen(user, menu, _dashboardPath);
    final showEntry = !loading && PageAccess.canOpen(user, menu, _entryPath);

    final sections = loading ? const <_Section>[] : _sections(user, menu, hideLaunchers: true);
    final pinned = loading ? const <_Leaf>[] : _pinned(user, menu);
    final nothing = !loading && !failed && !showDashboard && !showEntry && sections.isEmpty;

    final first = (user?.name ?? '').trim().split(RegExp(r'\s+')).first;

    return AppScaffold(
      title: 'Home',
      body: LayoutBuilder(
        builder: (context, box) {
          final gutter = math.max(16.0, (box.maxWidth - 720) / 2);
          final inner = math.min(box.maxWidth, 720.0) - 32;
          return RefreshIndicator(
            onRefresh: () => _refresh(context),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: EdgeInsets.fromLTRB(gutter, 20, gutter, 32),
              children: [
                _Greeting(firstName: first, companyName: company.name, logo: company.logo),
                if (loading) const HomeSkeleton(),
                if (failed)
                  SizedBox(
                    height: 320,
                    child: ErrorView(message: menu.error!, onRetry: () => _refresh(context)),
                  ),
                if (nothing)
                  const SizedBox(
                    height: 320,
                    child: EmptyView(
                      message: 'No pages are assigned to your role yet. Ask your administrator to grant access.',
                      icon: Icons.lock_outline_rounded,
                    ),
                  ),
                if (showDashboard || showEntry) ...[
                  const SizedBox(height: 22),
                  _Launchers(
                    width: inner,
                    dashboard: showDashboard
                        ? LauncherCard(
                            title: 'Production Dashboard',
                            subtitle: 'OEE, KPIs, trends and drill-downs',
                            icon: LucideIcons.layoutDashboard,
                            colors: const [AppColors.brand600, AppColors.brand700],
                            onTap: () => AppNav.go(context, _dashboardPath),
                          )
                        : null,
                    entry: showEntry
                        ? LauncherCard(
                            title: 'Data Entry',
                            subtitle: 'Log shifts and production',
                            icon: LucideIcons.clipboardPen,
                            colors: const [Color(0xFF0F766E), Color(0xFF115E59)],
                            onTap: () => AppNav.go(context, _entryPath),
                          )
                        : null,
                  ),
                ],
                if (pinned.isNotEmpty) ...[
                  const SectionLabel('Your shortcuts'),
                  _Grid(width: inner, leaves: pinned),
                ],
                for (final s in sections) ...[
                  SectionLabel(s.title),
                  _Grid(width: inner, leaves: s.leaves),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Leaf {
  const _Leaf(this.id, this.name, this.url, this.icon);
  final String id;
  final String name;
  final String url;
  final String? icon;
}

class _Section {
  const _Section(this.title, this.leaves);
  final String title;
  final List<_Leaf> leaves;
}

void _collect(List<MenuItem> items, void Function(MenuItem) add) {
  for (final m in items) {
    if (m.children.isNotEmpty) {
      _collect(m.children, add);
    } else {
      add(m);
    }
  }
}

List<_Section> _sections(AppUser? user, MenuProvider menu, {required bool hideLaunchers}) {
  final out = <_Section>[];
  final links = <_Leaf>[];
  bool skip(String url) {
    final r = AppRoutes.match(url);
    if (r == null) return true;
    if (r.path == AppRoutes.home.path) return true;
    if (!PageAccess.canOpen(user, menu, url)) return true;
    return hideLaunchers && (r.path == _dashboardPath || r.path == _entryPath);
  }

  for (final g in menu.groups) {
    if (g.isLink) {
      final url = g.url;
      if (url == null || skip(url)) continue;
      links.add(_Leaf(g.groupId, g.groupName, url, g.icon));
      continue;
    }
    final leaves = <_Leaf>[];
    _collect(g.menus, (m) {
      final url = m.url;
      if (url == null || normalizeMenuPath(url).isEmpty || skip(url)) return;
      leaves.add(_Leaf(m.id, m.name, url, m.icon ?? g.icon));
    });
    if (leaves.isNotEmpty) out.add(_Section(g.groupName, leaves));
  }
  if (links.isNotEmpty) out.add(_Section('More', links));
  return out;
}

/// Menu items the person pinned in Shortcuts (preferences.shortcuts = menu ids).
List<_Leaf> _pinned(AppUser? user, MenuProvider menu) {
  final ids = user?.preferences.shortcuts ?? const <String>[];
  if (ids.isEmpty) return const [];
  final out = <_Leaf>[];
  for (final g in menu.groups) {
    _collect(g.menus, (m) {
      final url = m.url;
      if (url != null && ids.contains(m.id) && PageAccess.canOpen(user, menu, url)) {
        out.add(_Leaf(m.id, m.name, url, m.icon ?? g.icon));
      }
    });
  }
  return out;
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.firstName, required this.companyName, this.logo});
  final String firstName;
  final String companyName;
  final String? logo;

  static String _hello() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final date = DateFormat('EEEE, d MMMM y').format(DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_hello(), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: s.onSurfaceVariant)),
        const SizedBox(height: 2),
        Text(
          firstName.isEmpty ? 'Welcome' : firstName,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, height: 1.15),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(Icons.calendar_today_rounded, size: 14, color: s.onSurfaceVariant),
            const SizedBox(width: 6),
            Flexible(child: Text(date, style: TextStyle(fontSize: 13, color: s.onSurfaceVariant))),
          ],
        ),
        if (companyName.isNotEmpty || (logo != null && logo!.isNotEmpty)) ...[
          const SizedBox(height: 12),
          CompanyBadge(name: companyName, logo: logo),
        ],
      ],
    );
  }
}

class _Launchers extends StatelessWidget {
  const _Launchers({required this.width, this.dashboard, this.entry});
  final double width;
  final Widget? dashboard;
  final Widget? entry;

  @override
  Widget build(BuildContext context) {
    final cards = [?dashboard, ?entry];
    if (cards.length == 2 && width >= 520) {
      return IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [Expanded(child: cards[0]), const SizedBox(width: 12), Expanded(child: cards[1])],
        ),
      );
    }
    return Column(
      children: [
        for (var i = 0; i < cards.length; i++) ...[
          if (i > 0) const SizedBox(height: 12),
          cards[i],
        ],
      ],
    );
  }
}

class _Grid extends StatelessWidget {
  const _Grid({required this.width, required this.leaves});
  final double width;
  final List<_Leaf> leaves;

  @override
  Widget build(BuildContext context) {
    const gap = 10.0;
    final cols = width >= 560 ? 5 : (width >= 420 ? 4 : 3);
    final tile = (width - gap * (cols - 1)) / cols;
    return Wrap(
      spacing: gap,
      runSpacing: gap,
      children: [
        for (final l in leaves)
          SizedBox(
            width: tile,
            child: PageTile(label: l.name, icon: l.icon, onTap: () => AppNav.go(context, l.url)),
          ),
      ],
    );
  }
}
