import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/page_guard.dart';
import 'package:indo/features/home/home_screen.dart';
import 'package:indo/models/menu_models.dart';
import 'package:indo/providers/menu_provider.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

List<MenuGroup> _groups() => [
      MenuGroup(groupId: 'g1', groupName: 'Production', menus: [
        MenuItem(id: 'm-dash', name: 'Dashboard menu', url: '/hqepl/production/dashboard'),
        MenuItem(id: 'm-entry', name: 'Entry menu', url: '/hqepl/production/cnc-data-entry'),
        MenuItem(id: 'm-mach', name: 'Machines', url: '/hqepl/production/machines', icon: 'Factory'),
      ]),
      MenuGroup(groupId: 'g2', groupName: 'Support', isLink: true, url: '/hqepl/support'),
    ];

void _grant(WidgetTester tester, List<Map<String, dynamic>> roles) {
  tester.element(find.byType(HomeScreen)).read<MenuProvider>().setForTest(isAdmin: false, groups: _groups(), roles: roles);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('shows greeting, both launchers and the other pages grouped like the drawer', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const HomeScreen(), menus: _groups());
    expect(find.textContaining(RegExp('Good (morning|afternoon|evening)')), findsOneWidget);
    expect(find.text('Test'), findsOneWidget); // first name
    expect(find.text('Production Dashboard'), findsOneWidget);
    expect(find.text('Data Entry'), findsOneWidget);
    expect(find.byTooltip('Account'), findsOneWidget);
    // The launchers are not repeated in the grid; the rest is reachable.
    expect(find.text('Dashboard menu'), findsNothing);
    expect(find.text('PRODUCTION'), findsOneWidget);
    expect(find.text('Machines'), findsOneWidget);
    expect(find.text('Support'), findsOneWidget);

    await tester.tap(find.text('Machines'));
    await tester.pumpAndSettle();
    expect(ModalRoute.of(tester.element(find.byType(PageGuard)))?.settings.name, '/production/machines');
  });

  testWidgets('launchers follow the role permissions', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const HomeScreen(), user: testUser(superAdmin: false), menus: _groups());
    _grant(tester, const []);
    await tester.pumpAndSettle();
    expect(find.text('Production Dashboard'), findsNothing);
    expect(find.text('Data Entry'), findsNothing);
    expect(find.textContaining('No pages are assigned'), findsOneWidget);

    _grant(tester, [
      {'menuId': 'm-dash', 'view': true},
      {'menuId': 'm-mach', 'view': true},
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Production Dashboard'), findsOneWidget);
    expect(find.text('Data Entry'), findsNothing);
    expect(find.text('Machines'), findsOneWidget);
    expect(find.text('Support'), findsNothing);
  });

  testWidgets('pull to refresh reloads menus and branding', (tester) async {
    final api = FakeApi.install();
    api.on('GET', '/api/v1/menus/by-groups', (_) => {'isOk': true, 'data': <Object>[]});
    api.on('GET', '/api/v1/companies/getCompanyDetails', (_) => {'isOk': true, 'data': {'name': 'Indo Electricals'}});
    await pumpScreen(tester, const HomeScreen(), menus: _groups());
    final g = await tester.startGesture(tester.getCenter(find.byType(ListView)));
    for (var i = 0; i < 20; i++) {
      await g.moveBy(const Offset(0, 25));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await g.up();
    // Dio answers from fake timers, which pumpAndSettle alone does not advance.
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 400));
    }
    await tester.pumpAndSettle();
    expect(api.called('GET', '/api/v1/menus/by-groups'), isNotEmpty);
    expect(find.text('Indo Electricals'), findsOneWidget);
  });

  testWidgets('skeleton while the menus load, error with retry when they fail', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const HomeScreen(), settle: false);
    final menu = tester.element(find.byType(HomeScreen)).read<MenuProvider>();
    menu.loading = true;
    // ignore: invalid_use_of_protected_member
    menu.notifyListeners();
    await tester.pump();
    expect(find.bySemanticsLabel('Loading your workspace'), findsOneWidget);
    expect(find.text('Production Dashboard'), findsNothing);

    menu.loading = false;
    menu.error = 'Server is down';
    // ignore: invalid_use_of_protected_member
    menu.notifyListeners();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Server is down'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('smoke: dark, 360x640, text scale 1.6 and a tablet, no overflow', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const HomeScreen(), menus: _groups(), dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(find.text('Production Dashboard'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await pumpScreen(tester, const HomeScreen(), menus: _groups(), size: const Size(1024, 768));
    expect(find.text('Data Entry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
