import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/widgets/states.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/data/dashboard_repository.dart';
import 'package:indo/features/production/dashboard/data/processes_controller.dart';
import 'package:indo/features/production/dashboard/sheets/customize_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/date_range_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/filter_sheet.dart';
import 'package:indo/features/production/dashboard/shell/process_dashboard_page.dart';
import 'package:indo/features/production/dashboard/widgets/skeleton.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// A stand-in chart that shows what the shell handed it, so the tests can
/// assert on props (rows, view, expanded) and drive the callbacks.
class _FakeChart extends StatelessWidget {
  const _FakeChart(this.name, this.props);
  final String name;
  final DashboardChartProps props;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$name view=${props.view.name} expanded=${props.expanded} rows=${props.rowsFor(null).length} machineRows=${props.rowsFor('machine').length}'),
        TextButton(onPressed: () => props.onToggle('machine', 'm1'), child: const Text('toggle 7A')),
        TextButton(onPressed: () => props.onDrill(eng.causeMeasure('setupMin')), child: const Text('drill setup')),
      ],
    );
  }
}

final Map<String, DashboardChartBuilder> fakeCharts = {
  for (final k in eng.chartsByKey.keys) k: (p) => _FakeChart(k, p),
};

/// Loads the process list the way the landing page does, then shows the
/// dashboard of [processId] (null = All machines) over it.
Future<ProcessesController> pumpDashboard(
  WidgetTester tester, {
  String? processId = processVmc,
  bool superAdmin = true,
  bool dark = false,
  Size size = const Size(390, 844),
  double textScale = 1.0,
  bool settle = true,
  bool realCharts = false,
}) async {
  final processes = ProcessesController();
  await tester.runAsync(processes.load);
  await pumpScreen(
    tester,
    ProcessDashboardPage(
      processId: processId,
      processes: processes,
      chartRegistry: realCharts ? null : fakeCharts,
      tableOnlyKeys: realCharts ? null : const {'machineSummary'},
    ),
    user: testUser(superAdmin: superAdmin),
    dark: dark,
    size: size,
    textScale: textScale,
    settle: settle,
  );
  return processes;
}

Finder tile(String key) => find.byKey(ValueKey('kpi:$key'));
Finder tileValue(String key, String text) => find.descendant(of: tile(key), matching: find.text(text));

String qty(num v) => eng.formats['qty']!(v);

