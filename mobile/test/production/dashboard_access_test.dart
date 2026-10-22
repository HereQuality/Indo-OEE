import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:indo/models/menu_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// Who sees which process on the Dashboard: an admin sees every process; anyone
/// else sees a process (its chip, its machines, its entries) only when Manage
/// Role lets them open that process's data-entry page.
void main() {
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  Finder chip(String label) => find.widgetWithText(InkWell, label);

  // VMC and PRESS each have a data-entry page; ROLL has none linked.
  List<Map<String, dynamic>> processes() => [
        {
          '_id': processVmc,
          'processName': 'VMC',
          'dataEntryMenu': '/hqepl/production/vmc-data-entry',
          'machines': [machineJson('m1', '7A', process: processVmc), machineJson('m2', '7B', process: processVmc)],
        },
        {
          '_id': processPress,
          'processName': 'PRESS',
          'dataEntryMenu': '/hqepl/production/press-data-entry',
          'machines': [machineJson('m3', 'P1', process: processPress)],
        },
        {
          '_id': 'p3',
          'processName': 'ROLL',
          'machines': [machineJson('m5', 'R1', process: 'p3')],
        },
      ];

  final menus = [
    MenuGroup(groupId: 'g1', groupName: 'Production', menus: [
      MenuItem(id: 'mv', name: 'VMC Data Entry', url: '/hqepl/production/vmc-data-entry'),
      MenuItem(id: 'mp', name: 'Press Data Entry', url: '/hqepl/production/press-data-entry'),
      MenuItem(id: 'md', name: 'Dashboard', url: '/hqepl/production/dashboard'),
    ]),
  ];

  Map<String, dynamic> view(String menuId) => {'menuId': menuId, 'view': true};

  testWidgets('admin sees every process, including one with no data-entry page', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processes());
    await pumpScreen(tester, const ProductionDashboardScreen());
    expect(chip('VMC'), findsOneWidget);
    expect(chip('PRESS'), findsOneWidget);
    expect(chip('ROLL'), findsOneWidget);
    expect(chip('All machines'), findsOneWidget);
  });

  testWidgets('a VMC-only user sees just VMC — no chips for others, no "All machines", only VMC entries asked for', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processes());
    await pumpScreen(
      tester,
      const ProductionDashboardScreen(),
      user: testUser(superAdmin: false),
      menus: menus,
      roles: [view('mv'), view('md')],
    );
    expect(chip('VMC'), findsOneWidget);
    expect(chip('PRESS'), findsNothing);
    expect(chip('ROLL'), findsNothing);
    expect(chip('All machines'), findsNothing);
    final asked = api.called('GET', '/api/v1/processes/entries');
    expect(asked, hasLength(1));
    expect(asked.single.query['process'], processVmc);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a user with VMC and PRESS gets both chips and an "All machines" built from just those two', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processes());
    await pumpScreen(
      tester,
      const ProductionDashboardScreen(),
      user: testUser(superAdmin: false),
      menus: menus,
      roles: [view('mv'), view('mp'), view('md')],
    );
    expect(chip('VMC'), findsOneWidget);
    expect(chip('PRESS'), findsOneWidget);
    expect(chip('ROLL'), findsNothing);

    await tester.tap(chip('All machines'));
    await tester.pumpAndSettle();
    final asked = [for (final r in api.called('GET', '/api/v1/processes/entries')) r.query['process']];
    // The first open was VMC; "All machines" then asks for VMC and PRESS separately
    // — never the unfiltered, every-machine request.
    expect(asked.where((p) => p == null), isEmpty);
    expect(asked.toSet(), {processVmc, processPress});
  });

  testWidgets('a user with no data-entry page access sees an explanation, not someone else\'s dashboard', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processes());
    await pumpScreen(
      tester,
      const ProductionDashboardScreen(),
      user: testUser(superAdmin: false),
      menus: menus,
      roles: [view('md')],
    );
    expect(find.textContaining('No dashboards for you yet'), findsOneWidget);
    expect(chip('VMC'), findsNothing);
    expect(api.called('GET', '/api/v1/processes/entries'), isEmpty);
  });
}
