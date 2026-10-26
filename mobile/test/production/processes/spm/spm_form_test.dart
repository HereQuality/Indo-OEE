import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/processes/spm/spm_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

// The SPM form through the real editor screen: its cards render, the caps and the
// operation ticks behave, and Save PUTs the web's payload to /spm-sheet/row.

const rowPath = '/api/v1/spm-sheet/row';
const occupiedPath = '/api/v1/spm-sheet/occupied';

final machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'SPM 1'},
  {'_id': 'm2', 'machineName': 'SPM 2'},
];
final items = <Map<String, dynamic>>[
  {
    '_id': 'i1',
    'itemName': 'Bracket',
    'drawingNo': 'D-100',
    'totalCycleSec': 30,
    'loadingSec': 5,
    'processSec': 20,
    'unloadingCleaningSec': 3,
    'otherOperationsSec': 2,
    'noOfHoles': 4,
    'piecesPerCycle': 2,
    'strokeRequired': 1,
  },
  // An older part without its operation times / reference figures.
  {'_id': 'i2', 'itemName': 'Old part', 'totalCycleSec': 60},
];

class _Launcher extends StatelessWidget {
  const _Launcher({required this.popped, this.row, this.machineId});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? machineId;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () async => popped.add(
              await Navigator.of(context).push<bool>(
                MaterialPageRoute<bool>(
                  builder: (_) => EntryEditorScreen(
                    spec: spmSpec,
                    row: row,
                    initialMachineId: machineId,
                    machines: machines,
                    items: items,
                    operators: const [
                      {'_id': 'o1', 'name': 'Ravi'},
                    ],
                  ),
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

Future<({FakeApi api, List<bool?> popped})> open(WidgetTester tester, {Map<String, dynamic>? row, String? machineId = 'm1'}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  final popped = <bool?>[];
  await pumpScreen(tester, ScaffoldMessenger(key: rootMessengerKey, child: _Launcher(popped: popped, row: row, machineId: machineId)));
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return (api: api, popped: popped);
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));
Finder inputOf(String field) => find.descendant(of: find.byKey(ValueKey('entry0/$field')), matching: find.byType(TextField));
Finder calcText(String key, String text) => find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.text(text));

/// A complete, valid block, typed the way the form would.
Future<void> fillValid(WidgetTester t) async {
  final f = form(t);
  f.onChange(0, 'operator', 'Ravi');
  f.onItemSelect(0, 'i1');
  f.onChange(0, 'machineOnTime', '08:00');
  f.onChange(0, 'machineOffTime', '16:00');
  f.onChange(0, 'actualQty', '420');
  f.onChange(0, 'okQty', '400');
  f.onRejectChange(0, 'Tool Mark', '20');
  f.onChange(0, 'plannedOperatorShiftHours', '9');
  f.onChange(0, 'lunchMin', '30');
  f.onChange(0, 'setupMin', '10');
  await t.pump();
}

void main() {
  setUp(EntryNotices.reset);
  tearDown(EntryFormToast.reset);

  testWidgets('add: the SPM cards are drawn, with the Production Master and Rejection Master', (tester) async {
    await open(tester);
    expect(find.text('Add SPM Entry'), findsOneWidget);
    for (final title in [
      'Date, Machine No., Operator',
      'Part, Cycle Breakdown',
      'Machine ON–OFF Time, Machine Shift',
      'Production Master',
      'Rejection Master (Qty)',
      'Planned Operator Shift, Lunch / Rest',
      'Downtime / Stoppage (min)',
      'Remarks',
    ]) {
      expect(find.text(title), findsOneWidget, reason: title);
    }
    expect(find.text('Production (Qty)'), findsNothing);
    expect(find.text('Machine Working Status'), findsOneWidget);
    for (final label in ['Actual Quantity', 'OK Quantity', 'Rejected', 'No. of Holes in One Piece', 'No. of Piece in One Cycle', 'Stroke Required for One Piece', 'Total Cycle Time (Sec)', 'Planned Downtime (min)', 'Others (min)']) {
      expect(find.textContaining(label), findsWidgets, reason: label);
    }
    // Nine downtime boxes (Lunch / Rest sits with Planned Operator Shift).
    for (final k in ['plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'otherMin', 'lunchMin']) {
      expect(find.byKey(ValueKey('entry0/$k')), findsOneWidget, reason: k);
    }
    expect(find.byKey(const ValueKey('entry0/actualQty')), findsOneWidget);
  });

  testWidgets('picking a part copies its figures; unticking an operation lowers this entry\'s cycle time only', (tester) async {
    await open(tester);
    form(tester).onItemSelect(0, 'i1');
    form(tester).onChange(0, 'machineOnTime', '08:00');
    form(tester).onChange(0, 'machineOffTime', '16:00');
    await tester.pump();
    final v = form(tester).entries[0];
    expect([v['totalCycleSec'], v['loadingSec'], v['processSec'], v['noOfHoles'], v['piecesPerCycle'], v['strokeRequired'], v['drawingNo']], ['30', '5', '20', '4', '2', '1', 'D-100']);
    expect(calcText('totalCycleSec', '30'), findsOneWidget);
    expect(calcText('idealQty', '960'), findsOneWidget); // 8 h = 28800 s / 30 s
    expect(calcText('noOfHoles', '4'), findsOneWidget);

    // Untick "Loading — 5": 25 s a piece, Ideal 1152; the Part's own figures are untouched.
    await tester.ensureVisible(find.byKey(const ValueKey('entry0/loadingSec')));
    await tester.tap(find.byKey(const ValueKey('entry0/loadingSec')));
    await tester.pump();
    expect(form(tester).entries[0]['excludedOps'], ['loadingSec']);
    expect(form(tester).entries[0]['loadingSec'], '5');
    expect(calcText('totalCycleSec', '25'), findsOneWidget);
    expect(calcText('idealQty', '1152'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('entry0/loadingSec')));
    await tester.pump();
    expect(form(tester).entries[0]['excludedOps'], isEmpty);
    expect(calcText('totalCycleSec', '30'), findsOneWidget);
  });

  testWidgets('Actual is capped by Ideal Quantity (with the web popup) and OK by Actual', (tester) async {
    final toasts = <String>[];
    EntryFormToast.sink = toasts.add;
    await open(tester);
    form(tester).onItemSelect(0, 'i1');
    form(tester).onChange(0, 'machineOnTime', '08:00');
    form(tester).onChange(0, 'machineOffTime', '08:10'); // 600 s / 30 s = Ideal 20
    await tester.pump();
    expect(calcText('idealQty', '20'), findsOneWidget);

    await tester.ensureVisible(inputOf('actualQty'));
    await tester.enterText(inputOf('actualQty'), '21'); // 21 > Ideal 20: refused
    await tester.pump();
    expect(form(tester).entries[0]['actualQty'], '');
    await tester.pump(const Duration(milliseconds: 10));
    // The web's popup with the figures (21 against Ideal 20), not a toast.
    expect(toasts, isEmpty);
    expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
    expect(find.textContaining('this machine can make at most 20 pieces in this shift.'), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(const ValueKey('entry-notice/value/Actual Quantity'))).data, '21');
    await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
    await tester.pumpAndSettle();
    await tester.enterText(inputOf('actualQty'), '20'); // exactly fits
    await tester.pump();
    expect(form(tester).entries[0]['actualQty'], '20');

    // OK can't pass Actual (a toast); Rejected = Actual − OK.
    await tester.ensureVisible(inputOf('okQty'));
    await tester.enterText(inputOf('okQty'), '21');
    await tester.pump();
    expect(form(tester).entries[0]['okQty'], '');
    expect(toasts, ["OK Quantity can't be more than Actual Quantity (20)"]);
    await tester.enterText(inputOf('okQty'), '15');
    await tester.pump();
    expect(form(tester).entries[0]['okQty'], '15');
    expect(calcText('rejectedQty', '5'), findsOneWidget);
    expect(calcText('pctOk', '75.00%'), findsOneWidget);
  });

  testWidgets('Save on an empty form shows the web messages and sends nothing', (tester) async {
    final h = await open(tester);
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    expect(h.api.called('PUT', rowPath), isEmpty);
    expect(find.text('Operator is required'), findsOneWidget);
    expect(find.text('Part Name is required'), findsOneWidget);
    expect(find.text('Actual Quantity is required'), findsOneWidget);
    expect(find.text('OK Quantity is required'), findsOneWidget);
    expect(find.text('Planned Operator Shift is required'), findsOneWidget);
  });

  testWidgets('a part without operation times cannot be saved (web message)', (tester) async {
    await open(tester);
    await fillValid(tester);
    form(tester).onItemSelect(0, 'i2');
    await tester.pump();
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    expect(find.textContaining('This Part is missing No. of Holes'), findsOneWidget);
  });

  testWidgets('Save PUTs the web payload to /spm-sheet/row', (tester) async {
    final h = await open(tester);
    await fillValid(tester);
    expect(find.textContaining('Others (min)'), findsOneWidget);
    // Stoppage so far: 30 lunch + 10 set-up = 40 of the 480 min Machine Shift.
    expect(find.textContaining('40 min'), findsWidgets);
    expect(find.textContaining('of 480 min allowed'), findsOneWidget);

    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    final puts = h.api.called('PUT', rowPath).toList();
    expect(puts, hasLength(1));
    expect(h.api.called('PUT', '/api/v1/production-sheet/row'), isEmpty);
    final body = Map<String, dynamic>.from(puts.single.body as Map);
    final today = body['date'];
    expect(today, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(body, {
      'date': today,
      'machine': 'm1',
      'machineStatus': <dynamic>[],
      'workingMode': 'Working',
      'slot': 'auto',
      'item': 'i1',
      'vendor': null,
      'excludedOps': <dynamic>[],
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'drawingNo': 'D-100',
      'remarks': '',
      'otherMinRemark': '',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'noOfHoles': 4,
      'piecesPerCycle': 2,
      'strokeRequired': 1,
      'loadingSec': 5,
      'processSec': 20,
      'unloadingCleaningSec': 3,
      'otherOperationsSec': 2,
      'totalCycleSec': 30,
      'actualQty': 420,
      'okQty': 400,
      'rejectBreakdown': {'Tool Mark': 20},
      'rejectReason': 'Tool Mark',
      'rejectOtherRemark': '',
      'plannedOperatorShiftHours': 9,
      'plannedDownMin': '',
      'setupMin': 10,
      'noManPowerMin': '',
      'materialShiftingMin': '',
      'noMaterialMin': '',
      'bdMechMin': '',
      'bdEleMin': '',
      'noPowerMin': '',
      'lunchMin': 30,
      'otherMin': '',
    });
    expect(h.popped, [true]);
  });

  testWidgets('"Others" downtime asks for its remark and sends it', (tester) async {
    final h = await open(tester);
    await fillValid(tester);
    form(tester).onChange(0, 'otherMin', '15');
    await tester.pump();
    expect(find.textContaining('Remark for Others downtime'), findsOneWidget);
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    expect(h.api.called('PUT', rowPath), isEmpty);
    expect(find.text('Remark is required when Others downtime is entered'), findsOneWidget);
    form(tester).onChange(0, 'otherMinRemark', '  power cut ');
    await tester.pump();
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    final body = Map<String, dynamic>.from(h.api.called('PUT', rowPath).single.body as Map);
    expect(body['otherMin'], 15);
    expect(body['otherMinRemark'], 'power cut');
  });

  testWidgets('Non Working: only the day, machine and reason are asked for', (tester) async {
    final h = await open(tester);
    await tester.ensureVisible(find.text('Non Working'));
    await tester.tap(find.text('Non Working'));
    await tester.pump();
    expect(form(tester).entries[0]['workingMode'], 'Non Working');
    expect(find.text('Production Master'), findsNothing);
    expect(find.text('Rejection Master (Qty)'), findsNothing);
    expect(find.text('Part, Cycle Breakdown'), findsNothing);
    expect(find.text('Remarks'), findsNWidgets(2), reason: 'the Remarks card title and the Status chip');
    await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Planning')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')));
    await tester.pump();
    expect(form(tester).entries[0]['machineStatus'], ['Machine Breakdown', 'No Planning']);

    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    final body = Map<String, dynamic>.from(h.api.called('PUT', rowPath).single.body as Map);
    expect(body['workingMode'], 'Non Working');
    expect(body['machineStatus'], ['Machine Breakdown', 'No Planning']);
    expect(body['lunchMin'], 0);
    expect(body['okQty'], '');
    expect(body['actualQty'], '');
    expect(body['rejectBreakdown'], isEmpty);
    expect(body.containsKey('rejectedQty'), isFalse);
  });

