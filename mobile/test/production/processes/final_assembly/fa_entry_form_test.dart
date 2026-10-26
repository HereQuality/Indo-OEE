import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_fields.dart' show EntryPickerBox;
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/final_assembly/final_assembly_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = finalAssemblySpec;
const rowPath = '/api/v1/final-assembly-sheet/row';
const occupiedPath = '/api/v1/final-assembly-sheet/occupied';

final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'Alkesh', 'processes': ['p1']},
  {'_id': 'w2', 'name': 'Amit', 'processes': [{'_id': 'p1'}]},
  {'_id': 'w3', 'name': 'Other process', 'processes': ['p2']},
  {'_id': 'w4', 'name': 'Gone', 'isActive': false, 'processes': ['p1']},
];
final p1 = <String, dynamic>{'_id': 'p1', 'processName': 'FINAL ASSEMBLY', 'dataEntryMenu': '/hqepl/production/final-assembly-data-entry'};
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: p1);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Connector', 'totalCycleSec': 30},
  {'_id': 'i2', 'itemName': 'PACKING', 'totalCycleSec': null},
];
final vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme', 'isActive': true, 'processes': ['p1']},
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
  const _Launcher({required this.popped, this.row, this.workerId, this.processes = const [], this.withVendors = false});
  final List<bool?> popped;
  final Map<String, dynamic>? row;
  final String? workerId;
  final List<Map<String, dynamic>> processes;
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
                    processes: processes,
                    extra: {'vendors': withVendors ? vendors : <Map<String, dynamic>>[]},
                    lockedProcess: p1,
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
      child: _Launcher(popped: popped, row: row, workerId: workerId, processes: processes, withVendors: withVendors),
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
Finder box(String key) => find.descendant(of: find.byKey(ValueKey('entry0/$key')), matching: find.byType(EditableText));
Finder label(String text) => find.textContaining(text, findRichText: true);
String calc(WidgetTester t, String key) =>
    t.widget<Text>(find.descendant(of: find.byKey(ValueKey('entry0/calc/$key')), matching: find.byType(Text)).first).data ?? '';

/// The paper row 11:00–14:00 at 30 s, 200 assembled, 2 wrong.
Future<void> fillValid(WidgetTester t, {int index = 0, String worker = 'w1'}) async {
  final f = form(t);
  f.onChange(index, 'machine', worker);
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '11:00');
  f.onChange(index, 'machineOffTime', '14:00');
  f.onChange(index, 'actualQty', '200');
  f.onRejectChange(index, 'Wrong Assembly', '2');
  f.onChange(index, 'plannedOperatorShiftHours', '3');
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

String today(WidgetTester t) {
  final p = (form(t).entries[0]['date'] as String).split('-');
  return '${p[2]}/${p[1]}/${p[0]}';
}

