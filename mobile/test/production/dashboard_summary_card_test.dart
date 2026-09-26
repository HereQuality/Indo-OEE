import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_page_test.dart' show pumpDashboard;
import 'dashboard_shell_fixtures.dart';

Finder card() => find.byKey(const ValueKey('dashboardSummary'));
Finder inCard(String text) => find.descendant(of: card(), matching: find.text(text));

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    pinDashboardClock();
  });
  tearDown(unpinDashboardClock);

  Future<void> pump(WidgetTester tester, {String? processId = processVmc, Size size = const Size(390, 844), double textScale = 1, bool dark = false}) async {
    final api = FakeApi.install();
    installDashboardApi(api);
    await pumpDashboard(tester, processId: processId, size: size, textScale: textScale, dark: dark);
  }

  group('phone summary card', () {
    testWidgets('sits above the KPI tiles with OEE big and the key figures beside it', (tester) async {
      await pump(tester);
      expect(card(), findsOneWidget);
      expect(inCard('OEE'), findsOneWidget);
      expect(inCard('87.42%'), findsOneWidget);
      expect(inCard('Considering losses'), findsOneWidget);
      expect(inCard('Produced'), findsOneWidget);
      expect(inCard(eng.formats['qty']!(1700)), findsOneWidget);
      expect(inCard('OK rate'), findsOneWidget);
      expect(inCard(eng.formats['pct']!(1670 / 1700)), findsOneWidget);
      expect(inCard('Downtime'), findsOneWidget);
      expect(inCard(eng.formats['minutes']!(120)), findsOneWidget);
      expect(inCard('Machines ran'), findsOneWidget);
      expect(inCard('2 of 2'), findsOneWidget);

      expect(tester.getTopLeft(card()).dy, lessThan(tester.getTopLeft(find.byKey(const ValueKey('kpi:totalQty'))).dy));
      // Side by side: the figures are to the right of the headline.
      expect(tester.getTopLeft(inCard('Produced')).dx, greaterThan(tester.getTopLeft(inCard('87.42%')).dx + 60));
      expect(tester.takeException(), isNull);
    });

    testWidgets('tapping it opens the OEE breakdown', (tester) async {
      await pump(tester);
      await tester.tap(card());
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsOneWidget);
      expect(find.text('OEE Considering Losses'), findsWidgets);
    });

    testWidgets('follows the filters: narrowing to one machine changes the figures', (tester) async {
      await pump(tester);
      await tester.tap(card());
      await tester.pumpAndSettle();
      await tester.tap(find.text('7B').last);
      await tester.pumpAndSettle();
      expect(find.text('Machine: 7B'), findsOneWidget);
      expect(inCard('1 of 2'), findsOneWidget);
    });

    testWidgets('"All machines" has no fixed total, so it shows just the count', (tester) async {
      await pump(tester, processId: null);
      expect(card(), findsOneWidget);
      expect(inCard('Machines ran'), findsOneWidget);
      expect(find.descendant(of: card(), matching: find.textContaining(' of ')), findsNothing);
    });

    testWidgets('is absent when the period has no entries', (tester) async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (_) => {
            'isOk': true,
            'data': <Map<String, dynamic>>[],
            'extent': {'from': '2026-01-05', 'to': '2026-09-14'},
            'machineNames': <String, dynamic>{},
          });
      await pumpDashboard(tester);
      expect(card(), findsNothing);
    });

    testWidgets('is a phone thing: the tablet keeps the web layout without it', (tester) async {
      await pump(tester, size: const Size(820, 1180));
      expect(card(), findsNothing);
      expect(find.byKey(const ValueKey('kpi:totalQty')), findsOneWidget);
    });

    testWidgets('large text stacks it (headline, then a 2-column grid) instead of overflowing', (tester) async {
      await pump(tester, size: const Size(360, 640), textScale: 1.6, dark: true);
      expect(tester.takeException(), isNull);
      for (final label in ['Produced', 'OK rate', 'Downtime', 'Machines ran']) {
        expect(inCard(label), findsOneWidget, reason: label);
      }
      // Stacked: the figures are below the headline, not beside it.
      expect(tester.getTopLeft(inCard('Produced')).dy, greaterThan(tester.getBottomLeft(inCard('87.42%')).dy));
    });

    testWidgets('a small phone at normal text is one row of columns without overflow', (tester) async {
      await pump(tester, size: const Size(320, 640));
      expect(tester.takeException(), isNull);
      expect(card(), findsOneWidget);
    });
  });
}
