import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/printing/printing_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = printingSpec;
const rowPath = '/api/v1/printing-sheet/row';
const occupiedPath = '/api/v1/printing-sheet/occupied';

/// Operator Master as the page loads it: two operators of this process, one of
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'op1', 'name': 'Surekha', 'isActive': true, 'processes': ['p1']},
  {'_id': 'op2', 'name': 'Ravi', 'processes': [{'_id': 'p1'}]},
  {'_id': 'op3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'op4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'op5', 'name': 'Unassigned', 'processes': <String>[]},
];
final p1 = <String, dynamic>{'_id': 'p1', 'processName': 'PRINTING', 'dataEntryMenu': '/hqepl/production/printing-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: p1);

/// Machine Master: the MC No. box offers this process's active machines.
final machineList = <Map<String, dynamic>>[
  {'_id': 'mc1', 'machineName': 'Printer 1', 'process': 'p1'},
  {'_id': 'mc2', 'machineName': 'Printer 2', 'process': {'_id': 'p1'}},
  {'_id': 'mc3', 'machineName': 'CNC 7A', 'process': 'p2'},
  {'_id': 'mc4', 'machineName': 'Old printer', 'process': 'p1', 'isActive': false},
];
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Label', 'totalCycleSec': 6},
  {'_id': 'i2', 'itemName': 'Carton', 'totalCycleSec': 38},
];
final vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Inks', 'isActive': true, 'processes': ['p1']},
];

void editorTest(String description, Future<void> Function(WidgetTester tester) body) {
  testWidgets(description, (tester) async {
    EntryNotices.reset();
    try {
      await body(tester);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
    } finally {
      EntryFormToast.reset();
    }
  });
}

class _Launcher extends StatelessWidget {
  const _Launcher({required this.popped, this.row, this.workerId, this.processes = const [], this.withVendors = false, this.linked = true});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? workerId;
  final List<Map<String, dynamic>> processes;
  final bool withVendors;
  final bool linked;

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
                    processes: processes,
                    extra: {'machines': machineList, 'vendors': withVendors ? vendors : <Map<String, dynamic>>[]},
                    lockedProcess: linked ? p1 : null,
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
  List<Map<String, dynamic>> processes = const [],
  bool withVendors = false,
  bool linked = true,
  List<Map<String, dynamic>> occupied = const [],
  Size size = const Size(390, 3200),
  bool dark = false,
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': occupied});
  final popped = <bool?>[];
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(popped: popped, row: row, workerId: workerId, processes: processes, withVendors: withVendors, linked: linked),
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
Finder box(String field, {int index = 0}) => find.descendant(of: find.byKey(ValueKey('entry$index/$field')), matching: find.byType(EditableText));
String calc(WidgetTester t, String key) =>
    t.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.byType(Text)).first).data ?? '';

/// The paper sheet's row: 10:30–16:00 at 6 s a piece, 3000 made, 2990 OK.
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'op1', String on = '10:30', String off = '16:00'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', on);
  f.onChange(index, 'machineOffTime', off);
  f.onChange(index, 'actualQty', '3000');
  f.onChange(index, 'okQty', '2990');
  f.onChange(index, 'plannedOperatorShiftHours', '5.5');
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

