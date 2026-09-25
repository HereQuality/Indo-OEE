import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/api_client.dart' show ApiException;
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/sheets/customize_sheet.dart';

import 'dashboard_sheets_support.dart';

void main() {
  late List<String> saved;

  Future<void> open(
    WidgetTester tester, {
    List<String> stats = const ['totalQty', 'okQty', 'rejectedQty'],
    List<String> charts = const ['oeeTrend', 'machineSummary'],
    Future<void> Function(List<String>, List<String>)? onSave,
    bool dark = false,
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    saved = [];
    await openSheet(
      tester,
      (context) => showCustomizeSheet(
        context,
        stats: stats,
        charts: charts,
        onSave: onSave ??
            (s, c) async {
              saved.add('${s.join(',')}|${c.join(',')}');
            },
      ),
      dark: dark,
      size: size,
      textScale: textScale,
    );
  }

  Finder scroller() => find.descendant(of: find.byType(CustomScrollView), matching: find.byType(Scrollable)).first;

  testWidgets('shows both lists with counts, switching a shown tile off and Save sends the new lists and closes', (tester) async {
    await open(tester);
    expect(find.text('Customize'), findsOneWidget);
    expect(find.text('3 tiles · 2 graphs'), findsOneWidget);
    expect(find.textContaining('KPI tiles', findRichText: true), findsWidgets);
    await tester.tap(find.text('OK QTY'));
    await tester.pump();
    expect(find.text('2 tiles · 2 graphs'), findsOneWidget);
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved, ['totalQty,rejectedQty|oeeTrend,machineSummary']);
    expect(find.text('Customize'), findsNothing);
  });

  testWidgets('switching on a hidden graph appends it', (tester) async {
    await open(tester);
    await tester.scrollUntilVisible(find.text('Rejected QTY by Reason'), 300, scrollable: scroller());
    await tester.tap(find.text('Rejected QTY by Reason'));
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved.single, endsWith('|oeeTrend,machineSummary,rejectByReason'));
  });

  testWidgets('dragging a handle reorders', (tester) async {
    await open(tester);
    await tester.drag(find.byIcon(Icons.drag_indicator_rounded).first, const Offset(0, 260));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved.single.split('|').first, isNot('totalQty,okQty,rejectedQty'));
    expect(saved.single.split('|').first.split(',').toSet(), {'totalQty', 'okQty', 'rejectedQty'});
  });

  testWidgets('Reset restores the default tiles and graphs', (tester) async {
    await open(tester, stats: const ['totalQty'], charts: const []);
    await tester.tap(find.text('Reset'));
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved.single, '${eng.defaultStats.join(',')}|${eng.defaultCharts.join(',')}');
  });

  testWidgets('a failed save keeps the sheet open, shows why, and can be retried', (tester) async {
    var fail = true;
    await open(tester, onSave: (s, c) async {
      if (fail) throw ApiException('Server said no', statusCode: 500);
      saved.add('ok');
    });
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.text('Customize'), findsOneWidget);
    expect(find.text('Server said no'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(saved, ['ok']);
    expect(find.text('Customize'), findsNothing);
  });

  for (final c in [(true, const Size(390, 844), 1.0), (false, const Size(360, 640), 1.6), (true, const Size(360, 640), 1.6)]) {
    testWidgets('looks right: dark=${c.$1} ${c.$2} textScale ${c.$3}', (tester) async {
      await open(tester, dark: c.$1, size: c.$2, textScale: c.$3);
      await tester.scrollUntilVisible(find.text('Rejected QTY by Reason'), 300, scrollable: scroller());
      expect(tester.takeException(), isNull);
    });
  }
}