void main() {
  group('identity', () {
    test('the page, endpoints, keys and rules', () {
      expect(ProcessRegistry.byKey('final-assembly'), same(spec));
      expect(ProcessRegistry.all.last, same(spec));
      expect(ProcessRegistry.byPath('/production/final-assembly-data-entry'), same(spec));
      expect(spec.pageTitle, 'FINAL ASSEMBLY Data Entry');
      expect(spec.api.list, '${Endpoints.v1}/final-assembly-sheet');
      expect(spec.api.row, rowPath);
      expect(spec.api.machineParam, 'worker');
      expect(spec.draftKey, 'finalAssemblyEntryDraft');
      expect(spec.checksTimeOverlap, isFalse);
      expect(spec.maxEntriesPerDay, 12);
      expect(spec.uniqueMachinePerDate, isFalse);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/final-assembly-data-entry'}), isTrue);
      expect(spec.ownsProcess({'dataEntryMenu': '/hqepl/production/mfa-data-entry'}), isFalse);
      expect([for (final w in workers) w['_id']], ['w1', 'w2']);
    });
  });

  group('add', () {
    editorTest('a chosen worker opens the sheet: every card and label of the web form', (tester) async {
      await open(tester, workerId: 'w1', withVendors: true);
      expect(find.text('Add FINAL ASSEMBLY Entry'), findsOneWidget);
      for (final t in [
        'Date, Worker Name, Working Status',
        'Item Name, Standard Time per Piece',
        'Start – End Time, Assembly Working Hours',
        'Total QTY, Types of Defects',
        'Other Activity Carried out',
        'Planned Operator Shift, Lunch / Tea',
        'Idle — Other (min)',
        'Remarks',
        'Worker Name',
        'Vendor Name',
        'Standard Time per Piece (Sec)',
        'Assembly Start Time',
        'Assembly End Time',
        'Assembly Working Hours',
        'Total QTY',
        'Ideal Quantity',
        'Ideal Quantity/Hour',
        'Effective Assembly Time (hr)',
        'Wrong Assembly (Qty)',
        'Broken Screw (Qty)',
        'Wrong Clamping (Qty)',
        'Other (Qty)',
        'Total Defects',
        'OK QTY',
        'Time consume in Other Activity (min)',
        'Planned Operator Shift (hours)',
        'Lunch / Tea / Washroom etc (Min)',
        'Idle + Other Activity Allowed (min)',
        'Other (Min)',
        'Total Idle (Min)',
      ]) {
        expect(label(t), findsWidgets, reason: t);
      }
      expect(find.text('Add another entry'), findsOneWidget);
      expect(find.textContaining('MC No.'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    editorTest('Save on an unfinished entry flags the web messages', (tester) async {
      final h = await open(tester, workerId: 'w1');
      await tapSave(tester);
      await tester.pump();
      expect(h.puts, isEmpty);
      for (final message in [
        'Item Name is required',
        'Assembly Start Time is required',
        'Assembly End Time is required',
        'Total QTY is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(message), findsOneWidget, reason: message);
      }
      // Standard Time per Piece is optional.
      expect(find.textContaining('Standard Time per Piece is required'), findsNothing);
    });

    editorTest('saves one entry: the exact PUT body (worker, process, defects by reason)', (tester) async {
      final h = await open(tester, workerId: 'w1');
      await fillValid(tester);
      expect(calc(tester, 'totalDefect'), '2');
      expect(calc(tester, 'okQty'), '198');
      expect(calc(tester, 'idealQty'), '360');
      expect(calc(tester, 'idealQtyPerHour'), '120');
      expect(calc(tester, 'effectiveHours'), '1.67 hr');
      expect(calc(tester, 'shiftHours'), '3 hr (3:00)');
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b.keys.toSet(), {
        'date', 'worker', 'process', 'vendor', 'machineStatus', 'workingMode', 'slot', 'item',
        'workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark', 'rejectOtherRemark',
        'machineOnTime', 'machineOffTime', 'totalCycleSec', 'actualQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin',
        'rejectBreakdown', 'rejectReason',
      });
      expect(b['worker'], 'w1');
      expect(b['process'], 'p1');
      expect(b['slot'], 'auto');
      expect(b['totalCycleSec'], 30);
      expect(b['actualQty'], 200);
      expect(b['rejectBreakdown'], {'Wrong Assembly': 2});
      expect(b['rejectReason'], 'Wrong Assembly');
      expect(b['plannedOperatorShiftHours'], 3);
      expect(b.containsKey('okQty'), isFalse);
      expect(h.api.called('GET', occupiedPath).first.query['worker'], 'w1');
      expect(find.text('Entry added successfully!'), findsOneWidget);
    });

    editorTest('Standard Time is optional (PACKING): no Ideal, Effective 0, and it saves', (tester) async {
      final h = await open(tester, workerId: 'w1');
      final f = form(tester);
      f.onItemSelect(0, 'i2');
      f.onChange(0, 'machineOnTime', '08:00');
      f.onChange(0, 'machineOffTime', '18:00');
      f.onChange(0, 'actualQty', '170');
      f.onChange(0, 'plannedOperatorShiftHours', '10');
      await tester.pump();
      expect(form(tester).entries[0]['totalCycleSec'], '');
      expect(find.text('Blank (e.g. PACKING): no Ideal, Effective 0'), findsOneWidget);
      expect(calc(tester, 'idealQty'), '—', reason: 'an empty grey box reads as a dash');
      expect(calc(tester, 'effectiveHours'), '0 hr');
      expect(bar(tester).canSave, isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['totalCycleSec'], '');
    });

    editorTest('Total QTY above Ideal is allowed: flagged for OEE Review, not blocked', (tester) async {
      final h = await open(tester, workerId: 'w1');
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '500');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], '500');
      expect(find.byKey(const ValueKey('entry0/oeeCheck')), findsOneWidget);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.body(0)['actualQty'], 500);
    });

    editorTest('the defects can\'t add up to more than Total QTY; "Other" asks for its remark', (tester) async {
      await open(tester, workerId: 'w1');
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      form(tester).onChange(0, 'actualQty', '10');
      await tester.pump();
      await tester.enterText(box('reject/Wrong Assembly'), '6');
      await tester.pump();
      await tester.enterText(box('reject/Other'), '5');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect((form(tester).entries[0]['rejectBreakdown'] as Map)['Other'], isNot('5'));
      expect(toasts, contains("Types of Defects can't add up to more than Total QTY (10)."));
      form(tester).onRejectChange(0, 'Other', '2');
      await tester.pump();
      expect(label('Remark for “Other” defects'), findsOneWidget);
      await tapSave(tester);
      await tester.pump();
      expect(find.text('Remark is required when "Other" defects are entered'), findsOneWidget);
    });

    editorTest('one worker, two jobs at once: both save (no overlap rule)', (tester) async {
      final h = await open(tester, workerId: 'w1', occupied: [
        {'slot': 1, 'machineOnTime': '11:00', 'machineOffTime': '14:00'},
      ]);
      await fillValid(tester);
      await tester.ensureVisible(find.byKey(const ValueKey('entry-add')));
      await tester.tap(find.byKey(const ValueKey('entry-add')));
      await tester.pumpAndSettle();
      expect(find.textContaining('already added'), findsNothing);
      await tester.tap(find.text('Alkesh').last);
      await tester.pumpAndSettle();
      await fillValid(tester, index: 1);
      expect(label('Already entered for this worker on this date: 11:00 – 14:00'), findsWidgets);
      expect(find.textContaining('overlaps'), findsNothing);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, hasLength(2));
    });

    editorTest('a worker whose date already has 12 entries is told at once', (tester) async {
      final h = await open(tester, workerId: 'w1', occupied: [
        for (var s = 1; s <= 12; s++) {'slot': s, 'machineOnTime': '08:00', 'machineOffTime': '18:00'},
      ]);
      expect(find.text('Alkesh already has 12 entries on ${today(tester)} — edit one of them instead'), findsOneWidget);
      await fillValid(tester);
      expect(bar(tester).canSave, isFalse);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(h.puts, isEmpty);
    });

    editorTest('Idle + Other Activity stay within the Working Hours, with the web popup', (tester) async {
      await open(tester, workerId: 'w1');
      final f = form(tester);
      f.onChange(0, 'machineOnTime', '09:00');
      f.onChange(0, 'machineOffTime', '10:00');
      f.onChange(0, 'otherActivityMin', '50');
      await tester.pump();
      await tester.enterText(box('lunchMin'), '30');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 10));
      expect(form(tester).entries[0]['lunchMin'], isNot('30'));
      expect(find.text("Stoppage happens within the Assembly Working Hours, so all of it together can't be more than 60 min."), findsOneWidget);
      expect(find.text('Check the stoppage minutes, or the Start / End Time.'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
    });

    editorTest('Non Working: no "Machine Breakdown"; only the status goes out', (tester) async {
      final h = await open(tester, workerId: 'w1');
      final f = form(tester);
      f.onRejectChange(0, 'Other', '2');
      f.onChange(0, 'workingMode', 'Non Working');
      await tester.pump();
      expect(find.byKey(const ValueKey('entry0/machineStatus/Machine Breakdown')), findsNothing);
      expect(find.byKey(const ValueKey('entry0/machineStatus/No Manpower')), findsOneWidget);
      expect(find.text('Total QTY, Types of Defects'), findsNothing);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect(b['workingMode'], 'Non Working');
      expect(b['rejectBreakdown'], <String, dynamic>{});
      expect(b['rejectReason'], '');
      expect(b['item'], isNull);
    });

    editorTest('Planned Operator Shift locked in Process Master: read-only and says why', (tester) async {
      await open(tester, workerId: 'w1', processes: [
        {...p1, 'plannedShiftLocked': true, 'plannedShiftHours': 12},
      ]);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      expect(find.text('Fixed at 12:00 hr — locked in Process Master'), findsOneWidget);
      expect(tester.widget<EditableText>(box('plannedOperatorShiftHours')).readOnly, isTrue);
    });
  });

  group('edit', () {
    editorTest('the worker is locked, the defects load, Update keeps slot and _id', (tester) async {
      final h = await open(tester, row: {
        '_id': 'e1',
        'date': '2024-05-11',
        'worker': 'w2',
        'machine': 'w2',
        'operator': 'Amit',
        'slot': 7,
        'item': 'i1',
        'itemName': 'Connector',
        'totalCycleSec': 30,
        'machineOnTime': '11:00',
        'machineOffTime': '14:00',
        'actualQty': 200,
        'okQty': 195,
        'rejectedQty': 5,
        'rejectBreakdown': {'Broken Screw': 5},
        'plannedOperatorShiftHours': 3,
        'lunchMin': 30,
      });
      expect(find.text('Update FINAL ASSEMBLY Entry'), findsOneWidget);
      expect(tester.widget<EntryPickerBox>(find.byKey(const ValueKey('entry0/machine'))).enabled, isFalse);
      expect(form(tester).entries.single['rejectBreakdown'], {'Broken Screw': '5'});
      expect(calc(tester, 'okQty'), '195');
      await tapSave(tester);
      await tester.pumpAndSettle();
      final b = h.body(0);
      expect([b['_id'], b['slot'], b['worker']], ['e1', 7, 'w2']);
      expect(b['rejectBreakdown'], {'Broken Screw': 5});
    });
  });

  testWidgets('the saved entry\'s detail lists its defects and Productivity', (tester) async {
    final row = <String, dynamic>{
      '_id': 'e1',
      'date': '2024-05-11',
      'machine': 'w1',
      'operator': 'Alkesh',
      'itemName': 'Connector',
      'totalCycleSec': 30,
      'machineOnTime': '09:30',
      'machineOffTime': '10:30',
      'actualQty': 185,
      'rejectBreakdown': {'Wrong Clamping': 1},
      'plannedOperatorShiftHours': 1,
    };
    final c = spec.rowCalc(row);
    final day = spec.dayCalc([row]).single;
    expect(day['productivity'], closeTo(185 * 30 / 3600, 1e-9));
    await pumpScreen(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          child: EntryDetail(
            spec: spec,
            row: row,
            calc: c,
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
    for (final t in ['Wrong Clamping', 'Effective Assembly Time (hr)', 'Unreported (min)', 'Ideal Quantity', '154.17%']) {
      expect(label(t), findsWidgets, reason: t);
    }
    expect(tester.takeException(), isNull);
  });

  group('responsive', () {
    for (final (name, size, scale, dark) in [
      ('small phone, large text', const Size(360, 3600), 1.6, false),
      ('tablet, dark', const Size(1024, 2400), 1.0, true),
    ]) {
      editorTest('the open form lays out without overflow: $name', (tester) async {
        await open(tester, workerId: 'w1', size: size, textScale: scale, dark: dark, withVendors: true);
        await fillValid(tester);
        form(tester).onChange(0, 'otherMin', '5');
        form(tester).onRejectChange(0, 'Other', '1');
        await tester.pump();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
