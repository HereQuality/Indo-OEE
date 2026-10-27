import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/bpc/bpc_calc.dart';
import 'package:indo/features/production/processes/bpc/bpc_spec.dart';
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/sheet_controller.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = bpcSpec;
const rowPath = '/api/v1/bpc-sheet/row';
const occupiedPath = '/api/v1/bpc-sheet/occupied';

/// Operator Master as the page loads it: two operators for this process, one for
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'op1', 'name': 'SUREKHA', 'isActive': true, 'processes': ['p1']},
  {'_id': 'op2', 'name': 'RAVI', 'processes': [{'_id': 'p1'}]},
  {'_id': 'op3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'op4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'op5', 'name': 'Unassigned', 'processes': <String>[]},
];
final lockedProcess = <String, dynamic>{'_id': 'p1', 'processName': 'BEFORE POWDER COATING', 'dataEntryMenu': '/hqepl/production/before-powder-coating-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: lockedProcess);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'BODY', 'totalCycleSec': 27},
  {'_id': 'i2', 'itemName': 'Cover', 'totalCycleSec': 30},
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

/// The first paper row as typed: 08:15–15:00, 27 s, TOTAL 796, OK 795 (1 Blow Holes).
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'op1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:15');
  f.onChange(index, 'machineOffTime', '15:00');
  f.onChange(index, 'actualQty', '796');
  f.onChange(index, 'okQty', '795');
  f.onRejectChange(index, 'Blow Holes Casting', '1');
  f.onChange(index, 'plannedOperatorShiftHours', '6.75');
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
  group('the operators stand in as machines', () {
    test('active operators of this process, plus those with no process yet', () {
      expect([for (final w in workers) w['_id']], ['op1', 'op2', 'op5']);
      expect(workers.first, {'_id': 'op1', 'machineName': 'SUREKHA', 'process': 'p1'});
      final all = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: null);
      expect([for (final w in all) w['_id']], ['op1', 'op2', 'op3', 'op5']);
    });
  });

  group('identity', () {
    test('the page, endpoints and keys', () {
      expect(spec.key, 'bpc');
      expect(spec.routePath, '/production/before-powder-coating-data-entry');
      expect(spec.pageTitle, 'BEFORE POWDER COATING Data Entry');
      expect(spec.api.list, '${Endpoints.v1}/bpc-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.occupied, occupiedPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.referenceLists, {'vendors': Endpoints.vendors});
      expect(spec.draftKey, 'bpcEntryDraft');
      expect(spec.machineLabel, 'Operator');
      expect(spec.uniqueMachinePerDate, isFalse);
      expect(spec.checksOperatorClash, isFalse);
      expect(spec.maxEntriesPerDay, 8);
    });

    test('registered after Injection Moulding, reachable by key and page', () {
      final keys = [for (final s in ProcessRegistry.all) s.key];
      expect(keys.indexOf('bpc'), greaterThan(keys.indexOf('injection')));
      expect(keys.indexOf('bpc'), greaterThan(keys.indexOf('powder-coating')));
      expect(ProcessRegistry.byKey('bpc'), same(spec));
      expect(ProcessRegistry.byPath('/production/before-powder-coating-data-entry'), same(spec));
    });

    test('a process owns the page its Data Entry Page names — not After Powder Coating\'s', () {
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/before-powder-coating-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/admin/production/before-powder-coating-data-entry/'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'}), isFalse);
      expect(powderCoatingSpec.ownsProcess({'dataEntryMenu': '/hqepl/production/before-powder-coating-data-entry'}), isFalse);
      expect(spec.ownsProcess({'dataEntryMenu': null}), isFalse);
      expect(spec.ownsProcess({}), isFalse);
    });
  });

  group('add', () {
    editorTest('a chosen operator opens the sheet: every card, label and cap of the web form', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      expect(find.text('Add BEFORE POWDER COATING Entry'), findsOneWidget);
      for (final title in [
        'Date, Operator, Working Status',
        'Item Name, Standard Time per Piece',
        'Machine ON – OFF Time, Machine Shift Time',
        'Production Master',
        'Rejection Master (Qty)',
        'Planned Operator Shift, Lunch / Tea',
        'Idle Time (min)',
        'Reason/Remarks',
      ]) {
        expect(find.textContaining(title), findsWidgets, reason: title);
      }
      for (final label in [
        'Working Status',
        'Item Name',
        'Vendor Name',
        'Standard Time per Piece (Sec)',
        'Machine ON Time',
        'Machine OFF Time',
        'Machine Shift Time (Hours)',
        'TOTAL QTY',
        'OK QTY',
        'Rejected QTY',
        'Ideal Quantity',
        'Ideal Quantity/Hours',
        'Effective Machine Run Time',
        ...bpcRejectReasons,
        'Planned Operator Shift (hours)',
        'Lunch / Tea / Washroom etc (Min)',
        'Idle Time Allowed (min)',
        'Setup Time (min)',
        'B.D. (Breakdown) (min)',
        'Other (Min)',
      ]) {
        expect(find.textContaining(label), findsWidgets, reason: label);
      }
      // This sheet's own reject reasons, none of the CNC list's.
      for (final reason in bpcRejectReasons) {
        expect(find.byKey(ValueKey('entry0/reject/$reason')), findsOneWidget, reason: reason);
      }
      expect(find.byKey(const ValueKey('entry0/reject/Tool Mark')), findsNothing);
      expect(find.text('Actual Quantity'), findsNothing);
      // No machine / operator text box / CNC downtime on this sheet.
      expect(find.textContaining('Machine No.'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/operator')), findsNothing);
      expect(find.textContaining('No Man Power'), findsNothing);
      expect(find.text('Add another entry'), findsOneWidget);
      // The block is headed by the operator.
      expect(find.text('SUREKHA'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    editorTest('an empty block asks for its operator in the web\'s words', (tester) async {
      await open(tester, workerId: 'op1');
      form(tester).onAdd();
      await tester.pump();
      expect(find.text('Select an operator — their entry fields open automatically'), findsOneWidget);
      // The new block copied the date of the one above it.
      expect(form(tester).entries[1]['date'], form(tester).entries[0]['date']);
    });

    editorTest('Vendor Name shows only when the process has vendors', (tester) async {
      await open(tester, workerId: 'op1', withVendors: false, size: const Size(390, 3000));
      expect(find.text('Vendor Name'), findsNothing);
    });

    editorTest('Non Working hides every work card, keeps Machine Breakdown and sends a status-only body', (tester) async {
      final h = await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      final f = form(tester);
      f.onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('Reasons For Not Working'), findsOneWidget);
      expect(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')), findsOneWidget);
      expect(find.text('Item Name, Standard Time per Piece'), findsNothing);
      expect(find.text('Production Master'), findsNothing);
      expect(find.text('Rejection Master (Qty)'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/statusOnlyNote')), findsOneWidget);
      // The Reason/Remarks line stays: its title and the label over its box.
      expect(find.text('Reason/Remarks'), findsNWidgets(2));
      expect(bar(tester).canSave, isTrue);
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')));
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['machineStatus'], ['Machine Breakdown']);
      expect(b['worker'], 'op1');
      // Anything typed before the status was picked goes out blank.
      expect(b['itemName'], '');
      expect(b['item'], isNull);
      expect(b['actualQty'], '');
      expect(b['okQty'], '');
      expect(b['rejectBreakdown'], <String, dynamic>{});
      expect(b['rejectReason'], '');
      expect(b['lunchMin'], '');
    });

    editorTest('Save on an unfinished entry flags the web messages and sends nothing', (tester) async {
      final h = await open(tester, workerId: 'op1', size: const Size(390, 3000));
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Item Name is required',
        'Standard Time per Piece is required',
        'Machine ON Time is required',
        'Machine OFF Time is required',
        'TOTAL QTY is required',
        'OK QTY is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
    });

    editorTest('saves one entry: the exact PUT body (worker, process, the reject split)', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();

      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'vendor', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'remarks', 'otherMinRemark', 'rejectOtherRemark',
        'machineOnTime', 'machineOffTime',
        'totalCycleSec', 'actualQty', 'okQty', 'plannedOperatorShiftHours', 'setupMin', 'bdMechMin', 'lunchMin', 'otherMin',
        'rejectBreakdown', 'rejectReason',
      });
      expect(b.containsKey('machine'), isFalse, reason: 'the API names it worker');
      expect(b.containsKey('rejectedQty'), isFalse, reason: 'the server derives it');
      expect(b['worker'], 'op1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['itemName'], 'BODY');
      expect(b['totalCycleSec'], 27);
      expect(b['machineOnTime'], '08:15');
      expect(b['machineOffTime'], '15:00');
      expect(b['actualQty'], 796);
      expect(b['okQty'], 795);
      expect(b['rejectBreakdown'], {'Blow Holes Casting': 1});
      expect(b['rejectReason'], 'Blow Holes Casting');
      expect(b['plannedOperatorShiftHours'], 6.75);
      expect(b['lunchMin'], 30);
      expect(b['setupMin'], '');
      expect(b['bdMechMin'], '');
      expect(b['otherMin'], '');
      expect(b['workingMode'], 'Working');
      expect(b['vendor'], '');

      // The booked-time lookup asked for the operator, as `worker`.
      final lookups = h.api.called('GET', occupiedPath);
      expect(lookups, isNotEmpty);
      expect(lookups.first.query['worker'], 'op1');
      expect(lookups.first.query.containsKey('machine'), isFalse);
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
          'Link this page to the BEFORE POWDER COATING process in Process Master (Data Entry Page) before adding entries.',
          skipOffstage: false,
        ),
        findsOneWidget,
      );
      expect(h.popped, isEmpty);
    });

    editorTest('the grey boxes follow the typed figures (the first paper row)', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      expect(calcText(tester, 'shiftHours'), '6.75 hr (6:45)');
      expect(calcText(tester, 'rejectedQty'), '1');
      expect(calcText(tester, 'idealQty'), '900');
      expect(calcText(tester, 'idealQtyPerHour'), '133.33');
      expect(calcText(tester, 'effectiveHours'), '5.97 hr');
      expect(calcText(tester, 'stoppageAllowed'), '405');
      expect(find.text('Total Idle Time (with Lunch / Tea): 30 min of 405 min allowed'), findsOneWidget);
      expect(find.text('Split so far: 1 of 1 rejected'), findsOneWidget);
      expect(find.text('= 6:45 hr'), findsOneWidget);
      // 796 in 6:45 at 27 s each is under Ideal: nothing flagged.
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsNothing);
      // The Part's own time is what the box holds: no "Part's usual" hint.
      expect(find.textContaining("Part's usual"), findsNothing);
      form(tester).onChange(0, 'totalCycleSec', '30');
      await tester.pump();
      expect(find.text("Part's usual: 27 sec"), findsOneWidget);
      // 30 s a piece makes the same 796 pieces 106% Performance: flagged for review.
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
    });

    editorTest('TOTAL QTY may beat Ideal Quantity: flagged for OEE Review, not blocked', (tester) async {
      final h = await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      final f = form(tester);
      f.onChange(0, 'actualQty', '950');
      f.onChange(0, 'okQty', '950');
      f.onRejectChange(0, 'Blow Holes Casting', '');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      expect(find.textContaining('Performance, OEE considering losses, OEE not considering losses but lunch above 100%'), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['actualQty'], 950);
      expect(h.body(0)['rejectBreakdown'], <String, dynamic>{});
    });

    editorTest('OK QTY stops at TOTAL QTY, in the sheet\'s words', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '10');
      await tester.pump();
      await tester.enterText(box('okQty'), '12');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['okQty'], isNot('12'));
      expect(toasts, contains("OK QTY can't be more than TOTAL QTY (10)"));
    });

    editorTest('the reject split must add up to Rejected QTY, and "Other" needs a remark', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      final f = form(tester);
      f.onChange(0, 'okQty', '790');
      await tester.pump();
      expect(find.text('Split so far: 1 of 6 rejected — 5 left to assign'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      f.onRejectChange(0, 'TAP Broken Casting', '3');
      f.onRejectChange(0, 'Other', '2');
      await tester.pump();
      expect(find.textContaining('Remark for “Other” rejection'), findsOneWidget);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when "Other" is a reject reason'), findsOneWidget);
      f.onChange(0, 'rejectOtherRemark', 'chipped');
      await tester.pump();
      expect(bar(tester).canSave, isTrue);
    });

    editorTest('idle time cannot go past the Machine Shift Time: the popup in the operator\'s words', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.enterText(box('setupMin'), '50');
      await tester.pump();
      await tester.enterText(box('bdMechMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['setupMin'], '50');
      // Only 10 of the 60 minutes are left for B.D. (Breakdown).
      expect(form(tester).entries[0]['bdMechMin'], isNot('30'));
      expect(toasts, isEmpty);
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Machine Shift Time, so all of it together can't be more than 60 min."), findsOneWidget);
      expect(find.text('Check the stoppage minutes, or the Start / End Time.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('before the times are in, an idle box stops at a day', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await tester.enterText(box('otherMin'), '1441');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(toasts, contains("Minutes can't be more than 1440 (a day)."));
    });

    editorTest('"Other" idle time asks for its remark', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      expect(find.textContaining('Remark for Other idle time'), findsNothing);
      form(tester).onChange(0, 'otherMin', '5');
      await tester.pump();
      expect(find.textContaining('Remark for Other idle time'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when Other idle time is entered'), findsOneWidget);
    });

    editorTest('Planned Operator Shift below the Machine Shift Time is refused, in the sheet\'s words', (tester) async {
      await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      form(tester).onChange(0, 'plannedOperatorShiftHours', '6.5');
      await tester.pump();
      // A time rule: said at once, not only after Save.
      expect(find.text("Planned Operator Shift can't be less than the Machine Shift Time (6:45)"), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
    });

    editorTest('the same operator twice in one form: fine, but their times can\'t overlap', (tester) async {
      final h = await open(tester, workerId: 'op1', size: const Size(390, 3000));
      await fillValid(tester);
      final f = form(tester);
      f.onAdd();
      await tester.pump();
      await fillValid(tester, index: 1);
      await tester.pump();
      final errors = form(tester).errors;
      expect(errors[1]['machineOnTime'], 'Machine ON Time overlaps another entry for this operator on this date (08:15 – 15:00)');
      expect(bar(tester).canSave, isFalse);
      form(tester).onChange(1, 'machineOnTime', '15:00');
      form(tester).onChange(1, 'machineOffTime', '18:00');
      form(tester).onChange(1, 'plannedOperatorShiftHours', '3');
      form(tester).onChange(1, 'lunchMin', '');
      await tester.pump();
      expect(form(tester).errors.every((e) => e.isEmpty), isTrue, reason: '${form(tester).errors}');
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(2));
      expect([for (var i = 0; i < 2; i++) h.body(i)['worker']], ['op1', 'op1']);
      expect(find.text('2 entries added successfully!'), findsOneWidget);
    });

    editorTest('an operator with $bpcMaxEntriesPerDay entries on the date is full — said on the box at once', (tester) async {
      await open(
        tester,
        size: const Size(390, 3000),
        occupied: (q) => q['worker'] == 'op1' && q['date'] == '2026-05-13'
            ? [for (var s = 1; s <= bpcMaxEntriesPerDay; s++) {'slot': s, 'machineOnTime': '', 'machineOffTime': ''}]
            : const [],
      );
      final f = form(tester);
      f.onChange(0, 'date', '2026-05-13');
      f.onChange(0, 'machine', 'op1');
      await tester.pumpAndSettle();
      expect(form(tester).errors[0]['machine'], 'SUREKHA already has 8 entries on 13/05/2026 — edit one of them instead');
      expect(find.text('SUREKHA already has 8 entries on 13/05/2026 — edit one of them instead'), findsWidgets);
      // Seven are fine.
      f.onChange(0, 'date', '2026-05-14');
      await tester.pumpAndSettle();
      expect(form(tester).errors[0].containsKey('machine'), isFalse);
    });

    editorTest('Process Master\'s locked shift fills and locks the box', (tester) async {
      await open(
        tester,
        workerId: 'op1',
        size: const Size(390, 3000),
        processes: [
          {...lockedProcess, 'plannedShiftLocked': true, 'plannedShiftHours': 12},
        ],
      );
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      expect(find.textContaining('Fixed at 12:00 hr — locked in Process Master'), findsOneWidget);
    });

    editorTest('an unlocked process leaves the shift to the person', (tester) async {
      await open(
        tester,
        workerId: 'op1',
        size: const Size(390, 3000),
        processes: [
          {...lockedProcess, 'plannedShiftLocked': false},
        ],
      );
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '');
      expect(find.text("Type hours — 6.75 is 6 h 45 min. The same as the Machine Shift Time gives the sheet's own figures."), findsOneWidget);
    });
  });

  group('responsive', () {
    for (final (name, size, scale, dark) in [
      ('a 360 px phone at large text', const Size(360, 640), 1.6, false),
      ('a phone in dark mode', const Size(390, 844), 1.0, true),
      ('a tablet (two columns)', const Size(1024, 1366), 1.0, false),
      ('a phone in landscape', const Size(844, 390), 1.0, false),
    ]) {
      editorTest('the open form lays out on $name', (tester) async {
        await open(tester, workerId: 'op1', size: size, textScale: scale, dark: dark);
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
      '_id': 'e1',
      'date': '2026-05-13',
      'worker': 'op2',
      'machine': 'op2',
      'process': 'p1',
      'operator': 'RAVI',
      'slot': 6,
      'item': 'i1',
      'itemName': 'BODY',
      'vendor': 'v1',
      'vendorName': 'Acme Casting',
      'totalCycleSec': 27,
      'machineOnTime': '08:15',
      'machineOffTime': '15:00',
      'actualQty': 796,
      'okQty': 790,
      'rejectedQty': 6,
      'rejectBreakdown': {'Blow Holes Casting': 2, 'TAP Broken Casting': 3, 'Other': 1},
      'rejectReason': 'TAP Broken Casting',
      'rejectOtherRemark': 'chipped',
      'plannedOperatorShiftHours': 6.75,
      'setupMin': 10,
      'lunchMin': 30,
      'remarks': 'ok',
    };

    editorTest('the operator is locked, the saved figures are loaded and Update keeps the slot and _id', (tester) async {
      final h = await open(tester, row: row, size: const Size(390, 3000));
      expect(find.text('Update BEFORE POWDER COATING Entry'), findsOneWidget);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      final v = form(tester).entries.single;
      expect(v['machine'], 'op2');
      expect(v['actualQty'], '796');
      expect(v['okQty'], '790');
      expect(v['rejectBreakdown'], {'Blow Holes Casting': '2', 'TAP Broken Casting': '3', 'Other': '1'});
      expect(v['plannedOperatorShiftHours'], '6.75');
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['_id'], 'e1');
      expect(b['slot'], 6);
      expect(b['worker'], 'op2');
      expect(b['process'], 'p1');
      expect(b['vendor'], 'v1');
      expect(b['rejectBreakdown'], {'Blow Holes Casting': 2, 'TAP Broken Casting': 3, 'Other': 1});
      expect(b['rejectReason'], 'TAP Broken Casting');
      expect(b['rejectOtherRemark'], 'chipped');
      expect(b['setupMin'], 10);
      expect(b['remarks'], 'ok');
      expect(h.popped, [true]);
    });

    editorTest('an edited entry keeps the shift it was saved with, even on Process Master\'s lock', (tester) async {
      await open(
        tester,
        row: row,
        size: const Size(390, 3000),
        processes: [
          {...lockedProcess, 'plannedShiftLocked': true, 'plannedShiftHours': 12},
        ],
      );
      expect(form(tester).entries.single['plannedOperatorShiftHours'], '6.75');
      expect(find.textContaining('Kept as this entry was saved — set by Process Master'), findsOneWidget);
    });

    editorTest('an operator no longer offered keeps the saved name', (tester) async {
      await open(tester, row: {...row, 'worker': 'gone', 'machine': 'gone', 'operator': 'Old Hand'}, size: const Size(390, 3000));
      expect(find.text('Old Hand'), findsWidgets);
    });
  });

  group('the list controller keys everything by operator', () {
    test('the operator filter and the booked lookup use ?worker=, names come with the rows', () async {
      final api = FakeApi.install();
      api.list(Endpoints.machines, []);
      api.list(Endpoints.items, items);
      api.list(Endpoints.machineOperators, operators);
      api.list(Endpoints.processes, [lockedProcess]);
      api.list(Endpoints.companyHolidays, []);
      api.list(Endpoints.vendors, vendors);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', '${Endpoints.v1}/bpc-sheet/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', '${Endpoints.v1}/bpc-sheet/filter-options', (_) => {
            'isOk': true,
            'data': {'machine': ['op1', 'old'], 'operator': <String>[], 'item': ['BODY']},
            'machineNames': {'old': 'Old Hand'},
          });
      api.on('GET', '${Endpoints.v1}/bpc-sheet', (_) => {
            'isOk': true,
            'data': [
              {
                '_id': 'e1', 'date': '2026-05-13', 'worker': 'old', 'machine': 'old', 'slot': 1, 'operator': 'Old Hand',
                'itemName': 'BODY', 'vendorName': 'Acme Casting', 'machineOnTime': '08:15', 'machineOffTime': '15:00',
                'totalCycleSec': 27, 'actualQty': 796, 'okQty': 795, 'rejectedQty': 1, 'plannedOperatorShiftHours': 6.75, 'lunchMin': 30,
              },
              {
                '_id': 'e2', 'date': '2026-05-13', 'worker': 'old', 'machine': 'old', 'slot': 2, 'operator': 'Old Hand',
                'itemName': 'BODY', 'machineOnTime': '15:00', 'machineOffTime': '18:00',
                'totalCycleSec': 30, 'actualQty': 345, 'okQty': 286, 'rejectedQty': 59, 'plannedOperatorShiftHours': 3, 'lunchMin': 0,
              },
            ],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
            'machineNames': {'old': 'Old Hand'},
          });

      final c = SheetController(spec: spec);
      await c.start();
      expect(c.referenceLoaded, isTrue);
      expect(c.lockedProcess?['_id'], 'p1', reason: 'the process whose Data Entry Page this is');
      expect([for (final m in c.scopedMachines) m['_id']], ['op1', 'op2', 'op5']);
      expect(c.extra['vendors'], hasLength(2));
      expect(c.showVendorColumn, isTrue);
      expect(c.machineName['old'], 'Old Hand');
      expect(c.machineName['op1'], 'SUREKHA');
      expect(c.days.single.machines.single.machineName, 'Old Hand');
      // Each entry's own OEE (the paper's 88.44% / 95.83%), not one figure for the day.
      final rows = c.days.single.machines.single.entries;
      expect([for (final r in rows) (c.dayOf(r)['oeeLosses'] as double) * 100], [closeTo(88.44, 0.01), closeTo(95.83, 0.01)]);
      // Search looks in item, operator and vendor.
      c.setSearch('acme');
      expect(c.days, hasLength(1));
      c.setSearch('zzz');
      expect(c.days, isEmpty);
      c.setSearch('');

      await c.applyQuery(c.range, c.filters.withDim('machine', ['op1', 'op2']));
      final lists = api.called('GET', '${Endpoints.v1}/bpc-sheet').toList();
      expect(lists.last.query['worker'], 'op1,op2');
      expect(lists.last.query.containsKey('machine'), isFalse);
      expect(api.called('GET', '${Endpoints.v1}/powder-coating-sheet'), isEmpty);
      c.dispose();
    });
  });

  group('the table and detail of a saved entry', () {
    final row = <String, dynamic>{
      '_id': 'e1',
      'date': '2026-05-13',
      'machine': 'op1',
      'operator': 'SUREKHA',
      'slot': 1,
      'itemName': 'BODY',
      'vendorName': 'Acme',
      'totalCycleSec': 27,
      'machineOnTime': '08:15',
      'machineOffTime': '15:00',
      'actualQty': 796,
      'okQty': 790,
      'rejectedQty': 6,
      'rejectBreakdown': {'Blow Holes Casting': 2, 'TAP Broken Casting': 3, 'Other': 1},
      'rejectOtherRemark': 'chipped',
      'plannedOperatorShiftHours': 6.75,
      'lunchMin': 30,
      'otherMin': 10,
      'otherMinRemark': 'power cut',
      'remarks': 'two re-done',
      'review': {'status': 'pending'},
    };

    test('the Rejected QTY breakdown opens to this sheet\'s reasons and their total', () {
      final open = spec.columns({'rejectedQty'});
      expect([for (final c in open.middle.where((c) => c.sub)) c.label], [...bpcRejectReasons, 'Total']);
      expect(open.expandSummary, {'rejectedQty': 'rejectedQty'});
      // Every formulaKey a column declares has a formula text.
      for (final c in open.middle) {
        if (c.formulaKey != null) expect(spec.formulas.containsKey(c.formulaKey), isTrue, reason: c.key);
      }
      // The "Other" reason and the Other idle minutes carry their remark eyes.
      expect(open.middle.firstWhere((c) => c.key == 'Other').remarkKind, 'reject');
      expect(open.middle.firstWhere((c) => c.key == 'otherMin').remarkKind, 'downtime');
      expect(open.middle.firstWhere((c) => c.key == 'remarks').remarkKind, 'general');
    });

    test('cells show the figures the web table does', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final open = spec.columns({'rejectedQty'});
      String cell(String key, {String name = 'SUREKHA'}) {
        final col = [...open.left, ...open.middle].firstWhere((c) => c.key == key);
        return col.text(CellData(row: row, calc: calc, day: day, machineName: name));
      }

      expect(cell('machine'), 'SUREKHA');
      expect(cell('machine', name: '—'), 'SUREKHA', reason: 'falls back to the name on the row');
      expect(cell('shift'), '6.75');
      expect(cell('cycle'), '27');
      expect(cell('totalQty'), '796');
      expect(cell('okQty'), '790');
      expect(cell('rejectedQty'), '6');
      expect(cell('TAP Broken Casting'), '3');
      expect(cell('Threading Casting'), '—');
      expect(cell('rejectSplitTotal'), '6');
      expect(cell('idealQty'), '900');
      expect(cell('plannedShift'), '6.75');
      expect(cell('totalStoppage'), '40');
      // Every piece run counts: 796 × 27 s.
      expect(cell('effective'), '5.97');
      expect(cell('review'), 'Pending review');
    });

    test('the detail groups every figure and the remarks', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final d = spec.detail(row, calc, day);
      expect(d.oee.map((o) => o.formulaKey), ['oeeLosses', 'oeeLunch']);
      expect(d.groups.map((g) => g.title), ['Quantities', 'Time', 'Idle time', 'OEE', 'Entry']);
      final figures = spec.figures(row, calc);
      expect(figures.ok, 790);
      expect(figures.actual, 796);
      expect(spec.remarkParts(row).map((p) => p['key']), ['reject', 'downtime', 'general']);
    });
  });
}
