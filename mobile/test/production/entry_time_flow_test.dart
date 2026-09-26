import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';

import '../support/fake_api.dart';
import 'entry_form_harness.dart' show captureToasts;
import 'editor_screen_test.dart' show bar, editorTest, fillValid, form, occupiedPath, open, savedRow, settle, tapSave;

// The editor and the machine ON/OFF time rules: OFF after ON, and no overlap with
// what the machine already has saved on that date (asked of the server as soon as
// a machine and date are set) or with another block of the same form. The two
// messages show as soon as the times are picked — not only after Save.

Object? _saved(List<Map<String, String>> slots) => {
      'isOk': true,
      'data': [
        for (var i = 0; i < slots.length; i++) {'slot': i + 1, ...slots[i]},
      ],
    };

Future<void> openBlock0(WidgetTester tester) async {
  final plus = find.byKey(const ValueKey('entry0/expand'));
  if (plus.evaluate().isNotEmpty) await tester.tap(plus); // a machine set through code does not open its block
  await settle(tester);
}

void main() {
  editorTest('an overlapping time is flagged as soon as it is picked, blocks Save, and a free time saves', (tester) async {
    final h = await open(tester, onOccupied: (_) => _saved([
          {'machineOnTime': '15:00', 'machineOffTime': '18:00'},
        ]));
    await fillValid(tester); // machine CNC 1, 08:00 – 16:00
    await settle(tester);
    await openBlock0(tester);

    // No Save pressed, and it is already there, naming the clash.
    expect(find.textContaining('Machine OFF Time overlaps another entry for this machine on this date (3:00 PM – 6:00 PM)'), findsOneWidget);
    expect(find.textContaining('Already booked for this machine on this date: 3:00 PM – 6:00 PM'), findsOneWidget);
    expect(bar(tester).canSave, isFalse);

    await tapSave(tester);
    await settle(tester);
    expect(h.puts, isEmpty, reason: 'nothing is sent while the times overlap');

    // Pick a free slot of the same length.
    final f = form(tester);
    f.onChange(0, 'machineOnTime', '06:00');
    f.onChange(0, 'machineOffTime', '14:00');
    await settle(tester);
    expect(find.textContaining('overlaps another entry'), findsNothing);
    expect(bar(tester).canSave, isTrue);
    await tapSave(tester);
    await settle(tester);
    expect(h.puts, hasLength(1));
    expect(h.body(0)['machineOnTime'], '06:00');
    expect(h.popped, [true]);
  });

  group('a warning at the moment the time is picked (not only on Save)', () {
    editorTest('OFF not after ON warns as soon as it is picked, once, and stays quiet on other edits', (tester) async {
      final toasts = captureToasts();
      await open(tester, onOccupied: (_) => _saved(const []));
      await fillValid(tester); // a valid 08:00 – 16:00
      await settle(tester);
      expect(toasts, isEmpty, reason: 'nothing wrong yet');

      final f = form(tester);
      f.onChange(0, 'machineOffTime', '07:00'); // picked before ON
      await settle(tester);
      expect(toasts, ['Machine OFF Time must be after Machine ON Time']);

      f.onChange(0, 'remarks', 'x'); // typing elsewhere does not nag
      f.onChange(0, 'actualQty', '300');
      await settle(tester);
      expect(toasts, hasLength(1));

      f.onChange(0, 'machineOffTime', '16:00'); // fixed: no warning
      await settle(tester);
      expect(toasts, hasLength(1));
    });

    editorTest('picking a time that runs into a booked slot warns at that pick', (tester) async {
      final toasts = captureToasts();
      await open(tester, onOccupied: (_) => _saved([
            {'machineOnTime': '15:00', 'machineOffTime': '18:00'},
          ]));
      final f = form(tester);
      f.onChange(0, 'machine', 'm1'); // the lookup for this machine and date lands…
      await settle(tester);
      expect(toasts, isEmpty);

      f.onChange(0, 'machineOnTime', '14:00'); // start alone is fine
      await settle(tester);
      expect(toasts, isEmpty);
      f.onChange(0, 'machineOffTime', '16:00'); // …and this end runs into 3 – 6 PM
      await settle(tester);
      expect(toasts.single, contains('Machine OFF Time overlaps another entry for this machine on this date (3:00 PM – 6:00 PM)'));
    });

    editorTest('times picked before the bookings arrived warn as soon as they do', (tester) async {
      final toasts = captureToasts();
      await open(tester, onOccupied: (_) => _saved([
            {'machineOnTime': '15:00', 'machineOffTime': '18:00'},
          ]));
      await fillValid(tester); // machine and times set in one go; the lookup lands afterwards
      await settle(tester);
      expect(toasts.single, contains('overlaps another entry for this machine on this date (3:00 PM – 6:00 PM)'));
    });
  });

  editorTest('the lookup is asked once per machine and date, with the right query', (tester) async {
    final h = await open(tester, onOccupied: (_) => _saved(const []));
    await fillValid(tester);
    await settle(tester);
    final gets = h.api.called('GET', occupiedPath).toList();
    expect(gets, hasLength(1), reason: 'many edits, one lookup');
    expect(gets.single.query['machine'], 'm1');
    expect(gets.single.query['date'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(find.textContaining('Already booked'), findsNothing, reason: 'a free machine shows no hint');

    // Another machine on the same date is a new question.
    form(tester).onChange(0, 'machine', 'm2');
    await settle(tester);
    expect(h.api.called('GET', occupiedPath), hasLength(2));
  });

  editorTest('OFF before (or at) ON is flagged at once and blocks Save', (tester) async {
    final h = await open(tester, onOccupied: (_) => _saved(const []));
    await fillValid(tester);
    final f = form(tester);
    f.onChange(0, 'machineOnTime', '10:00');
    f.onChange(0, 'machineOffTime', '09:00');
    await settle(tester);
    await openBlock0(tester);
    expect(find.text('Machine OFF Time must be after Machine ON Time'), findsOneWidget);
    expect(bar(tester).canSave, isFalse);

    f.onChange(0, 'machineOffTime', '10:00');
    await settle(tester);
    expect(find.text('Machine OFF Time must be after Machine ON Time'), findsOneWidget, reason: 'equal is not after');

    await tapSave(tester);
    await settle(tester);
    expect(h.puts, isEmpty);
  });

  editorTest('two blocks of one form cannot overlap each other', (tester) async {
    await open(tester, onOccupied: (_) => _saved(const []));
    final f = form(tester);
    await fillValid(tester); // block 0: CNC 1, 08:00 – 16:00
    f.onAdd();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Close')); // the new block's machine picker opens by itself
    await tester.pumpAndSettle();
    final g = form(tester);
    g.onChange(1, 'machine', 'm1'); // same machine, same date
    g.onChange(1, 'machineOnTime', '12:00');
    g.onChange(1, 'machineOffTime', '20:00');
    await settle(tester);
    expect(bar(tester).canSave, isFalse);
    final errors = state(tester);
    expect(errors[0]['machineOffTime'], contains('overlaps another entry'));
    expect(errors[1]['machineOnTime'], contains('overlaps another entry'));

    g.onChange(1, 'machine', 'm2'); // another machine is independent
    await settle(tester);
    expect(state(tester)[0], isNot(contains('machineOffTime')));
  });

  editorTest('a server refusal (someone else booked it meanwhile) keeps the form and reads the bookings again', (tester) async {
    final h = await open(
      tester,
      onOccupied: (_) => _saved(const []),
      onPut: (_) => FakeResponse(
        {'isOk': false, 'message': "This machine already has an entry from 8:00 AM – 4:00 PM on 25/09/2026. Machine ON/OFF times can't overlap."},
        status: 400,
      ),
    );
    await fillValid(tester);
    await settle(tester);
    expect(h.api.called('GET', occupiedPath), hasLength(1));

    await tapSave(tester);
    await settle(tester);
    expect(h.puts, hasLength(1));
    expect(h.popped, isEmpty, reason: 'the editor stays open with everything typed');
    expect(find.byType(EntryEditorScreen), findsOneWidget);
    expect(find.textContaining("can't overlap"), findsWidgets);
    expect(h.api.called('GET', occupiedPath), hasLength(2), reason: 'what is booked is read again after a refusal');
  });

  editorTest('editing: the row itself is not "another entry", and old times stay saveable until they change', (tester) async {
    // Slot 2 is being edited; slot 1 (an older row) already overlaps it.
    final h = await open(
      tester,
      row: savedRow(),
      onOccupied: (_) => {
        'isOk': true,
        'data': [
          {'slot': 1, 'machineOnTime': '08:00', 'machineOffTime': '12:00'},
          {'slot': 2, 'machineOnTime': '08:00', 'machineOffTime': '16:00'},
        ],
      },
    );
    await settle(tester);
    expect(find.textContaining('overlaps another entry'), findsNothing, reason: 'its times are untouched');
    expect(bar(tester).canSave, isTrue);
    // Only the neighbour is listed — its own slot (8:00 AM – 4:00 PM) is not "another" entry.
    expect(find.text('Already booked for this machine on this date: 8:00 AM – 12:00 PM — pick a time outside it.'), findsOneWidget);

    form(tester).onChange(0, 'machineOffTime', '15:00');
    await settle(tester);
    expect(find.textContaining('overlaps another entry for this machine on this date (8:00 AM – 12:00 PM)'), findsOneWidget);
    expect(bar(tester).canSave, isFalse);
    expect(h.puts, isEmpty);
  });

  editorTest('an older overnight row can still be saved while its times are untouched', (tester) async {
    final row = savedRow(extra: {'machineOnTime': '22:00', 'machineOffTime': '06:00', 'plannedOperatorShiftHours': 9, 'lunchMin': 60, 'setupMin': 0});
    final h = await open(tester, row: row, onOccupied: (_) => _saved(const []));
    await settle(tester);
    expect(find.text('Machine OFF Time must be after Machine ON Time'), findsNothing);
    expect(bar(tester).canSave, isTrue);

    form(tester).onChange(0, 'machineOffTime', '05:00');
    await settle(tester);
    expect(find.text('Machine OFF Time must be after Machine ON Time'), findsOneWidget, reason: 'changing the times brings the rule back');
    expect(h.puts, isEmpty);
  });

  editorTest('when the lookup fails the form still works and the server has the last word', (tester) async {
    var asked = 0;
    final h = await open(tester, onOccupied: (_) {
      asked++;
      throw StateError('offline');
    });
    await fillValid(tester);
    await settle(tester);
    form(tester).onChange(0, 'remarks', 'a');
    form(tester).onChange(0, 'remarks', 'ab');
    await settle(tester);
    expect(asked, 1, reason: 'a failing lookup is not retried on every keystroke');
    expect(bar(tester).canSave, isTrue);
    await tapSave(tester);
    await settle(tester);
    expect(h.puts, hasLength(1));
  });
}

/// The editor's live per-block errors, read from the form it feeds.
List<Map<String, String>> state(WidgetTester t) => form(t).errors;
