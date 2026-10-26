import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_spec.dart' show SheetApi;
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/sheet_controller.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = powderCoatingSpec;
const rowPath = '/api/v1/powder-coating-sheet/row';
const occupiedPath = '/api/v1/powder-coating-sheet/occupied';

/// Operator Master as the page loads it: two workers for this process, one for
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'Asha', 'isActive': true, 'processes': ['p1']},
  {'_id': 'w2', 'name': 'Ravi', 'processes': [{'_id': 'p1'}]},
  {'_id': 'w3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'w4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'w5', 'name': 'Unassigned', 'processes': <String>[]},
];
final lockedProcess = <String, dynamic>{'_id': 'p1', 'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: lockedProcess);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Panel', 'totalCycleSec': 45},
  {'_id': 'i2', 'itemName': 'Cap', 'totalCycleSec': 30},
];
final vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Coaters', 'isActive': true, 'processes': ['p1']},
  {'_id': 'v2', 'name': 'Elsewhere', 'isActive': true, 'processes': ['p2']},
];

bool _isFormChipOverflow(FlutterErrorDetails d) =>
    d.exception.toString().contains('overflowed') && d.toString().contains('common_widgets.dart');

void editorTest(String description, Future<void> Function(WidgetTester tester) body) {
  testWidgets(description, (tester) async {
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      if (_isFormChipOverflow(d)) return;
      prev?.call(d);
    };
    EntryNotices.reset();
    try {
      await body(tester);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
    } finally {
      FlutterError.onError = prev;
      EntryFormToast.reset();
    }
  });
}

class _Launcher extends StatelessWidget {
  const _Launcher({required this.popped, this.row, this.workerId, this.process, this.withVendors = true});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? workerId;
  final Map<String, dynamic>? process;
  final bool withVendors;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () async {
              final r = await Navigator.of(context).push<bool>(
                MaterialPageRoute<bool>(
                  builder: (_) => EntryEditorScreen(
                    spec: spec,
                    row: row,
                    initialMachineId: workerId,
                    machines: workers,
                    items: items,
                    operators: operators,
                    extra: {'vendors': withVendors ? vendors : <Map<String, dynamic>>[]},
                    lockedProcess: process,
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

class Harness {
  Harness(this.api, this.popped);
  final FakeApi api;
  final List<bool?> popped;
  List<FakeRequest> get puts => api.called('PUT', rowPath).toList();
  Map<String, dynamic> body(int i) => Map<String, dynamic>.from(puts[i].body as Map);
}

Future<Harness> open(
  WidgetTester tester, {
  Map<String, dynamic>? row,
  String? workerId,
  bool linked = true,
  bool withVendors = true,
  Size size = const Size(390, 844),
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  final popped = <bool?>[];
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(popped: popped, row: row, workerId: workerId, process: linked ? lockedProcess : null, withVendors: withVendors),
    ),
    size: size,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return Harness(api, popped);
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
EntryActionBar bar(WidgetTester t) => t.widget<EntryActionBar>(find.byType(EntryActionBar));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));

Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'w1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:00');
  f.onChange(index, 'machineOffTime', '16:00');
  f.onChange(index, 'actualQty', '600');
  f.onChange(index, 'lessCoatingQty', '5');
  f.onChange(index, 'dotsQty', '3');
  f.onChange(index, 'plannedOperatorShiftHours', '8.5');
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

/// The text box of the form field [field] of block 0.
Finder box(String field) => find.descendant(of: find.byKey(ValueKey('entry0/$field')), matching: find.byType(EditableText));

void main() {
  group('the workers stand in as machines', () {
    test('active workers of this process, plus those with no process yet', () {
      expect([for (final w in workers) w['_id']], ['w1', 'w2', 'w5']);
      expect(workers.first, {'_id': 'w1', 'machineName': 'Asha', 'process': 'p1'});
      // Not linked to a process yet: every active worker.
      final all = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: null);
      expect([for (final w in all) w['_id']], ['w1', 'w2', 'w3', 'w5']);
    });
  });

  group('identity', () {
    test('the page, endpoints and keys', () {
      expect(spec.routePath, '/production/powder-coating-data-entry');
      expect(spec.api.list, '${Endpoints.v1}/powder-coating-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.occupied, occupiedPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.extraReference, {'vendors': '${Endpoints.v1}/vendors'});
      expect(spec.draftKey, 'powderCoatingEntryDraft');
      expect(spec.machineLabel, 'Worker Name');
      // The default spec keeps asking for `machine`.
      expect(const SheetApi('x').machineParam, 'machine');
    });

    test('a process owns the page its Data Entry Page names, role slug or not', () {
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/admin/production/powder-coating-data-entry/'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/cnc-data-entry'}), isFalse);
      expect(spec.ownsProcess({'dataEntryMenu': null}), isFalse);
      expect(spec.ownsProcess({}), isFalse);
    });

    test('the process id is added to the PUT body last', () {
      final body = spec.finishPayload({'worker': 'w1', 'process': null}, process: {'_id': 'p9'});
      expect(body['process'], 'p9');
      expect(spec.toPayload(spec.emptyEntry(), isEdit: false)['process'], isNull);
    });
  });

