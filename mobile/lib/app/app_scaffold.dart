import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/widgets/common_widgets.dart';
import '../models/app_user.dart';
import '../providers/auth_provider.dart';
import '../providers/unread_provider.dart';
import 'account_sheet.dart';

/// Scaffold for every top-level page: title, your own [actions], and the round
/// user avatar at the end of the app bar that opens the account menu (profile,
/// support, notifications, dark mode, sign out). There is no sidebar: the two
/// main sections live behind the bottom bar (see main_shell.dart), and a page
/// pushed on top of them (profile, support…) gets the usual Back arrow.
/// Detail screens / forms use a plain [Scaffold].
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
    this.resizeToAvoidBottomInset = true,
  });

  final String title;
  final Widget body;
  final List<Widget> actions;
  final Widget? floatingActionButton;
  final FloatingActionButtonLocation? floatingActionButtonLocation;
  final PreferredSizeWidget? bottom;
  final Widget? bottomNavigationBar;
  final bool resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        centerTitle: false,
        actions: [
          ...actions,
          const _AccountButton(),
          const SizedBox(width: 8),
        ],
        bottom: bottom,
      ),
      floatingActionButton: floatingActionButton,
      floatingActionButtonLocation: floatingActionButtonLocation,
      bottomNavigationBar: bottomNavigationBar,
      body: SafeArea(top: false, child: body),
    );
  }
}

/// Round user avatar at the end of the app bar: opens the account menu. A small
/// dot on it says there is something unread (notifications or support replies).
class _AccountButton extends StatelessWidget {
  const _AccountButton();

  @override
  Widget build(BuildContext context) {
    final user = context.select<AuthProvider, AppUser?>((a) => a.user);
    final unread = context.select<UnreadProvider, int>((u) => u.notifications + u.tickets);
    return Semantics(
      button: true,
      label: unread > 0 ? 'Account menu, $unread unread' : 'Account menu',
      excludeSemantics: true,
      child: Tooltip(
        message: 'Account',
        child: InkResponse(
          onTap: () => showAccountSheet(context),
          radius: 24,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Center(
              child: Badge(
                isLabelVisible: unread > 0,
                smallSize: 11,
                child: UserAvatar(imageUrl: user?.profilePic, name: user?.name, radius: 16),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
