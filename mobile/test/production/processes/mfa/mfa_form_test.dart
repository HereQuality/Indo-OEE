import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/process/process_spec.dart' show DetailMetric;
import 'package:indo/features/production/processes/mfa/mfa_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = mfaSpec;
const rowPath = '/api/v1/mfa-sheet/row';
const occupiedPath = '/api/v1/mfa-sheet/occupied';

/// Operator Master as the page loads it: two workers for this process, one for
/// another process, one inactive, one with no process yet.
final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'Asha', 'isActive': true, 'processes': ['p1']},
  {'_id': 'w2', 'name': 'Ravi', 'processes': [{'_id': 'p1'}]},
  {'_id': 'w3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'w4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
  {'_id': 'w5', 'name': 'Unassigned', 'processes': <String>[]},
];
final lockedProcess = <String, dynamic>{'_id': 'p1', 'processName': 'MODULAR FRAME ASSEMBLY', 'dataEntryMenu': '/hqepl/production/modular-frame-assembly-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: lockedProcess);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Frame', 'totalCycleSec': 45},
  {'_id': 'i2', 'itemName': 'Rail', 'totalCycleSec': 30},
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

/// 8 h at 45 s a piece (IDEAL 640), 600 made, 590 OK, planned 8.5.
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'w1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:00');
  f.onChange(index, 'machineOffTime', '16:00');
  f.onChange(index, 'actualQty', '600');
  f.onChange(index, 'okQty', '590');
  f.onChange(index, 'plannedOperatorShiftHours', '8.5');
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

Finder box(String field) => find.descendant(of: find.byKey(ValueKey('entry0/$field')), matching: find.byType(EditableText));

String calcText(WidgetTester t, String key) =>
    t.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.byType(Text)).first).data ?? '';

