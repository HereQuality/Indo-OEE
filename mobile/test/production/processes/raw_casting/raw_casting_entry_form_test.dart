import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/raw_casting/raw_casting_calc.dart';
import 'package:indo/features/production/processes/raw_casting/raw_casting_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = rawCastingSpec;
const rowPath = '/api/v1/raw-casting-sheet/row';
const occupiedPath = '/api/v1/raw-casting-sheet/occupied';
const listPath = '/api/v1/raw-casting-sheet';

/// Operator Master as the page loads it: two operators for this process, one for
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'MANJU', 'isActive': true, 'processes': ['p1']},
  {'_id': 'w2', 'name': 'ANJU', 'processes': [{'_id': 'p1'}]},
  {'_id': 'w3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'w4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'w5', 'name': 'Unassigned', 'processes': <String>[]},
];
final lockedProcess = <String, dynamic>{'_id': 'p1', 'processName': 'RAW CASTING', 'dataEntryMenu': '/hqepl/production/raw-casting-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: lockedProcess);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': '24 PIN', 'totalCycleSec': 36},
  {'_id': 'i2', 'itemName': 'Cap', 'totalCycleSec': 30},
];
final vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Casting', 'isActive': true, 'processes': ['p1']},
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
  const _Launcher({required this.popped, this.row, this.workerId, this.process, this.withVendors = true, this.processes = const []});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? workerId;
  final Map<String, dynamic>? process;
  final bool withVendors;
  final List<Map<String, dynamic>> processes;

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
                    processes: processes,
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
  List<Map<String, dynamic>> processes = const [],
  List<Map<String, dynamic>> Function(Map<String, dynamic> query)? occupied,
  Size size = const Size(390, 844),
  bool dark = false,
  double textScale = 1.0,
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (r) => {'isOk': true, 'data': occupied?.call(r.query) ?? <Map<String, dynamic>>[]});
  final popped = <bool?>[];
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(
        popped: popped,
        row: row,
        workerId: workerId,
        process: linked ? lockedProcess : null,
        withVendors: withVendors,
        processes: processes,
      ),
    ),
    size: size,
    dark: dark,
    textScale: textScale,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return Harness(api, popped);
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
EntryActionBar bar(WidgetTester t) => t.widget<EntryActionBar>(find.byType(EntryActionBar));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));

/// The 10 May paper row: 08:15–16:00, 36 s, TOTAL 686, 5 + 13 defects.
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'w1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:15');
  f.onChange(index, 'machineOffTime', '16:00');
  f.onChange(index, 'actualQty', '686');
  f.onRejectChange(index, 'Blow Holes Casting', '5');
  f.onRejectChange(index, 'Crack/Damage Casting', '13');
  f.onChange(index, 'plannedOperatorShiftHours', '7.75');
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

/// The text box of the form field [field] of block 0.
Finder box(String field) => find.descendant(of: find.byKey(ValueKey('entry0/$field')), matching: find.byType(EditableText));

String calcText(WidgetTester tester, String key, {int index = 0}) =>
    tester.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry$index/calc/$key')), matching: find.byType(Text)).first).data ?? '';