void main() {
  group('identity', () {
    test('the page, endpoints and keys', () {
      expect(ProcessRegistry.byKey('printing'), same(spec));
      expect(ProcessRegistry.byPath('/production/printing-data-entry'), same(spec));
      expect(spec.pageTitle, 'PRINTING Data Entry');
      expect(spec.api.list, '${Endpoints.v1}/printing-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.occupied, occupiedPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.extraReference, {'machines': Endpoints.machines});
      expect(spec.referenceLists, {'machines': Endpoints.machines, 'vendors': Endpoints.vendors});
      expect(spec.draftKey, 'printingEntryDraft');
      expect(spec.machineLabel, 'Operator');
      expect(spec.searchHint, 'Search item, operator, MC No., vendor…');
    });

    test('a process owns the page its Data Entry Page names, role slug or not', () {
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/printing-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/admin/production/printing-data-entry/'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/rubber-data-entry'}), isFalse);
      expect(spec.ownsProcess({}), isFalse);
    });

    test('the operators stand in as machines: this process\'s active ones plus the unassigned', () {
      expect([for (final w in workers) w['_id']], ['op1', 'op2', 'op5']);
      expect(workers.first, {'_id': 'op1', 'machineName': 'Surekha', 'process': 'p1'});
      final all = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: null);
      expect([for (final w in all) w['_id']], ['op1', 'op2', 'op3', 'op5']);
    });

    test('no overlap rule, up to 8 entries a date, the same operator twice in one form', () {
      expect(spec.checksTimeOverlap, isFalse);
      expect(spec.maxEntriesPerDay, 8);
      expect(spec.uniqueMachinePerDate, isFalse);
      expect(spec.checksOperatorClash, isFalse);
    });
  });

  group('add', () {
    editorTest('a chosen operator opens the sheet: every card and label of the web form, in its order', (tester) async {
      await open(tester, workerId: 'op1', withVendors: true);
      expect(find.text('Add PRINTING Entry'), findsOneWidget);
      for (final title in [
        'Date, Operator, Working Status',
        'MC No., Item Name, Standard Time per Piece',
        'Machine ON – OFF Time, Machine Shift Time',
        'Production Master',
        'Planned Operator Shift',
        'Idle Time (min)',
        'Reason/Remarks for Rejection/Rework',
      ]) {
        expect(find.textContaining(title), findsWidgets, reason: title);
      }
      for (final label in [
        'Date',
        'Operator',
        'Working Status',
        'MC No.',
        'Item Name',
        'Vendor Name',
        'Standard Time per Piece (in Sec)',
        'Machine ON Time',
        'Machine OFF Time',
        'Machine Shift Time (Hours)',
        'TOTAL QTY',
        'OK QTY',
        'Rejected QTY',
        'Ok Quantity (%)',
        'Effective Machine Run Time',
        'Ideal Quantity',
        'Ideal Quantity/Hours',
        'Planned Operator Shift (hours)',
        'Idle Time Allowed (min)',
        'Total Idle Time (Min)',
        'Ask Query To QC Team (min)',
        'Empty Bag Tugging (min)',
        'Stock Counting (min)',
        'Planned Down Time (min)',
        'Setup Time (min)',
        'No Man Power (min)',
        'Material Shifting (min)',
        'No Material (min)',
        'B.D. Mech. (min)',
        'B.D. Ele. (min)',
        'No Power (min)',
        'Lunch / Tea / Washroom etc (Min)',
        'Other (Min)',
      ]) {
        expect(find.textContaining(label, findRichText: true), findsWidgets, reason: label);
      }
      // The thirteen downtime boxes sit in the sheet's order.
      double y(String key) => tester.getTopLeft(find.byKey(ValueKey('entry0/$key'))).dy;
      expect(y('askQueryQcMin'), lessThanOrEqualTo(y('emptyBagTuggingMin')));
      expect(y('stockCountingMin'), lessThanOrEqualTo(y('plannedDownMin')));
      expect(y('lunchMin'), lessThanOrEqualTo(y('otherMin')));
      // No Rejection Master, no separate operator / machine row key box on this sheet.
      expect(find.textContaining('Rejection Master'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/operator')), findsNothing);
      expect(find.textContaining('Machine No.'), findsNothing);
      // The same operator may come again: "Add another entry" with the web's note.
      expect(find.text('Add another entry'), findsOneWidget);
      expect(find.text('The same operator can be added again — e.g. a second job at the same time.'), findsOneWidget);
      expect(find.text('Surekha'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    editorTest('Vendor Name shows only when the process has vendors', (tester) async {
      await open(tester, workerId: 'op1');
      expect(find.text('Vendor Name'), findsNothing);
    });

    editorTest('MC No. is optional and offers this process\'s active machines, "— None —" first', (tester) async {
      final h = await open(tester, workerId: 'op1');
      await tester.tap(find.byKey(const ValueKey('entry0/mcMachine')));
      await tester.pumpAndSettle();
      expect(find.text('— None —'), findsWidgets);
      expect(find.text('Printer 1'), findsOneWidget);
      expect(find.text('Printer 2'), findsOneWidget);
      expect(find.text('CNC 7A'), findsNothing);
      expect(find.text('Old printer'), findsNothing);
      await tester.tap(find.text('Printer 2'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['mcMachine'], 'mc2');
      // Left blank, it is no error.
      await fillValid(tester);
      form(tester).onChange(0, 'mcMachine', '');
      await tester.pump();
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['mcMachine'], '');
    });

    editorTest('Save on an unfinished entry flags the web messages and sends nothing', (tester) async {
      final h = await open(tester, workerId: 'op1');
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Item Name is required',
        'Standard Time per Piece is required',
        'Machine ON Time is required',
        'Machine OFF Time is required',
        'Actual Quantity is required',
        'OK Quantity is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
      expect(find.text('This entry is incomplete — fix the highlighted fields to save.'), findsOneWidget);
    });

    editorTest('saves one entry: the exact PUT body (worker, process, MC No., thirteen downtime columns)', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'mcMachine', 'mc1');
      form(tester).onChange(0, 'stockCountingMin', '10');
      await tester.pump();
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'mcMachine', 'vendor', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'remarks', 'otherMinRemark', 'machineOnTime', 'machineOffTime',
        'totalCycleSec', 'actualQty', 'okQty', 'plannedOperatorShiftHours',
        'askQueryQcMin', 'emptyBagTuggingMin', 'stockCountingMin',
        'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin',
      });
      expect(b.containsKey('machine'), isFalse, reason: 'the API names it worker');
      expect(b.containsKey('rejectBreakdown'), isFalse, reason: 'no Rejection Master');
      expect(b['worker'], 'op1');
      expect(b['process'], 'p1');
      expect(b['mcMachine'], 'mc1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['itemName'], 'Label');
      expect(b['totalCycleSec'], 6);
      expect(b['actualQty'], 3000);
      expect(b['okQty'], 2990);
      expect(b['plannedOperatorShiftHours'], 5.5);
      expect(b['lunchMin'], 30);
      expect(b['stockCountingMin'], 10);
      expect(b['askQueryQcMin'], '');
      expect(b['otherMinRemark'], '');
      expect(b['workingMode'], 'Working');
      // The occupied lookup asks for the operator, as `worker`; no operator-clash lookup.
      final lookups = h.api.called('GET', occupiedPath).toList();
      expect(lookups, isNotEmpty);
      expect(lookups.first.query['worker'], 'op1');
      expect(lookups.where((r) => r.query.containsKey('operator')), isEmpty);
      expect(h.popped, [true]);
      expect(find.text('Entry added successfully!'), findsOneWidget);
    });

    editorTest('one operator, two jobs at the same time: both entries save (no overlap rule)', (tester) async {
      final h = await open(tester, workerId: 'op1', occupied: [
        {'slot': 1, 'machineOnTime': '10:30', 'machineOffTime': '16:00'},
      ]);
      await fillValid(tester);
      await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
      await tester.tap(find.byKey(const ValueKey('entry-add')));
      await tester.pumpAndSettle();
      // The new block asks for its operator — and the one already in the form is offered as is.
      expect(find.textContaining('already added'), findsNothing);
      await tester.tap(find.text('Surekha').last);
      await tester.pumpAndSettle();
      expect(form(tester).entries[1]['machine'], 'op1');
      await fillValid(tester, index: 1);
      // What is already saved is said, and overlapping is fine.
      expect(find.textContaining('Already entered for this operator on this date: 10:30 – 16:00', findRichText: true), findsWidgets);
      expect(find.textContaining('overlaps'), findsNothing);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(2));
      expect(h.body(0)['worker'], 'op1');
      expect(h.body(1)['worker'], 'op1');
      expect(find.text('2 entries added successfully!'), findsOneWidget);
    });

    editorTest('an operator whose date already has 8 entries is told at once, on the Operator box', (tester) async {
      final h = await open(tester, workerId: 'op1', occupied: [
        for (var s = 1; s <= 8; s++) {'slot': s, 'machineOnTime': '10:30', 'machineOffTime': '16:00'},
      ]);
      final today = form(tester).entries[0]['date'] as String;
      final p = today.split('-');
      final message = 'Surekha already has 8 entries on ${p[2]}/${p[1]}/${p[0]} — edit one of them instead';
      // Live, before Save is pressed (web isLiveMessage).
      expect(find.text(message), findsOneWidget);
      await fillValid(tester);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, isEmpty);
    });

    editorTest('the grey boxes follow the typed figures (Ideal Quantity unrounded, decimal hours)', (tester) async {
      await open(tester, workerId: 'op1');
      final f = form(tester);
      f.onItemSelect(0, 'i2');
      f.onChange(0, 'machineOnTime', '08:30');
      f.onChange(0, 'machineOffTime', '17:55');
      f.onChange(0, 'actualQty', '880');
      f.onChange(0, 'okQty', '870');
      f.onChange(0, 'plannedOperatorShiftHours', '9.42');
      f.onChange(0, 'lunchMin', '30');
      f.onChange(0, 'askQueryQcMin', '5');
      await tester.pump();
      expect(calc(tester, 'shiftHours'), '9.42 hr (9:25)');
      expect(calc(tester, 'idealQtyExact'), '892.11');
      expect(calc(tester, 'idealQtyPerHour'), '94.74');
      expect(calc(tester, 'rejectedQty'), '10');
      expect(calc(tester, 'pctOk'), '98.86%');
      expect(calc(tester, 'effectiveHours'), '9.29 hr (9:17)');
      expect(calc(tester, 'stoppageAllowed'), '565');
      expect(calc(tester, 'totalStoppageMin'), '35');
      expect(find.text('Total Idle Time: 35 min of 565 min allowed', findRichText: true), findsOneWidget);
      expect(find.text('= 9:25 hr'), findsOneWidget);
    });

    editorTest('TOTAL QTY stops at the Ideal Quantity rounded down, with the web popup in the operator\'s words', (tester) async {
      await open(tester, workerId: 'op1');
      final f = form(tester);
      f.onItemSelect(0, 'i2');
      f.onChange(0, 'machineOnTime', '08:30');
      f.onChange(0, 'machineOffTime', '17:55');
      await tester.pump();
      await tester.enterText(box('actualQty'), '893');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['actualQty'], isNot('893'));
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.text("Can't add this much quantity"), findsOneWidget);
      expect(find.text('As per calculation, this operator can make at most 892 pieces in this shift.'), findsOneWidget);
      expect(find.text('Check the quantity, the time per piece, or the Machine ON / OFF Time.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('OK QTY can\'t be more than TOTAL QTY', (tester) async {
      await open(tester, workerId: 'op1');
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '100');
      await tester.pump();
      await tester.enterText(box('okQty'), '101');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['okQty'], isNot('101'));
      expect(toasts, contains("OK QTY can't be more than TOTAL QTY (100)"));
    });

    editorTest('all thirteen downtime columns together stay within the Machine Shift Time', (tester) async {
      await open(tester, workerId: 'op1');
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '10:00');
      f.onChange(0, 'machineOffTime', '11:00');
      f.onChange(0, 'askQueryQcMin', '40');
      await tester.pump();
      await tester.enterText(box('stockCountingMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['stockCountingMin'], isNot('30'));
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Machine Shift Time, so all of it together can't be more than 60 min."), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('"Other" downtime asks for its remark', (tester) async {
      await open(tester, workerId: 'op1');
      await fillValid(tester);
      expect(find.textContaining('Remark for Other downtime', findRichText: true), findsNothing);
      form(tester).onChange(0, 'otherMin', '5');
      await tester.pump();
      expect(find.textContaining('Remark for Other downtime', findRichText: true), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when Other downtime is entered'), findsOneWidget);
    });

    editorTest('Non Working hides every work card; the reasons and remarks are all that is sent', (tester) async {
      final h = await open(tester, workerId: 'op1');
      final f = form(tester);
      f.onChange(0, 'mcMachine', 'mc1');
      f.onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('Reasons For Not Working', findRichText: true), findsOneWidget);
      expect(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')), findsOneWidget);
      expect(find.text('MC No., Item Name, Standard Time per Piece'), findsNothing);
      expect(find.text('Production Master'), findsNothing);
      expect(find.textContaining('no work that day (W.OFF and the like)', findRichText: true), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Manpower')));
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['machineStatus'], ['No Manpower']);
      expect(b['mcMachine'], '');
      expect(b['item'], isNull);
      expect(b['actualQty'], '');
      expect(b['stockCountingMin'], '');
    });

    editorTest('a page not linked to a process cannot save, and says why', (tester) async {
      final h = await open(tester, linked: false);
      await fillValid(tester);
      await tapSave(tester);
      await tester.pump(const Duration(milliseconds: 800));
      expect(h.puts, isEmpty);
      expect(
        find.text('Link this page to the PRINTING process in Process Master (Data Entry Page) before adding entries.', skipOffstage: false),
        findsOneWidget,
      );
    });
  });

  group('Planned Operator Shift', () {
    editorTest('locked in Process Master: filled in, read-only, and says why', (tester) async {
      await open(tester, workerId: 'op1', processes: [
        {...p1, 'plannedShiftLocked': true, 'plannedShiftHours': 12},
      ]);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      expect(find.text('Fixed at 12:00 hr — locked in Process Master'), findsOneWidget);
      final field = tester.widget<EditableText>(box('plannedOperatorShiftHours'));
      expect(field.readOnly, isTrue);
    });

    editorTest('unlocked: typed as decimal hours like the sheet', (tester) async {
      await open(tester, workerId: 'op1', processes: [
        {...p1, 'plannedShiftLocked': false},
      ]);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '');
      expect(find.text("Type hours as on the sheet — the Machine Shift Time gives the sheet's own figures."), findsOneWidget);
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '10:30');
      f.onChange(0, 'machineOffTime', '16:00');
      f.onChange(0, 'plannedOperatorShiftHours', '5');
      await tester.pump();
      // A time rule: shown at once.
      expect(find.text("Planned Operator Shift can't be less than the Machine Shift (5:30)"), findsOneWidget);
    });
  });

  group('edit', () {
    final row = <String, dynamic>{
      '_id': 'e1',
      'date': '2025-05-14',
      'worker': 'op2',
      'machine': 'op2',
      'process': 'p1',
      'operator': 'Ravi',
      'slot': 3,
      'mcMachine': 'mc9',
      'mcName': 'Retired printer',
      'item': 'i1',
      'itemName': 'Label',
      'totalCycleSec': 6,
      'machineOnTime': '10:30',
      'machineOffTime': '16:00',
      'actualQty': 3000,
      'okQty': 2990,
      'rejectedQty': 10,
      'plannedOperatorShiftHours': 5.5,
      'lunchMin': 30,
      'stockCountingMin': 12,
      'remarks': 'smudged',
    };

    editorTest('the operator is locked, the saved figures load, and Update keeps the slot and _id', (tester) async {
      final h = await open(tester, row: row);
      expect(find.text('Update PRINTING Entry'), findsOneWidget);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      final v = form(tester).entries.single;
      expect(v['machine'], 'op2');
      expect(v['actualQty'], '3000');
      expect(v['stockCountingMin'], '12');
      expect(v['plannedOperatorShiftHours'], '5.5');
      // An MC No. no longer offered still shows by its saved name.
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/mcMachine'))).text, 'Retired printer');
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['_id'], 'e1');
      expect(b['slot'], 3);
      expect(b['worker'], 'op2');
      expect(b['mcMachine'], 'mc9');
      expect(b['stockCountingMin'], 12);
      expect(find.text('Entry updated successfully!'), findsOneWidget);
    });
  });

  group('the saved entry\'s detail', () {
    testWidgets('every figure of the table, grouped, with the own causes listed', (tester) async {
      final row = <String, dynamic>{
        '_id': 'e1',
        'date': '2025-05-14',
        'machine': 'op1',
        'operator': 'Surekha',
        'mcMachine': 'mc1',
        'mcName': 'Printer 1',
        'itemName': 'Label',
        'totalCycleSec': 6,
        'machineOnTime': '10:30',
        'machineOffTime': '16:00',
        'actualQty': 2700,
        'okQty': 2700,
        'plannedOperatorShiftHours': 5.5,
        'lunchMin': 30,
        'askQueryQcMin': 10,
        'emptyBagTuggingMin': 10,
        'stockCountingMin': 10,
      };
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final model = spec.detail(row, calc, day);
      expect(model.oee.map((o) => o.value), ['100.00%', '90.00%', '90.00%']);
      await pumpScreen(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: EntryDetail(
              spec: spec,
              row: row,
              calc: calc,
              day: day,
              lockMessage: '',
              unlockedUntil: null,
              canEdit: false,
              canDelete: false,
              isAdmin: false,
              unlocking: false,
              deleting: false,
              onEdit: () {},
              onDelete: () {},
              onUnlock: () {},
            ),
          ),
        ),
        size: const Size(390, 2400),
      );
      for (final label in [
        'Standard Time per Piece (in Sec)',
        'TOTAL QTY.',
        'Ideal Quantity',
        'Machine Shift Time (Hours)',
        'Effective Machine Run Time (hours)',
        'Unreported Time (min)',
        'Total Idle Time (Min)',
        'Ask Query To QC Team',
        'Empty Bag Tugging',
        'Stock Counting',
        'Lunch / Tea / Washroom etc',
        'MC No.',
        'Printer 1',
        'Availability (%)',
      ]) {
        expect(find.textContaining(label, findRichText: true), findsWidgets, reason: label);
      }
      expect(tester.takeException(), isNull);
    });
  });

  group('responsive', () {
    for (final (name, size, scale, dark) in [
      ('small phone, large text', const Size(360, 3600), 1.6, false),
      ('tablet, dark', const Size(1024, 2400), 1.0, true),
      ('landscape phone', const Size(844, 2400), 1.0, false),
    ]) {
      editorTest('the open form lays out without overflow: $name', (tester) async {
        await open(tester, workerId: 'op1', size: size, textScale: scale, dark: dark, withVendors: true);
        await fillValid(tester);
        form(tester).onChange(0, 'otherMin', '5');
        await tester.pump();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
