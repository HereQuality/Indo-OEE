import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/theme/app_theme.dart';
import 'package:indo/core/widgets/form_widgets.dart';

import '../support/fake_api.dart';

/// WCAG contrast ratio of two opaque colours.
double contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

/// The colour the engine will actually paint [f]'s text in. A null colour paints
/// white — the bug that made dropdown options vanish on the light theme.
Color? paintedColor(WidgetTester tester, Finder f) {
  final rich = tester.widget<RichText>(find.descendant(of: f, matching: find.byType(RichText)).first);
  return rich.text.style?.color;
}

void expectReadable(WidgetTester tester, String text, Color background, {double min = 4.5}) {
  final c = paintedColor(tester, find.text(text));
  expect(c, isNotNull, reason: '"$text" has no colour, so it paints white');
  expect(contrast(c!, background), greaterThanOrEqualTo(min), reason: '"$text" on $background');
}

List<PickOption<String>> _options(int n, {bool subtitles = false}) => [
      for (var i = 0; i < n; i++) PickOption('o$i', 'Option $i', subtitle: subtitles ? '${60 + i} sec' : null),
    ];

Future<void> _openPicker(
  WidgetTester tester, {
  required List<PickOption<String>> options,
  String? selected,
  bool dark = false,
  bool allowClear = false,
  ValueChanged<String?>? onChanged,
}) async {
  FakeApi.install();
  await pumpScreen(
    tester,
    Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: AppDropdownField<String>(
          label: 'Machine',
          options: options,
          value: selected,
          allowClear: allowClear,
          onChanged: onChanged ?? (_) {},
        ),
      ),
    ),
    dark: dark,
  );
  // The field's column stretches over the body; the box itself is the tap target.
  await tester.tap(find.descendant(of: find.byType(AppDropdownField<String>), matching: find.byType(InputDecorator)));
  await tester.pumpAndSettle();
}

