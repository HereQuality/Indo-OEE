import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// The Dashboard tab's layouts: the web portal's grid on an iPad, one column
/// on a phone.
void main() {
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  const charts = ['oeeTrend', 'runTimeByOperator', 'downtimeByMachine', 'runTimeByMachine'];
  const stats = ['totalQty', 'okQty', 'rejectedQty', 'okPct'];

  Finder card(String key) => find.byKey(ValueKey('chart:$key'));
  Finder kpi(String key) => find.byKey(ValueKey('kpi:$key'));

  Future<void> pumpTab(WidgetTester tester, Size size, {bool dark = false, double textScale = 1.0, List<String> chartKeys = charts, bool defaults = false}) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: defaults ? null : processesFixture(vmcStats: stats, vmcCharts: chartKeys));
    await pumpScreen(tester, const ProductionDashboardScreen(), size: size, dark: dark, textScale: textScale);
  }

  testWidgets('iPad landscape 1024x768: one-row header, KPI grid and the 12-column chart grid across the full width', (tester) async {
    await pumpTab(tester, const Size(1024, 768));

    // Header bar: process tabs, period, Filters, Customize on ONE row.
    final vmcY = tester.getCenter(find.text('VMC')).dy;
    expect((tester.getCenter(find.text('September 2026')).dy - vmcY).abs(), lessThan(8));
    expect((tester.getCenter(find.text('Filters')).dy - vmcY).abs(), lessThan(8));
    expect((tester.getCenter(find.text('Customize')).dy - vmcY).abs(), lessThan(8));

    // KPI tiles fill the width in one row.
    final tiles = [for (final k in stats) tester.getRect(kpi(k))];
    expect(tiles.map((r) => r.top).toSet(), hasLength(1));
    expect(tiles.first.left, 20);
    expect(tiles.last.right, closeTo(1004, 0.5));

    // oeeTrend is `lg` (8/12), runTimeByOperator `sm` (4/12): side by side.
    final a = tester.getRect(card('oeeTrend'));
    final b = tester.getRect(card('runTimeByOperator'));
    expect(a.top, b.top);
    expect(a.height, b.height); // rows share one height
    expect(a.left, 20);
    expect(b.right, closeTo(1004, 0.5));
    expect(a.width, closeTo(652, 1));
    expect(b.width, closeTo(320, 1));
    expect(a.width, greaterThan(400)); // no 720 px cap, no phone column
    expect(tester.takeException(), isNull);
  });

  testWidgets('iPad portrait 820x1180: sm/md cards take half, lg takes the row', (tester) async {
    await pumpTab(tester, const Size(820, 1180));

    final trend = tester.getRect(card('oeeTrend'));
    expect(trend.width, closeTo(780, 1)); // lg -> full row below 940 px
    // sm (6/12) has no lg partner, so the next md card backfills its row.
    final sm = tester.getRect(card('runTimeByOperator'));
    final md = tester.getRect(card('downtimeByMachine'));
    expect(sm.width, closeTo(384, 1));
    expect(md.width, closeTo(384, 1));
    expect(sm.top, greaterThan(trend.bottom - 1));
    expect(md.top, sm.top);
    expect(md.left, closeTo(sm.right + 12, 1));
    expect(sm.height, md.height);
    expect(tester.takeException(), isNull);
  });

  testWidgets('iPad portrait backfills a half-width gap instead of leaving it empty', (tester) async {
    await pumpTab(tester, const Size(820, 1180), chartKeys: ['runTimeByOperator', 'oeeTrend', 'downtimeByMachine']);
    final sm = tester.getRect(card('runTimeByOperator'));
    final md = tester.getRect(card('downtimeByMachine'));
    final trend = tester.getRect(card('oeeTrend'));
    expect(md.top, sm.top); // the later md card moved up beside the sm card
    expect(trend.top, greaterThan(sm.bottom));
    expect(tester.takeException(), isNull);
  });

  testWidgets('phone 390x844: one column, 2-column KPI tiles, chart cards stacked', (tester) async {
    await pumpTab(tester, const Size(390, 844));
    final t1 = tester.getRect(kpi('totalQty'));
    final t2 = tester.getRect(kpi('okQty'));
    final t3 = tester.getRect(kpi('rejectedQty'));
    expect(t1.top, t2.top);
    expect(t3.top, greaterThan(t1.bottom));

    final trend = tester.getRect(card('oeeTrend'));
    expect(trend.left, 16);
    expect(trend.right, 374);
    // The header stays compact: chips + period row.
    expect(tester.getRect(find.text('September 2026')).top, lessThan(200));
    expect(tester.takeException(), isNull);
  });

  testWidgets('dark + text 1.6x: iPad and phone with the real default charts do not overflow', (tester) async {
    await pumpTab(tester, const Size(1024, 768), dark: true, textScale: 1.6, defaults: true);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -2500));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await pumpTab(tester, const Size(360, 640), dark: true, textScale: 1.6, defaults: true);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -2500));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