void main() {
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  group('loading and KPI tiles', () {
    testWidgets('requests this month for the process and shows the KPI figures', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty', 'rejectedQty', 'okPct'], vmcCharts: []));
      await pumpDashboard(tester);

      expect(api.called('GET', '/api/v1/processes/entries').single.query, {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc});
      expect(find.text('September 2026'), findsOneWidget);
      expect(find.text('3 entries'), findsOneWidget);

      expect(tileValue('totalQty', qty(1700)), findsOneWidget);
      expect(tileValue('okQty', qty(1670)), findsOneWidget);
      expect(tileValue('rejectedQty', qty(30)), findsOneWidget);
      expect(tileValue('okPct', eng.formats['pct']!(1670 / 1700)), findsOneWidget);
      expect(find.text('Total QTY'), findsOneWidget);
      expect(find.text('Actual quantity produced'), findsOneWidget);
      expect(api.misses, isEmpty);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a never-customised process shows the default tiles and graphs', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpDashboard(tester);
      for (final k in eng.defaultStats.take(4)) {
        expect(tile(k), findsOneWidget, reason: k);
      }
      // First default graph, in default order, framed by its card.
      expect(find.text('Effective Machine Run Time (Hour) by Operator'), findsOneWidget);
      expect(find.textContaining('runTimeByOperator view=chart'), findsOneWidget);
    });

    testWidgets('an emptied selection says so', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: [], vmcCharts: []));
      await pumpDashboard(tester);
      expect(find.textContaining('No KPI tiles or graphs are selected'), findsOneWidget);
      expect(find.text('Customize'), findsWidgets); // the action for SuperAdmin
    });

    testWidgets('shows a skeleton while the entries load', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester, settle: false);
      expect(find.byType(KpiTileSkeleton), findsWidgets);
      await tester.pumpAndSettle();
      expect(find.byType(KpiTileSkeleton), findsNothing);
      expect(tile('totalQty'), findsOneWidget);
    });

    testWidgets('no entries in the period: message, data extent, Change period', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (_) => {
            'isOk': true,
            'data': <Map<String, dynamic>>[],
            'extent': {'from': '2026-01-05', 'to': '2026-08-14'},
            'machineNames': <String, String>{},
          });
      await pumpDashboard(tester);
      expect(find.text('No entries for VMC in September 2026.'), findsOneWidget);
      expect(find.textContaining(eng.describeRange(['2026-01-05', '2026-01-05'])), findsOneWidget);
      expect(find.textContaining(eng.describeRange(['2026-08-14', '2026-08-14'])), findsOneWidget);
      await tester.tap(find.text('Change period'));
      await tester.pumpAndSettle();
      expect(find.byType(DateRangeSheet), findsOneWidget);
    });

    testWidgets('a process without machines says to assign some', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(
        api,
        processes: [
          {'_id': processVmc, 'processName': 'VMC', 'machines': <Map<String, dynamic>>[]},
        ],
        entries: (_) => {'isOk': true, 'data': <Map<String, dynamic>>[], 'extent': null, 'machineNames': <String, String>{}},
      );
      await pumpDashboard(tester);
      expect(find.textContaining('has no machines yet'), findsOneWidget);
    });

    testWidgets('a failed load shows the server message; Try again reloads', (tester) async {
      final api = FakeApi.install();
      var fail = true;
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []), entries: (_) {
        if (fail) return FakeResponse({'isOk': false, 'message': 'Database unavailable'}, status: 500);
        return {'isOk': true, 'data': entriesFixture(), 'extent': null, 'machineNames': <String, String>{}};
      });
      await pumpDashboard(tester);
      expect(find.byType(ErrorView), findsOneWidget);
      expect(find.text('Database unavailable'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.byType(ErrorView), findsNothing);
      expect(tileValue('totalQty', qty(1700)), findsOneWidget);
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(2));
    });

    testWidgets('pull to refresh reloads the entries and the process list', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester);
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(1));
      final before = api.called('GET', '/api/v1/processes').length;

      await tester.fling(find.byType(CustomScrollView), const Offset(0, 320), 1000);
      await tester.pumpAndSettle();
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(2));
      expect(api.called('GET', '/api/v1/processes').length, before + 1);
      expect(tileValue('totalQty', qty(1700)), findsOneWidget);
    });

    testWidgets('a process removed while the dashboard is open shows a way back', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final processes = await pumpDashboard(tester);
      installDashboardApi(api, processes: [processesFixture()[1]]);
      await tester.runAsync(() => processes.load(silent: true));
      await tester.pumpAndSettle();
      expect(find.text('This process is no longer available.'), findsOneWidget);
    });
  });

  group('cross-filtering', () {
    testWidgets('a bar tap filters every tile and chart; the chip removes it; Clear all resets', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester);
      expect(find.textContaining('rows=3 machineRows=3'), findsOneWidget);

      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7A'), findsOneWidget);
      expect(tileValue('totalQty', qty(1300)), findsOneWidget);
      expect(find.text('2 of 3 entries'), findsOneWidget);
      // The chart that owns the dimension keeps all its marks.
      expect(find.textContaining('rows=2 machineRows=3'), findsOneWidget);
      expect(find.text('Clear all'), findsOneWidget);

      await tester.tap(find.text('Machine: 7A'));
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7A'), findsNothing);
      expect(tileValue('totalQty', qty(1700)), findsOneWidget);

      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Clear all'));
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7A'), findsNothing);
      expect(find.text('Clear all'), findsNothing);
      expect(tileValue('totalQty', qty(1700)), findsOneWidget);
      // Cross-filtering is client-side: no extra request.
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(1));
    });

    testWidgets('filters that exclude everything say so, with a way out', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester);
      // Asha on 7B has no entries -> pick machine 7A and operator Ravi... e2 is Ravi on 7A, so use an operator nobody has.
      final c = await _controllerOf(tester);
      c.setFilter('operator', ['Nobody']);
      await tester.pumpAndSettle();
      expect(find.text('No entries match these filters.'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Clear all').first);
      await tester.pumpAndSettle();
      expect(find.text('No entries match these filters.'), findsNothing);
    });

    testWidgets('the Filters button opens the sheet and shows the active-count badge', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester);

      await tester.tap(find.text('Filters'));
      await tester.pumpAndSettle();
      expect(find.byType(FilterSheet), findsOneWidget);
      await tester.tapAt(const Offset(200, 20)); // scrim
      await tester.pumpAndSettle();
      expect(find.byType(FilterSheet), findsNothing);

      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byType(Badge), matching: find.text('1')), findsOneWidget);
    });
  });

  group('period', () {
    testWidgets('picking a month in the sheet reloads that period and drops date filters', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester);

      await tester.tap(find.text('September 2026'));
      await tester.pumpAndSettle();
      expect(find.byType(DateRangeSheet), findsOneWidget);
      await tester.tap(find.text('Aug'));
      await tester.pumpAndSettle();

      final reqs = api.called('GET', '/api/v1/processes/entries').toList();
      expect(reqs, hasLength(2));
      expect(reqs.last.query, {'from': '2026-08-01', 'to': '2026-08-31', 'process': processVmc});
      // August is "Last month" from September, and a quick range keeps its own name.
      expect(find.text('Last month'), findsOneWidget);
      // Not the default period any more, so the chip offers a reset.
      expect(find.byTooltip('Reset the period to this month'), findsOneWidget);

      await tester.tap(find.byTooltip('Reset the period to this month'));
      await tester.pumpAndSettle();
      expect(api.called('GET', '/api/v1/processes/entries').last.query['from'], '2026-09-01');
      expect(find.text('September 2026'), findsOneWidget);
      expect(find.byTooltip('Reset the period to this month'), findsNothing);
    });

    testWidgets('a quick range keeps its own name on the chip', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester);
      await tester.tap(find.text('September 2026'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Date range'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Last 7 days'));
      await tester.pumpAndSettle();
      expect(api.called('GET', '/api/v1/processes/entries').last.query, {'from': '2026-09-09', 'to': '2026-09-15', 'process': processVmc});
      expect(find.text('Last 7 days'), findsOneWidget);
    });

    testWidgets('Clear all also puts the period back to this month', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester);
      final c = await _controllerOf(tester);
      c.setRange(['2026-08-01', '2026-08-31']);
      await tester.pumpAndSettle();
      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Clear all'));
      await tester.pumpAndSettle();
      expect(find.text('September 2026'), findsOneWidget);
      expect(api.called('GET', '/api/v1/processes/entries').last.query['from'], '2026-09-01');
    });
  });

  group('graph cards', () {
    testWidgets('title, hint, chart <-> table switch and the drill button', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['runTimeByOperator']));
      await pumpDashboard(tester);

      expect(find.text('Effective Machine Run Time (Hour) by Operator'), findsOneWidget);
      expect(find.text('Hours of effective run time each operator produced.'), findsOneWidget);
      expect(find.textContaining('view=chart'), findsOneWidget);

      await tester.tap(find.byTooltip('Show as table'));
      await tester.pumpAndSettle();
      expect(find.textContaining('view=table'), findsOneWidget);
      await tester.tap(find.byTooltip('Show as chart'));
      await tester.pumpAndSettle();
      expect(find.textContaining('view=chart'), findsOneWidget);

      await tester.tap(find.byTooltip('Break down by machine, operator, part, date'));
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsOneWidget);
      expect(find.text('Effective Machine Run Time'), findsWidgets);
    });

    testWidgets('a cause / reason bar opens its own breakdown through onDrill', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['downtimeByMachine']));
      await pumpDashboard(tester);
      await tester.tap(find.text('drill setup'));
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsOneWidget);
      expect(find.textContaining('Setup'), findsWidgets);
    });

    testWidgets('a table-only visual has no chart switch', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['machineSummary']));
      await pumpDashboard(tester);
      expect(find.byTooltip('Show as table'), findsNothing);
      expect(find.byTooltip('Show as chart'), findsNothing);
      expect(find.textContaining('view=table'), findsOneWidget);
      expect(find.byTooltip('Break down by machine, operator, part, date'), findsNothing); // no measure
    });

    testWidgets('Maximize opens a full-screen, expanded chart that still cross-filters', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester);

      await tester.tap(find.byTooltip('Maximize'));
      await tester.pumpAndSettle();
      expect(find.textContaining('expanded=true'), findsOneWidget);
      expect(find.byTooltip('Close'), findsOneWidget);

      // The maximised page has its own chart <-> table switch and opens on the chart.
      await tester.tap(find.byTooltip('Show as table'));
      await tester.pumpAndSettle();
      expect(find.textContaining('expanded=true'), findsOneWidget);
      expect(find.textContaining('view=table'), findsWidgets);

      // Tapping a bar filters the dashboard underneath, and the maximised chart follows.
      await tester.tap(find.text('toggle 7A').last);
      await tester.pumpAndSettle();
      expect(find.textContaining('rows=2 machineRows=3'), findsWidgets);

      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.textContaining('expanded=true'), findsNothing);
      expect(find.text('Machine: 7A'), findsOneWidget);
    });
  });

  group('drill-down', () {
    testWidgets('a KPI tile opens its breakdown; picking a row filters the dashboard to it', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester);

      await tester.tap(tile('totalQty'));
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsOneWidget);
      expect(find.text('Total QTY'), findsWidgets);

      await tester.tap(find.text('7B').last);
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsNothing);
      expect(find.text('Machine: 7B'), findsOneWidget);
      expect(tileValue('totalQty', qty(400)), findsOneWidget);
    });
  });

  group('customize', () {
    testWidgets('SuperAdmin saves the process selection: PUT /processes/:id with {stats, charts}', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester, size: const Size(1024, 768));

      await tester.tap(find.text('Customize'));
      await tester.pumpAndSettle();
      expect(find.byType(CustomizeSheet), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      final put = api.called('PUT', '/api/v1/processes/$processVmc').single;
      expect(put.body, {'stats': ['totalQty', 'okQty'], 'charts': ['oeeByMachine']});
      expect(find.byType(CustomizeSheet), findsNothing);
    });

    testWidgets('a rejected save leaves the sheet open', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      api.on('PUT', '/api/v1/processes/$processVmc', (_) => FakeResponse({'isOk': false, 'message': 'Nope'}, status: 400));
      await pumpDashboard(tester, size: const Size(1024, 768));
      await tester.tap(find.text('Customize'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(api.called('PUT', '/api/v1/processes/$processVmc'), hasLength(1));
      expect(find.byType(CustomizeSheet), findsOneWidget);
    });

    testWidgets('All machines keeps the selection on the device, never on the server', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpDashboard(tester, processId: null, size: const Size(1024, 768));
      await tester.tap(find.text('Customize'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(api.requests.where((r) => r.method == 'PUT'), isEmpty);
      final saved = await const DashboardRepository().loadAllMachinesWidgets();
      expect(saved?.stats, eng.defaultStats);
      expect(saved?.charts, eng.defaultCharts);
    });

    testWidgets('All machines reads a saved selection', (tester) async {
      SharedPreferences.setMockInitialValues({
        DashboardRepository.allMachinesWidgetsKey: '{"stats":["okQty"],"charts":[]}',
      });
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpDashboard(tester, processId: null);
      expect(tile('okQty'), findsOneWidget);
      expect(tile('totalQty'), findsNothing);
    });

    testWidgets('an Operator does not get Customize', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
      await pumpDashboard(tester, superAdmin: false, size: const Size(1024, 768));
      expect(tile('totalQty'), findsOneWidget);
      expect(find.text('Customize'), findsNothing);
    });
  });

  group('adaptive', () {
    testWidgets('dark mode', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty', 'oeeLunchCot'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester, dark: true);
      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7A'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('360x640 phone with every default tile and graph', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpDashboard(tester, size: const Size(360, 640));
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('text at 1.6x with the longest KPI label and filter chips', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['oeeLunchCot', 'oeeLunch', 'totalQty'], vmcCharts: ['runTimeByOperator']));
      await pumpDashboard(tester, size: const Size(360, 640), textScale: 1.6);
      expect(tester.takeException(), isNull);
      await tester.dragUntilVisible(find.text('toggle 7A'), find.byType(CustomScrollView), const Offset(0, -200));
      await tester.pumpAndSettle();
      await tester.tap(find.text('toggle 7A'));
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7A'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('landscape phone scrolls the control bar with the content', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty'], vmcCharts: ['oeeByMachine']));
      await pumpDashboard(tester, size: const Size(844, 390));
      expect(find.text('September 2026'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a tablet uses the full width (no 720 px cap)', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty', 'okQty', 'rejectedQty'], vmcCharts: ['oeeByMachine', 'machineSummary']));
      await pumpDashboard(tester, size: const Size(1024, 1366));
      // `full` fills the row; `md` is half of it — both far beyond the old 720 px cap.
      expect(tester.getSize(find.byKey(const ValueKey('chart:machineSummary'))).width, closeTo(984, 1));
      expect(tester.getSize(find.byKey(const ValueKey('chart:oeeByMachine'))).width, closeTo(486, 1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('the real chart widgets render inside the shell (light and dark, 360 wide)', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api);
      await pumpDashboard(tester, realCharts: true, size: const Size(360, 800));
      expect(tester.takeException(), isNull);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -1500));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await pumpDashboard(tester, realCharts: true, size: const Size(360, 800), dark: true);
      expect(tester.takeException(), isNull);
    });
  });
}

/// The controller behind the open dashboard page (tests poke state through it).
Future<dynamic> _controllerOf(WidgetTester tester) async {
  final state = tester.state(find.byType(ProcessDashboardPage));
  return (state as dynamic).debugController;
}
