import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart';
import 'package:indo/features/production/entry_form/entry_number_input.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_logic.dart';

import 'entry_form_harness.dart';

// Real production rows are messy and real fingers are messier. These tests type
// into every numeric box of the entry form the way the iOS keyboard does (one
// key at a time, through the text input channel) in every state a user reaches,
// then hammer them with a seeded monkey. Nothing may throw and typed digits
// must show up.

const _rejectReasons = [
  'Dimension Out',
  'Tool Mark',
  'Surface Finish',
  'Porosity / Blow Hole',
  'Material Defect',
  'Setting Mistake',
  'Operator Mistake',
  'Machine Fault',
  'Other',
];
const _downtime = ['setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'otherMin'];
final _integerFields = ['actualQty', 'okQty', 'lunchMin', ..._downtime, for (final r in _rejectReasons) 'reject/$r'];
const _decimalFields = ['plannedOperatorShiftHours'];

Map<String, dynamic> _withPart({Map<String, dynamic> extra = const {}}) => {
      ...blankEntry(machine: 'm1'),
      'operator': 'Asha Kumar',
      'item': 'i1',
      'itemName': 'Flange 40',
      'totalCycleSec': '60',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      ...extra,
    };

/// One key of the iOS keyboard: replaces the selection with [ch] the way the
/// platform reports it (whole new value + caret), or deletes for '\b'.
Future<void> press(WidgetTester tester, String ch) async {
  if (!tester.testTextInput.isRegistered) return;
  final focused = find.byWidgetPredicate((w) => w is EditableText && w.focusNode.hasFocus);
  if (focused.evaluate().isEmpty) return;
  final state = tester.state<EditableTextState>(focused);
  final v = state.textEditingValue;
  final sel = v.selection.isValid ? v.selection : TextSelection.collapsed(offset: v.text.length);
  String text;
  int caret;
  if (ch == '\b') {
    if (!sel.isCollapsed) {
      text = v.text.replaceRange(sel.start, sel.end, '');
      caret = sel.start;
    } else if (sel.start > 0) {
      text = v.text.replaceRange(sel.start - 1, sel.start, '');
      caret = sel.start - 1;
    } else {
      return;
    }
  } else {
    text = v.text.replaceRange(sel.start, sel.end, ch);
    caret = sel.start + ch.length;
  }
  tester.testTextInput.updateEditingValue(TextEditingValue(text: text, selection: TextSelection.collapsed(offset: caret)));
  await tester.pump();
}

/// Taps into the box, lets the select-all-on-focus settle, then types [keys].
Future<void> typeKeys(WidgetTester tester, String name, String keys) async {
  final f = textIn(0, name);
  await tester.ensureVisible(f);
  // A fresh tap: focus arrives, then the box selects its figure so typing replaces it.
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pump();
  await tester.showKeyboard(f);
  await tester.pump();
  await tester.pump();
  for (final ch in keys.split('')) {
    await press(tester, ch);
  }
}

TextField boxOf(WidgetTester tester, String name) => tester.widget<TextField>(textIn(0, name));

void main() {
  group('EntryNumberFormatter', () {
    TextEditingValue run(EntryNumberFormatter f, String old, String next, {int? caret, TextSelection? oldSel}) => f.formatEditUpdate(
          TextEditingValue(text: old, selection: oldSel ?? TextSelection.collapsed(offset: old.length)),
          TextEditingValue(text: next, selection: TextSelection.collapsed(offset: caret ?? next.length)),
        );

    test('digits pass, letters and symbols are dropped, the selection stays inside the text', () {
      const f = EntryNumberFormatter(decimals: false);
      expect(run(f, '', '1').text, '1');
      expect(run(f, '12', '12a').text, '12');
      expect(run(f, '12', '12a').selection, const TextSelection.collapsed(offset: 2));
      expect(run(f, '', '12abc').text, '12');
      expect(run(f, '', 'abc').text, '');
      expect(run(f, '5', '5.').text, '5', reason: 'no decimal point in an integer box');
      expect(run(f, '', '0000000000').text, '0000000000');
      expect(run(f, '12', '').text, '');
      // A junk keystroke on a selected value changes nothing (the selection is kept).
      final kept = run(f, '12', 'x', oldSel: const TextSelection(baseOffset: 0, extentOffset: 2));
      expect(kept.text, '12');
      expect(kept.selection, const TextSelection(baseOffset: 0, extentOffset: 2));
      // A selection past the end (an IME quirk) is repaired, never thrown on.
      final odd = run(f, '1', '12', caret: 99);
      expect(odd.selection.end, lessThanOrEqualTo(odd.text.length));
    });

    test('decimals: one point only, a comma keypad works too', () {
      const f = EntryNumberFormatter();
      expect(run(f, '1', '1.').text, '1.');
      expect(run(f, '1.2', '1.2.').text, '1.2');
      expect(run(f, '', '1.2.3').text, '1.23');
      expect(run(f, '8', '8,').text, '8.');
      expect(run(f, '', '.5').text, '.5');
    });

    test('a ceiling stops rising values but never blocks going down; 0 blocks everything above 0', () {
      final hits = <double>[];
      final f = EntryNumberFormatter(decimals: false, max: 10, onExceedMax: hits.add);
      expect(run(f, '1', '10').text, '10');
      expect(run(f, '10', '105').text, '10');
      expect(hits, [10]);
      expect(run(f, '25', '2').text, '2', reason: 'a value already over may shrink');
      final zero = EntryNumberFormatter(decimals: false, max: 0, onExceedMax: hits.add);
      expect(run(zero, '', '5').text, '');
      expect(run(zero, '', '0').text, '0');
    });

    test('a box with a ceiling of 0 that holds nothing is locked', () {
      expect(EntryTextField.capLocks('', 0), isTrue);
      expect(EntryTextField.capLocks('0', 0), isTrue);
      expect(EntryTextField.capLocks('3', 0), isFalse, reason: 'a value that is there must stay editable');
      expect(EntryTextField.capLocks('', 5), isFalse);
      expect(EntryTextField.capLocks('', null), isFalse);
    });
  });

  group('typing into the boxes in every state', () {
    testWidgets('empty new entry: every box that can take digits does, with the number keypad only where numeric', (tester) async {
      await pumpForm(tester, [blankEntry(machine: 'm1')]);
      await openBlock(tester, 0);

      for (final name in ['actualQty', 'okQty', 'plannedOperatorShiftHours', 'lunchMin', ..._downtime]) {
        final box = boxOf(tester, name);
        expect(box.keyboardType, TextInputType.numberWithOptions(decimal: name == 'plannedOperatorShiftHours'), reason: name);
        expect(box.readOnly, isFalse, reason: '$name should be typeable before anything else is filled in');
      }
      // No Part yet, so Actual has no Ideal ceiling: 12 goes in, then OK up to Actual.
      await typeKeys(tester, 'actualQty', '12');
      expect(textOf(tester, 0, 'actualQty'), '12');
      await typeKeys(tester, 'okQty', '5');
      expect(textOf(tester, 0, 'okQty'), '5');
      await typeKeys(tester, 'okQty', '99');
      expect(textOf(tester, 0, 'okQty'), '9', reason: 'OK is capped by Actual (12): 9 fits, the second 9 (99) does not');
      await typeKeys(tester, 'plannedOperatorShiftHours', '8.5');
      expect(textOf(tester, 0, 'plannedOperatorShiftHours'), '8.5');
      expect(boxOf(tester, 'plannedOperatorShiftHours').keyboardType, const TextInputType.numberWithOptions(decimal: true));
      expect(boxOf(tester, 'actualQty').keyboardType, const TextInputType.numberWithOptions(decimal: false));
      expect(tester.takeException(), isNull);
    });

    testWidgets('Reject Master is shut with a visible reason until Actual and OK leave pieces rejected, then opens', (tester) async {
      await pumpForm(tester, [_withPart()]);
      await openBlock(tester, 0);

      // Shut: drawn locked, read-only, still focusable, and it says why (not just a toast).
      final tool = textIn(0, 'reject/Tool Mark');
      await tester.ensureVisible(tool);
      expect(boxOf(tester, 'reject/Tool Mark').readOnly, isTrue);
      expect(find.textContaining('Enter Actual and OK Quantity first'), findsOneWidget);
      expect(find.byIcon(Icons.lock_outline_rounded), findsWidgets);
      final node = boxOf(tester, 'reject/Tool Mark').focusNode!;
      node.requestFocus();
      await tester.pump();
      expect(node.hasFocus, isTrue);
      node.unfocus();

      await typeKeys(tester, 'actualQty', '100');
      await typeKeys(tester, 'okQty', '100');
      expect(find.textContaining('Nothing to reject'), findsOneWidget);
      await typeKeys(tester, 'okQty', '90');
      expect(textOf(tester, 0, 'okQty'), '90');
      expect(find.textContaining('Nothing to reject'), findsNothing);
      expect(boxOf(tester, 'reject/Tool Mark').readOnly, isFalse);
      await typeKeys(tester, 'reject/Tool Mark', '15');
      expect(textOf(tester, 0, 'reject/Tool Mark'), '1', reason: '15 is more than the 10 left, so the 5 is refused');
      await typeKeys(tester, 'reject/Tool Mark', '10');
      expect(textOf(tester, 0, 'reject/Tool Mark'), '10');
      // Everything is assigned now: the others shut again and say so.
      expect(boxOf(tester, 'reject/Other').readOnly, isTrue);
      expect(find.textContaining('already assigned'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('downtime boxes: shut with a reason while the planned shift equals the machine shift, open once it is longer', (tester) async {
      await pumpForm(tester, [_withPart(extra: {'plannedOperatorShiftHours': '8'})]);
      await openBlock(tester, 0);
      await tester.ensureVisible(textIn(0, 'setupMin'));
      expect(boxOf(tester, 'setupMin').readOnly, isTrue);
      expect(boxOf(tester, 'lunchMin').readOnly, isTrue);
      expect(find.textContaining('No stoppage time left'), findsWidgets);

      await typeKeys(tester, 'plannedOperatorShiftHours', '9');
      expect(textOf(tester, 0, 'plannedOperatorShiftHours'), '9');
      expect(boxOf(tester, 'setupMin').readOnly, isFalse);
      await typeKeys(tester, 'setupMin', '61');
      expect(textOf(tester, 0, 'setupMin'), '6', reason: '60 min are allowed: 6 fits, the 1 after it would make 61');
      await typeKeys(tester, 'setupMin', '60');
      expect(textOf(tester, 0, 'setupMin'), '60');
      expect(boxOf(tester, 'noPowerMin').readOnly, isTrue);
      expect(find.textContaining('all 60 min allowed are used'), findsOneWidget);
      // Lowering the used box gives the room back.
      await typeKeys(tester, 'setupMin', '\b');
      expect(boxOf(tester, 'noPowerMin').readOnly, isFalse);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Actual is capped by Ideal, planned shift by 24, and blocked keys warn once without throwing', (tester) async {
      final toasts = captureToasts();
      await pumpForm(tester, [_withPart()]);
      await openBlock(tester, 0);
      await typeKeys(tester, 'actualQty', '481');
      expect(textOf(tester, 0, 'actualQty'), '48');
      await tester.pump(const Duration(milliseconds: 10));
      expect(toasts, hasLength(1));
      await typeKeys(tester, 'plannedOperatorShiftHours', '25');
      expect(textOf(tester, 0, 'plannedOperatorShiftHours'), '2');
      expect(tester.takeException(), isNull);
    });
  });

  group('legacy and messy production rows', () {
    // Shaped like what the server sends (Mongo ids as strings, dates as ISO strings,
    // numbers as ints, doubles and numeric strings, nulls, extra keys).
    final rows = <String, Map<String, dynamic>>{
      'nulls everywhere': {
        '_id': 'a1',
        'date': '2026-09-01T00:00:00.000Z',
        'machine': 'm1',
        'slot': 1,
        'operator': null,
        'item': null,
        'itemName': null,
        'machineOnTime': null,
        'machineOffTime': null,
        'actualQty': null,
        'okQty': null,
        'rejectedQty': null,
        'rejectBreakdown': null,
        'plannedOperatorShiftHours': null,
        'excludedOps': null,
        'setupMin': null,
      },
      'strings and doubles': {
        '_id': 'a2',
        'date': '2026-09-01T00:00:00.000Z',
        'machine': 'm2',
        'slot': '2',
        'operator': 'Ravi',
        'item': 'i1',
        'itemName': 'Flange 40',
        'totalCycleSec': '60',
        'drillingSec': 20.5,
        'machineOnTime': '0800',
        'machineOffTime': '16:00',
        'actualQty': '400',
        'okQty': 390.0,
        'rejectedQty': '10',
        'rejectBreakdown': {'Tool Mark': '6', 'Dimension Out': 4.0, 'Unknown Reason': 3},
        'plannedOperatorShiftHours': '9.5',
        'lunchMin': 30.0,
        'setupMin': '10',
        'noMaterialMin': 1e7,
        'surprise': {'nested': [1, 2, 3]},
      },
      'legacy single reason, huge and tiny numbers': {
        '_id': 'a3',
        'date': '2026-09-01',
        'machine': 'gone',
        'slot': 3,
        'operator': 'Ravi',
        'itemName': 'Old part',
        'cycleTimeSec': 0,
        'machineOnTime': '23:30',
        'machineOffTime': '00:15',
        'actualQty': 1e21,
        'okQty': 0.0000001,
        'rejectedQty': 5,
        'rejectReason': 'Tool Mark',
        'plannedOperatorShiftHours': 0,
        'otherMin': -5,
        'cycleOpsSec': [1, 'x', null],
      },
      'garbage types': {
        '_id': 'a4',
        'date': 12345,
        'machine': {'_id': 'm1'},
        'slot': null,
        'operator': 42,
        'item': {'x': 1},
        'itemName': ['a'],
        'machineOnTime': 830,
        'machineOffTime': true,
        'actualQty': 'abc',
        'okQty': double.nan,
        'plannedOperatorShiftHours': double.infinity,
        'rejectBreakdown': [1, 2],
        'excludedOps': 'drillingSec',
      },
    };

    for (final e in rows.entries) {
      testWidgets('edit "${e.key}" opens, every box takes digits and nothing throws', (tester) async {
        await pumpForm(tester, [toFormValues(e.value)], isEdit: true);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        for (final name in _integerFields) {
          final f = textIn(0, name);
          if (f.evaluate().isEmpty) continue;
          await tester.ensureVisible(f);
          if (boxOf(tester, name).readOnly) continue;
          await typeKeys(tester, name, '7');
          expect(tester.takeException(), isNull, reason: name);
        }
        await typeKeys(tester, 'plannedOperatorShiftHours', '8.5');
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('monkey', () {
    for (final seed in [1, 7, 2026]) {
      testWidgets('random typing, focus changes, resize and keyboard insets (seed $seed)', (tester) async {
        final rnd = math.Random(seed);
        captureToasts();
        await pumpForm(tester, [_withPart(extra: {'plannedOperatorShiftHours': '9'})]);
        await openBlock(tester, 0);

        final all = [..._integerFields, ..._decimalFields];
        final pastes = ['12abc', '1.2.3', '0000000000', '-5', ' 7 ', '１２', '1e5', ',', '٣', '9' * 30, ''];
        const chars = '0123456789..abc -+,';
        const sizes = [Size(390, 844), Size(360, 640), Size(844, 390), Size(820, 1180)];

        for (var step = 0; step < 220; step++) {
          final name = all[rnd.nextInt(all.length)];
          final f = textIn(0, name);
          switch (rnd.nextInt(8)) {
            case 0:
            case 1:
            case 2:
              if (f.evaluate().isEmpty) break;
              await tester.ensureVisible(f);
              if (boxOf(tester, name).readOnly) break;
              await tester.showKeyboard(f);
              await tester.pump();
              for (var n = rnd.nextInt(5) + 1; n > 0; n--) {
                await press(tester, chars[rnd.nextInt(chars.length)]);
              }
            case 3:
              if (tester.testTextInput.isRegistered) await press(tester, '\b');
            case 4:
              // select-all + replace, like a long-press "Select All" then a key
              final focused = find.byWidgetPredicate((w) => w is EditableText && w.focusNode.hasFocus);
              if (focused.evaluate().isNotEmpty && tester.testTextInput.isRegistered) {
                final st = tester.state<EditableTextState>(focused);
                st.userUpdateTextEditingValue(
                  st.textEditingValue.copyWith(selection: TextSelection(baseOffset: 0, extentOffset: st.textEditingValue.text.length)),
                  SelectionChangedCause.toolbar,
                );
                await tester.pump();
                await press(tester, '${rnd.nextInt(10)}');
              }
            case 5:
              // paste-like whole-value replacement with a bogus selection
              if (tester.testTextInput.isRegistered) {
                final s = pastes[rnd.nextInt(pastes.length)];
                tester.testTextInput.updateEditingValue(TextEditingValue(text: s, selection: TextSelection.collapsed(offset: rnd.nextInt(s.length + 1))));
                await tester.pump();
              }
            case 6:
              tester.view.physicalSize = sizes[rnd.nextInt(sizes.length)];
              tester.view.viewInsets = rnd.nextBool() ? FakeViewPadding(bottom: 200.0 + rnd.nextInt(150)) : FakeViewPadding.zero;
              await tester.pump(const Duration(milliseconds: 16));
            case 7:
              FocusManager.instance.primaryFocus?.unfocus();
              await tester.pump();
          }
          expect(tester.takeException(), isNull, reason: 'step $step on $name');
        }

        tester.view.viewInsets = FakeViewPadding.zero;
        tester.view.physicalSize = const Size(390, 844);
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        for (final name in _integerFields) {
          final f = textIn(0, name);
          if (f.evaluate().isEmpty) continue;
          expect(RegExp(r'^\d*$').hasMatch(textOf(tester, 0, name)), isTrue, reason: '$name = "${textOf(tester, 0, name)}"');
        }
        expect(RegExp(r'^\d*\.?\d*$').hasMatch(textOf(tester, 0, 'plannedOperatorShiftHours')), isTrue);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('clock dial time picker', () {
    Finder dial() => find.byWidgetPredicate((w) => w.runtimeType.toString() == '_Dial');

    testWidgets('opens a clock dial (12-hour), picks in fives, cancel keeps the old time', (tester) async {
      final key = await pumpForm(tester, [_withPart(extra: {'machineOnTime': '08:00'})]);
      await openBlock(tester, 0);
      final on = field(0, 'machineOnTime');
      await tester.ensureVisible(on);
      expect(find.text('08:00 AM'), findsOneWidget);

      // Cancel changes nothing.
      await tester.tap(on);
      await tester.pumpAndSettle();
      expect(find.byType(TimePickerDialog), findsOneWidget);
      expect(dial(), findsOneWidget);
      expect(find.text('MACHINE ON TIME'), findsOneWidget);
      expect(find.text('AM'), findsWidgets);
      expect(find.text('PM'), findsWidgets);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(key.currentState!.entries.first['machineOnTime'], '08:00');

      // Pick 3 o'clock on the dial, then 15 minutes, then PM, then OK.
      await tester.tap(on);
      await tester.pumpAndSettle();
      final c = tester.getCenter(dial());
      final r = tester.getSize(dial()).width / 2;
      await tester.tapAt(Offset(c.dx + r * 0.8, c.dy)); // 3
      await tester.pumpAndSettle();
      await tester.tapAt(Offset(c.dx + r * 0.8, c.dy)); // 15 minutes
      await tester.pumpAndSettle();
      await tester.tap(find.text('PM').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(key.currentState!.entries.first['machineOnTime'], '15:15');
      expect(find.text('03:15 PM'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    test('the chosen minute snaps to the nearest five, 58 rolls into the next hour', () {
      expect(snapToFiveMinutes(const TimeOfDay(hour: 8, minute: 2)), '08:00');
      expect(snapToFiveMinutes(const TimeOfDay(hour: 8, minute: 3)), '08:05');
      expect(snapToFiveMinutes(const TimeOfDay(hour: 8, minute: 58)), '09:00');
      expect(snapToFiveMinutes(const TimeOfDay(hour: 23, minute: 58)), '00:00');
      expect(snapToFiveMinutes(const TimeOfDay(hour: 12, minute: 30)), '12:30');
    });

    testWidgets('dark mode on an iPad shows a dialog, not a full-screen sheet', (tester) async {
      await pumpForm(tester, [_withPart(extra: {'machineOnTime': '', 'machineOffTime': ''})], size: const Size(820, 1180), dark: true);
      await openBlock(tester, 0);
      await tester.tap(field(0, 'machineOffTime'));
      await tester.pumpAndSettle();
      expect(find.byType(TimePickerDialog), findsOneWidget);
      expect(dial(), findsOneWidget);
      expect(tester.getSize(dial()).width, lessThan(400), reason: 'a dialog with a dial, not a stretched full-screen sheet');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('combined smoke', () {
    testWidgets('dark, 360x640, text scale 1.6: full form with locked and open boxes lays out without overflow', (tester) async {
      await pumpForm(
        tester,
        [
          _withPart(extra: {
            'actualQty': '100',
            'okQty': '90',
            'plannedOperatorShiftHours': '8',
            'rejectBreakdown': {'Other': '10'},
            'rejectOtherRemark': 'x',
          }),
          blankEntry(machine: 'm2'),
        ],
        size: const Size(360, 640),
        dark: true,
        textScale: 1.6,
      );
      await openBlock(tester, 0);
      await tester.drag(find.byType(SingleChildScrollView).first, const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.byKey(const ValueKey('entry1/expand')));
      await openBlock(tester, 1);
      expect(tester.takeException(), isNull);
    });

    testWidgets('iPad: cards sit in two columns and boxes are 40 px tall', (tester) async {
      await pumpForm(tester, [_withPart()], size: const Size(820, 1180));
      await openBlock(tester, 0);
      final a = tester.getTopLeft(find.text('Date, Machine No., Operator'));
      final b = tester.getTopLeft(find.text('Reject Master'));
      expect(b.dx, greaterThan(a.dx + 200), reason: 'left and right column');
      expect(tester.getSize(textIn(0, 'actualQty')).height, lessThanOrEqualTo(44));
      expect(tester.takeException(), isNull);
    });
  });
}