  testWidgets('edit: a saved row loads (planned shift as typed) and saves back to its own slot with its _id', (tester) async {
    final row = {
      '_id': 'r1',
      'date': '2026-10-02',
      'machine': 'm2',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'drawingNo': 'D-100',
      'noOfHoles': 4,
      'piecesPerCycle': 2,
      'strokeRequired': 1,
      'loadingSec': 5,
      'processSec': 20,
      'unloadingCleaningSec': 3,
      'otherOperationsSec': 2,
      'totalCycleSec': 30,
      'excludedOps': ['otherOperationsSec'],
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 420,
      'okQty': 400,
      'rejectBreakdown': {'Tool Mark': 12, 'Other': 8},
      'rejectOtherRemark': 'burr',
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
    };
    final h = await open(tester, row: row, machineId: null);
    expect(find.text('Update SPM Entry'), findsOneWidget);
    final v = form(tester).entries[0];
    expect(v['plannedOperatorShiftHours'], '8.5');
    expect(v['actualQty'], '420');
    expect(v['okQty'], '400');
    expect(v['rejectBreakdown'], {'Tool Mark': '12', 'Other': '8'});
    expect(calcText('totalCycleSec', '28'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(Scaffold).last, matching: find.widgetWithText(FilledButton, 'Update')).first);
    await tester.pumpAndSettle();
    final body = Map<String, dynamic>.from(h.api.called('PUT', rowPath).single.body as Map);
    expect(body['_id'], 'r1');
    expect(body['slot'], 2);
    expect(body['plannedOperatorShiftHours'], 8.5);
    expect(body['excludedOps'], ['otherOperationsSec']);
    expect(body['actualQty'], 420);
    expect(body['okQty'], 400);
    expect(body['rejectBreakdown'], {'Tool Mark': 12, 'Other': 8});
    expect(body['rejectReason'], 'Tool Mark');
    expect(body['rejectOtherRemark'], 'burr');
    expect(body.containsKey('rejectedQty'), isFalse);
    expect(h.popped, [true]);
  });

