// Web FormLine `optional` (folded cards: Planned Operator Shift, Downtime, Remarks, Rejection),
// the removed Machine Shift box, and SearchablePartSelect (grouping + Drawing No. search).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/utils/alerts.dart' show rootMessengerKey;
import 'package:indo/core/widgets/form_widgets.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_layout.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/part_options.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_api.dart';

final _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'CNC 1', 'process': 'p1'}, // locked at 8 h
  {'_id': 'm2', 'machineName': 'CNC 2', 'process': 'p3'}, // typed by hand
];
final _processes = <Map<String, dynamic>>[
  {'_id': 'p1', 'plannedShiftLocked': true, 'plannedShiftHours': 8},
  {'_id': 'p3', 'plannedShiftLocked': false},
];
final _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100', 'totalCycleSec': 60, 'process': 'p1'},
  {'_id': 'i2', 'itemName': 'Washer', 'drawingNo': 'PG21-7', 'totalCycleSec': 30, 'process': ''},
  {'_id': 'i3', 'itemName': 'Axle', 'drawingNo': '', 'totalCycleSec': 90, 'process': 'p1'},
];

class _Launcher extends StatelessWidget {
  const _Launcher();
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.of(context).push<bool>(
              MaterialPageRoute<bool>(
                builder: (_) => EntryEditorScreen(
                  spec: cncSpec,
                  machines: _machines,
                  items: _items,
                  operators: const [],
                  processes: _processes,
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

Future<void> _open(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  EntryNotices.reset();
  final api = FakeApi.install();
  api.on('GET', '/api/v1/production-sheet/occupied', (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(tester, ScaffoldMessenger(key: rootMessengerKey, child: const _Launcher()));
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
}

ProductionEntryForm _form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder _k(String key) => find.byKey(ValueKey(key));

Future<void> _pickMachine(WidgetTester t, String id) async {
  _form(t).onChange(0, 'machine', id);
  await t.pumpAndSettle();
  if (_k('entry0/expand').evaluate().isNotEmpty) {
    await t.tap(_k('entry0/expand'));
    await t.pumpAndSettle();
  }
}

void main() {
  setUp(() {
    EntryFormToast.reset();
    EntryNotices.reset();
    EntryLineCard.foldOptional = true; // the real app's behaviour (tests default to open)
  });
  tearDown(() => EntryLineCard.foldOptional = false);

  group('EntryLineCard optional (web FormLine)', () {
    Future<void> pump(WidgetTester t, EntryLineCard card) =>
        t.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(child: card))));

    EntryLineCard card({bool hasValue = false, bool openByDefault = false, bool hasError = false, String summary = '', String? revealKey}) =>
        EntryLineCard(
          title: 'Opt',
          icon: Icons.notes_rounded,
          optional: true,
          hasValue: hasValue,
          openByDefault: openByDefault,
          hasError: hasError,
          summary: summary,
          revealKey: revealKey,
          children: const [Text('inside')],
        );

    testWidgets('starts folded to one row, "Optional — tap to add", fields stay mounted; a tap opens and folds it', (t) async {
      await pump(t, card());
      expect(find.text('inside'), findsNothing); // hidden
      expect(find.text('inside', skipOffstage: false), findsOneWidget); // but still mounted
      expect(find.text('Optional — tap to add'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('line-toggle/Opt')));
      await t.pump();
      expect(find.text('inside'), findsOneWidget);
      expect(find.text('Optional — tap to add'), findsNothing);
      await t.tap(find.byKey(const ValueKey('line-toggle/Opt')));
      await t.pump();
      expect(find.text('inside'), findsNothing);
    });

    testWidgets('opens by itself when it holds something, needs typing, or has an error', (t) async {
      await pump(t, card(hasValue: true));
      expect(find.text('inside'), findsOneWidget);
      await pump(t, card(openByDefault: true));
      expect(find.text('inside'), findsOneWidget);
      await pump(t, card(hasError: true));
      expect(find.text('inside'), findsOneWidget);
      expect(find.text('Check this line'), findsOneWidget);
    });

    testWidgets('a folded card shows its summary instead; "Filled in" once it has a value and is folded', (t) async {
      await pump(t, card(summary: 'Fixed — nothing to enter'));
      expect(find.text('Fixed — nothing to enter'), findsOneWidget);
      expect(find.text('Optional — tap to add'), findsNothing);
    });

    testWidgets('a later hasValue opens a folded card (web useEffect); reveal() opens it from outside', (t) async {
      await pump(t, card(revealKey: 'k'));
      expect(find.text('inside'), findsNothing);
      expect(EntryLineCard.reveal('k'), isTrue);
      await t.pump();
      expect(find.text('inside'), findsOneWidget);
      expect(EntryLineCard.reveal('nope'), isFalse);
    });
  });

  group('CNC form', () {
    testWidgets('Planned Shift is folded and says "Fixed" when Process Master locks it; Downtime and Remarks start folded', (t) async {
      await _open(t);
      await _pickMachine(t, 'm1');
      await t.pumpAndSettle();
      expect(find.text('Fixed — nothing to enter'), findsOneWidget);
      expect(_k('entry0/plannedOperatorShiftHours'), findsNothing); // hidden
      expect(find.text('Optional — tap to add'), findsWidgets); // Rejection, Downtime, Remarks
      await t.ensureVisible(find.byKey(const ValueKey('line-toggle/Planned Operator Shift, Lunch / Rest')));
      await t.tap(find.byKey(const ValueKey('line-toggle/Planned Operator Shift, Lunch / Rest')));
      await t.pumpAndSettle();
      expect(_k('entry0/plannedOperatorShiftHours'), findsOneWidget);
      expect(find.textContaining('Fixed at 8:00 hr'), findsOneWidget);
    });

    testWidgets('an unlocked process opens the Planned Shift card for typing', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      await t.pumpAndSettle();
      expect(_k('entry0/plannedOperatorShiftHours'), findsOneWidget);
      expect(find.text('Fixed — nothing to enter'), findsNothing);
    });

    testWidgets('typing in Lunch / Rest (or any downtime box) opens its card; values keep when folded', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      expect(_k('entry0/setupMin'), findsNothing); // Downtime folded
      _form(t).onChange(0, 'setupMin', '10');
      await t.pumpAndSettle();
      expect(_k('entry0/setupMin'), findsOneWidget); // has a value -> opens
    });

    testWidgets('the Status "Remarks" tick opens the folded Remarks card and puts the cursor in it', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      await t.ensureVisible(_k('entry0/workingMode/Non Working'));
      await t.tap(_k('entry0/workingMode/Non Working'));
      await t.pumpAndSettle();
      expect(_k('entry0/remarks'), findsNothing); // folded
      await t.ensureVisible(_k('entry0/machineStatus/Remarks'));
      await t.tap(_k('entry0/machineStatus/Remarks'));
      await t.pumpAndSettle();
      expect(_k('entry0/remarks'), findsOneWidget);
      final field = t.widget<TextField>(find.descendant(of: _k('entry0/remarks'), matching: find.byType(TextField)));
      expect(field.focusNode!.hasFocus, isTrue);
    });

    testWidgets('a value in a folded card (Downtime) opens it', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      expect(_k('entry0/otherMin'), findsNothing); // Downtime folded
      _form(t).onChange(0, 'otherMin', '5'); // "Other" used -> its remark is required; the card opens by value
      await t.pumpAndSettle();
      expect(_k('entry0/otherMin'), findsOneWidget);
    });

    testWidgets('there is no Machine Shift box in the time card (the web removed it); the shift only shows in the planned-shift rule', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      expect(find.text('Machine Shift (hr)', skipOffstage: false), findsNothing);
      expect(_k('entry0/calc/shiftHours'), findsNothing);
      expect(find.text('Machine ON–OFF Time, Machine Shift'), findsOneWidget);
      _form(t).onChange(0, 'machineOnTime', '08:00');
      _form(t).onChange(0, 'machineOffTime', '16:00');
      _form(t).onChange(0, 'plannedOperatorShiftHours', '7.5');
      await t.pumpAndSettle();
      // The time rule shows live (and replaces the hint, as on the web).
      expect(find.text("Planned Operator Shift can't be less than the Machine Shift (8:00)"), findsOneWidget);
      _form(t).onChange(0, 'plannedOperatorShiftHours', '');
      await t.pumpAndSettle();
      expect(find.text('Type hours as on the sheet — 3.5 is 3 h 30 min.'), findsOneWidget);
    });
  });

  group('Part picker (web SearchablePartSelect)', () {
    test('parts with a process first, the rest under "Not in any process"; search = name or Drawing No. only', () {
      final o = partPickOptions(_items, (_) => null);
      expect([for (final x in o) x.label], ['Bracket', 'Axle', 'Washer']);
      expect([for (final x in o) x.group], [null, null, notInAnyProcess]);
      expect(o.first.detail, 'Drawing No.: D-100');
      expect(o[1].detail, isNull); // no drawing number -> no line
      expect(o.last.searchTerms, ['Washer', 'PG21-7']);
    });

    test('no unassigned part -> no group header at all', () {
      final o = partPickOptions([_items.first], (_) => null);
      expect(o.single.group, isNull);
    });

    testWidgets('the sheet shows the group header, always has a search box, and finds a part by Drawing No.', (t) async {
      await _open(t);
      await _pickMachine(t, 'm2');
      await t.ensureVisible(_k('entry0/itemName'));
      await t.tap(_k('entry0/itemName'));
      await t.pumpAndSettle();
      expect(find.text('Not in any process'), findsOneWidget);
      expect(find.text('Drawing No.: PG21-7'), findsOneWidget);
      final search = find.descendant(of: find.byType(BottomSheet), matching: find.byType(TextField));
      expect(search, findsOneWidget); // 3 parts only, still searchable (like the web)
      await t.enterText(search, 'pg21');
      await t.pumpAndSettle();
      expect(find.text('Washer'), findsOneWidget);
      expect(find.text('Bracket'), findsNothing);
      await t.enterText(search, 'axle');
      await t.pumpAndSettle();
      expect(find.text('Axle'), findsOneWidget);
      expect(find.text('Washer'), findsNothing);
      expect(find.text('Not in any process'), findsNothing); // its only member is filtered out
      await t.tap(find.text('Axle'));
      await t.pumpAndSettle();
      expect(_form(t).entries[0]['item'], 'i3');
    });

    testWidgets('PickOption searchTerms replace label + subtitle matching', (t) async {
      await t.pumpWidget(MaterialApp(
        home: Builder(
          builder: (c) => TextButton(
            onPressed: () => showPicker<String>(
              c,
              title: 'Part Name',
              options: const [PickOption('a', 'Alpha', subtitle: 'zzz', searchTerms: ['Alpha', 'D-1'])],
              alwaysSearch: true,
            ),
            child: const Text('go'),
          ),
        ),
      ));
      await t.tap(find.text('go'));
      await t.pumpAndSettle();
      await t.enterText(find.byType(TextField), 'zzz');
      await t.pumpAndSettle();
      expect(find.text('Alpha'), findsNothing); // the subtitle is not searched
      await t.enterText(find.byType(TextField), 'd-1');
      await t.pumpAndSettle();
      expect(find.text('Alpha'), findsOneWidget);
    });
  });
}
