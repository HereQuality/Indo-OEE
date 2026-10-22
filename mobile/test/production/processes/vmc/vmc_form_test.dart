import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/processes/vmc/vmc_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const rowPath = '/api/v1/vmc-sheet/row';
const occupiedPath = '/api/v1/vmc-sheet/occupied';

final machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'VMC 1'},
  {'_id': 'm2', 'machineName': 'VMC 2'},
];
// 6 min per program of 2 pieces = 180 s a piece; an 8 h shift makes 160.
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Housing', 'drawingNo': 'D-100', 'setupNo': 'S-1', 'programTimeMin': 6, 'pcsPerProgram': 2},
  {'_id': 'i2', 'itemName': 'Old part'},
];
final operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
];

Map<String, dynamic> savedRow({Map<String, dynamic> extra = const {}}) => {
      '_id': 'r1',
      'date': '2026-09-20',
      'machine': 'm2',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Housing',
      'drawingNo': 'D-100',
      'programTimeMin': 6,
      'pcsPerProgram': 2,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'okQty': 150,
      'rejectedQty': 5,
      'plannedOperatorShiftHours': 9,
      'lunchMin': 30,
      'setupMin': 10,
      'workOrder': 'w1',
      'workOrderNo': 'WO-9',
      ...extra,
    };

