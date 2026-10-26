import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/processes/press/press_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'PRESS 1'},
];
const _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-1', 'standardTimeMin': 2, 'pcsPerStandardTime': 10},
];
const _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
];

/// A saved row: 08:00-16:00, 2 min per 10 pieces -> cycle 12 s, Ideal 2400.
Map<String, dynamic> _row() => {
      '_id': 'r1',
      'date': '2026-09-20',
      'machine': 'm1',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'drawingNo': 'D-1',
      'operation': 'Bending',
      'setupNo': '3',
      'standardTimeMin': 2,
      'pcsPerStandardTime': 10,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'okQty': 2000,
      'rejectedQty': 100,
      // From before Actual existed: Actual reads as OK + Rejected, the 100 against this reason.
      'rejectReason': 'Tool Mark',
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'setupMin': 10,
      'remarks': 'steady run',
    };

FakeApi _api() {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', pressSpec.api.row, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', pressSpec.api.occupied, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  return api;
}

Future<void> _open(WidgetTester tester, {Map<String, dynamic>? row}) => pumpScreen(
      tester,
      EntryEditorScreen(spec: pressSpec, row: row, initialMachineId: 'm1', machines: _machines, items: _items, operators: _operators),
      size: const Size(800, 3200),
    );

/// A field label (required ones carry a red asterisk, so they are rich text).
Finder _label(String text) => find.textContaining(text, findRichText: true);

Finder _field(String key) => find.byKey(ValueKey('entry0/$key'));

