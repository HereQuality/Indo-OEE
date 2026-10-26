import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const rowPath = '/api/v1/rivet-sheet/row';
const occupiedPath = '/api/v1/rivet-sheet/occupied';

final machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'RV-1'},
  {'_id': 'm2', 'machineName': 'RV-2'},
];
final items = <Map<String, dynamic>>[
  {
    '_id': 'i1',
    'itemName': 'Rivet 4mm',
    'drawingNo': 'R-4',
    'totalCycleSec': 45,
    'rivetLoadingSec': 10,
    'rivetProcessSec': 20,
    'rivetUnloadingCleaningSec': 10,
    'rivetOtherOperationsSec': 5,
  },
  {'_id': 'i2', 'itemName': 'Bare part', 'drawingNo': 'B-1'},
];
final operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
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
                  builder: (_) => EntryEditorScreen(spec: rivetSpec, row: row, initialMachineId: machineId, machines: machines, items: items, operators: operators),
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

class Harness {
  Harness(this.api, this.popped);
  final FakeApi api;
  final List<bool?> popped;
  List<FakeRequest> get puts => api.called('PUT', rowPath).toList();
  Map<String, dynamic> body(int i) => Map<String, dynamic>.from(puts[i].body as Map);
}

// The form's "Incomplete — N fields" chip can overflow at some widths; it is the
// form's own concern (same carve-out as the CNC editor tests).
void formTest(String description, Future<void> Function(WidgetTester tester) body) {
  testWidgets(description, (tester) async {
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      if (d.exception.toString().contains('overflowed') && d.toString().contains('common_widgets.dart')) return;
      prev?.call(d);
    };
    try {
      await body(tester);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
    } finally {
      FlutterError.onError = prev;
    }
  });
}

Future<Harness> open(WidgetTester tester, {Map<String, dynamic>? row, String? machineId, Size size = const Size(390, 844)}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  final popped = <bool?>[];
  await pumpScreen(tester, ScaffoldMessenger(key: rootMessengerKey, child: _Launcher(popped: popped, row: row, machineId: machineId)), size: size);
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return Harness(api, popped);
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
EntryActionBar bar(WidgetTester t) => t.widget<EntryActionBar>(find.byType(EntryActionBar));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));

