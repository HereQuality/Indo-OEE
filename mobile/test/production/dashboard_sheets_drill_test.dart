import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';

import 'dashboard_sheets_support.dart';

const _ctx = DashboardCtx(machineName: {'m1': '7A', 'm2': '7B'}, machineOrder: {'m1': 0, 'm2': 1}, bucket: 'date');

/// The tabs scroll sideways on a phone: bring one into view, then tap it.
Future<void> tapTab(WidgetTester tester, String label) async {
  await tester.ensureVisible(find.text(label));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  late List<String> picks;

  Future<void> open(
    WidgetTester tester, {
    List<Map<String, dynamic>>? rows,
    Map<String, dynamic>? measure,
    bool dark = false,
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    picks = [];
    final data = rows ?? drillRows();
    await openSheet(
      tester,
      (context) => showDrillSheet(
        context,
        measure: measure ?? eng.statMeasure(eng.statsByKey['okQty']!),
        rows: data,
        ctx: _ctx,
        onPick: (dim, key) => picks.add('$dim=$key'),
      ),
      dark: dark,
      size: size,
      textScale: textScale,
    );
  }

  testWidgets('shows the total, splits by machine biggest first and a tap filters the dashboard and closes', (tester) async {
    await open(tester);
    expect(find.text('OK QTY'), findsOneWidget);
    expect(find.text(eng.formatExact('qty', 1670)), findsWidgets);
    expect(find.text('for the current filters · 3 entries'), findsOneWidget);
    // 7A = 690 + 600, 7B = 380
    expect(tester.getTopLeft(find.text('7A')).dy, lessThan(tester.getTopLeft(find.text('7B')).dy));
    await tester.tap(find.text('7B'));
    await tester.pumpAndSettle();
    expect(picks, ['machine=m2']);
    expect(find.text('Breakdown'), findsNothing);
  });

  testWidgets('every tab splits the same figure: operator, part, date', (tester) async {
    await open(tester);
    await tapTab(tester, 'By Operator');
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Ravi'), findsOneWidget);
    await tapTab(tester, 'By Part');
    expect(find.text('Bracket'), findsOneWidget);
    expect(find.text('Flange'), findsOneWidget);
    await tapTab(tester, 'By Date');
    await tester.tap(find.byType(InkWell).last);
    await tester.pumpAndSettle();
    expect(picks.single, startsWith('date=2026-09-0'));
  });

  testWidgets('Entries tab lists cards with labelled remarks, general remark last', (tester) async {
    await open(tester);
    await tapTab(tester, 'Entries');
    expect(find.text('7B'), findsWidgets);
    expect(find.textContaining('Reject · Other (12 pcs): scratches', findRichText: true), findsOneWidget);
    expect(find.textContaining('Downtime · Other (20 min): waiting for crane', findRichText: true), findsOneWidget);
    expect(find.textContaining('night shift', findRichText: true), findsOneWidget);
    expect(find.text('Tap a row to filter the dashboard to it'), findsNothing);
  });

  testWidgets('Entries tab stops at 300 and says so', (tester) async {
    final rows = [for (var i = 0; i < 305; i++) drillRow('r$i', date: '2026-08-${(i % 28 + 1).toString().padLeft(2, '0')}')];
    await open(tester, rows: rows);
    await tapTab(tester, 'Entries');
    await tester.scrollUntilVisible(
      find.textContaining('Showing the latest 300 of 305 entries'),
      3000,
      scrollable: find.descendant(of: find.byType(CustomScrollView), matching: find.byType(Scrollable)).first,
      maxScrolls: 200,
    );
    expect(find.textContaining('narrow the filters'), findsOneWidget);
  });

  testWidgets('a cause measure and an empty selection read sensibly', (tester) async {
    await open(tester, rows: [], measure: eng.reasonMeasure('Burr'));
    expect(find.text('for the current filters · 0 entries'), findsOneWidget);
    expect(find.text('Nothing to show for this selection.'), findsOneWidget);
    await tapTab(tester, 'Entries');
    expect(find.text('No entries for this selection.'), findsOneWidget);
  });

  for (final c in [(true, const Size(390, 844), 1.0), (false, const Size(360, 640), 1.6), (true, const Size(360, 640), 1.6)]) {
    testWidgets('looks right: dark=${c.$1} ${c.$2} textScale ${c.$3}', (tester) async {
      await open(tester, dark: c.$1, size: c.$2, textScale: c.$3);
      for (final tab in ['By Operator', 'By Date', 'Entries']) {
        await tapTab(tester, tab);
      }
      expect(tester.takeException(), isNull);
    });
  }
}
