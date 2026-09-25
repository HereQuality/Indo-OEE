import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';

import '../support/fake_api.dart';

Widget host({
  bool isEdit = false,
  int entryCount = 1,
  bool canSave = true,
  bool saving = false,
  int savingIndex = 0,
  String? incomplete,
  String? error,
  VoidCallback? onSave,
  VoidCallback? onCancel,
}) =>
    Scaffold(
      body: const SizedBox.expand(),
      bottomNavigationBar: EntryActionBar(
        isEdit: isEdit,
        entryCount: entryCount,
        canSave: canSave,
        saving: saving,
        savingIndex: savingIndex,
        incompleteMessage: incomplete,
        errorMessage: error,
        onSave: onSave ?? () {},
        onCancel: onCancel ?? () {},
      ),
    );

FilledButton save(WidgetTester t) => t.widget<FilledButton>(find.byType(FilledButton));

void main() {
  group('labels', () {
    for (final c in <String, (Map<String, Object?>, String)>{
      'add, one entry': ({}, 'Save'),
      'add, three entries': ({'entryCount': 3}, 'Save 3 entries'),
      'edit': ({'isEdit': true}, 'Update'),
      'saving one': ({'saving': true}, 'Saving…'),
      'saving one of several': ({'saving': true, 'entryCount': 3, 'savingIndex': 1}, 'Saving 2 of 3…'),
      'updating': ({'saving': true, 'isEdit': true}, 'Updating…'),
    }.entries) {
      testWidgets(c.key, (tester) async {
        FakeApi.install();
        final o = c.value.$1;
        await pumpScreen(
          tester,
          host(
            isEdit: o['isEdit'] as bool? ?? false,
            entryCount: o['entryCount'] as int? ?? 1,
            saving: o['saving'] as bool? ?? false,
            savingIndex: o['savingIndex'] as int? ?? 0,
          ),
          settle: false,
        );
        await tester.pump();
        expect(find.text(c.value.$2), findsOneWidget);
        expect(find.text('Cancel'), findsOneWidget);
      });
    }
  });

  testWidgets('a complete entry: Save is pressable and calls back; so is Cancel', (tester) async {
    FakeApi.install();
    var saves = 0, cancels = 0;
    await pumpScreen(tester, host(onSave: () => saves++, onCancel: () => cancels++));
    await tester.tap(find.text('Save'));
    await tester.tap(find.text('Cancel'));
    expect((saves, cancels), (1, 1));
    expect(find.byType(Tooltip), findsNothing, reason: 'no inactive hint when nothing is missing');
  });

  testWidgets('an incomplete entry only LOOKS inactive: it is still pressable and shows the hint on long press', (tester) async {
    FakeApi.install();
    var saves = 0;
    await pumpScreen(tester, host(canSave: false, onSave: () => saves++));
    final cs = Theme.of(tester.element(find.byType(EntryActionBar))).colorScheme;
    expect(save(tester).onPressed, isNotNull);
    final bg = save(tester).style!.backgroundColor!.resolve({})!;
    expect(bg, isNot(cs.primary));
    await tester.tap(find.text('Save'));
    expect(saves, 1);
    await tester.longPress(find.text('Save'));
    await tester.pump(const Duration(milliseconds: 800));
    expect(find.text(EntryActionBar.inactiveHint), findsOneWidget);
  });

  testWidgets('while saving: spinner, Save and Cancel are disabled', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, host(saving: true, canSave: false), settle: false);
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(save(tester).onPressed, isNull);
    expect(tester.widget<TextButton>(find.byType(TextButton)).onPressed, isNull);
    // Keeps its brand colour rather than greying out.
    final cs = Theme.of(tester.element(find.byType(EntryActionBar))).colorScheme;
    expect(save(tester).style!.backgroundColor!.resolve({WidgetState.disabled}), cs.primary.withValues(alpha: 0.8));
  });

  testWidgets('the incomplete message shows; a server error takes its place', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, host(canSave: false, incomplete: 'This entry is incomplete — fix the highlighted fields to save.'));
    expect(find.text('This entry is incomplete — fix the highlighted fields to save.'), findsOneWidget);

    await pumpScreen(tester, host(canSave: false, incomplete: 'incomplete msg', error: 'Machine not found or inactive'));
    expect(find.text('Machine not found or inactive'), findsOneWidget);
    expect(find.text('incomplete msg'), findsNothing);
  });

  for (final c in <String, (Size, bool, double)>{
    'light 390x844': (const Size(390, 844), false, 1.0),
    'dark 390x844': (const Size(390, 844), true, 1.0),
    'small phone 360x640': (const Size(360, 640), false, 1.0),
    'dark, text scale 1.6 on 360x640': (const Size(360, 640), true, 1.6),
    'landscape 844x390': (const Size(844, 390), false, 1.0),
    'tablet 1024x768': (const Size(1024, 768), false, 1.0),
  }.entries) {
    testWidgets('tallest state has no overflow and 44 px targets: ${c.key}', (tester) async {
      FakeApi.install();
      final (size, dark, scale) = c.value;
      await pumpScreen(
        tester,
        host(
          entryCount: 12,
          canSave: false,
          incomplete: '11 of 12 entries are incomplete — fix the highlighted fields to save.',
        ),
        size: size,
        dark: dark,
        textScale: scale,
      );
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(FilledButton)).height, greaterThanOrEqualTo(44));
      expect(tester.getSize(find.byType(TextButton)).height, greaterThanOrEqualTo(44));
      expect(tester.getRect(find.byType(FilledButton)).right, lessThanOrEqualTo(size.width));
      // Tablets cap the content column.
      expect(tester.getSize(find.byType(FilledButton)).width, lessThanOrEqualTo(720));

      await pumpScreen(
        tester,
        host(saving: true, entryCount: 12, savingIndex: 11, error: 'Total stoppage (75 min) can\'t be more than Planned Operator Shift − Machine Shift (60 min)'),
        size: size,
        dark: dark,
        textScale: scale,
        settle: false,
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('dark mode: surface and text come from the theme, not fixed colours', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, host(canSave: false, incomplete: 'msg'), dark: true);
    final cs = Theme.of(tester.element(find.byType(EntryActionBar))).colorScheme;
    final deco = tester.widget<DecoratedBox>(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(DecoratedBox)).first);
    expect((deco.decoration as BoxDecoration).color, cs.surface);
    final text = tester.widget<Text>(find.text('msg'));
    expect(text.style!.color, cs.onSurface);
    expect(cs.brightness, Brightness.dark);
  });
}