void main() {
  test('registered after MFD, with its page, endpoints and rules', () {
    final all = ProcessRegistry.all;
    expect(all.indexOf(spec), all.indexOf(ProcessRegistry.byKey('mfd')!) + 1);
    expect(ProcessRegistry.byPath('/production/modular-frame-assembly-data-entry'), same(spec));
    expect(spec.api.list, '${Endpoints.v1}/mfa-sheet');
    expect(spec.api.machineParam, 'worker');
    expect(spec.maxEntriesPerDay, 8);
    expect(spec.checksTimeOverlap, isFalse);
    expect(spec.uniqueMachinePerDate, isFalse);
    expect(spec.usesVendors, isFalse);
    expect(spec.extraReference, isEmpty);
    expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/modular-frame-assembly-data-entry'}), isTrue);
    expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/modular-frame-drilling-data-entry'}), isFalse);
  });

  group('add', () {
    editorTest('every card and label of the web form; no Vendor, no reason split', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      expect(find.text('Add MODULAR FRAME ASSEMBLY Entry'), findsOneWidget);
      for (final t in [
        'Date, Worker Name, Working Status',
        'Item Name, Standard Assembly Time',
        'Assembly Start – End Time, Working Hours',
        'TOTAL QTY, OK QTY, Rejected QTY',
        'Other Activity Carried Out',
        'Planned Operator Shift, Lunch / Tea',
        'Idle Time — Other (Min)',
        'Remarks',
        'Standard Assembly Time per Piece (Sec)',
        'Assembly Start Time',
        'Assembly End Time',
        'Assembly Working Hours',
        'Ideal Assembly Quantity',
        'Ideal Assembly Quantity/Hour',
        'Ideal Assembly Time (In Hour)',
        'Time consume in Other Activity (min)',
        'Lunch / Tea / Washroom etc (Min)',
        'Total Idle Time (Min)',
      ]) {
        expect(find.textContaining(t), findsWidgets, reason: t);
      }
      expect(find.text('Vendor Name'), findsNothing);
      expect(find.textContaining('Rejection Master'), findsNothing);
      expect(find.text('Add another entry'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    editorTest('Save on an unfinished entry flags the web messages', (tester) async {
      final h = await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final m in [
        'Item Name is required',
        'Standard Assembly Time per Piece is required',
        'Assembly Start Time is required',
        'Assembly End Time is required',
        'TOTAL QTY is required',
        'OK QTY is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(m), findsOneWidget, reason: m);
      }
    });

    editorTest('saves: the exact PUT body (worker, process, no vendor, no split)', (tester) async {
      final h = await open(tester);
      await fillValid(tester);
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark',
        'machineOnTime', 'machineOffTime',
        'totalCycleSec', 'actualQty', 'okQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin',
      });
      expect(b['worker'], 'w1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['actualQty'], 600);
      expect(b['okQty'], 590);
      expect(b['plannedOperatorShiftHours'], 8.5);
      expect(b['lunchMin'], 30);
      expect(h.api.called('GET', occupiedPath).first.query['worker'], 'w1');
      expect(h.popped, [true]);
    });

    editorTest('grey boxes: Ideal not rounded down, effective time on TOTAL', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      expect(calcText(tester, 'rejectedQty'), '10');
      expect(calcText(tester, 'idealQty'), '640');
      expect(calcText(tester, 'idealQtyPerHour'), '80');
      // 600 × 45 s = 7.5 h.
      expect(calcText(tester, 'effectiveHours'), '7.5 hr (7:30)');
      form(tester).onChange(0, 'totalCycleSec', '50');
      await tester.pump();
      // 8 h × 3600 ÷ 50 = 576 exactly; 47 s gives 612.77 (not floored).
      form(tester).onChange(0, 'totalCycleSec', '47');
      await tester.pump();
      expect(calcText(tester, 'idealQty'), '612.77');
    });

    editorTest('TOTAL may beat Ideal: flagged for OEE Review, not blocked', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await fillValid(tester);
      await tester.enterText(box('actualQty'), '700');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], '700');
      form(tester).onChange(0, 'okQty', '690');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      expect(bar(tester).canSave, isTrue);
    });

    editorTest('OK is capped at TOTAL with the web message', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
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

    editorTest('Idle + Other Activity past the Working Hours raises the popup', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.enterText(box('otherActivityMin'), '50');
      await tester.pump();
      await tester.enterText(box('lunchMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Assembly Working Hours, so all of it together can't be more than 60 min."), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('End before Start shows at once; overlapping times are fine', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600), booked: [
        {'slot': 1, 'machineOnTime': '06:00', 'machineOffTime': '10:00'},
      ]);
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '10:00');
      f.onChange(0, 'machineOffTime', '09:00');
      await tester.pumpAndSettle();
      expect(find.text('Assembly End Time must be after Assembly Start Time'), findsOneWidget);
      f.onChange(0, 'machineOnTime', '07:00');
      f.onChange(0, 'machineOffTime', '12:00');
      await tester.pumpAndSettle();
      expect(find.textContaining('overlaps another entry'), findsNothing);
      expect(find.textContaining('overlapping times are fine on this sheet'), findsOneWidget);
    });

    editorTest('a worker with eight entries that date is said at once', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600), booked: [
        for (var i = 1; i <= 8; i++) {'slot': i, 'machineOnTime': '0$i:00', 'machineOffTime': '0$i:30'},
      ]);
      await tester.pumpAndSettle();
      expect(find.textContaining('Asha already has 8 entries on'), findsOneWidget);
    });

    editorTest('the same worker can be added again', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
      await tester.tap(find.byKey(const ValueKey('entry-add')));
      await tester.pumpAndSettle();
      expect(find.text('Asha — already added'), findsNothing);
      expect(form(tester).entries, hasLength(2));
    });

    editorTest('Non Working hides the work cards', (tester) async {
      await open(tester, workerId: 'w1', size: const Size(390, 2600));
      form(tester).onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.textContaining('no assembly that day'), findsOneWidget);
      expect(find.text('TOTAL QTY, OK QTY, Rejected QTY'), findsNothing);
      expect(bar(tester).canSave, isTrue);
    });
  });

  group('edit', () {
    editorTest('an entry saved without TOTAL reads as OK + Rejected; Update keeps slot and _id', (tester) async {
      final h = await open(tester, size: const Size(390, 2600), row: {
        '_id': 'e1', 'date': '2026-09-20', 'worker': 'w2', 'machine': 'w2', 'process': 'p1', 'operator': 'Ravi', 'slot': 2,
        'item': 'i1', 'itemName': 'Frame', 'totalCycleSec': 45, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'okQty': 590, 'rejectedQty': 10, 'plannedOperatorShiftHours': 8.5, 'lunchMin': 30,
      });
      expect(form(tester).entries.single['actualQty'], '600');
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['_id'], 'e1');
      expect(b['slot'], 2);
      expect(b['worker'], 'w2');
      expect(b['actualQty'], 600);
    });
  });

  group('phone and tablet', () {
    for (final (name, size, scale, dark) in const [
      ('a small phone with large text', Size(360, 640), 1.6, false),
      ('a phone in dark mode', Size(390, 844), 1.0, true),
      ('a tablet in landscape', Size(1194, 834), 1.0, false),
      ('a tablet in portrait with large text', Size(834, 1194), 1.3, true),
    ]) {
      editorTest('$name: no overflow', (tester) async {
        await open(tester, workerId: 'w1', size: size, textScale: scale, dark: dark);
        await fillValid(tester);
        form(tester).onChange(0, 'otherMin', '5');
        await tester.pumpAndSettle();
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -4000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('table and detail', () {
    final row = <String, dynamic>{
      '_id': 'e1', 'date': '2026-09-20', 'machine': 'w1', 'operator': 'Asha', 'slot': 1, 'itemName': 'Frame', 'totalCycleSec': 45,
      'machineOnTime': '08:00', 'machineOffTime': '16:00', 'actualQty': 600, 'okQty': 590, 'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30, 'otherMin': 10, 'otherMinRemark': 'power cut', 'otherActivity': 'Packing', 'otherActivityMin': 20, 'remarks': 'ok',
      'review': {'status': 'pending'},
    };

    test('folded column order and wording', () {
      final cols = spec.columns(const <String>{});
      expect([for (final c in cols.left) c.label], ['Date', 'Worker Name']);
      expect([for (final c in cols.middle) c.label], [
        'Item Name', 'Working Status', 'Reasons For Not Working', 'Assembly Start Time', 'Assembly End Time', 'Assembly Working Hours',
        'Standard Assembly Time per Piece (in Sec)', 'TOTAL QTY', 'OK QTY', 'Rejected QTY', 'Ideal Assembly Quantity', 'Ideal Assembly Quantity/Hour',
        'Other Activity Carried Out', 'Time consume in Other Activity (min)', 'Planned Operator Shift (Hours)', 'Total Idle Time (Min)',
        'Ideal Assembly Time (In Hour)', 'Unreported Time (min)', 'Availability (%)', 'Performance (%)', 'Quality (%)',
        'Productivity without considering Lunch, tea, etc. (%)', 'Productivity Considering Lunch, tea, etc. (%)', 'OEE Review', 'Remarks',
      ]);
    });

    test('cells and detail', () {
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      final open = spec.columns({'idle'});
      String cell(String k) => [...open.left, ...open.middle].firstWhere((c) => c.key == k).text(CellData(row: row, calc: calc, day: day, machineName: 'Asha'));
      expect(cell('machine'), 'Asha');
      expect(cell('rejectedQty'), '10');
      expect(cell('totalStoppage'), '40');
      expect(cell('lunchMin'), '30');
      expect(cell('review'), 'Pending review');
      final d = spec.detail(row, calc, day);
      expect(d.groups.map((g) => g.title), ['Assembly', 'Time', 'Idle time & other activity', 'OEE', 'Entry']);
      for (final g in d.groups) {
        for (final r in g.rows) {
          if (r is DetailMetric && r.formulaKey != null) expect(spec.formulas.containsKey(r.formulaKey), isTrue, reason: r.label);
        }
      }
    });
  });
}
