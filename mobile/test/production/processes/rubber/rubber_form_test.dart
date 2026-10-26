import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/entry_number_input.dart' show EntryTextField;
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/process/process_spec.dart' show DetailMetric;
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/processes/rubber/rubber_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/sheet_controller.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = rubberSpec;
const rowPath = '/api/v1/rubber-sheet/row';
const occupiedPath = '/api/v1/rubber-sheet/occupied';

/// Operator Master as the page loads it: two workers for this process, one for
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'Asha', 'isActive': true, 'processes': ['p1']},
  {'_id': 'w2', 'name': 'Ravi', 'processes': [{'_id': 'p1'}]},
  {'_id': 'w3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'w4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'w5', 'name': 'Unassigned', 'processes': <String>[]},
];
final lockedProcess = <String, dynamic>{'_id': 'p1', 'processName': 'RUBBER', 'dataEntryMenu': '/hqepl/production/rubber-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: lockedProcess);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Seal', 'totalCycleSec': 45},
  {'_id': 'i2', 'itemName': 'Gasket', 'totalCycleSec': 30},
];
final vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Rubber', 'isActive': true, 'processes': ['p1']},
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
  List<Map<String, dynamic>> booked = const [],
  List<Map<String, dynamic>> processes = const [],
  Size size = const Size(390, 844),
  bool dark = false,
  double textScale = 1.0,
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': booked});
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

/// 8 h at 45 s a piece (IDEAL 640), 600 made, 590 OK, the 10 rejected split
/// 6 Tool Mark + 4 Surface Finish, planned 8.5 (decimal hours: 8 h 30 min), 30 min lunch.
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'w1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:00');
  f.onChange(index, 'machineOffTime', '16:00');
  f.onChange(index, 'actualQty', '600');
  f.onChange(index, 'okQty', '590');
  f.onRejectChange(index, 'Tool Mark', '6');
  f.onRejectChange(index, 'Surface Finish', '4');
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

String calcText(WidgetTester t, String key) =>
    t.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.byType(Text)).first).data ?? '';