  group('add', () {
    editorTest('a chosen worker opens the sheet: every card, label and cap of the web form', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      expect(find.text('Add Powder Coating Entry'), findsOneWidget);
      for (final title in [
        'Date, Worker Name, Working Status',
        'Item Name, Vendor Name, Standard Inspection Time',
        'Inspection Start – End Time, Working Hours',
        'Inspection (Qty), Types of Defect / Rework',
        'Other Activity Carried Out',
        'Planned Operator Shift, Lunch / Tea',
        'Idle Time — Other (min)',
        'Reason / Remarks for Rejection / Rework',
      ]) {
        expect(find.textContaining(title), findsWidgets, reason: title);
      }
      for (final label in [
        'Worker Name',
        'Working Status',
        'Item Name',
        'Vendor Name',
        'Standard Inspection Time per Piece (Sec)',
        'Inspection Start Time',
        'Inspection End Time',
        'Inspection Working Hours',
        'Total Qty',
        'Ideal Inspection Quantity',
        'Ideal Inspection Qty / Hour',
        'Ideal Inspection Time',
        'Less Powder Coating (Qty)',
        'Dots (Qty)',
        'Miss Powder Coating (Qty)',
        'Other (Qty)',
        'Total Defect / Rework',
        'OK Qty',
        'Time in Other Activity (min)',
        'Planned Operator Shift (hours)',
        'Lunch / Tea / Washroom (min)',
        'Minutes Allowed',
        'Other (min)',
        'Total Idle Time (min)',
      ]) {
        expect(find.textContaining(label), findsWidgets, reason: label);
      }
      // The web shows no machine / operator / reject-split boxes on this sheet.
      expect(find.textContaining('Machine No.'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/operator')), findsNothing);
      expect(find.textContaining('Rejection Master'), findsNothing);
      expect(find.text('Add another worker'), findsOneWidget);
      // The block is headed by the worker.
      expect(find.text('Asha'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    editorTest('Vendor Name shows only when the process has vendors', (tester) async {
      await open(tester, workerId: 'w1', withVendors: false, size: const Size(390, 2400));
      expect(find.text('Vendor Name'), findsNothing);
    });

    editorTest('Non Working hides every inspection card and keeps the reasons', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2400));
      final f = form(tester);
      f.onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('Reasons For Not Working'), findsOneWidget);
      expect(find.text('Item Name, Vendor Name, Standard Inspection Time'), findsNothing);
      expect(find.text('Inspection (Qty), Types of Defect / Rework'), findsNothing);
      // The Remarks line stays: its title and the label over its box (the web's two).
      expect(find.text('Reason / Remarks for Rejection / Rework'), findsNWidgets(2));
      // Date and Worker are all that's needed.
      expect(bar(tester).canSave, isTrue);
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Manpower')));
      await tester.pump();
      expect(form(tester).entries[0]['machineStatus'], ['No Manpower']);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['machineStatus'], ['No Manpower']);
      expect(b['worker'], 'w1');
      // Anything inspection-related goes out blank.
      expect(b['itemName'], '');
      expect(b['item'], isNull);
      expect(b['actualQty'], '');
      expect(b['lunchMin'], '');
    });

    editorTest('Save on an unfinished entry flags the web messages and sends nothing', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2400));
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Item Name is required',
        'Standard Inspection Time per Piece is required',
        'Inspection Start Time is required',
        'Inspection End Time is required',
        'Total Qty is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
    });

    editorTest('saves one entry: the exact PUT body (worker, process, derived figures stay server-side)', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'vendor', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark',
        'machineOnTime', 'machineOffTime',
        'totalCycleSec', 'actualQty', 'lessCoatingQty', 'dotsQty', 'missCoatingQty', 'otherDefectQty',
        'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin',
      });
      expect(b.containsKey('machine'), isFalse, reason: 'the API names it worker');
      expect(b.containsKey('okQty'), isFalse);
      expect(b.containsKey('operator'), isFalse);
      expect(b['worker'], 'w1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['itemName'], 'Panel');
      expect(b['totalCycleSec'], 45);
      expect(b['machineOnTime'], '08:00');
      expect(b['machineOffTime'], '16:00');
      expect(b['actualQty'], 600);
      expect(b['lessCoatingQty'], 5);
      expect(b['dotsQty'], 3);
      expect(b['missCoatingQty'], '');
      expect(b['otherDefectQty'], '');
      expect(b['plannedOperatorShiftHours'], 8.5);
      expect(b['lunchMin'], 30);
      expect(b['otherMin'], '');
      expect(b['otherMinRemark'], '');
      expect(b['workingMode'], 'Working');
      expect(b['machineStatus'], isEmpty);
      expect(b['vendor'], '');

      // The booked-time lookup asked for the worker, not a machine.
      final lookups = h.api.called('GET', occupiedPath);
      expect(lookups, isNotEmpty);
      expect(lookups.first.query.containsKey('worker'), isTrue);
      expect(lookups.first.query.containsKey('machine'), isFalse);
      expect(lookups.first.query['worker'], 'w1');
      // No operator clash lookup on this sheet.
      expect(lookups.where((r) => r.query.containsKey('operator')), isEmpty);

      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    editorTest('a page not linked to a process cannot save, and says why', (tester) async {
      final h = await open(tester, linked: false);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pump(const Duration(milliseconds: 800));
      expect(h.puts, isEmpty);
      expect(
        find.text(
          'Link this page to the AFTER POWDER COATING process in Process Master (Data Entry Page) before adding entries.',
          skipOffstage: false,
        ),
        findsOneWidget,
      );
      expect(h.popped, isEmpty);
    });

    editorTest('the grey boxes follow the typed figures', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      await fillValid(tester);
      String calc(String key) => tester.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.byType(Text)).first).data ?? '';
      expect(calc('shiftHours'), '8:00 hr');
      expect(calc('idealQty'), '640');
      expect(calc('idealQtyPerHour'), '80');
      expect(calc('totalDefect'), '8');
      expect(calc('okQty'), '592');
      expect(calc('effectiveHours'), '7:30 hr');
      // 30 min lunch of the 480 min Inspection Working Hours.
      expect(calc('stoppageAllowed'), '480');
      expect(calc('totalStoppageMin'), '30');
      expect(find.text('Idle Time + Other Activity: 30 min of 480 min allowed'), findsOneWidget);
      // 600 inspected in 8 h at 45 s each is under Ideal: nothing flagged.
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsNothing);
    });

    editorTest('Total Qty may beat Ideal Inspection Quantity: the entry is flagged for OEE Review, not blocked', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2400));
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '700');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      expect(find.textContaining('Performance above 100%'), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['actualQty'], 700);
    });

    editorTest('the defect boxes cannot add up to more than Total Qty', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '10');
      await tester.pump();
      await tester.enterText(box('lessCoatingQty'), '6');
      await tester.pump();
      await tester.enterText(box('dotsQty'), '5');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['lessCoatingQty'], '6');
      // 6 + 5 > 10: the second box stops at what is left.
      expect(form(tester).entries[0]['dotsQty'], isNot('5'));
      expect(toasts, contains("Defect / Rework can't add up to more than Total Qty (10)."));
    });

    editorTest('Idle Time + Other Activity cannot go past the Inspection Working Hours', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.enterText(box('otherActivityMin'), '50');
      await tester.pump();
      await tester.enterText(box('lunchMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['otherActivityMin'], '50');
      // Only 10 of the 60 minutes are left for Lunch / Tea.
      expect(form(tester).entries[0]['lunchMin'], isNot('30'));
      // The web raises its stoppage popup (in the worker's words) rather than a toast.
      expect(toasts, isEmpty);
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Inspection Working Hours, so all of it together can't be more than 60 min."), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('"Other" idle time asks for its remark; Other Activity minutes ask for what it was', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      await fillValid(tester);
      expect(find.textContaining('Remark for Other idle time'), findsNothing);
      form(tester).onChange(0, 'otherMin', '5');
      form(tester).onChange(0, 'otherActivityMin', '10');
      await tester.pump();
      expect(find.textContaining('Remark for Other idle time'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when Other idle time is entered'), findsOneWidget);
      expect(find.text('Say what the other activity was'), findsOneWidget);
    });

    editorTest('a worker already in another block of the date cannot be picked again', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2400));
      await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
      await tester.tap(find.byKey(const ValueKey('entry-add')));
      await tester.pumpAndSettle();
      // The new block opened its worker picker by itself.
      expect(find.text('Asha — already added'), findsOneWidget);
      expect(find.text('Ravi'), findsOneWidget);
      await tester.tap(find.text('Asha — already added'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[1]['machine'], '');
      await tester.tap(find.byKey(const ValueKey('entry1/machine')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ravi'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[1]['machine'], 'w2');
    });
  });

  group('edit', () {
    final row = <String, dynamic>{
      '_id': 'e1',
      'date': '2026-09-20',
      'worker': 'w2',
      'machine': 'w2',
      'process': 'p1',
      'operator': 'Ravi',
      'slot': 2,
      'item': 'i1',
      'itemName': 'Panel',
      'vendor': 'v1',
      'vendorName': 'Acme Coaters',
      'totalCycleSec': 45,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 600,
      'lessCoatingQty': 5,
      'dotsQty': 3,
      'rejectedQty': 8,
      'okQty': 592,
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'remarks': 'ok',
    };

    editorTest('the worker is locked, the saved figures are loaded and Update keeps the slot and _id', (tester) async {
      final h = await open(tester, row: row, size: const Size(390, 2400));
      expect(find.text('Update Powder Coating Entry'), findsOneWidget);
      // Web: the Worker Name select is just disabled while editing (no note under it).
      expect(find.text("Can't be changed while editing"), findsNothing);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      final v = form(tester).entries.single;
      expect(v['machine'], 'w2');
      expect(v['actualQty'], '600');
      expect(v['plannedOperatorShiftHours'], '8.5');
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['_id'], 'e1');
      expect(b['slot'], 2);
      expect(b['worker'], 'w2');
      expect(b['process'], 'p1');
      expect(b['vendor'], 'v1');
      expect(b['plannedOperatorShiftHours'], 8.5);
      expect(b['remarks'], 'ok');
      expect(h.popped, [true]);
    });

    editorTest('a worker no longer offered keeps the saved name', (tester) async {
      await open(tester, row: {...row, 'worker': 'gone', 'machine': 'gone', 'operator': 'Old Hand'}, size: const Size(390, 2400));
      expect(find.text('Old Hand'), findsWidgets);
    });
  });

  group('the list controller keys everything by worker', () {
    test('the worker filter and the booked lookup use ?worker=, names come with the rows', () async {
      final api = FakeApi.install();
      api.list(Endpoints.machines, []);
      api.list(Endpoints.items, items);
      api.list(Endpoints.machineOperators, operators);
      api.list(Endpoints.processes, [lockedProcess]);
      api.list(Endpoints.companyHolidays, []);
      api.list('${Endpoints.v1}/vendors', vendors);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', '${Endpoints.v1}/powder-coating-sheet/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', '${Endpoints.v1}/powder-coating-sheet/filter-options', (_) => {
            'isOk': true,
            'data': {'machine': ['w1', 'old'], 'operator': <String>[], 'item': ['Panel']},
            'machineNames': {'old': 'Old Hand'},
          });
      api.on('GET', '${Endpoints.v1}/powder-coating-sheet', (_) => {
            'isOk': true,
            'data': [
              {
                '_id': 'e1', 'date': '2026-09-20T00:00:00.000Z', 'worker': 'old', 'machine': 'old', 'slot': 1,
                'itemName': 'Panel', 'vendorName': 'Acme Coaters', 'machineOnTime': '08:00', 'machineOffTime': '09:00',
                'totalCycleSec': 45, 'actualQty': 40, 'okQty': 38, 'plannedOperatorShiftHours': 1,
              },
            ],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
            'machineNames': {'old': 'Old Hand'},
          });

      final c = SheetController(spec: spec);
      await c.start();
      expect(c.referenceLoaded, isTrue);
      expect(c.lockedProcess?['_id'], 'p1', reason: 'the process whose Data Entry Page this is');
      expect([for (final m in c.scopedMachines) m['_id']], ['w1', 'w2', 'w5']);
      expect(c.extra['vendors'], hasLength(2));
      // A worker deactivated since still has the name the API sent.
      expect(c.machineName['old'], 'Old Hand');
      expect(c.machineName['w1'], 'Asha');
      expect(c.optionLabel('machine', 'w1'), 'Asha');
      expect(c.optionLabel('machine', 'old'), 'Old Hand');
      expect(c.days.single.machines.single.machineName, 'Old Hand');
      // Search looks in item, worker and vendor.
      c.setSearch('acme');
      expect(c.days, hasLength(1));
      c.setSearch('zzz');
      expect(c.days, isEmpty);
      c.setSearch('');

      await c.applyQuery(c.range, c.filters.withDim('machine', ['w1', 'w2']));
      final lists = api.called('GET', '${Endpoints.v1}/powder-coating-sheet').toList();
      expect(lists.last.query['worker'], 'w1,w2');
      expect(lists.last.query.containsKey('machine'), isFalse);
      expect(api.called('GET', Endpoints.productionSheet), isEmpty);
      c.dispose();
    });
  });

  group('the table and detail of a saved entry', () {
    final row = <String, dynamic>{
      '_id': 'e1',
      'date': '2026-09-20',
      'machine': 'w1',
      'operator': 'Asha',
      'slot': 1,
      'itemName': 'Panel',
      'vendorName': 'Acme',
      'totalCycleSec': 45,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 600,
      'lessCoatingQty': 5,
      'dotsQty': 3,
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'otherMin': 10,
      'otherMinRemark': 'power cut',
      'otherActivity': 'Packing',
      'otherActivityMin': 20,
      'remarks': 'two panels re-done',
      'workingMode': 'Working',
      'review': {'status': 'pending'},
    };

    test('every column of the web sheet, in its order and wording', () {
      final cols = spec.columns({});
      expect([for (final c in cols.left) c.label], ['Date', 'Worker Name']);
      expect([for (final c in cols.middle) c.label], [
        'Item Name',
        'Vendor Name',
        'Working Status',
        'Inspection Start Time',
        'Inspection End Time',
        'Inspection Working Hours (hr:min)',
        'Standard Inspection Time per Piece (Sec)',
        'Total Qty',
        'OK Qty',
        'Total Defect / Rework',
        'Ideal Inspection Quantity',
        'Ideal Inspection Quantity/Hour',
        'Other Activity Carried Out',
        'Time in Other Activity (min)',
        'Planned Operator Shift Time (hr:min)',
        'Total Idle Time (min)',
        'Ideal Inspection Time (hr:min)',
        'Unreported Time (min)',
        'Availability (%)',
        'Performance (%)',
        'Quality (%)',
        'Productivity without considering Lunch, Tea, etc. (%)',
        'Productivity considering Lunch, Tea, etc. (%)',
        'OEE Review',
        'Reason/Remarks for Rejection/Rework',
      ]);
      final open = spec.columns({'defects', 'idle'});
      expect([for (final c in open.middle.where((c) => c.sub)) c.label], [
        'Less Powder Coating',
        'Dots',
        'Miss Powder Coating',
        'Other',
        'Lunch / Tea / Washroom etc (min)',
        'Other (min)',
      ]);
      expect(open.expandSummary, {'defects': 'totalDefect', 'idle': 'totalStoppage'});
      // Every formulaKey a column declares has a formula text.
      for (final c in open.middle) {
        if (c.formulaKey != null) expect(spec.formulas.containsKey(c.formulaKey), isTrue, reason: c.key);
      }
    });

    test('cells show the figures the web table does', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final open = spec.columns({'defects', 'idle'});
      String cell(String key) {
        final col = [...open.left, ...open.middle].firstWhere((c) => c.key == key);
        return col.text(CellData(row: row, calc: calc, day: day, machineName: 'Asha'));
      }

      expect(cell('machine'), 'Asha');
      expect(cell('itemName'), 'Panel');
      expect(cell('vendorName'), 'Acme');
      expect(cell('machineStatus'), 'Working');
      expect(cell('shift'), '8:00');
      expect(cell('cycle'), '45');
      expect(cell('actualQty'), '600');
      expect(cell('okQty'), '592');
      expect(cell('totalDefect'), '8');
      expect(cell('lessCoatingQty'), '5');
      expect(cell('missCoatingQty'), '0');
      expect(cell('idealQty'), '640');
      expect(cell('idealQtyPerHour'), '80');
      expect(cell('otherActivityMin'), '20');
      expect(cell('plannedShift'), '8:30');
      expect(cell('totalStoppage'), '40');
      expect(cell('lunchMin'), '30');
      expect(cell('effective'), '7:30');
      expect(cell('review'), 'Pending review');
      // A row key the names don't know falls back to the worker name on the row.
      final unknown = [...open.left].firstWhere((c) => c.key == 'machine').text(CellData(row: row, calc: calc, day: day, machineName: '—'));
      expect(unknown, 'Asha');
    });

    test('the detail groups every figure and the remarks', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final d = spec.detail(row, calc, day);
      expect(d.oee.map((o) => o.formulaKey), ['productivity', 'productivityLunch']);
      expect(d.groups.map((g) => g.title), ['Inspection', 'Time', 'Idle time & other activity', 'OEE', 'Entry']);
      final figures = spec.figures(row, calc);
      expect(figures.ok, 592);
      expect(figures.actual, 600);
      expect(spec.remarkParts(row).map((p) => p['key']), ['downtime', 'general']);
    });
  });
}
