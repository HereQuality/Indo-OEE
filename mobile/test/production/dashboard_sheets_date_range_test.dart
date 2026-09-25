import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart';
import 'package:indo/features/production/dashboard/sheets/date_range_sheet.dart';

import 'dashboard_sheets_support.dart';

/// Fill colour of a quick-range pill / month chip, found from its label.
Color? pillColor(WidgetTester tester, String label) {
  final box = tester.widget<Container>(find.ancestor(of: find.text(label), matching: find.byType(Container)).first);
  return (box.decoration as BoxDecoration).color;
}

Color? chipColor(WidgetTester tester, String label) =>
    tester.widget<Material>(find.ancestor(of: find.text(label), matching: find.byType(Material)).first).color;

void main() {
  late List<List<String>> changes;

  Future<void> open(
    WidgetTester tester, {
    List<String>? range,
    Map<String, dynamic>? extent,
    bool dark = false,
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    pinClock();
    changes = [];
    await openSheet(
      tester,
      (context) => showDateRangeSheet(
        context,
        range: range ?? monthRange('2026-09'),
        extent: extent,
        onChanged: changes.add,
      ),
      dark: dark,
      size: size,
      textScale: textScale,
    );
  }

  group('opening', () {
    testWidgets('a whole month opens on the Month tab and says what is showing', (tester) async {
      await open(tester);
      expect(find.text('Select period'), findsOneWidget);
      expect(find.text('Showing September 2026 · 30 days'), findsOneWidget);
      // Month tab content: a year stepper and the twelve months.
      expect(find.text('2026'), findsOneWidget);
      expect(find.text('Jan'), findsOneWidget);
      expect(find.text('Dec'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a whole year opens on the Year tab', (tester) async {
      await open(tester, range: yearRange(2025), extent: {'from': '2024-02-01', 'to': '2026-09-20'});
      expect(find.text('Showing 2025 · 365 days'), findsOneWidget);
      expect(find.text('2024'), findsOneWidget);
      expect(find.text('2026'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('anything else opens on the Date range tab with quick ranges and a calendar', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      expect(find.text('Showing 10/09/2026 to 12/09/2026 · 3 days'), findsOneWidget);
      for (final q in ['Today', 'Last 7 days', 'Last 30 days', 'Last 90 days', 'This month', 'Last month', 'This year', 'Last year']) {
        expect(find.text(q), findsOneWidget, reason: q);
      }
      expect(find.text('September 2026'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a single day reads as that day', (tester) async {
      await open(tester, range: ['2026-09-25', '2026-09-25']);
      expect(find.text('Showing 25/09/2026 · 1 day'), findsOneWidget);
    });
  });

  group('quick ranges', () {
    testWidgets('Last 7 days applies today minus six days to today and closes', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('Last 7 days'));
      await tester.pumpAndSettle();
      expect(changes, [
        ['2026-09-19', '2026-09-25'],
      ]);
      expect(find.text('Select period'), findsNothing);
    });

    testWidgets('Today and Last month give the right ranges', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-09-25', '2026-09-25']);

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Last month'));
      await tester.pumpAndSettle();
      expect(changes.last, ['2026-08-01', '2026-08-31']);
    });

    testWidgets('the active quick range is highlighted and choosing it again just closes', (tester) async {
      await open(tester, range: ['2026-09-19', '2026-09-25']);
      final accent = Theme.of(tester.element(find.text('Last 7 days'))).colorScheme.primary;
      expect(pillColor(tester, 'Last 7 days'), accent);
      expect(pillColor(tester, 'Last 30 days'), isNot(accent));
      await tester.tap(find.text('Last 7 days'));
      await tester.pumpAndSettle();
      expect(changes, isEmpty);
      expect(find.text('Select period'), findsNothing);
    });
  });

  group('calendar', () {
    testWidgets('two taps make a range, apply it and close', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('5'));
      await tester.pump();
      // Half picked: the header asks for the end and the sticky bar offers one day.
      expect(find.text('05/09/2026 → pick the end date'), findsOneWidget);
      expect(find.text('Just this day'), findsOneWidget);
      expect(changes, isEmpty);

      await tester.tap(find.text('15'));
      await tester.pumpAndSettle();
      expect(changes, [
        ['2026-09-05', '2026-09-15'],
      ]);
      expect(find.text('Select period'), findsNothing);
    });

    testWidgets('tapping an earlier day while picking restarts from it', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('20'));
      await tester.pump();
      await tester.tap(find.text('3'));
      await tester.pump();
      expect(find.text('03/09/2026 → pick the end date'), findsOneWidget);
      await tester.tap(find.text('4'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-09-03', '2026-09-04']);
    });

    testWidgets('the same day twice is a one-day range', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('8'));
      await tester.pump();
      await tester.tap(find.text('8'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-09-08', '2026-09-08']);
    });

    testWidgets('Just this day applies the first tap alone', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('7'));
      await tester.pump();
      await tester.tap(find.text('Just this day'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-09-07', '2026-09-07']);
      expect(find.text('Select period'), findsNothing);
    });

    testWidgets('Cancel drops the half-picked start and applies nothing', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('7'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      expect(find.text('Just this day'), findsNothing);
      expect(find.text('Showing 10/09/2026 to 12/09/2026 · 3 days'), findsOneWidget);
      expect(changes, isEmpty);
    });

    testWidgets('closing the sheet with a half-picked day discards it', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('7'));
      await tester.pump();
      await tester.tapAt(const Offset(20, 40)); // the barrier above the sheet
      await tester.pumpAndSettle();
      expect(find.text('Select period'), findsNothing);
      expect(changes, isEmpty);
    });

    testWidgets('days after today cannot be picked', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.text('28'), warnIfMissed: false);
      await tester.pump();
      expect(find.text('Just this day'), findsNothing);
    });

    testWidgets('the arrows move between months and the range stays put', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      await tester.tap(find.byTooltip('Previous month'));
      await tester.pumpAndSettle();
      expect(find.text('August 2026'), findsOneWidget);
      await tester.ensureVisible(find.text('31'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('31'));
      await tester.pump();
      await tester.tap(find.byTooltip('Next month'));
      await tester.pumpAndSettle();
      expect(find.text('September 2026'), findsOneWidget);
      await tester.ensureVisible(find.text('2'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('2'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-08-31', '2026-09-02']);
    });

    testWidgets('next month is disabled on the current month; swiping goes back', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12']);
      final next = tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.chevron_right_rounded));
      expect(next.onPressed, isNull);
      await tester.fling(find.byType(PageView), const Offset(200, 0), 1500);
      await tester.pumpAndSettle();
      expect(find.text('August 2026'), findsOneWidget);
    });

    testWidgets('tapping the month title jumps to any month and year', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12'], extent: {'from': '2024-01-05', 'to': '2026-09-20'});
      await tester.tap(find.text('September 2026'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Previous year'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Mar'));
      await tester.pumpAndSettle();
      expect(find.text('March 2025'), findsOneWidget);
      // The calendar starts at the first of the extent's first year (2024).
      await tester.tap(find.text('March 2025'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Previous year'));
      await tester.pumpAndSettle();
      expect(find.text('2024'), findsOneWidget);
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.remove_rounded)).onPressed, isNull);
    });

    testWidgets('a range longer than five years is refused with the web message', (tester) async {
      await open(tester, range: ['2026-09-10', '2026-09-12'], extent: {'from': '2015-03-01', 'to': '2026-09-20'});
      await tester.tap(find.text('September 2026'));
      await tester.pumpAndSettle();
      for (var i = 0; i < 11; i++) {
        await tester.tap(find.byTooltip('Previous year'));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      await tester.tap(find.text('Jan'));
      await tester.pumpAndSettle();
      expect(find.text('January 2015'), findsOneWidget);
      await tester.tap(find.text('1'));
      await tester.pump();

      await tester.tap(find.text('January 2015'));
      await tester.pumpAndSettle();
      for (var i = 0; i < 11; i++) {
        await tester.tap(find.byTooltip('Next year'));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sep'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('10'));
      await tester.pumpAndSettle();

      expect(find.text(kRangeTooLongMessage), findsOneWidget);
      expect(kRangeTooLongMessage, 'That period is longer than 5 years — pick a shorter one.');
      expect(changes, isEmpty);
      expect(find.text('Select period'), findsOneWidget);
      expect(find.text('Just this day'), findsNothing);
    });
  });

  group('month and year tabs', () {
    testWidgets('choosing a month applies its first and last day', (tester) async {
      await open(tester);
      await tester.tap(find.text('Feb'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2026-02-01', '2026-02-28']);
      expect(find.text('Select period'), findsNothing);
    });

    testWidgets('months that have not started are disabled', (tester) async {
      await open(tester);
      await tester.tap(find.text('Oct'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(changes, isEmpty);
      expect(find.text('Select period'), findsOneWidget);
    });

    testWidgets('the year stepper walks through the years with data and picks that year\'s months', (tester) async {
      await open(tester, extent: {'from': '2024-03-01', 'to': '2026-09-20'});
      final later = tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.chevron_right_rounded));
      expect(later.onPressed, isNull, reason: 'already on the newest year');
      await tester.tap(find.byTooltip('Earlier year'));
      await tester.pumpAndSettle();
      expect(find.text('2025'), findsOneWidget);
      await tester.tap(find.text('Nov'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2025-11-01', '2025-11-30']);
    });

    testWidgets('the applied month is marked', (tester) async {
      await open(tester);
      final accent = Theme.of(tester.element(find.text('Sep'))).colorScheme.primary;
      expect(chipColor(tester, 'Sep'), accent);
      expect(chipColor(tester, 'Aug'), isNot(accent));
      await tester.tap(find.text('Sep'));
      await tester.pumpAndSettle();
      expect(changes, isEmpty, reason: 'same range: just close');
    });

    testWidgets('the Year tab lists the years of the data, newest first, and applies a year', (tester) async {
      await open(tester, extent: {'from': '2024-03-01', 'to': '2026-09-20'});
      await tester.tap(find.text('Year'));
      await tester.pumpAndSettle();
      final years = tester.widgetList<Text>(find.textContaining(RegExp(r'^20\d\d$'))).map((t) => t.data).toList();
      expect(years, ['2026', '2025', '2024']);
      await tester.tap(find.text('2025'));
      await tester.pumpAndSettle();
      expect(changes.single, ['2025-01-01', '2025-12-31']);
    });

    testWidgets('without an extent the Year tab still offers the current year', (tester) async {
      await open(tester);
      await tester.tap(find.text('Year'));
      await tester.pumpAndSettle();
      expect(find.text('2026'), findsOneWidget);
    });

    testWidgets('switching tabs keeps the sheet open and shows that tab', (tester) async {
      await open(tester);
      await tester.tap(find.text('Date range'));
      await tester.pumpAndSettle();
      expect(find.text('Quick ranges'.toUpperCase()), findsOneWidget);
      await tester.tap(find.text('Month'));
      await tester.pumpAndSettle();
      expect(find.text('Jan'), findsOneWidget);
    });
  });

  group('look and feel', () {
    for (final tab in ['Date range', 'Month', 'Year']) {
      testWidgets('$tab tab: dark mode', (tester) async {
        await open(tester, dark: true, range: ['2026-09-10', '2026-09-12']);
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('$tab tab: small phone 360x640', (tester) async {
        await open(tester, size: const Size(360, 640), range: ['2026-09-10', '2026-09-12']);
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });

      testWidgets('$tab tab: text scale 1.6', (tester) async {
        await open(tester, size: const Size(360, 640), textScale: 1.6, range: ['2026-09-10', '2026-09-12']);
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('landscape phone without overflow', (tester) async {
      await open(tester, size: const Size(740, 360), textScale: 1.3, range: ['2026-09-10', '2026-09-12']);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tablet content stays at most 720 wide', (tester) async {
      await open(tester, size: const Size(1024, 768), range: ['2026-09-10', '2026-09-12']);
      expect(tester.getSize(find.byType(DateRangeSheet)).width, lessThanOrEqualTo(720));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a half-picked day in dark mode at large text', (tester) async {
      await open(tester, dark: true, size: const Size(360, 640), textScale: 1.6, range: ['2026-09-10', '2026-09-12']);
      await tester.ensureVisible(find.text('7'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('7'));
      await tester.pump();
      expect(find.text('Just this day'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