  testWidgets('an entry saved before Actual existed edits with Actual = OK + Rejected on its single reason', (tester) async {
    final h = await open(
      tester,
      machineId: null,
      row: {
        '_id': 'r2',
        'date': '2026-10-02',
        'machine': 'm2',
        'slot': 1,
        'item': 'i1',
        'operator': 'Ravi',
        'itemName': 'Bracket',
        'noOfHoles': 4,
        'piecesPerCycle': 2,
        'strokeRequired': 1,
        'totalCycleSec': 30,
        'machineOnTime': '08:00',
        'machineOffTime': '16:00',
        'okQty': 400,
        'rejectedQty': 20,
        'rejectReason': 'Dimension Out',
        'plannedOperatorShiftHours': 9,
      },
    );
    final v = form(tester).entries[0];
    expect(v['actualQty'], '420');
    expect(v['rejectBreakdown'], {'Dimension Out': '20'});
    expect(calcText('rejectedQty', '20'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(Scaffold).last, matching: find.widgetWithText(FilledButton, 'Update')).first);
    await tester.pumpAndSettle();
    final body = Map<String, dynamic>.from(h.api.called('PUT', rowPath).single.body as Map);
    expect(body['actualQty'], 420);
    expect(body['okQty'], 400);
    expect(body['rejectBreakdown'], {'Dimension Out': 20});
    expect(body['rejectReason'], 'Dimension Out');
    expect(body.containsKey('rejectedQty'), isFalse);
  });
}
