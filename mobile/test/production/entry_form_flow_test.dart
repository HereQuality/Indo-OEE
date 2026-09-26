import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'entry_form_harness.dart';

// How the form opens its blocks: choosing a machine opens the block (no "+"
// press), "Add another machine" asks for the machine first, and the OFF dial
// starts a sensible hour after ON.
void main() {
  Finder collapsed(int i) => find.byKey(ValueKey('entry$i/collapsed'), skipOffstage: false);
  Finder header(int i) => find.byKey(ValueKey('entry$i/header'), skipOffstage: false);

  testWidgets('choosing a machine in a closed block opens its entry fields at once', (tester) async {
    final form = await pumpForm(tester, [blankEntry()]);
    expect(collapsed(0), findsOneWidget);
    expect(header(0), findsNothing);
    expect(find.textContaining('open automatically'), findsOneWidget, reason: 'the closed block says what happens');

    await tester.tap(find.text('Select machine'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CNC-7A'));
    await tester.pumpAndSettle();

    expect(form.currentState!.log, contains('change 0 machine=m1'));
    expect(header(0), findsOneWidget, reason: 'no "+" press needed');
    expect(collapsed(0), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a block that starts with a machine already chosen (Add with the machine filter) is open', (tester) async {
    await pumpForm(tester, [blankEntry(machine: 'm2')]);
    expect(header(0), findsOneWidget);
    expect(collapsed(0), findsNothing);
  });

  testWidgets('with several blocks, only the first that has a machine opens; the "+" still opens another', (tester) async {
    await pumpForm(tester, [blankEntry(), blankEntry(machine: 'm1'), blankEntry(machine: 'm2')]);
    expect(collapsed(0), findsOneWidget, reason: 'no machine yet');
    expect(header(1), findsOneWidget);
    expect(collapsed(2), findsOneWidget);

    await tester.ensureVisible(find.byKey(const ValueKey('entry2/expand')));
    await tester.tap(find.byKey(const ValueKey('entry2/expand')));
    await tester.pumpAndSettle();
    expect(header(2), findsOneWidget);
    expect(collapsed(1), findsOneWidget, reason: 'one block open at a time');
  });

  testWidgets('"Add another machine" asks for the machine first and opens the block once one is chosen', (tester) async {
    final form = await pumpForm(tester, [validEntry()]);
    await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
    await tester.tap(find.byKey(const ValueKey('entry-add')));
    await tester.pumpAndSettle();

    expect(form.currentState!.entries.length, 2);
    expect(header(1), findsNothing, reason: 'the new block is not opened without a machine');
    expect(collapsed(1), findsOneWidget);
    expect(find.byType(BottomSheet), findsOneWidget, reason: 'the machine picker opens by itself');
    expect(header(0), findsOneWidget, reason: 'the block being filled stays open meanwhile');

    await tester.tap(find.text('CNC-7B'));
    await tester.pumpAndSettle();
    expect(header(1), findsOneWidget);
    expect(collapsed(0), findsOneWidget, reason: 'the first block folds away when the new one opens');
    expect(form.currentState!.entries[1]['machine'], 'm2');
  });

  testWidgets('dismissing that picker leaves a closed "Select machine" block, ready to be removed', (tester) async {
    final form = await pumpForm(tester, [validEntry()]);
    await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
    await tester.tap(find.byKey(const ValueKey('entry-add')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);

    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(collapsed(1), findsOneWidget);
    expect(header(1), findsNothing);
    expect(find.text('Select machine'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const ValueKey('entry1/remove')));
    await tester.tap(find.byKey(const ValueKey('entry1/remove')));
    await tester.pumpAndSettle();
    expect(form.currentState!.entries.length, 1);
  });

  testWidgets('a machine picked while editing never re-opens or asks again (edit shows one open block)', (tester) async {
    await pumpForm(tester, [validEntry()], isEdit: true);
    expect(header(0), findsOneWidget);
    expect(find.byKey(const ValueKey('entry-add')), findsNothing);
  });

  group('the OFF dial', () {
    Future<void> pickOff(WidgetTester tester) async {
      final off = field(0, 'machineOffTime');
      await tester.ensureVisible(off);
      await tester.tap(off);
      await tester.pumpAndSettle();
      expect(find.byType(TimePickerDialog), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
    }

    testWidgets('starts an hour after ON, so the first pick is already a sensible one', (tester) async {
      final key = await pumpForm(tester, [validEntry(overrides: {'machineOnTime': '08:00', 'machineOffTime': ''})]);
      await openBlock(tester, 0);
      await pickOff(tester);
      expect(key.currentState!.entries.first['machineOffTime'], '09:00');
    });

    testWidgets('near midnight it never starts past 23:55', (tester) async {
      final key = await pumpForm(tester, [validEntry(overrides: {'machineOnTime': '23:30', 'machineOffTime': ''})]);
      await openBlock(tester, 0);
      await pickOff(tester);
      expect(key.currentState!.entries.first['machineOffTime'], '23:55');
    });

    testWidgets('with no ON time yet it starts on now, as before (and OFF is not offered a guess)', (tester) async {
      final key = await pumpForm(tester, [validEntry(overrides: {'machineOnTime': '', 'machineOffTime': ''})]);
      await openBlock(tester, 0);
      await pickOff(tester);
      final v = key.currentState!.entries.first['machineOffTime'] as String;
      expect(RegExp(r'^\d\d:\d[05]$').hasMatch(v), isTrue, reason: v);
    });
  });
}