void main() {
  group('identity', () {
    test('the page, endpoints and keys', () {
      expect(spec.routePath, '/production/raw-casting-data-entry');
      expect(spec.pageTitle, 'RAW CASTING Data Entry');
      expect(spec.api.list, '${Endpoints.v1}/raw-casting-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.referenceLists, {'vendors': Endpoints.vendors});
      expect(spec.machineLabel, 'Worker Name');
      expect(spec.uniqueMachinePerDate, isFalse);
      expect(spec.checksTimeOverlap, isFalse);
      expect(spec.maxEntriesPerDay, 8);
      expect([for (final w in workers) w['_id']], ['w1', 'w2', 'w5']);
    });

    test('registered right after Before Powder Coating', () {
      final keys = [for (final s in ProcessRegistry.all) s.key];
      expect(keys.indexOf('raw-casting'), keys.indexOf('bpc') + 1);
      expect(ProcessRegistry.byPath('/production/raw-casting-data-entry'), same(spec));
    });

    test('a process owns the page its Data Entry Page names', () {
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/raw-casting-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'}), isFalse);
      expect(spec.ownsProcess({}), isFalse);
    });
  });

  group('add', () {
    editorTest('a chosen worker opens the sheet: every card, label and cap of the web form', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000));
      expect(find.text('Add RAW CASTING Entry'), findsOneWidget);
      for (final title in [
        'Date, Worker Name, Working Status',
        'Item Name, Vendor Name, Challan No., Standard Inspection Time',
        'Inspection Start – End Time, Working Hours',
        'TOTAL QTY, Types of Defects',
        'Other Activity Carried Out',
        'Planned Operator Shift, Lunch / Tea',
        'Idle Time — Other (Min)',
        'Reason/Remarks for Rejection',
      ]) {
        expect(find.textContaining(title), findsWidgets, reason: title);
      }
      for (final label in [
        'Worker Name', 'Working Status', 'Item Name', 'Vendor Name', 'Challan No.', 'Standard Inspection Time per Piece (Sec)',
        'Inspection Start Time', 'Inspection End Time', 'Inspection Working Hours', 'TOTAL QTY', 'Ideal Inspection Quantity',
        'Ideal Inspection Qty/Hour', 'Ideal Inspection Time', 'Types of Defects (Qty)', 'Total Defects', 'OK QTY',
        'Time consume in Other Activity (min)', 'Planned Operator Shift (hours)', 'Lunch / Tea / Washroom etc (Min)', 'Minutes Allowed',
        'Other (Min)', 'Total Idle Time (Min)',
      ]) {
        expect(find.textContaining(label), findsWidgets, reason: label);
      }
      for (final d in rawCastingDefects) {
        expect(find.byKey(ValueKey('entry0/reject/$d')), findsOneWidget, reason: d);
      }
      expect(find.byKey(const ValueKey('entry0/reject/Tool Mark')), findsNothing);
      expect(find.textContaining('Rejection Master'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/operator')), findsNothing);
      expect(find.text('Add another entry'), findsOneWidget);
      expect(find.text('MANJU'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    editorTest('Vendor Name shows only when the process has vendors', (tester) async {
      await open(tester, workerId: 'w1', withVendors: false, size: const Size(390, 3000));
      expect(find.text('Vendor Name'), findsNothing);
      expect(find.text('Challan No.'), findsWidgets);
    });

    editorTest('Non Working hides every inspection card and sends a status-only body', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 3000));
      await fillValid(tester);
      form(tester).onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('Reasons For Not Working'), findsOneWidget);
      // A worker has no machine to break down.
      expect(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')), findsNothing);
      expect(find.byKey(const ValueKey('entry0/machineStatus/No Manpower')), findsOneWidget);
      expect(find.text('TOTAL QTY, Types of Defects'), findsNothing);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['worker'], 'w1');
      expect(b['itemName'], '');
      expect(b['item'], isNull);
      expect(b['actualQty'], '');
      expect(b['rejectBreakdown'], <String, dynamic>{});
      expect(b['lunchMin'], '');
    });

    editorTest('Save on an unfinished entry flags the web messages and sends nothing', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 3000));
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Item Name is required',
        'Standard Inspection Time per Piece is required',
        'Inspection Start Time is required',
        'Inspection End Time is required',
        'TOTAL QTY is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
    });

    editorTest('saves one entry: the exact PUT body (worker, process, defects; OK and Total Defects stay server-side)', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'vendor', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'challanNo', 'otherActivity', 'remarks', 'otherMinRemark',
        'machineOnTime', 'machineOffTime', 'totalCycleSec', 'actualQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin',
        'rejectBreakdown',
      });
      expect(b['worker'], 'w1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['totalCycleSec'], 36);
      expect(b['actualQty'], 686);
      expect(b['rejectBreakdown'], {'Blow Holes Casting': 5, 'Crack/Damage Casting': 13});
      expect(b['plannedOperatorShiftHours'], 7.75);
      expect(b['lunchMin'], 30);
      expect(b['otherMin'], '');
      final lookups = h.api.called('GET', occupiedPath);
      expect(lookups.first.query['worker'], 'w1');
      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
    });

    editorTest('a page not linked to a process cannot save, and says why', (tester) async {
      final h = await open(tester, linked: false);
      await fillValid(tester);
      await tapSave(tester);
      await tester.pump(const Duration(milliseconds: 800));
      expect(h.puts, isEmpty);
      expect(
        find.text('Link this page to the RAW CASTING process in Process Master (Data Entry Page) before adding entries.', skipOffstage: false),
        findsOneWidget,
      );
    });

    editorTest('the grey boxes follow the typed figures (the 10 May paper row)', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000));
      await fillValid(tester);
      expect(calcText(tester, 'shiftHours'), '7.75 hr (7:45)');
      expect(calcText(tester, 'idealQty'), '775');
      expect(calcText(tester, 'idealQtyPerHour'), '100');
      expect(calcText(tester, 'effectiveHours'), '6.86 hr (6:52)');
      expect(calcText(tester, 'totalDefect'), '18');
      expect(calcText(tester, 'okQty'), '668');
      expect(calcText(tester, 'stoppageAllowed'), '465');
      expect(find.text('Idle Time + Other Activity: 30 min of 465 min allowed'), findsOneWidget);
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsNothing);
    });

    editorTest('TOTAL QTY may beat Ideal: flagged for OEE Review, not blocked', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 3000));
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '800');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['actualQty'], 800);
    });

    editorTest('the defects cannot add up to more than TOTAL QTY', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '10');
      await tester.pump();
      await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/reject/Blow Holes Casting')), matching: find.byType(EditableText)), '6');
      await tester.pump();
      await tester.enterText(find.descendant(of: find.byKey(const ValueKey('entry0/reject/Other')), matching: find.byType(EditableText)), '5');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['rejectBreakdown']['Blow Holes Casting'], '6');
      expect(form(tester).entries[0]['rejectBreakdown']['Other'], isNot('5'));
      expect(toasts, contains("Defects can't add up to more than TOTAL QTY (10)."));
    });

    editorTest('Idle Time + Other Activity cannot go past the Working Hours: the worker\'s popup', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000));
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.enterText(box('otherActivityMin'), '50');
      await tester.pump();
      await tester.enterText(box('lunchMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['lunchMin'], isNot('30'));
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.text("Stoppage happens within the Inspection Working Hours, so all of it together can't be more than 60 min."), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('"Other" idle time and Other Activity minutes ask for their words', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000));
      await fillValid(tester);
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

    editorTest('one worker twice in a form with overlapping times is fine (the paper has 10:10–16:30 and 16:10–18:50)', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 3000));
      await fillValid(tester);
      form(tester).onAdd();
      await tester.pump();
      await fillValid(tester, index: 1);
      await tester.pump();
      expect(form(tester).errors.every((e) => e.isEmpty), isTrue, reason: '${form(tester).errors}');
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(2));
    });

    editorTest('a worker with 8 entries on the date is full — said at once', (tester) async {
      await open(
        tester,
        size: const Size(390, 3000),
        occupied: (q) => q['worker'] == 'w1' && q['date'] == '2024-05-10'
            ? [for (var s = 1; s <= rawCastingMaxEntriesPerDay; s++) {'slot': s, 'machineOnTime': '', 'machineOffTime': ''}]
            : const [],
      );
      final f = form(tester);
      f.onChange(0, 'date', '2024-05-10');
      f.onChange(0, 'machine', 'w1');
      await tester.pumpAndSettle();
      expect(form(tester).errors[0]['machine'], 'MANJU already has 8 entries on 10/05/2024 — edit one of them instead');
    });

    editorTest('Process Master\'s locked shift fills and locks the box', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 3000), processes: [
        {...lockedProcess, 'plannedShiftLocked': true, 'plannedShiftHours': 12},
      ]);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      expect(find.textContaining('Fixed at 12:00 hr — locked in Process Master'), findsOneWidget);
    });
  });

  group('responsive', () {
    for (final (name, size, scale, dark) in [
      ('a 360 px phone at large text', const Size(360, 640), 1.6, false),
      ('a phone in dark mode', const Size(390, 844), 1.0, true),
      ('a tablet', const Size(1024, 1366), 1.0, false),
      ('a phone in landscape', const Size(844, 390), 1.0, false),
    ]) {
      editorTest('the open form lays out on $name', (tester) async {
        await open(tester, workerId: 'w1', size: size, textScale: scale, dark: dark);
        await fillValid(tester);
        form(tester).onChange(0, 'otherMin', '5');
        await tester.pump();
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -2000));
        await tester.pump();
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('edit', () {
    final row = <String, dynamic>{
      '_id': 'e1', 'date': '2024-05-10', 'worker': 'w2', 'machine': 'w2', 'process': 'p1', 'operator': 'ANJU', 'slot': 6,
      'item': 'i1', 'itemName': '24 PIN', 'vendor': 'v1', 'vendorName': 'Acme Casting', 'challanNo': 'DC/28',
      'totalCycleSec': 36, 'machineOnTime': '08:15', 'machineOffTime': '16:00', 'actualQty': 686, 'okQty': 668,
      'rejectBreakdown': {'Blow Holes Casting': 5, 'Crack/Damage Casting': 13}, 'plannedOperatorShiftHours': 7.75, 'lunchMin': 30,
    };

    editorTest('the worker is locked, the saved figures are loaded and Update keeps the slot and _id', (tester) async {
      final h = await open(tester, row: row, size: const Size(390, 3000));
      expect(find.text('Update RAW CASTING Entry'), findsOneWidget);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      final v = form(tester).entries.single;
      expect(v['rejectBreakdown'], {'Blow Holes Casting': '5', 'Crack/Damage Casting': '13'});
      expect(v['challanNo'], 'DC/28');
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['_id'], 'e1');
      expect(b['slot'], 6);
      expect(b['worker'], 'w2');
      expect(b['challanNo'], 'DC/28');
      expect(b['rejectBreakdown'], {'Blow Holes Casting': 5, 'Crack/Damage Casting': 13});
    });
  });

  group('the list', () {
    final first = <String, dynamic>{
      '_id': 'e1', 'date': '2024-05-10', 'worker': 'w1', 'machine': 'w1', 'slot': 1, 'operator': 'MANJU', 'itemName': '24 PIN', 'vendorName': 'Acme',
      'machineOnTime': '10:10', 'machineOffTime': '16:30', 'totalCycleSec': 36, 'actualQty': 686, 'rejectBreakdown': {'Blow Holes Casting': 5, 'Crack/Damage Casting': 13},
      'plannedOperatorShiftHours': 6.333333, 'lunchMin': 30,
    };
    final second = <String, dynamic>{
      '_id': 'e2', 'date': '2024-05-10', 'worker': 'w1', 'machine': 'w1', 'slot': 2, 'operator': 'MANJU', 'itemName': '24 PIN',
      'machineOnTime': '16:10', 'machineOffTime': '18:50', 'totalCycleSec': 30, 'actualQty': 300, 'plannedOperatorShiftHours': 2.666667,
    };

    testWidgets('the table and cards read per worker, each entry its own productivity', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final api = FakeApi.install();
      api.list(Endpoints.machines, []);
      api.list(Endpoints.items, items);
      api.list(Endpoints.machineOperators, operators);
      api.list(Endpoints.processes, [lockedProcess]);
      api.list(Endpoints.companyHolidays, []);
      api.list(Endpoints.vendors, vendors);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', '$listPath/extent', (_) => {'isOk': true, 'data': {'from': '2024-01-01', 'to': '2026-12-31'}});
      api.on('GET', '$listPath/filter-options', (_) => {'isOk': true, 'data': {'machine': ['w1'], 'operator': <String>[], 'item': ['24 PIN']}, 'machineNames': {'w1': 'MANJU'}});
      api.on('GET', listPath, (_) => {
            'isOk': true,
            'data': [first, second],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
            'machineNames': {'w1': 'MANJU'},
          });
      await pumpScreen(tester, const ProductionSheetScreen(spec: spec), size: const Size(3600, 900));
      for (final key in ['machine', 'itemName', 'vendorName', 'challanNo', 'totalQty', 'okQty', 'totalDefect', 'idealQty', 'effective', 'productivity', 'productivityLunch', 'review']) {
        expect(find.byKey(ValueKey('head-$key')), findsOneWidget, reason: key);
      }
      String cell(String k) => tester.widget<Text>(find.descendant(of: find.byKey(ValueKey(k)), matching: find.byType(Text)).first).data ?? '';
      expect(cell('e1:okQty'), '668');
      expect(cell('e1:totalDefect'), '18');
      expect(cell('e1:productivity'), isNot(cell('e2:productivity')));
      expect(api.called('GET', listPath).every((r) => !r.query.containsKey('machine')), isTrue);
      expect(tester.takeException(), isNull);
    });
  });
}
