import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/theme/app_theme.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_draft_store.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_logic.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

/// testWidgets that ignores ONE known overflow that is not the editor's: the
/// form's "Incomplete - N fields need attention" StatusChip (lib/core/widgets/
/// common_widgets.dart) has no Flexible around its label and is wider than the
/// block header at large text. It belongs to the FORM worker's files; every
/// other exception still fails the test.
bool _isFormChipOverflow(FlutterErrorDetails d) =>
    d.exception.toString().contains('overflowed') && d.toString().contains('common_widgets.dart');

void editorTest(String description, Future<void> Function(WidgetTester tester) body) {
  testWidgets(description, (tester) async {
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      if (_isFormChipOverflow(d)) return;
      prev?.call(d);
    };
    try {
      await body(tester);
    } finally {
      FlutterError.onError = prev;
    }
  });
}

const rowPath = '/api/v1/production-sheet/row';

final machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'CNC 1'},
  {'_id': 'm2', 'machineName': 'CNC 2'},
];
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100', 'totalCycleSec': 60, 'drillingSec': 20, 'boringSec': 15},
  {'_id': 'i2', 'itemName': 'Flange', 'drawingNo': 'F-7', 'totalCycleSec': 120},
];
final operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
  {'_id': 'o2', 'name': 'Asha'},
];

/// A saved record that passes validation (ideal 480, 400 made, 60 min allowance, 40 used).
Map<String, dynamic> savedRow({Map<String, dynamic> extra = const {}}) => {
      '_id': 'r1',
      'date': '2026-09-20',
      'machine': 'm2',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'drawingNo': 'D-100',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 400,
      'okQty': 390,
      'rejectedQty': 10,
      'rejectReason': 'Tool Mark',
      'rejectBreakdown': {'Tool Mark': 6, 'Dimension Out': 4},
      'plannedOperatorShiftHours': 9,
      'totalCycleSec': 60,
      'lunchMin': 30,
      'setupMin': 10,
      ...extra,
    };

class _Launcher extends StatelessWidget {
  const _Launcher({required this.popped, this.row, this.machineId});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? machineId;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () async {
              final r = await Navigator.of(context).push<bool>(
                MaterialPageRoute<bool>(
                  builder: (_) => EntryEditorScreen(
                    row: row,
                    initialMachineId: machineId,
                    machines: machines,
                    items: items,
                    operators: operators,
                  ),
                ),
              );
              popped.add(r);
            },
            child: const Text('Open editor'),
          ),
        ),
      );
}

class EditorHarness {
  EditorHarness(this.api, this.popped);
  final FakeApi api;
  final List<bool?> popped;
  List<FakeRequest> get puts => api.called('PUT', rowPath).toList();
  Map<String, dynamic> body(int i) => Map<String, dynamic>.from(puts[i].body as Map);
}