class _Launcher extends StatelessWidget {
  const _Launcher({required this.popped, this.row, this.machineId});
  final String? machineId;
  final List<bool?> popped;
  final Map<String, dynamic>? row;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () async => popped.add(
              await Navigator.of(context).push<bool>(
                MaterialPageRoute<bool>(
                  builder: (_) => EntryEditorScreen(spec: vmcSpec, row: row, initialMachineId: machineId, machines: machines, items: items, operators: operators),
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

Future<FakeApi> open(WidgetTester tester, {Map<String, dynamic>? row, List<bool?>? popped, String? machineId = 'm1'}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(tester, ScaffoldMessenger(key: rootMessengerKey, child: _Launcher(popped: popped ?? <bool?>[], row: row, machineId: row == null ? machineId : null)));
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));
Map<String, dynamic> put(FakeApi api, [int i = 0]) => Map<String, dynamic>.from(api.called('PUT', rowPath).toList()[i].body as Map);
String boxText(WidgetTester t, String key) {
  final typed = find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(EditableText));
  if (typed.evaluate().isNotEmpty) return t.widget<EditableText>(typed.first).controller.text;
  // A grey calculated box shows its figure as plain text (empty = not available yet).
  final shown = find.descendant(of: find.byKey(ValueKey(key)), matching: find.byType(Text));
  return shown.evaluate().isEmpty ? '' : (t.widget<Text>(shown.first).data ?? '');
}

void main() {
  testWidgets('the VMC form renders its own cards (not CNC\'s)', (tester) async {
    await open(tester);
    expect(find.text('Add VMC Entry'), findsOneWidget);
    for (final title in [
      'Date, Machine No., Operator',
      'Part, Product Cycle Time',
      'Machine ON–OFF Time, Machine Shift',
      'Production (Qty)',
      'Planned Operator Shift, Lunch / Rest',
      'Downtime / Stoppage (min)',
      'Remarks',
    ]) {
      expect(find.text(title, skipOffstage: false), findsOneWidget, reason: title);
    }
    // CNC-only cards are gone.
    expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
    expect(find.text('Operations in this cycle', skipOffstage: false), findsNothing);
    // VMC's labels and its nine downtime boxes.
    for (final label in ['Actual OK Quantity', 'Rejected Quantity', 'Product Cycle Time (sec)', 'Machine Working Status', 'Planned Downtime (min)', 'Others (min)', 'Program Time (min)', 'No. of Piece In One Program']) {
      expect(find.textContaining(label, skipOffstage: false), findsWidgets, reason: label);
    }
    expect(find.textContaining('Actual Quantity', skipOffstage: false), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an incomplete Save flags the VMC rules and sends nothing', (tester) async {
    final api = await open(tester);
    form(tester).onChange(0, 'machine', 'm1');
    await tester.pump();
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    expect(api.called('PUT', rowPath), isEmpty);
    expect(find.text('Operator is required', skipOffstage: false), findsOneWidget);
    expect(find.text('Part Name is required', skipOffstage: false), findsOneWidget);
    expect(find.text('Actual OK Quantity is required', skipOffstage: false), findsOneWidget);
    expect(find.text('Rejected Quantity is required', skipOffstage: false), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('picking a part works out Product Cycle Time and Ideal Quantity; OK + Rejected are capped together', (tester) async {
    await open(tester);
    final f = form(tester);
    f.onChange(0, 'machine', 'm1');
    f.onItemSelect(0, 'i1');
    f.onChange(0, 'machineOnTime', '08:00');
    f.onChange(0, 'machineOffTime', '16:00');
    await tester.pump();
    expect(boxText(tester, 'entry0/calc/totalCycleSec'), '180');
    expect(boxText(tester, 'entry0/calc/idealQty'), '160');

    f.onChange(0, 'rejectedQty', '10');
    await tester.pump();
    // OK may take what Rejected leaves: 150.
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/okQty')), matching: find.byType(EditableText)), '151');
    await tester.pump();
    expect(boxText(tester, 'entry0/okQty'), isNot('151'), reason: 'the 151st piece is refused');
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/okQty')), matching: find.byType(EditableText)), '150');
    await tester.pump();
    expect(boxText(tester, 'entry0/okQty'), '150');
    expect(boxText(tester, 'entry0/calc/pctOk'), isNotEmpty);
  });

  testWidgets('a complete add saves the exact VMC payload to /vmc-sheet/row', (tester) async {
    final popped = <bool?>[];
    final api = await open(tester, popped: popped);
    final f = form(tester);
    f.onChange(0, 'machine', 'm1');
    f.onChange(0, 'operator', 'Ravi');
    f.onItemSelect(0, 'i1');
    f.onChange(0, 'machineOnTime', '08:00');
    f.onChange(0, 'machineOffTime', '16:00');
    f.onChange(0, 'okQty', '150');
    f.onChange(0, 'rejectedQty', '5');
    f.onChange(0, 'plannedOperatorShiftHours', '9');
    f.onChange(0, 'lunchMin', '30');
    f.onChange(0, 'setupMin', '10');
    f.onChange(0, 'otherMin', '5');
    f.onChange(0, 'otherMinRemark', ' tea ');
    f.onChange(0, 'remarks', 'fine');
    await tester.pump();
    expect(find.textContaining('Remark for Others downtime', skipOffstage: false), findsOneWidget);
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();

    expect(api.called('PUT', rowPath), hasLength(1));
    final b = put(api);
    expect(b['slot'], 'auto');
    expect(b.containsKey('_id'), isFalse);
    expect(b['machine'], 'm1');
    expect(b['item'], 'i1');
    expect(b['itemName'], 'Housing');
    expect(b['drawingNo'], 'D-100');
    expect(b['setupNo'], 'S-1');
    expect(b['programTimeMin'], 6);
    expect(b['pcsPerProgram'], 2);
    expect(b['okQty'], 150);
    expect(b['rejectedQty'], 5);
    expect(b['plannedOperatorShiftHours'], 9);
    expect(b['lunchMin'], 30);
    expect(b['setupMin'], 10);
    expect(b['otherMin'], 5);
    expect(b['otherMinRemark'], 'tea');
    expect(b['remarks'], 'fine');
    expect(b['workingMode'], 'Working');
    expect(b['machineStatus'], isEmpty);
    expect(b['vendor'], isNull);
    expect(b['workOrder'], isNull);
    expect(b['excludedOps'], isEmpty);
    // VMC has no reject split or actual-quantity box.
    expect(b.containsKey('actualQty'), isFalse);
    expect(b.containsKey('rejectBreakdown'), isFalse);
    expect(b.containsKey('totalCycleSec'), isFalse);
    expect(popped, [true]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('editing a saved row loads it and saves back to its own _id / slot (work order kept)', (tester) async {
    final popped = <bool?>[];
    final api = await open(tester, row: savedRow(), popped: popped);
    expect(find.text('Update VMC Entry'), findsOneWidget);
    expect(boxText(tester, 'entry0/okQty'), '150');
    expect(boxText(tester, 'entry0/calc/totalCycleSec'), '180');
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    final b = put(api);
    expect(b['_id'], 'r1');
    expect(b['slot'], 2);
    expect(b['machine'], 'm2');
    expect(b['date'], '2026-09-20');
    expect(b['plannedOperatorShiftHours'], 9);
    expect(b['workOrderNo'], 'WO-9');
    expect(popped, [true]);
  });

  testWidgets('Non Working asks for nothing else, and the status goes with the payload', (tester) async {
    final api = await open(tester);
    final f = form(tester);
    f.onChange(0, 'machine', 'm1');
    await tester.pump();
    await tester.tap(find.text('Non Working', skipOffstage: false).first);
    await tester.pumpAndSettle();
    expect(find.text('Part, Product Cycle Time', skipOffstage: false), findsNothing);
    expect(find.text('Production (Qty)', skipOffstage: false), findsNothing);
    expect(find.textContaining('the machine did not run', skipOffstage: false), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Manpower'), skipOffstage: false));
    await tester.pumpAndSettle();
    await tester.tap(saveBtn());
    await tester.pumpAndSettle();
    final b = put(api);
    expect(b['workingMode'], 'Non Working');
    expect(b['machineStatus'], ['No Manpower']);
    expect(b['okQty'], '');
    expect(tester.takeException(), isNull);
  });
}