void main() {
  for (final dark in [false, true]) {
    final name = dark ? 'dark' : 'light';
    final theme = dark ? AppTheme.dark() : AppTheme.light();

    group('$name theme', () {
      test('field borders are visible against the fill and the page (>= 3:1)', () {
        final fill = theme.inputDecorationTheme.fillColor!;
        expect(contrast(theme.colorScheme.outline, fill), greaterThanOrEqualTo(3.0), reason: 'outline vs field fill');
        expect(contrast(theme.colorScheme.outline, theme.scaffoldBackgroundColor), greaterThanOrEqualTo(3.0),
            reason: 'outline vs page');
      });

      test('placeholder text is readable (>= 4.5:1)', () {
        final fill = theme.inputDecorationTheme.fillColor!;
        // Blend first: a translucent hint is lighter than its base colour suggests.
        final hint = Color.alphaBlend(theme.inputDecorationTheme.hintStyle!.color!, fill);
        expect(contrast(hint, fill), greaterThanOrEqualTo(4.5));
      });

      test('list tile text styles carry a colour', () {
        // ListTile replaces the ambient text style, so a colourless one paints white.
        expect(theme.listTileTheme.titleTextStyle?.color, isNotNull);
        expect(theme.listTileTheme.subtitleTextStyle?.color, isNotNull);
      });

      testWidgets('dropdown options and their subtitles are readable', (tester) async {
        await _openPicker(tester, options: _options(3, subtitles: true), selected: 'o1', dark: dark);
        final sheet = theme.bottomSheetTheme.backgroundColor!;
        expectReadable(tester, 'Option 0', sheet);
        expectReadable(tester, 'Option 1', sheet); // the selected row sits on a tint
        expectReadable(tester, '60 sec', sheet);
        expectReadable(tester, 'Machine', sheet); // sheet title
      });

      testWidgets('plain list tiles (drawer, settings rows) are readable', (tester) async {
        FakeApi.install();
        await pumpScreen(
          tester,
          const Scaffold(
            body: Column(children: [
              ListTile(title: Text('Real-time clock'), subtitle: Text('Show the clock on the dashboard')),
              SwitchListTile(title: Text('Dark mode'), value: false, onChanged: null),
            ]),
          ),
          dark: dark,
        );
        final bg = theme.scaffoldBackgroundColor;
        expectReadable(tester, 'Real-time clock', bg);
        expectReadable(tester, 'Show the clock on the dashboard', bg);
        expectReadable(tester, 'Dark mode', bg, min: 3.0); // disabled switch: greyed on purpose
      });

      testWidgets('popup menu items are readable on the menu surface', (tester) async {
        FakeApi.install();
        await pumpScreen(
          tester,
          Scaffold(
            appBar: AppBar(
              actions: [
                PopupMenuButton<int>(
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 1, child: Text('Edit entry')),
                    PopupMenuItem(value: 2, child: Text('Delete entry')),
                  ],
                ),
              ],
            ),
          ),
          dark: dark,
        );
        await tester.tap(find.byType(PopupMenuButton<int>));
        await tester.pumpAndSettle();
        final menu = theme.popupMenuTheme.color!;
        expectReadable(tester, 'Edit entry', menu);
        expectReadable(tester, 'Delete entry', menu);
      });
    });
  }

  group('picker sheet', () {
    testWidgets('marks the selected option', (tester) async {
      await _openPicker(tester, options: _options(3), selected: 'o1');
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    });

    testWidgets('a long list opens at the current choice, not the top', (tester) async {
      await _openPicker(tester, options: _options(60), selected: 'o40');
      final inSheet = find.descendant(of: find.byType(ListView), matching: find.text('Option 40'));
      expect(inSheet, findsOneWidget);
      expect(find.text('Option 0'), findsNothing);
    });

    testWidgets('search filters, explains an empty result and clears in one tap', (tester) async {
      await _openPicker(tester, options: _options(12));
      await tester.enterText(find.widgetWithIcon(TextField, Icons.search), 'zzz');
      await tester.pump();
      expect(find.text('No matches for “zzz”'), findsOneWidget);
      expect(find.text('Option 3'), findsNothing);

      await tester.tap(find.byTooltip('Clear search'));
      await tester.pump();
      expect(find.text('No matches for “zzz”'), findsNothing);
      expect(find.text('Option 3'), findsOneWidget);
    });

    testWidgets('an empty list says so instead of showing a blank sheet', (tester) async {
      await _openPicker(tester, options: const []);
      expect(find.text('Nothing to choose from yet'), findsOneWidget);
    });

    testWidgets('Close dismisses without changing the value', (tester) async {
      final picked = <String?>[];
      await _openPicker(tester, options: _options(3), selected: 'o1', onChanged: picked.add);
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.text('Option 0'), findsNothing);
      expect(picked, isEmpty);
    });

    testWidgets('tapping an option picks it', (tester) async {
      final picked = <String?>[];
      await _openPicker(tester, options: _options(3), onChanged: picked.add);
      await tester.tap(find.text('Option 2'));
      await tester.pumpAndSettle();
      expect(picked, ['o2']);
      expect(find.text('Option 2'), findsOneWidget); // now shown in the field
    });

    testWidgets('Clear only appears for an optional field that has a value', (tester) async {
      await _openPicker(tester, options: _options(3), selected: 'o1', allowClear: true);
      expect(find.text('Clear'), findsOneWidget);
    });

    testWidgets('Clear is absent when nothing is selected', (tester) async {
      await _openPicker(tester, options: _options(3), allowClear: true);
      expect(find.text('Clear'), findsNothing);
    });
  });

  group('SearchField', () {
    Future<List<String>> pumpSearch(WidgetTester tester) async {
      FakeApi.install();
      final seen = <String>[];
      await pumpScreen(tester, Scaffold(body: Padding(padding: const EdgeInsets.all(16), child: SearchField(onChanged: seen.add))));
      return seen;
    }

    testWidgets('shows a clear button only when there is text, and it resets the query', (tester) async {
      final seen = await pumpSearch(tester);
      expect(find.byTooltip('Clear search'), findsNothing);

      await tester.enterText(find.byType(TextField), 'cnc');
      await tester.pump();
      expect(find.byTooltip('Clear search'), findsOneWidget);
      expect(seen.last, 'cnc');

      await tester.tap(find.byTooltip('Clear search'));
      await tester.pump();
      expect(find.byTooltip('Clear search'), findsNothing);
      expect(seen.last, '');
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
    });
  });
}