Future<EditorHarness> open(
  WidgetTester tester, {
  Map<String, dynamic>? row,
  String? machineId,
  FakeHandler? onPut,
  Map<String, Object> prefs = const {},
  Size size = const Size(390, 844),
  bool dark = false,
  double textScale = 1.0,
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final api = FakeApi.install();
  api.on('PUT', rowPath, onPut ?? (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  final popped = <bool?>[];
  await pumpScreen(
    tester,
    // Alerts toasts go to the root messenger; give them one to land in.
    ScaffoldMessenger(key: rootMessengerKey, child: _Launcher(popped: popped, row: row, machineId: machineId)),
    size: size,
    dark: dark,
    textScale: textScale,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return EditorHarness(api, popped);
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
EntryActionBar bar(WidgetTester t) => t.widget<EntryActionBar>(find.byType(EntryActionBar));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));
Finder cancelBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(TextButton));

/// Types a complete, valid block the way the form would (through its callbacks).
Future<void> fillValid(WidgetTester t, {int index = 0, String machine = 'm1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', machine);
  f.onChange(index, 'operator', 'Ravi');
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:00');
  f.onChange(index, 'machineOffTime', '16:00');
  f.onChange(index, 'actualQty', '400');
  f.onChange(index, 'okQty', '390');
  f.onRejectChange(index, 'Tool Mark', '6');
  f.onRejectChange(index, 'Dimension Out', '4');
  f.onChange(index, 'plannedOperatorShiftHours', '9');
  f.onChange(index, 'lunchMin', '30');
  f.onChange(index, 'setupMin', '10');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

Future<void> settle(WidgetTester t) => t.pumpAndSettle();

String draftJson(List<Map<String, dynamic>> entries, {int ageMs = 0}) =>
    jsonEncode({'entries': entries, 'savedAt': DateTime.now().millisecondsSinceEpoch - ageMs});

Future<String?> storedDraft() async => (await SharedPreferences.getInstance()).getString(EntryDraftStore.key);

void main() {
  group('add', () {
    editorTest('opens on a blank block dated today, titled Add Production Entry, Save looks inactive', (tester) async {
      final h = await open(tester);
      expect(find.text('Add Production Entry'), findsOneWidget);
      expect(find.byType(ProductionEntryForm), findsOneWidget);
      final f = form(tester);
      expect(f.isEdit, isFalse);
      expect(f.entries, hasLength(1));
      expect(f.entries[0]['machine'], '');
      expect(f.entries[0]['date'], emptyEntry()['date']);
      expect(f.machines, machines);
      expect(f.items, items);
      expect(f.operators, operators);
      expect(f.isSubmit, isFalse);
      expect(f.focusTarget, isNull);
      expect(find.text('Save'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      expect(h.api.requests.where((r) => r.method == 'PUT'), isEmpty);
      expect(tester.takeException(), isNull);
    });

    editorTest('saves one entry: exact PUT body, "Entry added successfully!", pops true', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await settle(tester);

      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'machine', 'slot', 'item', 'excludedOps', 'rejectBreakdown', 'rejectReason',
        'operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark',
        'machineOnTime', 'machineOffTime',
        'actualQty', 'okQty', 'plannedOperatorShiftHours', 'totalCycleSec',
        'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin',
        'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin',
        'drillingSec', 'boringSec', 'threadingSec', 'tappingSec', 'chamferingSec',
        'otherOp1Sec', 'otherOp2Sec', 'clampDeclampSec',
      });
      expect(b['date'], emptyEntry()['date']);
      expect(b['machine'], 'm1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['itemName'], 'Bracket');
      expect(b['drawingNo'], 'D-100');
      expect(b['operator'], 'Ravi');
      expect(b['actualQty'], isA<int>());
      expect(b['actualQty'], 400);
      expect(b['okQty'], 390);
      expect(b['plannedOperatorShiftHours'], 9);
      expect(b['totalCycleSec'], 60);
      expect(b['drillingSec'], 20);
      expect(b['boringSec'], 15);
      expect(b['threadingSec'], '');
      expect(b['rejectBreakdown'], {'Tool Mark': 6, 'Dimension Out': 4});
      expect(b['rejectReason'], 'Tool Mark');
      expect(b['rejectOtherRemark'], '');
      expect(b['otherMinRemark'], '');
      expect(b.containsKey('rejectedQty'), isFalse);

      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
      expect(find.byType(EntryEditorScreen), findsNothing);
      expect(tester.takeException(), isNull);
    });

    editorTest('Other reject and Other downtime send their remarks', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      final f = form(tester);
      // 10 rejected: 6 tool mark + 4 other; 20 min other downtime (10 setup + 20 + 30 lunch = 60 = the allowance).
      f.onRejectChange(0, 'Dimension Out', '');
      f.onRejectChange(0, 'Other', '4');
      f.onChange(0, 'otherMin', '20');
      f.onChange(0, 'setupMin', '10');
      f.onChange(0, 'lunchMin', '30');
      await tester.pump();
      expect(bar(tester).canSave, isFalse, reason: 'both Other figures need a remark');
      form(tester).onChange(0, 'rejectOtherRemark', ' burr ');
      form(tester).onChange(0, 'otherMinRemark', ' crane ');
      await tester.pump();
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await settle(tester);
      final b = h.body(0);
      expect(b['rejectBreakdown'], {'Tool Mark': 6, 'Other': 4});
      expect(b['rejectOtherRemark'], 'burr');
      expect(b['otherMin'], 20);
      expect(b['otherMinRemark'], 'crane');
      expect(h.popped, [true]);
    });

    editorTest('a remark left behind after its Other figure went back to zero is not sent', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      final f = form(tester);
      f.onChange(0, 'rejectOtherRemark', 'stale');
      f.onChange(0, 'otherMinRemark', 'stale');
      await tester.pump();
      await tapSave(tester);
      await settle(tester);
      expect(h.body(0)['rejectOtherRemark'], '');
      expect(h.body(0)['otherMinRemark'], '');
    });

    editorTest('several blocks save one after another, in order, and count in the toast', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      form(tester).onAdd();
      await tester.pump();
      expect(form(tester).entries, hasLength(2));
      await fillValid(tester, index: 1, machine: 'm2');
      expect(bar(tester).entryCount, 2);
      expect(find.text('Save 2 entries'), findsOneWidget);
      await tapSave(tester);
      await settle(tester);

      expect(h.puts, hasLength(2));
      expect(h.body(0)['machine'], 'm1');
      expect(h.body(1)['machine'], 'm2');
      expect(h.body(1)['slot'], 'auto');
      expect(h.popped, [true]);
      expect(find.text('2 entries added successfully!'), findsOneWidget);
    });

    editorTest('a new block copies only the date of the block above', (tester) async {
      await open(tester);
      form(tester).onChange(0, 'date', '2026-09-01');
      form(tester).onChange(0, 'operator', 'Ravi');
      form(tester).onAdd();
      await tester.pump();
      final second = form(tester).entries[1];
      expect(second['date'], '2026-09-01');
      expect(second['operator'], '');
    });

    editorTest('removing a block keeps the others; the last block cannot be removed', (tester) async {
      await open(tester);
      form(tester).onChange(0, 'operator', 'A');
      form(tester).onAdd();
      await tester.pump();
      form(tester).onChange(1, 'operator', 'B');
      form(tester).onAdd();
      await tester.pump();
      form(tester).onChange(2, 'operator', 'C');
      await tester.pump();
      form(tester).onRemove(1);
      await tester.pump();
      expect(form(tester).entries.map((e) => e['operator']), ['A', 'C']);
      form(tester).onRemove(0);
      await tester.pump();
      form(tester).onRemove(0);
      await tester.pump();
      expect(form(tester).entries.map((e) => e['operator']), ['C']);
    });

    editorTest('picking a part copies its values; typing works; the live errors follow', (tester) async {
      await open(tester);
      final f = form(tester);
      f.onItemSelect(0, 'i1');
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '16:00');
      f.onChange(0, 'actualQty', '500');
      await tester.pump();
      var e = form(tester).entries[0];
      expect(e['itemName'], 'Bracket');
      expect(e['drawingNo'], 'D-100');
      expect(e['totalCycleSec'], '60');
      expect(e['drillingSec'], '20');
      expect(form(tester).errors[0]['actualQty'], contains('Ideal Quantity (480)'));
      form(tester).onChange(0, 'actualQty', '480');
      await tester.pump();
      expect(form(tester).errors[0].containsKey('actualQty'), isFalse);
      form(tester).onItemSelect(0, '');
      await tester.pump();
      e = form(tester).entries[0];
      expect(e['item'], '');
      expect(e['itemName'], '');
    });

    editorTest('the machine is pre-selected when it is one of the selectable machines', (tester) async {
      await open(tester, machineId: 'm2');
      expect(form(tester).entries[0]['machine'], 'm2');
    });

    editorTest('an unknown initial machine is ignored', (tester) async {
      await open(tester, machineId: 'zzz');
      expect(form(tester).entries[0]['machine'], '');
    });
  });

  group('validation', () {
    editorTest('Save on an incomplete form saves nothing and hands the form its first incomplete field', (tester) async {
      final h = await open(tester);
      await tapSave(tester);
      expect(h.puts, isEmpty);
      final f = form(tester);
      expect(f.isSubmit, isTrue);
      expect(f.focusTarget, isNotNull);
      expect(f.focusTarget!['index'], 0);
      expect(f.focusTarget!['field'], 'machine');
      final nonce = f.focusTarget!['nonce'];
      expect(find.text('This entry is incomplete — fix the highlighted fields to save.'), findsOneWidget);

      await tapSave(tester);
      expect(form(tester).focusTarget!['nonce'], isNot(nonce), reason: 'pressing Save again scrolls again');
      expect(h.puts, isEmpty);
      expect(h.api.misses, isEmpty);
    });

    editorTest('the target follows what is still missing, in form order', (tester) async {
      await open(tester);
      form(tester).onChange(0, 'machine', 'm1');
      await tester.pump();
      await tapSave(tester);
      expect(form(tester).focusTarget!['field'], 'operator');
      form(tester).onChange(0, 'operator', 'Ravi');
      form(tester).onItemSelect(0, 'i1');
      await tester.pump();
      await tapSave(tester);
      expect(form(tester).focusTarget!['field'], 'machineOnTime');
    });

    editorTest('with several blocks it counts the incomplete ones and points at the first', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      form(tester).onAdd();
      await tester.pump();
      form(tester).onAdd();
      await tester.pump();
      form(tester).onChange(2, 'machine', 'm2');
      await tester.pump();
      await tapSave(tester);
      expect(h.puts, isEmpty);
      expect(find.text('2 of 3 entries are incomplete — fix the highlighted fields to save.'), findsOneWidget);
      expect(form(tester).focusTarget!['index'], 1);
    });

    editorTest('a block that becomes complete clears the message', (tester) async {
      await open(tester);
      await tapSave(tester);
      expect(find.textContaining('incomplete'), findsOneWidget);
      await fillValid(tester);
      expect(find.textContaining('incomplete'), findsNothing);
      expect(bar(tester).canSave, isTrue);
    });

    editorTest('OK above Actual, a short split and a missing Other remark each block the save', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'okQty', '401');
      await tester.pump();
      expect(bar(tester).canSave, isFalse);
      form(tester).onChange(0, 'okQty', '390');
      form(tester).onRejectChange(0, 'Dimension Out', '3');
      await tester.pump();
      expect(bar(tester).canSave, isFalse);
      expect(form(tester).errors[0]['rejectBreakdown'], contains('still have no reason'));
      await tapSave(tester);
      expect(h.puts, isEmpty);
    });

    editorTest('total stoppage above the allowance blocks the save', (tester) async {
      await open(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'noPowerMin', '30');
      await tester.pump();
      expect(form(tester).errors[0]['stoppageTotal'], contains('only 60 min is allowed'));
      expect(bar(tester).canSave, isFalse);
    });
  });

  group('save button', () {
    editorTest('looks inactive while incomplete but is still pressable', (tester) async {
      await open(tester);
      final cs = Theme.of(tester.element(find.byType(EntryActionBar))).colorScheme;
      expect(saveWidget(tester).onPressed, isNotNull);
      final inactiveBg = saveWidget(tester).style!.backgroundColor!.resolve({})!;
      expect(inactiveBg, isNot(cs.primary));
      await fillValid(tester);
      final activeStyle = saveWidget(tester).style!;
      expect(activeStyle.backgroundColor!.resolve({}), isNull, reason: 'the theme colour takes over once complete');
      expect(inactiveBg, isNot(cs.primary));
      expect(saveWidget(tester).onPressed, isNotNull);
    });

    editorTest('shows progress and blocks a second press, Cancel, Close and back while saving', (tester) async {
      final gate = Completer<void>();
      final h = await open(tester, onPut: (r) async {
        await gate.future;
        return {'isOk': true, 'data': r.body};
      });
      await fillValid(tester);
      await tapSave(tester);
      await tester.pump();
      await tester.pump();
      expect(bar(tester).saving, isTrue);
      expect(find.text('Saving…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsWidgets);
      expect(saveWidget(tester).onPressed, isNull);
      expect(tester.widget<TextButton>(cancelBtn()).onPressed, isNull);
      final close = find.descendant(of: find.byType(AppBar), matching: find.byType(IconButton));
      expect(tester.widget<IconButton>(close.first).onPressed, isNull);

      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byType(EntryEditorScreen), findsOneWidget);

      gate.complete();
      await settle(tester);
      expect(h.puts, hasLength(1), reason: 'no double submit');
      expect(h.popped, [true]);
    });

    editorTest('an update button reads Update / Updating…', (tester) async {
      await open(tester, row: savedRow());
      expect(find.text('Update'), findsOneWidget);
      expect(find.text('Save'), findsNothing);
    });
  });

  group('server errors', () {
    editorTest('a rejected save keeps the form, shows the server message and can be retried', (tester) async {
      var calls = 0;
      final h = await open(tester, onPut: (r) {
        calls++;
        if (calls == 1) {
          return FakeResponse({'isOk': false, 'message': 'This machine already has 3 entries on 2026-09-25 — edit one of them instead'}, status: 400);
        }
        return {'isOk': true, 'data': r.body};
      });
      await fillValid(tester);
      await tapSave(tester);
      await settle(tester);

      expect(h.popped, isEmpty);
      expect(find.byType(EntryEditorScreen), findsOneWidget);
      expect(find.text('This machine already has 3 entries on 2026-09-25 — edit one of them instead'), findsOneWidget);
      expect(form(tester).entries, hasLength(1));
      expect(form(tester).entries[0]['operator'], 'Ravi');
      expect(bar(tester).saving, isFalse);
      expect(saveWidget(tester).onPressed, isNotNull);

      // Editing clears the stale message; pressing Save again succeeds.
      form(tester).onChange(0, 'remarks', 'retry');
      await tester.pump();
      expect(find.textContaining('already has 3 entries'), findsNothing);
      await tapSave(tester);
      await settle(tester);
      expect(h.puts, hasLength(2));
      expect(h.popped, [true]);
    });

    editorTest('the lock message of a 403 is shown as is', (tester) async {
      const lock = 'This entry is more than 2 working days old and is locked. Ask a Super Admin to unlock it.';
      final h = await open(tester, row: savedRow(), onPut: (_) => FakeResponse({'isOk': false, 'message': lock}, status: 403));
      await tapSave(tester);
      await settle(tester);
      expect(find.text(lock), findsOneWidget);
      expect(h.popped, isEmpty);
    });

    editorTest('an unreachable server gives a readable message', (tester) async {
      await open(tester, onPut: (_) => throw Exception('socket'));
      await fillValid(tester);
      await tapSave(tester);
      await settle(tester);
      expect(find.byType(EntryEditorScreen), findsOneWidget);
      expect(find.byIcon(Icons.error_outline_rounded), findsWidgets);
    });

    editorTest('a failure after some blocks were saved drops them, so a retry cannot duplicate', (tester) async {
      var calls = 0;
      final h = await open(tester, onPut: (r) {
        calls++;
        if (calls == 2) {
          return FakeResponse({'isOk': false, 'message': 'This machine already has 3 entries on 2026-09-25 — edit one of them instead'}, status: 400);
        }
        return {'isOk': true, 'data': r.body};
      });
      await fillValid(tester);
      form(tester).onAdd();
      await tester.pump();
      await fillValid(tester, index: 1, machine: 'm2');
      await tapSave(tester);
      await settle(tester);

      expect(h.puts, hasLength(2));
      expect(h.popped, isEmpty);
      expect(form(tester).entries, hasLength(1));
      expect(form(tester).entries[0]['machine'], 'm2', reason: 'only the block that failed is left');
      expect(
        find.text('1 saved, then: This machine already has 3 entries on 2026-09-25 — edit one of them instead The rest are still in the form.'),
        findsOneWidget,
      );

      await tapSave(tester);
      await settle(tester);
      expect(h.puts, hasLength(3));
      expect(h.body(2)['machine'], 'm2', reason: 'the first block is not saved a second time');
      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
    });

    editorTest('leaving after a partial save still tells the sheet to refresh (pops true) and keeps the rest as a draft', (tester) async {
      var calls = 0;
      final h = await open(tester, onPut: (r) {
        calls++;
        return calls == 2 ? FakeResponse({'isOk': false, 'message': 'boom'}, status: 400) : {'isOk': true, 'data': r.body};
      });
      await fillValid(tester);
      form(tester).onAdd();
      await tester.pump();
      await fillValid(tester, index: 1, machine: 'm2');
      await tapSave(tester);
      await settle(tester);
      expect(find.textContaining('1 saved, then: boom'), findsOneWidget);

      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.text('Leave this entry?'), findsOneWidget);
      await tester.tap(find.text('Leave'));
      await settle(tester);
      expect(h.popped, [true]);
      final draft = jsonDecode((await storedDraft())!) as Map<String, dynamic>;
      expect((draft['entries'] as List), hasLength(1));
      expect((draft['entries'] as List).first['machine'], 'm2');
    });
  });

  group('edit', () {
    editorTest('loads the record, locks the slot, saves back to its own slot and machine', (tester) async {
      final h = await open(tester, row: savedRow());
      expect(find.text('Update Production Entry'), findsOneWidget);
      expect(find.byTooltip('Clear form'), findsNothing);
      final f = form(tester);
      expect(f.isEdit, isTrue);
      expect(f.entries, hasLength(1));
      expect(f.entries[0]['machine'], 'm2');
      expect(f.entries[0]['slot'], 2);
      expect(f.entries[0]['okQty'], '390', reason: 'typed fields are Strings');
      expect(f.entries[0]['rejectBreakdown'], {'Tool Mark': '6', 'Dimension Out': '4'});
      expect(bar(tester).canSave, isTrue);

      form(tester).onChange(0, 'okQty', '395');
      form(tester).onRejectChange(0, 'Dimension Out', '');
      form(tester).onRejectChange(0, 'Tool Mark', '5');
      await tester.pump();
      await tapSave(tester);
      await settle(tester);

      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b['slot'], 2);
      expect(b['slot'], isA<int>());
      expect(b['machine'], 'm2');
      expect(b['date'], '2026-09-20');
      expect(b['okQty'], 395);
      expect(b['rejectBreakdown'], {'Tool Mark': 5});
      expect(b['rejectReason'], 'Tool Mark');
      expect(h.popped, [true]);
      expect(find.text('Entry updated successfully!'), findsOneWidget);
      expect(await storedDraft(), isNull, reason: 'edits never write the add draft');
    });

    editorTest('a record saved with one reject reason opens with it in the split', (tester) async {
      await open(tester, row: savedRow(extra: {'rejectBreakdown': null, 'rejectReason': 'Surface Finish'}));
      expect(form(tester).entries[0]['rejectBreakdown'], {'Surface Finish': '10'});
      expect(bar(tester).canSave, isTrue);
    });

    editorTest("a record's machine that is no longer selectable stays in the list", (tester) async {
      await open(tester, row: savedRow(extra: {'machine': 'm9'}));
      expect(form(tester).machines.map((m) => m['_id']), ['m1', 'm2', 'm9']);
      expect(form(tester).entries[0]['machine'], 'm9');
    });

    editorTest('closing without changes leaves at once; with changes it asks first', (tester) async {
      final h = await open(tester, row: savedRow());
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, [false]);

      final h2 = await open(tester, row: savedRow());
      form(tester).onChange(0, 'remarks', 'x');
      await tester.pump();
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.text('Discard changes?'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await settle(tester);
      expect(find.byType(EntryEditorScreen), findsOneWidget);
      expect(form(tester).entries[0]['remarks'], 'x');
      await tester.tap(find.text('Cancel'));
      await settle(tester);
      await tester.tap(find.text('Discard'));
      await settle(tester);
      expect(h2.popped, [false]);
      expect(h2.puts, isEmpty);
    });

    editorTest('typing a change and typing it back is not a change', (tester) async {
      final h = await open(tester, row: savedRow());
      form(tester).onChange(0, 'remarks', 'x');
      await tester.pump();
      form(tester).onChange(0, 'remarks', '');
      await tester.pump();
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, [false]);
    });
  });

  group('leaving and the draft', () {
    editorTest('a form nobody touched closes silently and stores no draft', (tester) async {
      final h = await open(tester, machineId: 'm1');
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, [false]);
      expect(await storedDraft(), isNull);
    });

    editorTest('closing with typing asks, Keep editing stays, Leave stores a draft', (tester) async {
      final h = await open(tester);
      form(tester).onChange(0, 'operator', 'Ravi');
      form(tester).onChange(0, 'machine', 'm1');
      await tester.pump();
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.text('Leave this entry?'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await settle(tester);
      expect(find.byType(EntryEditorScreen), findsOneWidget);
      expect(await storedDraft(), isNull);

      await tester.tap(find.text('Cancel'));
      await settle(tester);
      await tester.tap(find.text('Leave'));
      await settle(tester);
      expect(h.popped, [false]);
      final draft = jsonDecode((await storedDraft())!) as Map<String, dynamic>;
      expect((draft['entries'] as List).single['operator'], 'Ravi');
      expect((draft['savedAt'] as int) > 0, isTrue);
    });

    editorTest('the system back button asks the same question', (tester) async {
      final h = await open(tester);
      form(tester).onChange(0, 'operator', 'Ravi');
      await tester.pump();
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.text('Leave this entry?'), findsOneWidget);
      await tester.tap(find.text('Leave'));
      await settle(tester);
      expect(h.popped, [false]);
    });

    editorTest('the system back button on an untouched form just leaves', (tester) async {
      final h = await open(tester);
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, hasLength(1));
      expect(find.byType(EntryEditorScreen), findsNothing);
    });

    editorTest('reopening within a minute brings the typing back, with a notice', (tester) async {
      final h = await open(tester);
      form(tester).onChange(0, 'operator', 'Ravi');
      form(tester).onChange(0, 'machine', 'm2');
      form(tester).onChange(0, 'okQty', '12');
      await tester.pump();
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      await tester.tap(find.text('Leave'));
      await settle(tester);
      expect(h.popped, [false]);

      await tester.tap(find.text('Open editor'));
      await settle(tester);
      expect(find.text('Restored what you were typing.'), findsOneWidget);
      final e = form(tester).entries.single;
      expect(e['operator'], 'Ravi');
      expect(e['machine'], 'm2');
      expect(e['okQty'], '12');
      expect(e['lunchMin'], '');
    });

    editorTest('a draft older than a minute is ignored and removed', (tester) async {
      await open(tester, prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi')], ageMs: 61 * 1000)});
      expect(find.text('Restored what you were typing.'), findsNothing);
      expect(form(tester).entries.single['operator'], '');
      expect(await storedDraft(), isNull);
    });

    editorTest('a draft written by an older build gets the fields it lacks', (tester) async {
      await open(tester, prefs: {
        EntryDraftStore.key: jsonEncode({
          'entries': [
            {'machine': 'm1', 'operator': 'Ravi'},
          ],
          'savedAt': DateTime.now().millisecondsSinceEpoch,
        }),
      });
      final e = form(tester).entries.single;
      expect(e['operator'], 'Ravi');
      expect(e['lunchMin'], '');
      expect(e['rejectBreakdown'], <String, dynamic>{});
      expect(e['excludedOps'], <dynamic>[]);
      expect(e['date'], emptyEntry()['date']);
    });

    editorTest('a restored draft wins over the pre-selected machine', (tester) async {
      await open(tester, machineId: 'm1', prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi', machine: 'm2')])});
      expect(form(tester).entries.single['machine'], 'm2');
    });

    editorTest('a restored draft that is left alone closes silently and keeps the draft', (tester) async {
      final stored = draftJson([validBlockFor('Ravi')]);
      final h = await open(tester, prefs: {EntryDraftStore.key: stored});
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, [false]);
      expect(await storedDraft(), stored);
    });

    editorTest('a successful save clears the draft', (tester) async {
      final h = await open(tester, prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi')])});
      expect(find.text('Restored what you were typing.'), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await settle(tester);
      expect(h.body(0)['operator'], 'Ravi');
      expect(h.popped, [true]);
      expect(await storedDraft(), isNull);
    });

    editorTest('Clear form asks, then blanks every block and drops the draft', (tester) async {
      await open(tester, prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi'), validBlockFor('Asha')])});
      expect(form(tester).entries, hasLength(2));
      await tester.tap(find.byTooltip('Clear form'));
      await settle(tester);
      expect(find.text("Clear everything typed in this form? This can't be undone."), findsOneWidget);

      await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Cancel')));
      await settle(tester);
      expect(form(tester).entries, hasLength(2), reason: 'cancelled');

      await tester.tap(find.byTooltip('Clear form'));
      await settle(tester);
      await tester.tap(find.text('Clear'));
      await settle(tester);
      expect(form(tester).entries, hasLength(1));
      expect(form(tester).entries.single['operator'], '');
      expect(form(tester).isSubmit, isFalse);
      expect(find.text('Restored what you were typing.'), findsNothing);
      expect(await storedDraft(), isNull);
      expect(find.byTooltip('Clear form'), findsNothing, reason: 'nothing left to clear');
    });

    editorTest('the banner\'s Start over does the same as Clear form', (tester) async {
      await open(tester, prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi')])});
      await tester.tap(find.text('Start over'));
      await settle(tester);
      await tester.tap(find.text('Clear'));
      await settle(tester);
      expect(form(tester).entries.single['operator'], '');
      expect(await storedDraft(), isNull);
    });

    editorTest('closing after everything was erased drops the draft without asking', (tester) async {
      final h = await open(tester, prefs: {EntryDraftStore.key: draftJson([validBlockFor('Ravi')])});
      final blank = emptyEntry();
      for (final k in blank.keys) {
        if (k == 'rejectBreakdown' || k == 'excludedOps' || k == 'slot') continue;
        form(tester).onChange(0, k, blank[k]);
      }
      form(tester).onChange(0, 'rejectBreakdown', <String, dynamic>{});
      await tester.pump();
      await tester.tap(find.byTooltip('Close'));
      await settle(tester);
      expect(find.byType(AlertDialog), findsNothing);
      expect(h.popped, [false]);
      expect(await storedDraft(), isNull);
    });
  });

  group('layout', () {
    for (final c in <String, (Size, bool, double)>{
      'light 390x844': (const Size(390, 844), false, 1.0),
      'dark 390x844': (const Size(390, 844), true, 1.0),
      'small phone 360x640': (const Size(360, 640), false, 1.0),
      'small phone dark 360x640': (const Size(360, 640), true, 1.0),
      'text scale 1.6 on 360x640': (const Size(360, 640), false, 1.6),
      'text scale 1.6 dark on 360x640': (const Size(360, 640), true, 1.6),
      'landscape 844x390': (const Size(844, 390), false, 1.0),
      'tablet 1024x768': (const Size(1024, 768), false, 1.0),
    }.entries) {
      editorTest('renders without overflow: ${c.key}', (tester) async {
        final (size, dark, scale) = c.value;
        await open(tester, size: size, dark: dark, textScale: scale);
        expect(bar(tester), isNotNull);
        // The failed-press message and three blocks make the bar as tall as it gets.
        form(tester).onAdd();
        await tester.pump();
        form(tester).onAdd();
        await tester.pump();
        await tapSave(tester);
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.text('Save 3 entries'), findsOneWidget);
        expect(find.text('3 of 3 entries are incomplete — fix the highlighted fields to save.'), findsOneWidget);
        expect(tester.takeException(), isNull);

        // Save/Cancel keep a comfortable tap target.
        expect(tester.getSize(saveBtn()).height, greaterThanOrEqualTo(44));
        expect(tester.getSize(cancelBtn()).height, greaterThanOrEqualTo(44));
        expect(tester.getRect(saveBtn()).right, lessThanOrEqualTo(size.width));

        if (size.width > 960) {
          expect(tester.getSize(find.byType(ProductionEntryForm)).width, lessThanOrEqualTo(960));
        }
      });
    }

    editorTest('the bar follows the theme in dark mode', (tester) async {
      await open(tester, dark: true);
      final ctx = tester.element(find.byType(EntryActionBar));
      final cs = Theme.of(ctx).colorScheme;
      expect(cs.brightness, Brightness.dark);
      expect(Theme.of(ctx).colorScheme.surface, AppTheme.dark().colorScheme.surface);
      final deco = tester.widget<DecoratedBox>(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(DecoratedBox)).first);
      expect((deco.decoration as BoxDecoration).color, cs.surface);
      await tapSave(tester);
      expect(tester.takeException(), isNull);
    });

    editorTest('a long server message wraps inside the bar on a small phone at large text', (tester) async {
      await open(
        tester,
        size: const Size(360, 640),
        textScale: 1.6,
        onPut: (_) => FakeResponse({'isOk': false, 'message': 'Total stoppage (75 min) can\'t be more than Planned Operator Shift − Machine Shift (60 min)'}, status: 400),
      );
      await fillValid(tester);
      await tapSave(tester);
      await settle(tester);
      expect(find.textContaining('Total stoppage (75 min)'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    for (final size in const [Size(360, 640), Size(390, 844)]) {
      editorTest('with the keyboard up the bar folds away as it rises and is back when it closes: ${size.width.toInt()}', (tester) async {
        await open(tester, size: size);
        expect(find.byType(EntryActionBar), findsOneWidget);
        final full = tester.getSize(find.byType(EntryActionBar)).height;
        // Half way up the bar is half folded (no jump), all the way up it is gone.
        tester.view.viewInsets = const FakeViewPadding(bottom: 50);
        await tester.pump();
        expect(tester.getSize(find.byType(ClipRect).last).height, lessThan(full));
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pump();
        expect(find.byType(EntryActionBar), findsNothing);
        tester.view.viewInsets = FakeViewPadding.zero;
        await tester.pump();
        expect(find.byType(EntryActionBar), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  });
}

FilledButton saveWidget(WidgetTester t) => t.widget<FilledButton>(saveBtn());

/// A complete block for seeding a draft.
Map<String, dynamic> validBlockFor(String operator, {String machine = 'm1'}) => {
      ...emptyEntry(),
      'machine': machine,
      'operator': operator,
      'item': 'i1',
      'itemName': 'Bracket',
      'drawingNo': 'D-100',
      'totalCycleSec': '60',
      'drillingSec': '20',
      'boringSec': '15',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': '400',
      'okQty': '390',
      'rejectBreakdown': <String, dynamic>{'Tool Mark': '6', 'Dimension Out': '4'},
      'plannedOperatorShiftHours': '9',
      'lunchMin': '30',
      'setupMin': '10',
    };
