// The web's newer KPI tiles (Unutilized, Availability, Performance, Quality)
// and graphs (apqTrend rings, unutilizedTrend, runTimeByMachineBars) plus the
// graphs that changed shape (B.D. Backup treemap, Downtime-by-Cause radar,
// Rejected-by-Reason donut): values, sizes, Customize.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_data.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/charts/charts_registry.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/sheets/customize_sheet.dart';

import '../support/fake_api.dart';
import 'dashboard_sheets_support.dart';

Map<String, dynamic> _row(String id, String date, String machine, {int ok = 690, int actual = 700, int bd = 20, int setup = 10, int lunch = 30}) => {
      '_id': id,
      'date': date,
      'machine': machine,
      'slot': 1,
      'operator': 'Asha',
      'item': 'i1',
      'itemName': 'Bracket',
      'totalCycleSec': 36,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': actual,
      'okQty': ok,
      'rejectedQty': actual - ok,
      'rejectBreakdown': {'Dimension Out': actual - ok},
      'plannedOperatorShiftHours': 8,
      'lunchMin': lunch,
      'setupMin': setup,
      'bdMechMin': bd,
    };

List<Map<String, dynamic>> _rows() => [
      for (var d = 1; d <= 4; d++)
        for (final m in ['m1', 'm2']) _row('$m$d', '2026-09-0$d', m, ok: 600 + d * 10, bd: m == 'm1' ? 20 : 45),
    ];

const _ctx = DashboardCtx(machineName: {'m1': '7A', 'm2': '7B'}, machineOrder: {'m1': 0, 'm2': 1}, bucket: 'date');