void main() {
  group('registry', () {
    test('RUBBER sits right after After Powder Coating and owns its page', () {
      final all = ProcessRegistry.all;
      expect(all.indexOf(spec), all.indexOf(powderCoatingSpec) + 1);
      expect(ProcessRegistry.byKey('rubber'), same(spec));
      expect(ProcessRegistry.byPath('/production/rubber-data-entry'), same(spec));
    });
  });

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
      expect(spec.routePath, '/production/rubber-data-entry');
      expect(spec.pageTitle, 'RUBBER Data Entry');
      expect(spec.api.list, '${Endpoints.v1}/rubber-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.occupied, occupiedPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.extraReference, {'vendors': '${Endpoints.v1}/vendors'});
      expect(spec.draftKey, 'rubberEntryDraft');
      expect(spec.machineLabel, 'Worker Name');
      expect(spec.checksOperatorClash, isFalse);
      expect(spec.maxEntriesPerDay, 3);
      expect(spec.usesPlannedShiftSetting, isTrue);
      expect(spec.showLimitPopups, isTrue);
    });

    test('a process owns the page its Data Entry Page names, role slug or not', () {
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/rubber-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/admin/production/rubber-data-entry/'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'}), isFalse);
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
    editorTest('a chosen worker opens the sheet: every card, label and box of the web form', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      expect(find.text('Add RUBBER Entry'), findsOneWidget);
      for (final title in [
        'Date, Worker Name, Working Status',
        'Part Name, Total Cycle Time',
        'Working Start – End Time, Worker Shift Time',
        'Production Master',
        'Rejection Master (Qty)',
        'Planned Operator Shift, Lunch / Tea',
        'Stoppage (min)',
        'Remarks',
      ]) {
        expect(find.textContaining(title), findsWidgets, reason: title);
      }
      for (final label in [
        'Date',
        'Worker Name',
        'Working Status',
        'Part Name',
        'Vendor Name',
        'Total Cycle Time (Sec)',
        'Working Start Time',
        'Working End Time',
        'Worker Shift Time',
        'Actual Quantity',
        'OK Quantity',
        'Rejected',
        '% OK Quantity',
        'Effective working Time',
        'IDEAL Quantity',
        'IDEAL Quantity / Hour',
        'Dimension Out',
        'Tool Mark',
        'Other',
        'Planned Operator Shift (hours)',
        'Lunch / Tea / Washroom (min)',
        'Stoppage Allowed (min)',
        'Planned downtime (min)',
        'Set-up Time (min)',
        'No Manpower (min)',
        'Material Shifting (min)',
        'No Material (min)',
        'No Power (min)',
        'Others (min)',
      ]) {
        expect(find.textContaining(label), findsWidgets, reason: label);
      }
      // A worker has no machine to break down, and no separate operator.
      expect(find.textContaining('Machine No.'), findsNothing);
      expect(find.textContaining('B.D.'), findsNothing);
      expect(find.textContaining('Breakdown'), findsNothing);
      expect(find.byKey(const ValueKey('entry0/operator')), findsNothing);
      expect(find.text('Add another worker'), findsOneWidget);
      // The block is headed by the worker.
      expect(find.text('Asha'), findsWidgets);
      expect(tester.takeException(), isNull);
    });

    editorTest('Vendor Name shows only when the process has vendors', (tester) async {
      await open(tester, workerId: 'w1', withVendors: false, size: const Size(390, 2600));
      expect(find.text('Vendor Name'), findsNothing);
    });

    editorTest('Non Working hides every work card, offers only the worker reasons, and blanks the rest on Save', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      form(tester).onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('Reasons For Not Working'), findsOneWidget);
      expect(find.textContaining('no work that day'), findsOneWidget);
      expect(find.text('Part Name, Total Cycle Time'), findsNothing);
      expect(find.text('Production Master'), findsNothing);
      expect(find.text('Rejection Master (Qty)'), findsNothing);
      // A worker has no machine to break down (WORKER_STATUSES).
      expect(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')), findsNothing);
      expect(find.text('Remarks'), findsWidgets);
      expect(bar(tester).canSave, isTrue);
      await tester.tap(find.byKey(const ValueKey('entry0/machineStatus/No Manpower')));
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(1));
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['machineStatus'], ['No Manpower']);
      expect(b['worker'], 'w1');
      // Anything work-related goes out blank.
      expect(b['itemName'], '');
      expect(b['item'], isNull);
      expect(b['actualQty'], '');
      expect(b['okQty'], '');
      expect(b['rejectBreakdown'], isEmpty);
      expect(b['rejectReason'], '');
      expect(b['lunchMin'], '');
    });

    editorTest('Save on an unfinished entry flags the web messages and sends nothing', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2600));
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Part Name is required',
        'Total Cycle Time is required',
        'Working Start Time is required',
        'Working End Time is required',
        'Actual Quantity is required',
        'OK Quantity is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
    });

    editorTest('saves one entry: the exact PUT body (worker, process, the split; Rejected stays server-side)', (tester) async {
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
        'totalCycleSec', 'actualQty', 'okQty', 'plannedOperatorShiftHours',
        'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'noPowerMin', 'lunchMin', 'otherMin',
        'rejectBreakdown', 'rejectReason',
      });
      expect(b.containsKey('machine'), isFalse, reason: 'the API names it worker');
      expect(b.containsKey('rejectedQty'), isFalse, reason: 'the server works it out (Actual − OK)');
      expect(b.containsKey('operator'), isFalse);
      expect(b['worker'], 'w1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['item'], 'i1');
      expect(b['itemName'], 'Seal');
      expect(b['totalCycleSec'], 45);
      expect(b['machineOnTime'], '08:00');
      expect(b['machineOffTime'], '16:00');
      expect(b['actualQty'], 600);
      expect(b['okQty'], 590);
      expect(b['rejectBreakdown'], {'Tool Mark': 6, 'Surface Finish': 4});
      expect(b['rejectReason'], 'Tool Mark');
      expect(b['rejectOtherRemark'], '');
      expect(b['plannedOperatorShiftHours'], 8.5);
      expect(b['lunchMin'], 30);
      expect(b['setupMin'], '');
      expect(b['otherMin'], '');
      expect(b['otherMinRemark'], '');
      expect(b['workingMode'], 'Working');
      expect(b['machineStatus'], isEmpty);
      expect(b['vendor'], '');

      // The booked-time lookup asked for the worker, not a machine.
      final lookups = h.api.called('GET', occupiedPath);
      expect(lookups, isNotEmpty);
      expect(lookups.first.query['worker'], 'w1');
      expect(lookups.first.query.containsKey('machine'), isFalse);
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
        find.text('Link this page to the RUBBER process in Process Master (Data Entry Page) before adding entries.', skipOffstage: false),
        findsOneWidget,
      );
      expect(h.popped, isEmpty);
    });

    editorTest('the grey boxes follow the typed figures', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      expect(calcText(tester, 'shiftHours'), '8:00 hr');
      expect(calcText(tester, 'rejectedQty'), '10');
      expect(calcText(tester, 'pctOk'), '98.33%');
      // 590 OK × 45 s = 7 h 22 min 30 s.
      expect(calcText(tester, 'effectiveHours'), '7:23 hr');
      expect(calcText(tester, 'idealQty'), '640');
      expect(calcText(tester, 'idealQtyPerHour'), '80');
      expect(calcText(tester, 'stoppageAllowed'), '480');
      expect(find.text('Total stoppage (with Lunch / Tea): 30 min of 480 min allowed'), findsOneWidget);
      expect(find.text('Split so far: 10 of 10 rejected'), findsOneWidget);
      expect(find.text('= 8:30 hr'), findsOneWidget);
      // 600 made in 8 h at 45 s each is under IDEAL: nothing flagged.
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsNothing);
    });

    editorTest('Actual may beat IDEAL Quantity: flagged for OEE Review, not blocked', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      await tester.enterText(box('actualQty'), '700');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], '700', reason: 'no cap at IDEAL Quantity (640)');
      form(tester).onChange(0, 'okQty', '690');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      expect(find.textContaining('Performance above 100%'), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['actualQty'], 700);
    });

    editorTest('OK Quantity is capped at Actual, with the web message', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '10');
      await tester.pump();
      await tester.enterText(box('okQty'), '12');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['okQty'], isNot('12'));
      expect(toasts, contains("OK Quantity can't be more than Actual Quantity (10)"));
    });

    editorTest('the Rejection Master split must add up, and "Other" needs its remark', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      final f = form(tester);
      f.onRejectChange(0, 'Tool Mark', '');
      f.onRejectChange(0, 'Surface Finish', '');
      f.onRejectChange(0, 'Other', '4');
      await tester.pump();
      expect(find.text('Split so far: 4 of 10 rejected — 6 left to assign'), findsOneWidget);
      expect(find.textContaining('Remark for “Other” rejection'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(
        find.text('6 of 10 rejected piece(s) still have no reason — the boxes must add up to the rejected quantity'),
        findsOneWidget,
      );
      expect(find.text('Remark is required when "Other" is a reject reason'), findsOneWidget);
    });

    editorTest('stoppage cannot go past the Worker Shift Time: the web popup in RUBBER\'s words', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.enterText(box('setupMin'), '50');
      await tester.pump();
      await tester.enterText(box('lunchMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['setupMin'], '50');
      // Only 10 of the 60 minutes are left for Lunch / Tea.
      expect(form(tester).entries[0]['lunchMin'], isNot('30'));
      expect(toasts, isEmpty);
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Worker Shift Time, so all of it together can't be more than 60 min."), findsOneWidget);
      expect(find.text('Check the stoppage minutes, or the Start / End Time.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('"Others" stoppage asks for its remark', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      expect(find.textContaining('Remark for Others stoppage'), findsNothing);
      form(tester).onChange(0, 'otherMin', '5');
      await tester.pump();
      expect(find.textContaining('Remark for Others stoppage'), findsOneWidget);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when Others stoppage is entered'), findsOneWidget);
    });

    editorTest('the time rules speak up at once, in the worker\'s words', (tester) async {
      await open(
        tester,
        workerId: 'w1',
        size: const Size(390, 2600),
        booked: [
          {'slot': 1, 'machineOnTime': '06:00', 'machineOffTime': '08:00'},
        ],
      );
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '10:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pumpAndSettle();
      // Before Save: End before Start shows at once (web isEndBeforeStartMessage).
      expect(find.text('Working End Time must be after Working Start Time'), findsOneWidget);
      expect(find.text('Part Name is required'), findsNothing);
      f.onChange(0, 'machineOnTime', '07:00');
      f.onChange(0, 'machineOffTime', '12:00');
      await tester.pumpAndSettle();
      expect(find.text('Working Start Time overlaps another entry for this worker on this date (06:00 – 08:00)'), findsOneWidget);
      expect(find.textContaining('Already booked for this worker on this date: 06:00 – 08:00'), findsOneWidget);
    });

    editorTest('a worker with three entries that date is said at once', (tester) async {
      await open(
        tester,
        workerId: 'w1',
        size: const Size(390, 2600),
        booked: [
          {'slot': 1, 'machineOnTime': '06:00', 'machineOffTime': '08:00'},
          {'slot': 2, 'machineOnTime': '08:00', 'machineOffTime': '10:00'},
          {'slot': 3, 'machineOnTime': '10:00', 'machineOffTime': '12:00'},
        ],
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Asha already has 3 entries on'), findsOneWidget);
    });

    editorTest('Process Master\'s locked shift fills and locks the box, and says why', (tester) async {
      await open(
        tester,
        workerId: 'w1',
        size: const Size(390, 2600),
        processes: [
          {...lockedProcess, 'plannedShiftLocked': true, 'plannedShiftHours': 8.5},
        ],
      );
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '8.5');
      expect(find.textContaining('Fixed at 8:30 hr — locked in Process Master'), findsOneWidget);
      expect(tester.widget<EntryTextField>(find.byKey(const ValueKey('entry0/plannedOperatorShiftHours'))).enabled, isFalse);
    });

    editorTest('a worker already in another block of the date cannot be picked again', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
      await tester.tap(find.byKey(const ValueKey('entry-add')));
      await tester.pumpAndSettle();
      // The new block opened its worker picker by itself.
      expect(find.text('Asha — already added'), findsOneWidget);
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
      'itemName': 'Seal',
      'vendor': 'v1',
      'vendorName': 'Acme Rubber',
      'totalCycleSec': 45,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 600,
      'okQty': 590,
      'rejectedQty': 10,
      'rejectBreakdown': {'Tool Mark': 6, 'Other': 4},
      'rejectReason': 'Tool Mark',
      'rejectOtherRemark': 'flash',
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'remarks': 'ok',
    };

    editorTest('the worker is locked, the saved figures and split are loaded, Update keeps the slot and _id', (tester) async {
      final h = await open(tester, row: row, size: const Size(390, 2600));
      expect(find.text('Update RUBBER Entry'), findsOneWidget);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      final v = form(tester).entries.single;
      expect(v['machine'], 'w2');
      expect(v['actualQty'], '600');
      expect(v['okQty'], '590');
      expect(v['rejectBreakdown'], {'Tool Mark': '6', 'Other': '4'});
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
      expect(b['rejectBreakdown'], {'Tool Mark': 6, 'Other': 4});
      expect(b['rejectOtherRemark'], 'flash');
      expect(b['plannedOperatorShiftHours'], 8.5);
      expect(b['remarks'], 'ok');
      expect(h.popped, [true]);
    });

    editorTest('an entry saved before Actual existed reads as OK + Rejected', (tester) async {
      await open(tester, row: {...row, 'actualQty': null, 'rejectBreakdown': null, 'rejectReason': 'Tool Mark'}, size: const Size(390, 2600));
      final v = form(tester).entries.single;
      expect(v['actualQty'], '600');
      expect(v['rejectBreakdown'], {'Tool Mark': '10'});
    });

    editorTest('a worker no longer offered keeps the saved name', (tester) async {
      await open(tester, row: {...row, 'worker': 'gone', 'machine': 'gone', 'operator': 'Old Hand'}, size: const Size(390, 2600));
      expect(find.text('Old Hand'), findsWidgets);
    });
  });

  group('phone and tablet', () {
    for (final (name, size, scale, dark) in const [
      ('a small phone with large text', Size(360, 640), 1.6, false),
      ('a phone in dark mode', Size(390, 844), 1.0, true),
      ('a tablet in landscape', Size(1194, 834), 1.0, false),
      ('a tablet in portrait with large text', Size(834, 1194), 1.3, true),
    ]) {
      editorTest('$name: the open form lays out without overflow', (tester) async {
        await open(tester, workerId: 'w1', size: size, textScale: scale, dark: dark);
        await fillValid(tester);
        form(tester).onChange(0, 'otherMin', '5');
        form(tester).onRejectChange(0, 'Other', '1');
        await tester.pumpAndSettle();
        expect(find.text('Production Master'), findsOneWidget);
        expect(tester.takeException(), isNull);
        // Scroll the whole form through: every card builds.
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -4000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
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
      api.on('GET', '${Endpoints.v1}/rubber-sheet/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', '${Endpoints.v1}/rubber-sheet/filter-options', (_) => {
            'isOk': true,
            'data': {'machine': ['w1', 'old'], 'operator': <String>[], 'item': ['Seal']},
            'machineNames': {'old': 'Old Hand'},
          });
      api.on('GET', '${Endpoints.v1}/rubber-sheet', (_) => {
            'isOk': true,
            'data': [
              {
                '_id': 'e1', 'date': '2026-09-20T00:00:00.000Z', 'worker': 'old', 'machine': 'old', 'slot': 1,
                'itemName': 'Seal', 'vendorName': 'Acme Rubber', 'machineOnTime': '08:00', 'machineOffTime': '09:00',
                'totalCycleSec': 45, 'actualQty': 40, 'okQty': 38, 'rejectedQty': 2, 'plannedOperatorShiftHours': 1,
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
      expect(c.days.single.machines.single.machineName, 'Old Hand');
      // Search looks in item, worker and vendor.
      c.setSearch('acme');
      expect(c.days, hasLength(1));
      c.setSearch('zzz');
      expect(c.days, isEmpty);
      c.setSearch('');

      await c.applyQuery(c.range, c.filters.withDim('machine', ['w1', 'w2']));
      final lists = api.called('GET', '${Endpoints.v1}/rubber-sheet').toList();
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
      'itemName': 'Seal',
      'vendorName': 'Acme',
      'totalCycleSec': 45,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 600,
      'okQty': 590,
      'rejectBreakdown': {'Tool Mark': 6, 'Other': 4},
      'rejectOtherRemark': 'flash',
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'setupMin': 15,
      'otherMin': 10,
      'otherMinRemark': 'power cut',
      'remarks': 'two re-done',
      'workingMode': 'Working',
      'review': {'status': 'pending'},
    };

    test('the folded table: the totals only, each opening its breakdown', () {
      final cols = spec.columns(const <String>{});
      expect([for (final c in cols.left) c.label], ['Date', 'Worker Name']);
      expect([for (final c in cols.middle) c.label], [
        'Part Name',
        'Vendor Name',
        'Working Status',
        'Total Cycle Time (Sec)',
        'Working Start Time',
        'Working End Time',
        'Worker Shift Time (hr:min)',
        'IDEAL Quantity',
        'IDEAL Quantity/Hour',
        'Actual Quantity',
        'ACTUAL OK Quantity',
        'Rejected Quantity',
        '% OK Quantity',
        'Planned Operator Shift Time (hr:min)',
        'Total stoppage (min)',
        'Effective working Time (hr:min)',
        'Unreported Time (min)',
        'Availability (%)',
        'Performance (%)',
        'Quality (%)',
        'Productivity without considering Lunch, tea, etc. (%)',
        'Productivity Considering Lunch, tea, etc. (%)',
        'OEE Review',
        'REMARKS',
      ]);
    });

    test('cells and the "Other" remark eyes', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final open = spec.columns({'rejectedQty', 'downtime'});
      SheetCol col(String key) => [...open.left, ...open.middle].firstWhere((c) => c.key == key);
      String cell(String key) => col(key).text(CellData(row: row, calc: calc, day: day, machineName: 'Asha'));
      expect(cell('machine'), 'Asha');
      expect(cell('rejectedQty'), '10');
      expect(cell('Tool Mark'), '6');
      expect(cell('Dimension Out'), '—');
      expect(cell('totalStoppage'), '55');
      expect(cell('setupMin'), '15');
      expect(cell('noPowerMin'), '0');
      expect(cell('review'), 'Pending review');
      expect(col('Other').remarkKind, 'reject');
      expect(col('otherMin').remarkKind, 'downtime');
      expect(col('remarks').remarkKind, 'general');
    });

    test('the detail groups every figure and the remarks', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final d = spec.detail(row, calc, day);
      expect(d.oee.map((o) => o.formulaKey), ['productivity', 'productivityLunch']);
      expect(d.groups.map((g) => g.title), ['Production', 'Time', 'Stoppage', 'OEE', 'Entry']);
      // Every formula a detail row points at exists.
      for (final g in d.groups) {
        for (final r in g.rows) {
          if (r is DetailMetric && r.formulaKey != null) expect(spec.formulas.containsKey(r.formulaKey), isTrue, reason: r.label);
        }
      }
      final figures = spec.figures(row, calc);
      expect(figures.ok, 590);
      expect(figures.actual, 600);
      expect(spec.remarkParts(row).map((p) => p['key']), ['reject', 'downtime', 'general']);
    });
  });
}