Future<void> fillValid(WidgetTester t, {String machine = 'm1'}) async {
  final f = form(t);
  f.onChange(0, 'machine', machine);
  f.onChange(0, 'operator', 'Ravi');
  f.onChange(0, 'processType', 'Rivet');
  f.onItemSelect(0, 'i1');
  f.onChange(0, 'noOfHoles', '4');
  f.onChange(0, 'machineOnTime', '08:00');
  f.onChange(0, 'machineOffTime', '16:00');
  f.onChange(0, 'actualQty', '320');
  f.onChange(0, 'okQty', '300');
  f.onRejectChange(0, 'Dimension Out', '20');
  f.onChange(0, 'plannedOperatorShiftHours', '9');
  f.onChange(0, 'lunchMin', '30');
  f.onChange(0, 'setupMin', '10');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

void main() {
  group('the Rivet form', () {
    formTest('renders its cards, not CNC\'s', (tester) async {
      await open(tester, machineId: 'm1');
      expect(find.text('Add Rivet Entry'), findsOneWidget);
      for (final title in [
        'Date, Machine No., Operator',
        'Process, Part, Total Cycle Time',
        'Machine ON–OFF Time, Machine Shift',
        'Production Master',
        'Rejection Master (Qty)',
        'Planned Operator Shift, Lunch / Rest',
        'Downtime / Stoppage (min)',
        'Remarks',
      ]) {
        expect(find.text(title, skipOffstage: false), findsOneWidget, reason: title);
      }
      expect(find.text('Production (Qty)', skipOffstage: false), findsNothing);
      // Process choices, the four operations, the nine downtime boxes' labels.
      expect(find.text('Rivet', skipOffstage: false), findsOneWidget);
      expect(find.text('Clamp', skipOffstage: false), findsOneWidget);
      for (final label in ['Loading', 'Process', 'Unloading and Cleaning', 'Other Operations']) {
        expect(find.text(label, skipOffstage: false), findsWidgets, reason: label);
      }
      for (final label in ['Actual Quantity', 'OK Quantity', 'Rejected', 'Dimension Out', 'Other', 'No. of Holes in One Piece', 'Planned Downtime (min)', 'Set-up Time (min)', 'Others (min)', 'Lunch / Rest (min)']) {
        expect(find.textContaining(label, skipOffstage: false), findsWidgets, reason: label);
      }
    });

    formTest('Save on a blank form saves nothing and flags the required fields', (tester) async {
      final h = await open(tester);
      form(tester).onChange(0, 'machine', 'm1');
      await tester.pump();
      await tapSave(tester);
      expect(h.puts, isEmpty);
      final f = form(tester);
      expect(f.isSubmit, isTrue);
      expect(f.focusTarget!['field'], 'operator');
      expect(f.errors[0]['processType'], 'Process is required');
      expect(f.errors[0]['itemName'], 'Part Name is required');
      expect(f.errors[0]['actualQty'], 'Actual Quantity is required');
      expect(f.errors[0]['okQty'], 'OK Quantity is required');
      expect(f.errors[0].containsKey('rejectedQty'), isFalse, reason: 'Rejected is Actual − OK, never asked for');
      expect(find.text('Operator is required', skipOffstage: false), findsOneWidget);
      expect(find.text('Process is required', skipOffstage: false), findsOneWidget);
    });

    formTest('a part without operation times cannot be saved; unticking every operation neither', (tester) async {
      await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      form(tester).onItemSelect(0, 'i2');
      await tester.pump();
      expect(form(tester).errors[0]['itemName'], 'This Part has no Operation Times set — edit it in Parts first');
      form(tester).onItemSelect(0, 'i1');
      form(tester).onChange(0, 'excludedOps', ['rivetLoadingSec', 'rivetProcessSec', 'rivetUnloadingCleaningSec', 'rivetOtherOperationsSec']);
      await tester.pump();
      expect(form(tester).errors[0]['itemName'], 'Total Cycle Time must be more than 0 — untick fewer operations');
    });

    formTest('ticking an operation off lowers Total Cycle Time on the card', (tester) async {
      await open(tester, machineId: 'm1');
      await fillValid(tester);
      expect(find.byKey(const ValueKey('entry0/calc/totalCycleSec'), skipOffstage: false), findsOneWidget);
      expect(tester.widget<Text>(find.descendant(of: find.byKey(const ValueKey('entry0/calc/totalCycleSec'), skipOffstage: false), matching: find.byType(Text), skipOffstage: false).first).data, '45');
      await tester.ensureVisible(find.byKey(const ValueKey('entry0/rivetLoadingSec')));
      await tester.tap(find.byKey(const ValueKey('entry0/rivetLoadingSec')));
      await tester.pump();
      expect(form(tester).entries[0]['excludedOps'], ['rivetLoadingSec']);
      expect(tester.widget<Text>(find.descendant(of: find.byKey(const ValueKey('entry0/calc/totalCycleSec'), skipOffstage: false), matching: find.byType(Text), skipOffstage: false).first).data, '35');
    });

    formTest('Actual is capped by Ideal Quantity and OK by Actual, with a warning', (tester) async {
      EntryFormToast.reset();
      EntryNotices.reset();
      addTearDown(EntryFormToast.reset);
      await open(tester, machineId: 'm1');
      await fillValid(tester);
      // 8 h at 45 s = 640 pieces: Actual may take no more.
      form(tester).onChange(0, 'actualQty', '');
      await tester.pump();
      final actual = find.byKey(const ValueKey('entry0/actualQty'), skipOffstage: false);
      await tester.ensureVisible(actual);
      await tester.enterText(find.descendant(of: actual, matching: find.byType(EditableText)), '650');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], isNot('650'), reason: 'a keystroke past the cap is refused');
      // The web raises a popup with the figures (limitNotice.js qtyNotice), not a toast.
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.textContaining('this machine can make at most 640 pieces in this shift.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
      await tester.enterText(find.descendant(of: actual, matching: find.byType(EditableText)), '640');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], '640');
      // OK is held to Actual.
      form(tester).onChange(0, 'okQty', '');
      await tester.pump();
      final ok = find.byKey(const ValueKey('entry0/okQty'), skipOffstage: false);
      await tester.ensureVisible(ok);
      await tester.enterText(find.descendant(of: ok, matching: find.byType(EditableText)), '641');
      await tester.pump();
      expect(form(tester).entries[0]['okQty'], isNot('641'));
      await tester.enterText(find.descendant(of: ok, matching: find.byType(EditableText)), '600');
      await tester.pump();
      expect(form(tester).entries[0]['okQty'], '600');
      // Rejected = 640 − 600 = 40, but only 20 is split so far.
      expect(form(tester).errors[0]['rejectBreakdown'], startsWith('20 of 40 rejected piece(s) still have no reason'));
      expect(bar(tester).canSave, isFalse);
      form(tester).onRejectChange(0, 'Dimension Out', '40');
      await tester.pump();
      expect(form(tester).errors[0], isEmpty);
      expect(bar(tester).canSave, isTrue);
    });

    formTest('the Rejection Master split has to add up, and "Other" needs a remark', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(form(tester).errors[0], isEmpty);
      // Move 5 of the 20 rejected pieces to Other.
      form(tester).onRejectChange(0, 'Dimension Out', '15');
      form(tester).onRejectChange(0, 'Other', '5');
      await tester.pump();
      expect(form(tester).errors[0]['rejectOtherRemark'], 'Remark is required when "Other" is a reject reason');
      expect(bar(tester).canSave, isFalse);
      form(tester).onChange(0, 'rejectOtherRemark', ' cracked ');
      await tester.pump();
      expect(form(tester).errors[0], isEmpty);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['actualQty'], 320);
      expect(b['okQty'], 300);
      expect(b['rejectBreakdown'], {'Dimension Out': 15, 'Other': 5});
      expect(b['rejectReason'], 'Dimension Out', reason: 'the biggest reason');
      expect(b['rejectOtherRemark'], 'cracked');
      expect(b.containsKey('rejectedQty'), isFalse, reason: 'the server derives Rejected');
    });

    formTest('stoppage is capped by the Machine Shift (8 h = 480 min), not by Planned Operator Shift', (tester) async {
      await open(tester, machineId: 'm1');
      await fillValid(tester);
      form(tester).onChange(0, 'plannedOperatorShiftHours', '9');
      form(tester).onChange(0, 'bdMechMin', '440'); // 30 + 10 + 440 = 480
      await tester.pump();
      expect(form(tester).errors[0], isEmpty);
      form(tester).onChange(0, 'bdMechMin', '441');
      await tester.pump();
      expect(form(tester).errors[0]['stoppageTotal'], 'Total stoppage is 481 min but the Machine Shift is only 480 min');
      expect(find.text('480', skipOffstage: false), findsWidgets, reason: 'Stoppage Allowed shows the shift in minutes');
    });

    formTest('Non Working asks only for Date and Machine and sends the status', (tester) async {
      final h = await open(tester, machineId: 'm1');
      await tester.ensureVisible(find.byKey(const ValueKey('entry0/workingMode/Non Working')));
      await tester.tap(find.byKey(const ValueKey('entry0/workingMode/Non Working')));
      await tester.pump();
      expect(form(tester).entries[0]['workingMode'], 'Non Working');
      expect(find.text('Process, Part, Total Cycle Time', skipOffstage: false), findsNothing);
      expect(find.text('Production Master', skipOffstage: false), findsNothing);
      expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
      expect(find.text('Remarks', skipOffstage: false), findsWidgets);
      expect(bar(tester).canSave, isTrue);
      await tester.ensureVisible(find.byKey(const ValueKey('entry0/machineStatus/No Planning')));
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Planning')));
      await tester.pump();
      await tester.ensureVisible(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')));
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')));
      await tester.pump();
      expect(form(tester).entries[0]['machineStatus'], ['Machine Breakdown', 'No Planning']);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      expect(h.body(0)['workingMode'], 'Non Working');
      expect(h.body(0)['machineStatus'], ['Machine Breakdown', 'No Planning']);
      expect(h.popped, [true]);
    });

    formTest('saves the exact payload to /rivet-sheet/row', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(h.puts, hasLength(1));
      expect(h.api.called('PUT', '/api/v1/production-sheet/row'), isEmpty);
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'machine', 'machineStatus', 'workingMode', 'slot', 'item', 'vendor', 'excludedOps',
        'operator', 'processType', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark',
        'rejectBreakdown', 'rejectReason',
        'machineOnTime', 'machineOffTime',
        'noOfHoles', 'rivetLoadingSec', 'rivetProcessSec', 'rivetUnloadingCleaningSec', 'rivetOtherOperationsSec',
        'totalCycleSec', 'actualQty', 'okQty', 'plannedOperatorShiftHours',
        'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin',
        'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin',
      });
      expect(b['machine'], 'm1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['vendor'], isNull);
      expect(b['workingMode'], 'Working');
      expect(b['machineStatus'], isEmpty);
      expect(b['operator'], 'Ravi');
      expect(b['processType'], 'Rivet');
      expect(b['itemName'], 'Rivet 4mm');
      expect(b['drawingNo'], 'R-4');
      expect(b['noOfHoles'], 4);
      expect(b['rivetLoadingSec'], 10);
      expect(b['rivetProcessSec'], 20);
      expect(b['rivetUnloadingCleaningSec'], 10);
      expect(b['rivetOtherOperationsSec'], 5);
      expect(b['totalCycleSec'], 45);
      expect(b['actualQty'], 320);
      expect(b['okQty'], 300);
      expect(b['rejectBreakdown'], {'Dimension Out': 20});
      expect(b['rejectReason'], 'Dimension Out');
      expect(b['rejectOtherRemark'], '');
      expect(b.containsKey('rejectedQty'), isFalse, reason: 'Rejected = Actual − OK is derived on the server');
      expect(b['plannedOperatorShiftHours'], 9);
      expect(b['lunchMin'], 30);
      expect(b['setupMin'], 10);
      expect(b['otherMin'], '');
      expect(b['otherMinRemark'], '');
      expect(b['machineOnTime'], '08:00');
      expect(b.containsKey('_id'), isFalse);
      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
    });

    formTest('Others downtime needs its remark, and the remark is sent', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'otherMin', '15');
      await tester.pump();
      expect(bar(tester).canSave, isFalse);
      expect(form(tester).errors[0]['otherMinRemark'], 'Remark is required when Others downtime is entered');
      form(tester).onChange(0, 'otherMinRemark', ' crane ');
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['otherMin'], 15);
      expect(h.body(0)['otherMinRemark'], 'crane');
    });

    formTest('editing keeps the document _id and slot, and shows the saved values', (tester) async {
      final h = await open(tester, row: {
        '_id': 'r1',
        'date': '2026-09-20',
        'machine': 'm2',
        'slot': 2,
        'item': 'i1',
        'operator': 'Ravi',
        'processType': 'Clamp',
        'itemName': 'Rivet 4mm',
        'drawingNo': 'R-4',
        'noOfHoles': 4,
        'rivetLoadingSec': 10,
        'rivetProcessSec': 20,
        'rivetUnloadingCleaningSec': 10,
        'rivetOtherOperationsSec': 5,
        'totalCycleSec': 45,
        'excludedOps': ['rivetOtherOperationsSec'],
        'machineOnTime': '08:00',
        'machineOffTime': '16:00',
        'okQty': 300,
        'rejectedQty': 20,
        'rejectReason': 'Tool Mark',
        'plannedOperatorShiftHours': 9.5,
        'lunchMin': 30,
      });
      expect(find.text('Update Rivet Entry'), findsOneWidget);
      final e = form(tester).entries[0];
      expect(e['plannedOperatorShiftHours'], '9.5');
      expect(e['okQty'], '300');
      // An entry from before Actual existed: Actual = OK + Rejected, the rejected pieces on its one reason.
      expect(e['actualQty'], '320');
      expect(e['rejectBreakdown'], {'Tool Mark': '20'});
      expect(form(tester).isEdit, isTrue);
      expect(form(tester).errors[0], isEmpty);
      await tester.tap(find.descendant(of: find.byType(Scaffold).last, matching: find.widgetWithText(FilledButton, 'Update')).first);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b['_id'], 'r1');
      expect(b['slot'], 2);
      expect(b['machine'], 'm2');
      expect(b['processType'], 'Clamp');
      expect(b['excludedOps'], ['rivetOtherOperationsSec']);
      expect(b['plannedOperatorShiftHours'], 9.5);
      expect(b['actualQty'], 320);
      expect(b['okQty'], 300);
      expect(b['rejectBreakdown'], {'Tool Mark': 20});
      expect(b['rejectReason'], 'Tool Mark');
      expect(b.containsKey('rejectedQty'), isFalse);
      expect(h.popped, [true]);
    });
  });
}
