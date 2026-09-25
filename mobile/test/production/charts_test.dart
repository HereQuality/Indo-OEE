import 'package:fl_chart/fl_chart.dart' show BarChart;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_kit.dart' show ChartEmpty;
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/charts/charts_registry.dart';
import 'package:indo/features/production/dashboard/charts/run_time_treemap.dart';
import 'package:indo/features/production/dashboard/charts/treemap_layout.dart';
import 'package:indo/features/production/dashboard/charts/unreported_chart.dart';

import '../support/fake_api.dart';

Map<String, dynamic> _row(
  String id, {
  String date = '2026-09-01',
  String machine = 'm1',
  String operator = 'Asha',
  String itemName = 'Bracket',
  int cycle = 36,
  int actual = 700,
  int ok = 690,
  Map<String, dynamic>? reject,
  int lunch = 30,
  int setup = 10,
  int bd = 20,
}) =>
    {
      '_id': id,
      'date': date,
      'machine': machine,
      'slot': 1,
      'operator': operator,
      'item': 'i-$itemName',
      'itemName': itemName,
      'totalCycleSec': cycle,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': actual,
      'okQty': ok,
      'rejectedQty': actual - ok,
      'rejectBreakdown': reject ?? {'Dimension Out': actual - ok},
      'plannedOperatorShiftHours': 8,
      'lunchMin': lunch,
      'setupMin': setup,
      'bdMechMin': bd,
    };

/// 3 machines x 5 days, two operators, two parts.
List<Map<String, dynamic>> _rows() {
  final out = <Map<String, dynamic>>[];
  var n = 0;
  for (var d = 1; d <= 5; d++) {
    for (final m in ['m1', 'm2', 'm3']) {
      n++;
      out.add(_row(
        'e$n',
        date: '2026-09-0$d',
        machine: m,
        operator: n.isEven ? 'Ravi' : 'Asha',
        itemName: m == 'm2' ? 'Flange' : 'Bracket',
        actual: 600 + n * 10,
        ok: 590 + n * 9,
        reject: n % 4 == 0 ? {'Dimension Out': n, 'Other': n} : null,
        setup: 5 + n,
      ));
    }
  }
  return out;
}

DashboardCtx _ctx([int machines = 3]) => DashboardCtx(
      machineName: {for (var i = 1; i <= machines; i++) 'm$i': i <= 3 ? const ['7A', '7B', 'P1'][i - 1] : 'M$i'},
      machineOrder: {for (var i = 1; i <= machines; i++) 'm$i': i - 1},
      bucket: 'date',
    );

class _Calls {
  final toggles = <(String, String)>[];
  final drills = <Map<String, dynamic>>[];
}

Future<void> _pump(
  WidgetTester t,
  String chart, {
  List<Map<String, dynamic>>? rows,
  DashboardCtx? ctx,
  ChartView view = ChartView.chart,
  bool expanded = false,
  bool dark = false,
  Size size = const Size(360, 640),
  double scale = 1.0,
  Map<String, List<String>> filters = const {},
  _Calls? calls,
}) async {
  final data = rows ?? _rows();
  final c = ctx ?? _ctx();
  await pumpScreen(
    t,
    Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Builder(
          builder: (context) {
            final body = Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: dashboardCharts[chart]!(DashboardChartProps(
                  rowsFor: (_) => data,
                  ctx: c,
                  colors: DashboardColors.of(context),
                  filters: filters,
                  onToggle: (d, k) => calls?.toggles.add((d, k)),
                  onDrill: (m) => calls?.drills.add(m),
                  view: view,
                  expanded: expanded,
                )),
              ),
            );
            return expanded ? body : Align(alignment: Alignment.topCenter, child: SizedBox(height: 300, child: body));
          },
        ),
      ),
    ),
    dark: dark,
    size: size,
    textScale: scale,
  );
}

