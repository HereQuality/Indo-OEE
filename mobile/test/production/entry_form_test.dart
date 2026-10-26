import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';

import 'entry_form_harness.dart';
import 'web_parity/form_lines_support.dart';

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

    // The web's lines, in the web's order (CNC: ProductionEntryForm.jsx LINES).
    final titles = [
      'Date, Machine No., Operator',
      'Part Name, Total Cycle Time',
      'Machine ON–OFF Time, Machine Shift',
      'Production Master',
      'Rejection Master (Qty)',
      'Planned Operator Shift, Lunch / Rest',
      'Downtime / Stoppage (min)',
      'Remarks',
    ];
    final tops = <double>[];
    for (final title in titles) {
      // "Remarks" is both the line title and the label of its box.
      final f = find.text(title, skipOffstage: false);
      expect(f, title == 'Remarks' ? findsNWidgets(2) : findsOneWidget, reason: title);
      tops.add(tester.getTopLeft(f.first).dy);
    }
    // One column on a phone, so the order down the page is the web's.
    for (var i = 1; i < titles.length; i++) {
      expect(tops[i], greaterThan(tops[i - 1]), reason: '${titles[i]} comes after ${titles[i - 1]}');
    }

    // Production Master: Actual, OK and the grey Rejected - no Ideal Quantity and no % OK box.
    expect(openFormLines(tester).firstWhere((l) => l.$1 == 'Production Master').$2, ['Actual Quantity *', 'OK Quantity *', 'Rejected']);
    expect(find.byKey(const ValueKey('entry0/calc/idealQty'), skipOffstage: false), findsNothing);
    expect(find.byKey(const ValueKey('entry0/calc/pctOk'), skipOffstage: false), findsNothing);
    expect(find.byKey(const ValueKey('entry0/calc/rejectedQty')), findsOneWidget);
    // 9 h planned over a 08:00-16:00 shift -> the allowance box exists.
    expect(find.byKey(const ValueKey('entry0/calc/stoppageAllowed'), skipOffstage: false), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('typing caps: above Ideal / above the room refused, shortening allowed', (tester) async {
    final toasts = captureToasts();
    final key = await pumpForm(tester, [validEntry(overrides: {'okQty': '390'})]);
    await openBlock(tester, 0);

    await typeIn(tester, 0, 'actualQty', '481'); // Ideal is 480
    expect(textOf(tester, 0, 'actualQty'), '400');
    // CNC raises the web's popup (with the figures) instead of a toast.
    await tester.pump();
    expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
    expect(find.textContaining('at most 480 pieces'), findsOneWidget);
    expect(find.byKey(const ValueKey('entry-notice/value/Actual Quantity')), findsOneWidget);
    expect(toasts.any((t) => t.contains('Ideal Quantity')), isFalse);
    await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
    await tester.pumpAndSettle();

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

  testWidgets('Other remark box and the no-room note follow the data', (tester) async {
    await pumpForm(tester, [validEntry(overrides: {'okQty': '390', 'rejectBreakdown': <String, dynamic>{'Other': '10'}})]);
    await openBlock(tester, 0);
    expect(find.byKey(const ValueKey('entry0/rejectOtherRemark'), skipOffstage: false), findsOneWidget);
    expect(find.byKey(const ValueKey('entry0/otherMinRemark'), skipOffstage: false), findsNothing);

    await typeIn(tester, 0, 'otherMin', '5');
    expect(find.byKey(const ValueKey('entry0/otherMinRemark'), skipOffstage: false), findsOneWidget);

    // The whole Machine Shift used up (web stoppageLimitMin = ON -> OFF = 480 min) -> the stoppage boxes say so.
    expect(find.textContaining('No stoppage time left'), findsNothing);
    await typeIn(tester, 0, 'lunchMin', '475'); // + the 5 min of Other typed above = 480
    expect(find.textContaining('No stoppage time left'), findsWidgets);
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

  testWidgets('a machine can be in the form once per date: the picker says "already added", and "Add another machine" goes off with the web note once all are in', (tester) async {
    final key = await pumpForm(tester, [validEntry(), blankEntry(machine: 'm2')]);
    // Both machines are already in this form for the date (web allTaken).
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey('entry-add'))).onPressed, isNull);
    expect(find.text('Every machine is already in this form for this date.'), findsOneWidget);

    // A different date frees them again.
    key.currentState!.set(1, 'date', '2026-09-26');
    await tester.pumpAndSettle();
    expect(tester.widget<OutlinedButton>(find.byKey(const ValueKey('entry-add'))).onPressed, isNotNull);
    expect(find.text('Every machine is already in this form for this date.'), findsNothing);
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
