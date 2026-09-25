import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/widgets/states.dart';
import 'package:indo/features/production/dashboard/data/dashboard_repository.dart';
import 'package:indo/features/production/dashboard/sheets/customize_sheet.dart';
import 'package:indo/features/production/dashboard/widgets/kpi_tile.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// The Dashboard tab: it opens straight on a dashboard (no process list), with
/// a process chip row on top.
void main() {
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  Finder chip(String label) => find.widgetWithText(InkWell, label);

  group('tab', () {
    testWidgets('opens on the first process with machines: chips on top, its dashboard below', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpScreen(tester, const ProductionDashboardScreen());

      expect(find.text('Select a process to open its dashboard'), findsNothing);
      expect(chip('VMC'), findsOneWidget);
      expect(chip('PRESS'), findsOneWidget);
      expect(chip('All machines'), findsOneWidget);
      expect(find.text('Total QTY'), findsOneWidget); // the dashboard is already there
      expect(find.text('September 2026'), findsOneWidget);
      expect(api.called('GET', '/api/v1/processes/entries').single.query, {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc});
      expect(api.misses, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('switching chips is instant for a process already loaded, and the choice is remembered', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpScreen(tester, const ProductionDashboardScreen());
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(1));

      await tester.tap(chip('All machines'));
      await tester.pumpAndSettle();
      final all = api.called('GET', '/api/v1/processes/entries').toList();
      expect(all, hasLength(2));
      expect(all.last.query, {'from': '2026-09-01', 'to': '2026-09-30'});
      expect((await SharedPreferences.getInstance()).getString(DashboardRepository.lastProcessKey), DashboardRepository.allMachinesChoice);

      // Back to VMC: served from what is already loaded — no new request.
      await tester.tap(chip('VMC'));
      await tester.pumpAndSettle();
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(2));
      expect(find.text('Total QTY'), findsOneWidget);
      expect((await SharedPreferences.getInstance()).getString(DashboardRepository.lastProcessKey), processVmc);
    });

    testWidgets('reopens on the last chosen process', (tester) async {
      SharedPreferences.setMockInitialValues({DashboardRepository.lastProcessKey: processPress});
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpScreen(tester, const ProductionDashboardScreen());
      expect(api.called('GET', '/api/v1/processes/entries').single.query['process'], processPress);
    });

    testWidgets('a process without machines is not offered; with no processes only All machines is', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: const [], machines: [machineJson('m1', '7A')]);
      await pumpScreen(tester, const ProductionDashboardScreen());
      expect(chip('All machines'), findsOneWidget);
      expect(chip('VMC'), findsNothing);
      expect(api.called('GET', '/api/v1/processes/entries').single.query.containsKey('process'), isFalse);
    });

    testWidgets('no processes and no machines: only the empty message', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: const [], machines: const []);
      await pumpScreen(tester, const ProductionDashboardScreen());
      expect(find.textContaining('No processes yet'), findsOneWidget);
      expect(api.called('GET', '/api/v1/processes/entries'), isEmpty);
    });

    testWidgets('a failed load shows the error with Try again, which reloads', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      var fail = true;
      api.on('GET', '/api/v1/processes', (_) {
        if (fail) return FakeResponse({'isOk': false, 'message': 'Server is down'}, status: 500);
        return {'isOk': true, 'data': processesFixture()};
      });
      await pumpScreen(tester, const ProductionDashboardScreen());
      expect(find.byType(ErrorView), findsOneWidget);
      expect(find.text('Server is down'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.byType(ErrorView), findsNothing);
      expect(chip('VMC'), findsOneWidget);
      expect(find.text('Total QTY'), findsOneWidget);
    });

    testWidgets('the phone app bar has Customize for a SuperAdmin (not for an Operator)', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpScreen(tester, const ProductionDashboardScreen());
      await tester.tap(find.byTooltip('Customize'));
      await tester.pumpAndSettle();
      expect(find.byType(CustomizeSheet), findsOneWidget);
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(api.called('PUT', '/api/v1/processes/$processVmc').single.body, {'stats': ['totalQty'], 'charts': <String>[]});

      final api2 = FakeApi.install();
      installDashboardApi(api2);
      await pumpScreen(tester, const ProductionDashboardScreen(), user: testUser(superAdmin: false));
      expect(find.byTooltip('Customize'), findsNothing);
    });

    testWidgets('pull to refresh reloads the dashboard and the process list', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpScreen(tester, const ProductionDashboardScreen());
      final before = api.called('GET', '/api/v1/processes').length;
      await tester.fling(find.byType(CustomScrollView), const Offset(0, 320), 1000);
      await tester.pumpAndSettle();
      expect(api.called('GET', '/api/v1/processes').length, before + 1);
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(2));
    });
  });

  group('adaptive', () {
    testWidgets('dark, 360x640, text 1.6x', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpScreen(tester, const ProductionDashboardScreen(), dark: true, size: const Size(360, 640), textScale: 1.6);
      expect(chip('VMC'), findsOneWidget);
      expect(find.byType(KpiTile), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });
}