Future<void> _pump(WidgetTester t, String chart, List<Map<String, dynamic>> rows, {Size size = const Size(360, 640), ChartView view = ChartView.chart, bool expanded = false, double scale = 1, bool dark = false, double height = 264}) async {
  await pumpScreen(
    t,
    Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Builder(
          builder: (context) => Align(
            alignment: Alignment.topCenter,
            child: SizedBox(
              height: expanded ? null : height,
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: dashboardCharts[chart]!(DashboardChartProps(
                    rowsFor: (_) => rows,
                    ctx: _ctx,
                    colors: DashboardColors.of(context),
                    filters: const {},
                    onToggle: (_, _) {},
                    onDrill: (_) {},
                    view: view,
                    expanded: expanded,
                  )),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    size: size,
    textScale: scale,
    dark: dark,
  );
}

void main() {
  final rows = _rows();
  final s = eng.summarize(rows);

  test('summary carries the web figures and they are ratios of totals', () {
    for (final k in ['unutilized', 'oeeAvailability', 'oeePerformance', 'oeeQuality']) {
      expect(s[k], isA<double>(), reason: k);
    }
    // Quality = OK / actual over all entries.
    var ok = 0.0, total = 0.0;
    for (final r in rows) {
      ok += (r['okQty'] as int);
      total += (r['actualQty'] as int);
    }
    expect(s['oeeQuality'], closeTo(ok / total, 1e-12));
    expect(eng.formats['pct']!(s['oeeQuality'] as double), '${(ok / total * 100).toStringAsFixed(2)}%');
  });

  test('catalogs list the new tiles and graphs with the web defaults', () {
    expect(eng.statsByKey['unutilized']!['tone'], 'downtime');
    expect(eng.statsByKey['oeeQuality']!['tone'], 'ok');
    expect(eng.defaultStats, ['totalQty', 'okQty', 'rejectedQty', 'okPct', 'oeeLosses', 'oeeLunch', 'oeeLunchCot', 'unutilized']);
    expect(eng.defaultCharts, containsAll(['apqTrend', 'unutilizedTrend', 'runTimeByMachineBars']));
    expect(eng.chartsByKey['runTimeByMachine']!['label'], 'Downtime by Cause (min)');
    expect(eng.chartsByKey['downtimeByMachine']!['preview'], 'nestedTreemap');
    expect(eng.chartsByKey['rejectByReason']!['preview'], 'donut');
  });

  test('chart data: causes largest first, machines in sheet order, short lunch label', () {
    final causes = stoppageCauses(rows);
    expect(causes.map((c) => c.key).toList(), ['bdMechMin', 'lunchMin', 'setupMin']);
    expect(causes[1].label, 'Lunch / Tea');
    expect(causes[1].value, 8 * 30);
    expect(causes.first.value, 4 * 20 + 4 * 45);
    final machines = stoppageMachines(rows, _ctx);
    expect(machines.map((m) => m.label).toList(), ['7A', '7B']);
    expect(machines[1].causes.first.$1, 'bdMechMin'); // 45 min x 4 days = 180 > lunch 120
    expect(machines[1].groupTotal(eng.stoppageGroups.first), 180);
  });

  for (final size in [const Size(320, 640), const Size(360, 640), const Size(820, 1180)]) {
    for (final scale in [1.0, 1.6]) {
      testWidgets('new graphs render without overflow at ${size.width.toInt()} wide, text x$scale', (t) async {
        for (final key in ['apqTrend', 'unutilizedTrend', 'runTimeByMachineBars', 'runTimeByMachine', 'downtimeByMachine', 'rejectByReason']) {
          for (final view in ChartView.values) {
            for (final expanded in [false, true]) {
              await _pump(t, key, rows, size: size, view: view, scale: scale, expanded: expanded, dark: size.width == 360);
              expect(t.takeException(), isNull, reason: '$key $view expanded=$expanded');
            }
          }
        }
      });
    }
  }

  testWidgets('rings show the exact figures of the period and mark one over 100%', (t) async {
    await _pump(t, 'apqTrend', rows);
    for (final k in ['oeeAvailability', 'oeePerformance', 'oeeQuality']) {
      expect(find.textContaining('${((s[k] as double) * 100).toStringAsFixed(1)}%'), findsWidgets, reason: k);
    }
    expect(find.text('Availability'), findsOneWidget);
    expect(find.textContaining('A full ring is 100%'), findsOneWidget);
    // More OK than actual => Quality over 100%, flagged with the triangle.
    final over = [_row('o1', '2026-09-01', 'm1', ok: 720, actual: 700)];
    await _pump(t, 'apqTrend', over);
    final q = eng.summarize(over)['oeeQuality'] as double;
    expect(q, greaterThan(1));
    expect(find.text('${(q * 100).toStringAsFixed(1)}% ▲'), findsOneWidget);
    // Table view is the by-date numbers.
    await _pump(t, 'apqTrend', rows, view: ChartView.table);
    expect(find.text('AVAILABILITY'), findsOneWidget);
    expect(find.text('04/09/2026').evaluate().isNotEmpty || find.textContaining('2026').evaluate().isNotEmpty, isTrue);
  });

  testWidgets('machine run-time bars show hours per machine; table agrees', (t) async {
    await _pump(t, 'runTimeByMachineBars', rows);
    final hours = (eng.summarizeBy(rows, 'machine', _ctx).first['summary'] as Map)['effectiveHours'] as double;
    await _pump(t, 'runTimeByMachineBars', rows, view: ChartView.table);
    expect(find.text('EFFECTIVE RUN TIME'), findsOneWidget);
    expect(find.text(eng.formatExact('hours', hours)), findsWidgets);
  });

  testWidgets('unutilized trend and the radar table render real figures', (t) async {
    await _pump(t, 'unutilizedTrend', rows);
    expect(find.text('Unutilized machine time'), findsOneWidget);
    await _pump(t, 'runTimeByMachine', rows, view: ChartView.table);
    expect(find.text('7A'), findsOneWidget);
    expect(find.text('EFFECTIVE RUN TIME'), findsOneWidget);
    expect(find.text('LUNCH/TEA/WASH ROOM ETC. (MIN)'), findsOneWidget);
  });

  testWidgets('Customize lists the new tiles and graphs', (t) async {
    // A tall window builds every row of the lazy lists.
    await openSheet(t, (context) => showCustomizeSheet(context, stats: const ['totalQty'], charts: const ['oeeTrend'], onSave: (_, _) async {}), size: const Size(390, 9000));
    for (final label in ['Availability', 'Performance', 'Quality', 'Unutilized Machine Time']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    for (final label in [
      'OEE Components — Availability, Performance, Quality',
      'Unutilized Machine Time Trend',
      'Downtime by Cause (min)',
      'Effective Run Time by Machine (hr)',
    ]) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    expect(find.text('Operating Time ÷ Planned Production Time'), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}