void main() {
  tearDown(EntryFormToast.reset);

  test('identity: titles, draft key and the /press-sheet endpoints', () {
    expect(pressSpec.key, 'press');
    expect(pressSpec.routePath, '/production/press-data-entry');
    expect(pressSpec.draftKey, 'pressEntryDraft');
    expect(pressSpec.api.row, '/api/v1/press-sheet/row');
    expect(pressSpec.api.list, '/api/v1/press-sheet');
    expect(pressSpec.api.extent, '/api/v1/press-sheet/extent');
    expect(pressSpec.api.filterOptions, '/api/v1/press-sheet/filter-options');
    expect(pressSpec.api.occupied, '/api/v1/press-sheet/occupied');
    expect(pressSpec.scopeItemsToProcess, isTrue);
  });

  testWidgets('an empty form shows the PRESS cards and no CNC ones', (tester) async {
    _api();
    await _open(tester);
    await tester.pumpAndSettle();

    for (final title in [
      'Date, Machine No., Operator',
      'Part, Operation, Setup No.',
      'Standard Time, Product Cycle Time',
      'Machine ON–OFF Time, Machine Shift',
      'Production Master',
      'Rejection Master (Qty)',
      'Planned Operator Shift, Lunch / Rest',
      'Downtime / Stoppage (min)',
      'Remarks',
    ]) {
      // The Remarks card shows its title and, like the web, a "Remarks" label over the box.
      expect(find.text(title), title == 'Remarks' ? findsNWidgets(2) : findsOneWidget, reason: title);
    }
    expect(find.text('Production (Qty)'), findsNothing);
    for (final label in ['Actual Quantity', 'OK Quantity', 'Rejected', 'Dimension Out', 'Operation', 'Setup No.', 'Product Cycle Time (sec)', 'Planned Downtime (min)', 'Others (min)', 'Lunch / Rest (min)']) {
      expect(_label(label), findsWidgets, reason: label);
    }
    expect(_label('Standard Time Taken (min)'), findsWidgets);
    expect(_label('No. Piece in Standard Time'), findsWidgets);
    expect(find.textContaining('enter Machine ON/OFF Time to see the allowance'), findsOneWidget);
  });

  testWidgets('Save on an empty form flags the required fields and sends nothing', (tester) async {
    final api = _api();
    await _open(tester);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('Operator is required'), findsOneWidget);
    expect(find.text('Part Name is required'), findsOneWidget);
    expect(find.text('Machine ON Time is required'), findsOneWidget);
    expect(find.text('Actual Quantity is required'), findsOneWidget);
    expect(find.text('OK Quantity is required'), findsOneWidget);
    expect(find.text('Planned Operator Shift is required'), findsOneWidget);
    expect(api.called('PUT', pressSpec.api.row), isEmpty);
  });

  testWidgets('a saved row opens with its figures; Actual is capped at Ideal Quantity and OK at Actual', (tester) async {
    EntryNotices.reset();
    _api();
    await _open(tester, row: _row());
    await tester.pumpAndSettle();

    // Product Cycle Time 2 min x 60 / 10 pcs = 12 s; planned 8.5 h is typed as 8.5.
    expect(find.text('12'), findsWidgets);
    expect(find.text('8.5'), findsOneWidget);
    expect(find.textContaining('of 480 min allowed'), findsOneWidget);
    expect(find.text('Stoppage Allowed (min)'), findsOneWidget);
    // An entry from before Actual existed: Actual = 2000 + 100, the 100 rejected on its one reason.
    String text(String key) => tester.widget<EditableText>(find.descendant(of: _field(key), matching: find.byType(EditableText))).controller.text;
    expect(text('actualQty'), '2100');
    expect(text('okQty'), '2000');
    expect(find.textContaining('Split so far: 100 of 100 rejected'), findsOneWidget);

    // Ideal is 2400, so Actual may rise to 2400 but no further.
    await tester.enterText(find.descendant(of: _field('actualQty'), matching: find.byType(EditableText)), '2401');
    await tester.pump();
    // The web raises a popup with the figures (limitNotice.js qtyNotice), not a toast.
    await tester.pump();
    expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
    expect(find.textContaining('this machine can make at most 2400 pieces in this shift.'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
    await tester.pumpAndSettle();
    expect(text('actualQty'), '2100');

    await tester.enterText(find.descendant(of: _field('actualQty'), matching: find.byType(EditableText)), '2400');
    await tester.pump();
    expect(text('actualQty'), '2400');

    // OK can't pass Actual.
    await tester.enterText(find.descendant(of: _field('okQty'), matching: find.byType(EditableText)), '2401');
    await tester.pump();
    expect(text('okQty'), '2000');
    await tester.enterText(find.descendant(of: _field('okQty'), matching: find.byType(EditableText)), '2300');
    await tester.pump();
    expect(text('okQty'), '2300');
    // Rejected is now 100 (2400 - 2300), which the 100 on Tool Mark already accounts for.
    expect(find.textContaining('Split so far: 100 of 100 rejected'), findsOneWidget);
  });

  testWidgets('the Rejection Master split must add up; Other needs its remark; the payload carries the split', (tester) async {
    final api = _api();
    await _open(tester, row: _row());
    await tester.pumpAndSettle();

    // Raise OK to 2050: Rejected falls to 50 but 100 is still on Tool Mark.
    await tester.enterText(find.descendant(of: _field('okQty'), matching: find.byType(EditableText)), '2050');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Split is 50 more than the 50 rejected'), findsOneWidget);
    expect(api.called('PUT', pressSpec.api.row), isEmpty);

    // Split the 50 between Tool Mark and Other.
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/reject/Tool Mark')), matching: find.byType(EditableText)), '30');
    await tester.pump();
    await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/reject/Other')), matching: find.byType(EditableText)), '20');
    await tester.pumpAndSettle();
    expect(_label('Remark for “Other” rejection'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();
    expect(find.text('Remark is required when "Other" is a reject reason'), findsOneWidget);
    expect(api.called('PUT', pressSpec.api.row), isEmpty);

    await tester.enterText(find.descendant(of: _field('rejectOtherRemark'), matching: find.byType(EditableText)), ' cracked ');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();
    final body = api.called('PUT', pressSpec.api.row).single.body as Map;
    expect(body['actualQty'], 2100);
    expect(body['okQty'], 2050);
    expect(body['rejectBreakdown'], {'Tool Mark': 30, 'Other': 20});
    expect(body['rejectReason'], 'Tool Mark');
    expect(body['rejectOtherRemark'], 'cracked');
    expect(body.containsKey('rejectedQty'), isFalse, reason: 'the server derives Rejected');
  });

  testWidgets('stoppage is capped at the Machine Shift, not Planned - Shift', (tester) async {
    EntryNotices.reset();
    _api();
    await _open(tester, row: _row());
    await tester.pumpAndSettle();

    // 30 + 10 already; the 480 min shift leaves 440 for Planned Downtime.
    final box = find.descendant(of: _field('plannedDownMin'), matching: find.byType(EditableText));
    await tester.enterText(box, '441');
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
    expect(find.textContaining("Stoppage happens within the Machine Shift, so all of it together can't be more than 480 min."), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
    await tester.pumpAndSettle();
    expect(tester.widget<EditableText>(box).controller.text, '');
    await tester.enterText(box, '440');
    await tester.pump();
    expect(tester.widget<EditableText>(box).controller.text, '440');
  });

  testWidgets('Update PUTs the exact PRESS payload to /press-sheet/row', (tester) async {
    final api = _api();
    await _open(tester, row: _row());
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();

    final puts = api.called('PUT', pressSpec.api.row).toList();
    expect(puts, hasLength(1));
    expect(api.called('PUT', '/api/v1/production-sheet/row'), isEmpty);
    expect(puts.single.body, {
      '_id': 'r1',
      'date': '2026-09-20',
      'machine': 'm1',
      'machineStatus': <dynamic>[],
      'workingMode': 'Working',
      'slot': 2,
      'item': 'i1',
      'vendor': null,
      'excludedOps': <dynamic>[],
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'operation': 'Bending',
      'drawingNo': 'D-1',
      'setupNo': '3',
      'remarks': 'steady run',
      'otherMinRemark': '',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'standardTimeMin': 2,
      'pcsPerStandardTime': 10,
      'actualQty': 2100,
      'okQty': 2000,
      'rejectBreakdown': {'Tool Mark': 100},
      'rejectReason': 'Tool Mark',
      'rejectOtherRemark': '',
      'plannedOperatorShiftHours': 8.5,
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
  });

  testWidgets('Others downtime asks for its remark before Save', (tester) async {
    final api = _api();
    await _open(tester, row: _row());
    await tester.pumpAndSettle();

    await tester.enterText(find.descendant(of: _field('otherMin'), matching: find.byType(EditableText)), '15');
    await tester.pumpAndSettle();
    expect(_label('Remark for Others downtime'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();
    expect(find.text('Remark is required when Others downtime is entered'), findsOneWidget);
    expect(api.called('PUT', pressSpec.api.row), isEmpty);

    await tester.enterText(find.descendant(of: _field('otherMinRemark'), matching: find.byType(EditableText)), 'belt broke');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Update'));
    await tester.pumpAndSettle();
    final body = api.called('PUT', pressSpec.api.row).single.body as Map;
    expect(body['otherMin'], 15);
    expect(body['otherMinRemark'], 'belt broke');
  });

}
