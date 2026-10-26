import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/main_shell.dart';
import 'package:indo/app/navigation.dart';
import 'package:indo/app/page_access.dart';
import 'package:indo/app/routes.dart';
import 'package:indo/core/widgets/states.dart';
import 'package:indo/features/production/data_entry_hub/data_entry_hub_screen.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart';
import 'package:indo/features/production/processes/rubber/rubber_spec.dart';
import 'package:indo/features/production/processes/vmc/vmc_spec.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/models/menu_models.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/menu_provider.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// The Data entry hub: every process the person may enter data for, as cards.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  List<Map<String, dynamic>> processes() => [
        {
          '_id': 'p1',
          'processName': 'VMC',
          'dataEntryMenu': '/hqepl/production/vmc-data-entry',
          'machines': [machineJson('m1', '7A', process: 'p1'), machineJson('m2', '7B', process: 'p1')],
        },
        {
          '_id': 'p2',
          'processName': 'PRESS',
          'dataEntryMenu': '/hqepl/production/press-data-entry',
          'machines': [machineJson('m3', 'P1', process: 'p2')],
        },
        {
          '_id': 'p3',
          'processName': 'RUBBER',
          'dataEntryMenu': '/hqepl/production/rubber-data-entry',
          'machines': <Object>[],
        },
        {'_id': 'p4', 'processName': 'ROLL', 'machines': <Object>[]},
        // A page the phone has no screen for (RUBBER has one now).
        {
          '_id': 'p5',
          'processName': 'BUFFING',
          'dataEntryMenu': '/hqepl/production/buffing-data-entry',
          'machines': <Object>[],
        },
      ];

  final menus = [
    MenuGroup(groupId: 'g1', groupName: 'DATA ENTRY', menus: [
      MenuItem(id: 'mv', name: 'VMC', url: '/hqepl/production/vmc-data-entry'),
      MenuItem(id: 'mp', name: 'PRESS', url: '/hqepl/production/press-data-entry'),
      MenuItem(id: 'mr', name: 'RUBBER', url: '/hqepl/production/rubber-data-entry'),
      MenuItem(id: 'mb', name: 'BUFFING', url: '/hqepl/production/buffing-data-entry'),
      MenuItem(id: 'md', name: 'Dashboard', url: '/hqepl/production/dashboard'),
    ]),
  ];

  Map<String, dynamic> view(String id) => {'menuId': id, 'view': true};

  FakeApi setup({List<Map<String, dynamic>>? procs}) {
    final api = FakeApi.install();
    installDashboardApi(api, processes: procs ?? processes());
    for (final spec in [vmcSpec, cncSpec, rubberSpec]) {
      api.on('GET', spec.api.list, (_) => {
            'isOk': true,
            'data': <Object>[],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 0},
          });
    }
    return api;
  }

  Future<void> pumpHub(
    WidgetTester tester, {
    bool admin = false,
    List<Map<String, dynamic>> roles = const [],
    Size size = const Size(390, 844),
    bool dark = false,
    double textScale = 1,
  }) =>
      pumpScreen(
        tester,
        const DataEntryHubScreen(),
        user: testUser(superAdmin: admin),
        menus: menus,
        roles: roles,
        size: size,
        dark: dark,
        textScale: textScale,
      );

  Finder card(String name) => find.widgetWithText(Card, name);

  testWidgets('admin sees every process: linked ones, one without a screen, one unlinked', (tester) async {
    setup();
    await pumpHub(tester, admin: true);
    expect(card('VMC'), findsOneWidget);
    expect(find.text('2 machines'), findsOneWidget);
    expect(find.text('1 machine'), findsOneWidget);
    expect(card('PRESS'), findsOneWidget);
    // RUBBER is kept per worker: it has no machines to count.
    expect(card('RUBBER'), findsOneWidget);
    expect(find.text('Per worker'), findsOneWidget);
    expect(card('BUFFING'), findsOneWidget);
    expect(find.text('Not in the app yet'), findsOneWidget);
    expect(card('ROLL'), findsOneWidget);
    expect(find.text('Not linked to a page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a restricted user sees only the processes whose page they may view', (tester) async {
    setup();
    await pumpHub(tester, roles: [view('mv'), view('md')]);
    expect(card('VMC'), findsOneWidget);
    expect(card('PRESS'), findsNothing);
    expect(card('RUBBER'), findsNothing);
    expect(card('BUFFING'), findsNothing);
    expect(card('ROLL'), findsNothing); // unlinked: hidden from non-admins
    expect(find.text('Not linked to a page'), findsNothing);
  });

  testWidgets('a process the phone has no screen for is listed disabled', (tester) async {
    final api = setup();
    await pumpHub(tester, roles: [view('mv'), view('mb')]);
    expect(card('BUFFING'), findsOneWidget);
    expect(find.text('Not in the app yet'), findsOneWidget);
    await tester.tap(card('BUFFING'));
    await tester.pumpAndSettle();
    expect(find.byType(ProductionSheetScreen), findsNothing);
    expect(find.byType(DataEntryHubScreen), findsOneWidget);
    expect(api.misses, isEmpty);
  });

  testWidgets('RUBBER opens its own screen', (tester) async {
    final api = setup();
    await pumpHub(tester, roles: [view('mr')]);
    expect(find.text('Not in the app yet'), findsNothing);
    await tester.tap(card('RUBBER'));
    await tester.pumpAndSettle();
    final screen = tester.widget<ProductionSheetScreen>(find.byType(ProductionSheetScreen));
    expect(screen.spec, same(rubberSpec));
    expect(api.called('GET', rubberSpec.api.list), isNotEmpty);
  });

  testWidgets('tapping a card opens that process\'s screen (its list is fetched); Back returns to the hub', (tester) async {
    final api = setup();
    await pumpHub(tester, roles: [view('mv'), view('mp')]);
    await tester.tap(card('VMC'));
    await tester.pumpAndSettle();
    final screen = tester.widget<ProductionSheetScreen>(find.byType(ProductionSheetScreen));
    expect(screen.spec, same(vmcSpec));
    expect(api.called('GET', vmcSpec.api.list), isNotEmpty);
    expect(api.called('GET', cncSpec.api.list), isEmpty);

    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();
    expect(find.byType(ProductionSheetScreen), findsNothing);
    expect(card('VMC'), findsOneWidget);
  });

  testWidgets('a single available process still shows as one card', (tester) async {
    setup();
    await pumpHub(tester, roles: [view('mp')]);
    expect(card('PRESS'), findsOneWidget);
    expect(find.byType(Card), findsOneWidget);
  });

  testWidgets('no data-entry access shows the explanation', (tester) async {
    setup();
    await pumpHub(tester, roles: [view('md')]);
    expect(find.text('No data entry access yet — ask your administrator.'), findsOneWidget);
    expect(find.byType(Card), findsNothing);
  });

  testWidgets('a failed load shows the error with Try again, which recovers', (tester) async {
    final api = setup();
    var fail = true;
    api.on('GET', '/api/v1/processes', (_) {
      if (fail) throw Exception('boom');
      return {'isOk': true, 'data': processes()};
    });
    await pumpHub(tester, admin: true);
    expect(find.byType(ErrorView), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(card('VMC'), findsOneWidget);
  });

  testWidgets('shows a skeleton while loading', (tester) async {
    setup();
    await pumpScreen(tester, const DataEntryHubScreen(), menus: menus, settle: false);
    expect(find.bySemanticsLabel('Loading processes'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(card('VMC'), findsOneWidget);
  });

  testWidgets('pull to refresh asks for the processes again', (tester) async {
    final api = setup();
    await pumpHub(tester, admin: true);
    expect(api.called('GET', '/api/v1/processes'), hasLength(1));
    await tester.fling(find.byType(ListView), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(api.called('GET', '/api/v1/processes'), hasLength(2));
  });

  group('layouts: no overflow', () {
    for (final c in <(String, Size, bool, double)>[
      ('320px', const Size(320, 640), false, 1),
      ('tablet', const Size(1024, 768), false, 1),
      ('dark', const Size(390, 844), true, 1),
      ('text scale 1.6', const Size(320, 640), false, 1.6),
      ('tablet text scale 1.6 dark', const Size(820, 1180), true, 1.6),
    ]) {
      testWidgets(c.$1, (tester) async {
        setup();
        await pumpHub(tester, admin: true, size: c.$2, dark: c.$3, textScale: c.$4);
        expect(card('VMC'), findsOneWidget);
        expect(card('ROLL'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('a tablet lays the cards out in a grid, a phone in one column', (tester) async {
      setup();
      await pumpHub(tester, admin: true, size: const Size(1024, 768));
      expect(tester.getTopLeft(card('VMC')).dy, tester.getTopLeft(card('PRESS')).dy);
      await pumpHub(tester, admin: true);
      expect(tester.getTopLeft(card('VMC')).dy, lessThan(tester.getTopLeft(card('PRESS')).dy));
    });
  });

  group('route access and the bottom tab', () {
    Future<void> pumpShell(WidgetTester tester, {required bool admin, List<Map<String, dynamic>> roles = const []}) =>
        pumpScreen(tester, const MainShell(), user: testUser(superAdmin: admin), menus: menus, roles: roles);

    testWidgets('the Data entry tab opens the hub, not CNC', (tester) async {
      final api = setup();
      await pumpShell(tester, admin: true);
      await tester.tap(find.text('Data entry').last);
      await tester.pumpAndSettle();
      expect(find.byType(DataEntryHubScreen), findsOneWidget);
      expect(find.byType(ProductionSheetScreen), findsNothing);
      expect(api.called('GET', cncSpec.api.list), isEmpty);
    });

    testWidgets('the tab is hidden when the person can open no data-entry page', (tester) async {
      setup();
      await pumpShell(tester, admin: false, roles: [view('md'), view('mb')]);
      expect(find.byType(NavigationBar), findsNothing); // a single tab: no bar
      expect(find.byType(ProductionDashboardScreen), findsOneWidget);
      expect(find.byType(DataEntryHubScreen), findsNothing);
    });

    testWidgets('the tab shows when any process page is viewable', (tester) async {
      setup();
      await pumpShell(tester, admin: false, roles: [view('md'), view('mp')]);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.text('Data entry'), findsOneWidget);
    });

    testWidgets('PageAccess: hub follows the process pages; the old CNC alias still opens CNC', (tester) async {
      setup();
      await pumpShell(tester, admin: false, roles: [view('mp')]);
      final menu = tester.element(find.byType(MainShell));
      final m = menu.read<MenuProvider>();
      final u = menu.read<AuthProvider>().user;
      expect(PageAccess.canOpen(u, m, dataEntryHubPath), isTrue);
      expect(PageAccess.canOpen(u, m, '/production/data-entry'), isFalse); // CNC itself not granted
      expect(AppRoutes.match('/hqepl/production/data-entry')?.path, '/production/cnc-data-entry');
      expect(AppRoutes.match('/production/data-entry-hub')?.path, dataEntryHubPath);
    });

    testWidgets('AppNav with the old CNC alias pushes the CNC screen over the hub', (tester) async {
      final api = setup();
      await pumpShell(tester, admin: true);
      AppNav.go(tester.element(find.byType(MainShell)), '/production/data-entry');
      await tester.pumpAndSettle();
      expect(tester.widget<ProductionSheetScreen>(find.byType(ProductionSheetScreen)).spec, same(cncSpec));
      expect(api.called('GET', cncSpec.api.list), isNotEmpty);
    });
  });
}
