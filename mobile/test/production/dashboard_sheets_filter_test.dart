import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/sheets/filter_sheet.dart';

import 'dashboard_sheets_support.dart';

const _options = {
  'machine': [
    {'value': 'm1', 'label': '7A'},
    {'value': 'm2', 'label': '7B'},
    {'value': 'm3', 'label': 'P1'},
  ],
  'operator': [
    {'value': 'Asha', 'label': 'Asha'},
    {'value': 'Ravi', 'label': 'Ravi'},
  ],
  'item': [
    {'value': 'i1', 'label': 'Bracket'},
    {'value': 'i2', 'label': 'Flange'},
  ],
};

void main() {
  late List<String> sets;
  late int cleared;

  Future<void> open(
    WidgetTester tester, {
    Map<String, List<String>>? filters,
    bool dark = false,
    Size size = const Size(390, 844),
    double textScale = 1.0,
  }) async {
    sets = [];
    cleared = 0;
    await openSheet(
      tester,
      (context) => showFilterSheet(
        context,
        options: _options,
        filters: filters ?? {'machine': [], 'operator': [], 'item': [], 'month': [], 'date': []},
        onFilterSet: (d, v) => sets.add('$d=${v.join(',')}'),
        onClearAll: () => cleared++,
      ),
      dark: dark,
      size: size,
      textScale: textScale,
    );
  }

  testWidgets('search narrows the list, multi-select applies once per changed dimension', (tester) async {
    await open(tester);
    expect(find.text('Filters'), findsOneWidget);
    expect(find.text('7A'), findsOneWidget);
    expect(find.text('P1'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '7');
    await tester.pump();
    expect(find.text('P1'), findsNothing);
    await tester.tap(find.text('7A'));
    await tester.tap(find.text('7B'));
    await tester.pump();

    await tester.tap(find.text('Operator').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ravi'));
    await tester.pump();
    expect(find.text('Apply · 3 filters'), findsOneWidget);

    await tester.tap(find.textContaining('Apply'));
    await tester.pumpAndSettle();
    expect(sets, ['machine=m1,m2', 'operator=Ravi']);
    expect(cleared, 0);
    expect(find.text('Filters'), findsNothing);
  });

  testWidgets('Select all / Clear work on what the search shows', (tester) async {
    await open(tester, filters: {'machine': ['m3'], 'operator': [], 'item': [], 'month': [], 'date': []});
    await tester.enterText(find.byType(TextField), '7');
    await tester.pump();
    await tester.tap(find.text('Select all'));
    await tester.pump();
    expect(find.textContaining('3 of 3 selected'), findsOneWidget);
    await tester.tap(find.text('Clear').last);
    await tester.pump();
    // Only the two shown machines were cleared; P1 stays picked.
    expect(find.textContaining('1 of 3 selected'), findsOneWidget);
  });

  testWidgets('Clear all empties everything, including month and date picks, and asks the dashboard to reset', (tester) async {
    await open(tester, filters: {'machine': ['m1'], 'operator': [], 'item': [], 'month': ['2026-09'], 'date': ['2026-09-02']});
    expect(find.textContaining('Month: '), findsOneWidget);
    expect(find.text('3 filters'), findsOneWidget);
    await tester.tap(find.text('Clear all'));
    await tester.pump();
    expect(find.textContaining('Month: '), findsNothing);
    expect(find.textContaining('Everything cleared'), findsOneWidget);
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(cleared, 1);
    expect(sets, isEmpty);
  });

  testWidgets('nothing changed reads Done and applies nothing', (tester) async {
    await open(tester);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(sets, isEmpty);
    expect(cleared, 0);
  });

  for (final c in [(true, const Size(390, 844), 1.0), (false, const Size(360, 640), 1.6), (true, const Size(360, 640), 1.6)]) {
    testWidgets('looks right: dark=${c.$1} ${c.$2} textScale ${c.$3}', (tester) async {
      await open(tester, dark: c.$1, size: c.$2, textScale: c.$3, filters: {'machine': ['m1', 'm2'], 'operator': ['Asha'], 'item': [], 'month': [], 'date': []});
      await tester.tap(find.text('Part').first);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'zzz');
      await tester.pump();
      if (c.$3 == 1.0) expect(find.text('No matches'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