void main() {
  test('registry exposes the 11 charts and the table-only set', () {
    expect(dashboardCharts.keys.toSet(), {
      'oeeTrend', 'runTimeByOperator', 'downtimeByMachine', 'runTimeByMachine', 'unreportedByMachine',
      'okRejectedTrend', 'oeeByMachine', 'rejectByReason', 'okPctByOperator', 'outputByItem', 'machineSummary',
    });
    expect(tableOnlyCharts, {'machineSummary'});
  });

  for (final dark in [false, true]) {
    testWidgets('every chart renders in chart and table view (${dark ? 'dark' : 'light'})', (t) async {
      for (final key in dashboardCharts.keys) {
        for (final view in ChartView.values) {
          await _pump(t, key, view: view, dark: dark);
          expect(t.takeException(), isNull, reason: '$key $view');
          expect(find.byType(ChartEmpty), findsNothing, reason: '$key $view has data');
        }
      }
    });
  }

  testWidgets('key texts and the web empty-state messages', (t) async {
    await _pump(t, 'runTimeByOperator');
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Ravi'), findsOneWidget);
    await _pump(t, 'runTimeByOperator', view: ChartView.table);
    expect(find.text('EFFECTIVE RUN TIME'), findsOneWidget);
    await _pump(t, 'machineSummary');
    expect(find.text('7A'), findsOneWidget);
    expect(find.text('MACHINE'), findsOneWidget);
    expect(find.text('% REJECTED'), findsOneWidget);
    expect(find.text('OEE · LUNCH + SETUP TIME'), findsOneWidget);
    await _pump(t, 'downtimeByMachine');
    expect(find.text('Breakdown (Mech + Ele)'), findsOneWidget);
    await _pump(t, 'oeeTrend');
    expect(find.text('Considering losses'), findsOneWidget);
    // A hidden series is struck through, not removed: tapping twice restores it.
    await t.tap(find.text('Lunch only'));
    await t.pump(const Duration(milliseconds: 300));
    await t.tap(find.text('Lunch only'));
    await t.pump(const Duration(milliseconds: 300));
    expect(t.takeException(), isNull);

    const empty = {
      'oeeTrend': 'Needs machine ON/OFF times and OK quantity.',
      'runTimeByOperator': 'Needs cycle time and OK quantity.',
      'downtimeByMachine': 'No downtime recorded.',
      'runTimeByMachine': 'Needs cycle time and OK quantity.',
      'unreportedByMachine': 'Needs machine ON/OFF times.',
      'okRejectedTrend': 'No quantities entered for this period.',
      'oeeByMachine': 'Needs machine ON/OFF times and OK quantity.',
      'rejectByReason': 'Nothing rejected in this period.',
      'okPctByOperator': 'No quantities entered.',
      'outputByItem': 'No OK quantity entered.',
      'machineSummary': 'No entries for this period.',
    };
    for (final e in empty.entries) {
      await _pump(t, e.key, rows: const []);
      expect(find.text(e.value), findsOneWidget, reason: e.key);
      expect(t.takeException(), isNull, reason: e.key);
    }
  });

  testWidgets('tapping a mark cross-filters with the right (dim, key)', (t) async {
    final calls = _Calls();
    await _pump(t, 'runTimeByOperator', calls: calls);
    await t.tap(find.text('Asha'));
    await _pump(t, 'outputByItem', calls: calls);
    await t.tap(find.text('Flange'));
    await _pump(t, 'oeeByMachine', view: ChartView.table, calls: calls);
    await t.tap(find.text('7B'));
    await _pump(t, 'machineSummary', calls: calls);
    await t.tap(find.text('P1'));
    await _pump(t, 'unreportedByMachine', calls: calls);
    await t.tap(find.textContaining('7A').first);
    await _pump(t, 'runTimeByMachine', calls: calls);
    await t.tapAt(t.getTopLeft(find.byType(TreemapView)) + const Offset(4, 4));
    expect(calls.toggles.take(5).toList(), [
      ('operator', 'Asha'),
      ('item', 'Flange'),
      ('machine', 'm2'),
      ('machine', 'm3'),
      ('machine', 'm1'),
    ]);
    expect(calls.toggles.last.$1, 'machine');
    expect(calls.toggles, hasLength(6));

    // fl_chart bars: a tap anywhere in a day's column cross-filters that day.
    await _pump(t, 'okRejectedTrend', calls: calls);
    await t.tapAt(t.getCenter(find.byType(BarChart)));
    await t.pump(const Duration(milliseconds: 400));
    expect(calls.toggles, hasLength(7));
    expect(calls.toggles.last.$1, 'date');

    // Reject reasons are not a dashboard dimension: tapping opens the drill-down.
    await _pump(t, 'rejectByReason', calls: calls);
    await t.tap(find.text('Dimension Out'));
    expect(calls.drills.single['key'], 'reason:Dimension Out');
    expect(t.takeException(), isNull);
  });

  testWidgets('cards keep the top 12 bars, maximize shows all', (t) async {
    final rows = [
      for (var i = 1; i <= 15; i++) _row('o$i', operator: 'Op${i.toString().padLeft(2, '0')}', ok: 300 + i * 10, actual: 700),
    ];
    await _pump(t, 'runTimeByOperator', rows: rows);
    expect(find.textContaining('more — maximize to see all'), findsOneWidget);
    expect(find.text('Op15'), findsOneWidget); // largest first
    expect(find.text('Op01'), findsNothing); // smallest is cut
    await _pump(t, 'runTimeByOperator', rows: rows, expanded: true, size: const Size(390, 900));
    expect(find.textContaining('more — maximize to see all'), findsNothing);
    expect(find.text('Op01'), findsOneWidget);
    expect(t.takeException(), isNull);
  });

  test('treemap tiles fill the stage without overlapping; panels grid follows the machine count', () {
    final cells = squarify([50, 30, 10, 5, 5], const Rect.fromLTWH(0, 0, 300, 200));
    expect(cells, hasLength(5));
    expect(cells.fold<double>(0, (s, c) => s + c.rect.width * c.rect.height), closeTo(300 * 200, 0.5));
    for (var i = 0; i < cells.length; i++) {
      for (var j = i + 1; j < cells.length; j++) {
        final inter = cells[i].rect.intersect(cells[j].rect);
        expect(inter.width <= 0.001 || inter.height <= 0.001, isTrue);
      }
    }
    expect(fitGrid(3, 900, 300)!.cols, 3);
    expect(fitGrid(6, 900, 400), (cols: 3, rows: 2));
  });

  testWidgets('small multiples: 1, 5 and 9 machines lay out without overflow', (t) async {
    for (final n in [1, 5, 9]) {
      final rows = [
        for (var m = 1; m <= n; m++)
          for (var d = 1; d <= 3; d++) _row('u$m$d', date: '2026-09-0$d', machine: 'm$m', ok: 600 + m * 5),
      ];
      await _pump(t, 'unreportedByMachine', rows: rows, ctx: _ctx(n));
      expect(t.takeException(), isNull, reason: '$n machines');
      await _pump(t, 'unreportedByMachine', rows: rows, ctx: _ctx(n), expanded: true, dark: true);
      expect(t.takeException(), isNull, reason: '$n machines expanded');
    }
  });

  testWidgets('smoke: dark, 360x640, text scale 1.6, every chart, view and expanded', (t) async {
    for (final key in dashboardCharts.keys) {
      for (final view in ChartView.values) {
        for (final expanded in [false, true]) {
          await _pump(t, key, view: view, expanded: expanded, dark: true, scale: 1.6, filters: const {
            'machine': ['m1'],
            'operator': ['Asha'],
            'date': ['2026-09-02'],
          });
          expect(t.takeException(), isNull, reason: '$key $view expanded=$expanded');
        }
      }
    }
    // Landscape phone.
    await _pump(t, 'oeeTrend', size: const Size(640, 360), scale: 1.6);
    expect(t.takeException(), isNull);
  });
}
