import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';

import 'entry_form_harness.dart';

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  testWidgets('open block renders every section and the calc boxes', (tester) async {
    await pumpForm(tester, [validEntry()]);
    // A block whose machine is already chosen starts open — no "+" to press.
    expect(find.byKey(const ValueKey('entry0/collapsed')), findsNothing);
    await openBlock(tester, 0);

    for (final title in [
      'Date, Machine No., Operator',
      'Part Name, Total Cycle Time',
      'Machine ON–OFF Time, Machine Shift',
      'Rejection Master (Qty)',
      'Planned Operator Shift, Lunch / Rest',
      'Downtime / Stoppage (min)',
      'Remarks',
    ]) {
      expect(find.text(title, skipOffstage: false), findsOneWidget, reason: title);
    }
    // 08:00-16:00 on a 60 s part -> Ideal 480; 9 h planned -> 60 min allowed.
    expect(find.descendant(of: find.byKey(const ValueKey('entry0/calc/idealQty')), matching: find.text('480')), findsOneWidget);
    expect(find.byKey(const ValueKey('entry0/calc/stoppageAllowed'), skipOffstage: false), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('typing caps: above Ideal / above the room refused, shortening allowed', (tester) async {
    final toasts = captureToasts();
    final key = await pumpForm(tester, [validEntry(overrides: {'okQty': '390'})]);
    await openBlock(tester, 0);

    await typeIn(tester, 0, 'actualQty', '481'); // Ideal is 480
    expect(textOf(tester, 0, 'actualQty'), '400');
    expect(toasts.any((t) => t.contains('Ideal Quantity')), isTrue);

    await typeIn(tester, 0, 'actualQty', '40'); // shortening is never blocked
    expect(textOf(tester, 0, 'actualQty'), '40');
    await typeIn(tester, 0, 'actualQty', '400');

    // Rejected = 400 - 390 = 10: a box may not take more than what is left.
    final reject = find.descendant(of: find.byKey(const ValueKey('entry0/reject/Other')), matching: find.byType(TextField));
    await tester.ensureVisible(reject);
    await tester.enterText(reject, '11');
    await tester.pump();
    expect(tester.widget<TextField>(reject).controller!.text, '');
    await tester.enterText(reject, '10');
    await tester.pump();
    expect(key.currentState!.log, contains('reject 0 Other=10'));
    expect(find.textContaining('Split so far: '), findsOneWidget);
  });

  testWidgets('Other remark box and the lunch star follow the data', (tester) async {
    await pumpForm(tester, [validEntry(overrides: {'okQty': '390', 'rejectBreakdown': <String, dynamic>{'Other': '10'}})]);
    await openBlock(tester, 0);
    expect(find.byKey(const ValueKey('entry0/rejectOtherRemark'), skipOffstage: false), findsOneWidget);
    expect(find.byKey(const ValueKey('entry0/otherMinRemark'), skipOffstage: false), findsNothing);

    await typeIn(tester, 0, 'otherMin', '5');
    expect(find.byKey(const ValueKey('entry0/otherMinRemark'), skipOffstage: false), findsOneWidget);

    // Planned shift equal to the run -> no allowance -> Lunch / Rest not needed.
    await typeIn(tester, 0, 'plannedOperatorShiftHours', '8');
    expect(find.textContaining('Not needed'), findsOneWidget);
  });

  testWidgets('errors only after submit; focusTarget opens a collapsed block and focuses the field', (tester) async {
    final key = await pumpForm(tester, [validEntry(overrides: {'actualQty': ''})]);
    expect(find.textContaining('Incomplete'), findsNothing);

    key.currentState!.submit();
    await _settle(tester);
    expect(find.byKey(const ValueKey('entry0/header'), skipOffstage: false), findsOneWidget); // block opened
    expect(find.textContaining('Incomplete'), findsWidgets);
    expect(tester.widget<TextField>(textIn(0, 'actualQty')).focusNode!.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('callbacks fire with (index, name, value); add and remove', (tester) async {
    final key = await pumpForm(tester, [validEntry()]);
    await openBlock(tester, 0);
    await typeIn(tester, 0, 'okQty', '399');
    expect(key.currentState!.log, contains('change 0 okQty=399'));

    await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
    await tester.tap(find.byKey(const ValueKey('entry-add')));
    await tester.pumpAndSettle();
    expect(key.currentState!.log, contains('add'));
    expect(key.currentState!.entries.length, 2);
    // The new block stays closed and asks for its machine first: the picker opens
    // by itself, and the block opens once a machine is chosen.
    expect(find.byKey(const ValueKey('entry1/header'), skipOffstage: false), findsNothing);
    expect(find.byKey(const ValueKey('entry1/collapsed'), skipOffstage: false), findsOneWidget);
    expect(find.byType(BottomSheet), findsOneWidget);
    await tester.tap(find.text('CNC-7B'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('entry1/header'), skipOffstage: false), findsOneWidget);

    // Edit mode: one block, already open, machine locked, no add / remove.
    await pumpForm(tester, [validEntry()], isEdit: true);
    expect(find.byKey(const ValueKey('entry0/header')), findsOneWidget);
    expect(find.byKey(const ValueKey('entry-add')), findsNothing);
    expect(find.byKey(const ValueKey('entry0/remove')), findsNothing);
  });

  testWidgets('dark + 360x640 + text scale 1.6 renders without exceptions', (tester) async {
    EntryFormToast.reset();
    final key = await pumpForm(tester, [validEntry(overrides: {'okQty': '390', 'rejectBreakdown': <String, dynamic>{'Other': '10'}, 'otherMin': '5'}), blankEntry(machine: 'm2')],
        size: const Size(360, 640), dark: true, textScale: 1.6);
    await openBlock(tester, 0);
    key.currentState!.submit();
    await _settle(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('entry1/expand')));
    await tester.pumpAndSettle();
    await openBlock(tester, 1);
    expect(find.byKey(const ValueKey('entry1/header'), skipOffstage: false), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
