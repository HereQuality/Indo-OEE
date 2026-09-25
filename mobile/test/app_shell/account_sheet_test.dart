import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/app_scaffold.dart';
import 'package:indo/app/page_guard.dart';
import 'package:indo/models/menu_models.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/menu_provider.dart';
import 'package:indo/providers/theme_provider.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _page = AppScaffold(title: 'Machines', body: Center(child: Text('page body')));

Future<void> _openSheet(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Account'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    // Secure storage has no plugin in tests: answer instantly so logout finishes.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
  });

  testWidgets('avatar opens the account sheet: identity, one Light/Dark choice, profile/support/notifications, sign out', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, _page);
    expect(find.byTooltip('Account'), findsOneWidget);

    await _openSheet(tester);
    expect(find.text('Test User'), findsOneWidget);
    expect(find.text('Super Admin'), findsOneWidget);
    expect(find.text('@tester'), findsOneWidget);
    // ONE Light | Dark control - no separate switch - and nothing but the four rows.
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);
    expect(find.byType(Switch), findsNothing);
    for (final t in ['My profile', 'Notifications', 'Support', 'Sign out']) {
      expect(find.text(t), findsOneWidget, reason: t);
    }
    for (final t in ['Settings', 'Shortcuts', 'Dark mode']) {
      expect(find.text(t), findsNothing, reason: '$t must not be offered');
    }
    // No company name / logo row.
    expect(find.byIcon(Icons.business_rounded), findsNothing);
  });

  testWidgets('an operator only sees Support when the menus allow it', (tester) async {
    FakeApi.install();
    final groups = [MenuGroup(groupId: 'g2', groupName: 'Support', isLink: true, url: '/manager/support')];
    await pumpScreen(tester, _page, user: testUser(superAdmin: false), menus: groups);
    await _openSheet(tester);
    expect(find.text('Manager'), findsOneWidget);
    expect(find.text('My profile'), findsOneWidget);
    expect(find.text('Support'), findsNothing);

    // Grant view on the Support link group, reopen.
    await tester.tapAt(const Offset(10, 10)); // dismiss barrier
    await tester.pumpAndSettle();
    tester.element(find.byType(AppScaffold)).read<MenuProvider>().setForTest(
      isAdmin: false,
      groups: groups,
      roles: [
        {'menuGroupId': 'g2', 'view': true},
      ],
    );
    await tester.pump();
    await _openSheet(tester);
    expect(find.text('Support'), findsOneWidget);
  });

  testWidgets('the Light | Dark control flips the theme and saves themeMode on the account', (tester) async {
    final api = FakeApi.install();
    api.on('PUT', '/api/v1/auth/me/preferences', (r) => {'isOk': true, 'data': r.body});
    await pumpScreen(tester, _page);
    final ctx = tester.element(find.byType(AppScaffold));
    final theme = ctx.read<ThemeProvider>()..attach(ctx.read<AuthProvider>());

    await _openSheet(tester);
    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();
    expect(theme.isDark, isTrue);
    final put = api.called('PUT', '/api/v1/auth/me/preferences').single;
    expect((put.body as Map)['themeMode'], 'dark');

    // And back.
    await tester.tap(find.text('Light'));
    await tester.pumpAndSettle();
    expect(theme.isDark, isFalse);
    expect((api.called('PUT', '/api/v1/auth/me/preferences').last.body as Map)['themeMode'], 'light');
  });

  testWidgets('a row closes the sheet and opens that page', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, _page);
    await _openSheet(tester);
    await tester.tap(find.text('My profile'));
    await tester.pumpAndSettle();
    expect(find.text('Appearance'), findsNothing); // sheet is gone
    final guard = find.byType(PageGuard);
    expect(guard, findsOneWidget);
    expect(ModalRoute.of(tester.element(guard))?.settings.name, '/profile');
  });

  testWidgets('sign out asks first, then calls logout', (tester) async {
    final api = FakeApi.install();
    api.on('POST', '/api/v1/auth/logout', (_) => {'isOk': true});
    await pumpScreen(tester, _page);
    final auth = tester.element(find.byType(AppScaffold)).read<AuthProvider>();

    await _openSheet(tester);
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    expect(find.text('Sign out?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.called('POST', '/api/v1/auth/logout'), isEmpty);
    expect(auth.isAuthenticated, isTrue);

    await _openSheet(tester);
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();
    expect(api.called('POST', '/api/v1/auth/logout'), hasLength(1));
    expect(auth.isAuthenticated, isFalse);
  });

  testWidgets('smoke: dark, 360x640, text scale 1.6', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, _page, dark: true, size: const Size(360, 640), textScale: 1.6);
    await _openSheet(tester);
    expect(find.text('Sign out'), findsOneWidget);
    final err = tester.takeException();
    expect(err == null ? null : (err as FlutterError).toStringDeep(), isNull);
  });

  testWidgets('wide screens get a ~380 px popover instead of a sheet', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, _page, size: const Size(1024, 768));
    await _openSheet(tester);
    expect(tester.getSize(find.byType(Material).last).width, lessThanOrEqualTo(380));
    expect(find.text('Appearance'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
