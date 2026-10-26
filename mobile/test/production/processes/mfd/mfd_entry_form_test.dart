// The MODULAR FRAME DRILLING Add / Edit form against the web's (MfdEntryForm.jsx
// in ModularFrameDrillingDataEntry.jsx): the same lines in the same order with
// the same boxes, labels and required stars; the Part's grey figures; the IDEAL
// Quantity (Lunch out) and its popup; several overlapping entries on one
// machine; Setting Time; Planned Operator Shift from Process Master; the
// Working Status; what Save sends — and the list's order, table and detail.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_layout.dart' show EntryLineCard;
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/mfd/mfd_spec.dart';
import 'package:indo/features/production/sheet/sheet_model.dart' show SheetFilters, buildSheetDays;
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';
import '../../sheet_list_test.dart' as list;
import '../../web_parity/form_lines_support.dart';

const spec = mfdSpec;
const rowPath = '/api/v1/mfd-sheet/row';
const occupiedPath = '/api/v1/mfd-sheet/occupied';

// m1: process p1 (Planned Operator Shift locked at 12 h, no vendors)
// m2: process p3 (Planned typed by hand; vendor v1 active, v2 inactive)
// m3: no process
final _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': '4/A', 'process': 'p1'},
  {'_id': 'm2', 'machineName': '4/E', 'process': 'p3'},
  {'_id': 'm3', 'machineName': '4/B'},
];
final _processes = <Map<String, dynamic>>[
  {'_id': 'p1', 'plannedShiftLocked': true, 'plannedShiftHours': 12},
  {'_id': 'p3', 'plannedShiftLocked': false},
];
final _vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Tools', 'isActive': true, 'processes': ['p3']},
  {'_id': 'v2', 'name': 'Retired Vendor', 'isActive': false, 'processes': ['p3']},
];
final _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': '24 PIN FRAME BIG', 'drawingNo': 'IE0726', 'mfdOperation': 'DRILLING', 'noOfHoles': 2, 'strokeRequired': 2, 'totalCycleSec': 50},
];
final _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'VISHAL'},
  {'_id': 'o2', 'name': 'MEENA'},
];

/// The lines of the web's Add Entry modal, in the order it draws them, each with
/// its boxes (a trailing " *" is the red required star) — a machine in no process,
/// so no Vendor Name and the shift typed by hand.
const webLines = <FormLineLabels>[
  ('Date, MC NO., Operator, Working Status', ['Date *', 'MC NO. *', 'Operator *', 'Working Status']),
  (
    'Part Name, Drawing No., Process, Holes, Stroke, Total Cycle Time',
    ['Part Name *', 'Total Cycle Time (Sec) *', 'Drawing No.', 'Process', 'No. of Holes in One Piece', 'Stroke Required for One Piece'],
  ),
  ('Machine Time ON – OFF, Machine Shift Time', ['Machine Time ON *', 'Machine Time OFF *', 'Machine Shift Time (Hour)']),
  ('Setting Time ON – OFF', ['Setting Time ON', 'Setting Time OFF']),
  (
    'Production Master — Actual, ACTUAL OK, Rejected Quantity',
    [
      'Actual Quantity *', 'ACTUAL OK Quantity *', 'Rejected Quantity', '% OK Quantity', 'IDEAL Quantity', 'IDEAL Quantity/Hour',
      'Effective Machine Run Time (Hour)', 'Efficiency (%)',
    ],
  ),
  ('Planned Operator Shift, Lunch / Tea / Washroom', ['Planned Operator Shift (hours) *', 'Lunch / Tea / Washroom etc (min)', 'Downtime Allowed (min)']),
  (
    'Downtime (min)',
    [
      'Planned downtime (min)', 'Set-up Time (min)', 'No Manpower (min)', 'Material Shifting (min)', 'No Material (min)',
      'B.D. Mech. (min)', 'B.D. Ele. (min)', 'No Power (min)', 'Others (min)',
    ],
  ),
  ('REMARKS', ['REMARKS']),
];

class _Launcher extends StatelessWidget {
  const _Launcher({this.row, this.vendors = const []});
  final Map<String, dynamic>? row;
  final List<Map<String, dynamic>> vendors;

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.of(context).push<bool>(
              MaterialPageRoute<bool>(
                builder: (_) => EntryEditorScreen(
                  spec: spec,
                  row: row,
                  machines: _machines,
                  items: _items,
                  operators: _operators,
                  processes: _processes,
                  extra: {'vendors': vendors},
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

/// A saved entry: the paper's 4/B row — 08:15–18:55 at 50 s with 30 min Lunch
/// (IDEAL 732), ACTUAL OK 99, 115 min Material Shifting.
Map<String, dynamic> _saved({String machine = 'm3', Map<String, dynamic> extra = const {}}) => {
      '_id': 'r1',
      'date': '2024-05-10',
      'machine': machine,
      'slot': 1,
      'item': 'i1',
      'operator': 'VISHAL',
      'itemName': '24 PIN FRAME BIG',
      'drawingNo': 'IE0726',
      'operation': 'DRILLING',
      'noOfHoles': 2,
      'strokeRequired': 2,
      'totalCycleSec': 50,
      'machineOnTime': '08:15',
      'machineOffTime': '18:55',
      'actualQty': 99,
      'okQty': 99,
      'rejectedQty': 0,
      'plannedOperatorShiftHours': 10.666667,
      'lunchMin': 30,
      'materialShiftingMin': 115,
      ...extra,
    };

Future<FakeApi> openEditor(
  WidgetTester tester, {
  Map<String, dynamic>? row,
  List<Map<String, dynamic>>? vendors,
  Size size = const Size(390, 844),
  double textScale = 1,
  bool dark = false,
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(
    tester,
    ScaffoldMessenger(key: rootMessengerKey, child: _Launcher(row: row, vendors: vendors ?? _vendors)),
    size: size,
    textScale: textScale,
    dark: dark,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder k(String key) => find.byKey(ValueKey(key));
Finder box(String field) => find.descendant(of: k('entry0/$field'), matching: find.byType(TextField));
Finder calcText(String key, String text) => find.descendant(of: k('entry0/calc/$key'), matching: find.text(text));

/// The header of an optional line (tap it to open / fold the line).
Finder toggle(String title) => k('line-toggle/$title');

Future<void> pickMachine(WidgetTester t, String id) async {
  form(t).onChange(0, 'machine', id);
  await t.pumpAndSettle();
  if (k('entry0/expand').evaluate().isNotEmpty) {
    await t.tap(k('entry0/expand'));
    await t.pumpAndSettle();
  }
}

/// The paper's 4/B row typed in: 08:15–18:55 at 50 s, Actual 99, OK 99, Lunch 30.
Future<void> fillValid(WidgetTester t, {String machine = 'm3', String planned = '10.67', int index = 0}) async {
  if (index == 0) await pickMachine(t, machine);
  final f = form(t);
  f.onChange(index, 'operator', 'VISHAL');
  f.onItemSelect(index, 'i1');
  f.onChange(index, 'machineOnTime', '08:15');
  f.onChange(index, 'machineOffTime', '18:55');
  f.onChange(index, 'actualQty', '99');
  f.onChange(index, 'okQty', '99');
  if (machine != 'm1') f.onChange(index, 'plannedOperatorShiftHours', planned);
  f.onChange(index, 'lunchMin', '30');
  await t.pump();
}

Future<void> save(WidgetTester t) async {
  await t.tap(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton)));
  await t.pump();
}

void main() {
  setUp(() {
    EntryFormToast.reset();
    EntryNotices.reset();
  });

  test('registered right after BEFORE POWDER COATING, reachable by key and by its page', () {
    final keys = [for (final s in ProcessRegistry.all) s.key];
    expect(ProcessRegistry.byKey('mfd'), same(spec));
    expect(ProcessRegistry.byPath('/production/modular-frame-drilling-data-entry'), same(spec));
    expect(keys.indexOf('mfd'), greaterThan(keys.indexOf('bpc')));
    expect(spec.api.row, rowPath);
    expect(spec.draftKey, 'mfdEntryDraft');
    expect(spec.pageTitle, 'MODULAR FRAME DRILLING Data Entry');
    expect(spec.addTitle, 'Add MODULAR FRAME DRILLING Entry');
    expect(spec.editTitle, 'Update MODULAR FRAME DRILLING Entry');
    expect(spec.searchKeys, ['itemName', 'operator', 'drawingNo', 'operation']);
    // Several overlapping entries a machine a day (up to 8); an operator still can't be on two machines.
    expect(spec.uniqueMachinePerDate, isFalse);
    expect(spec.checksTimeOverlap, isFalse);
    expect(spec.checksOperatorClash, isTrue);
    expect(spec.maxEntriesPerDay, 8);
    expect(spec.entriesByMachineOn, isTrue);
    expect(spec.usesVendors, isTrue);
    expect(spec.usesPlannedShiftSetting, isTrue);
    expect(spec.showLimitPopups, isTrue);
    expect(spec.referenceLists['vendors'], Endpoints.vendors);
    expect(spec.machineBlockTitle('4/B', 0), 'MC 4/B');
    expect(spec.machineBlockTitle('', 2), 'Entry 3');
  });

  group('same lines and boxes as the web Add Entry modal', () {
    testWidgets('phone: the eight web lines, in the web order, each with the web boxes', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm3');
      expect(describeLines(openFormLines(tester)), describeLines(webLines));
      expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tablet: two columns, the left one then the right one is the web order', (tester) async {
      await openEditor(tester, size: const Size(1024, 1180));
      await pickMachine(tester, 'm3');
      expect(describeLines(openFormLines(tester)), describeLines(webLines));
      final date = tester.getTopLeft(find.text('Date, MC NO., Operator, Working Status'));
      final planned = tester.getTopLeft(find.text('Planned Operator Shift, Lunch / Tea / Washroom'));
      expect(planned.dx, greaterThan(date.dx + 200), reason: 'Planned sits in the right column');
      expect(tester.takeException(), isNull);
    });

    testWidgets('Vendor Name follows the Part\'s figures when the process has vendors', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm2');
      final line = openFormLines(tester).firstWhere((l) => l.$1 == 'Part Name, Drawing No., Process, Holes, Stroke, Total Cycle Time');
      expect(line.$2.last, 'Vendor Name');
    });

    testWidgets('"Add another entry", its note, and the same machine can be picked again', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      expect(find.text('Add another entry'), findsOneWidget);
      expect(find.text('The same machine can take several entries a day, even at overlapping times.'), findsOneWidget);
      await tester.ensureVisible(k('entry-add'));
      await tester.tap(k('entry-add'));
      await tester.pumpAndSettle();
      // The new block asks for its machine: the same one is offered (not "already added").
      expect(find.textContaining('already added'), findsNothing);
      await tester.tap(find.text('4/B').last);
      await tester.pumpAndSettle();
      expect(form(tester).entries[1]['machine'], 'm3', reason: 'not "already added" on this sheet');
      expect(find.text('Already added to this form for this date.'), findsNothing);
    });
  });

  group('the Part\'s figures and the grey boxes, worked out as the sheet does', () {
    testWidgets('picking the part fills Drawing No., Process, Holes, Stroke and Total Cycle Time', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      final v = form(tester).entries[0];
      expect([v['drawingNo'], v['operation'], v['noOfHoles'], v['strokeRequired'], v['totalCycleSec']], ['IE0726', 'DRILLING', '2', '2', '50']);
      expect(calcText('drawingNo', 'IE0726'), findsOneWidget);
      expect(calcText('operation', 'DRILLING'), findsOneWidget);
      expect(calcText('noOfHoles', '2'), findsOneWidget);
      expect(calcText('strokeRequired', '2'), findsOneWidget);
      expect(find.text('24 PIN FRAME BIG — 50 sec'), findsOneWidget);
      form(tester).onChange(0, 'totalCycleSec', '45');
      await tester.pumpAndSettle();
      expect(find.text("Part's usual: 50 sec"), findsOneWidget);
    });

    testWidgets('Machine Shift, IDEAL (Lunch out, 0 dp), IDEAL/Hour (1 dp), Effective on OK, Efficiency', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      // 08:15–18:55 = 640 min, less 30 min Lunch, at 50 s: 732.
      expect(calcText('shiftHours', '10.67 (10:40 hr)'), findsOneWidget);
      expect(calcText('idealQtyExact', '732'), findsOneWidget);
      expect(calcText('idealQtyPerHour', '68.6'), findsOneWidget);
      expect(calcText('effectiveHours', '1.38 (1:23 hr)'), findsOneWidget, reason: '99 × 50 ÷ 3600');
      expect(calcText('efficiency', '12.89%'), findsOneWidget);
      expect(calcText('rejectedQty', '0'), findsOneWidget);
      expect(calcText('pctOk', '100.00%'), findsOneWidget);
      expect(calcText('stoppageAllowed', '640'), findsOneWidget);
      expect(find.textContaining('Total stoppage (with Lunch / Tea): ', findRichText: true), findsOneWidget);
      // Lunch counts in IDEAL: without it, 768.
      form(tester).onChange(0, 'lunchMin', '');
      await tester.pumpAndSettle();
      expect(calcText('idealQtyExact', '768'), findsOneWidget);
    });
  });

  group('caps and popups', () {
    testWidgets('typing Actual past IDEAL raises the popup, which names the Lunch it took out', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '');
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('actualQty'));
      await tester.enterText(box('actualQty'), '733');
      await tester.pump();
      await tester.pump();
      expect(k('entry-notice'), findsOneWidget);
      expect(find.textContaining('this machine can make at most 732 pieces'), findsOneWidget);
      expect(tester.widget<Text>(k('entry-notice/value/Less Lunch / Tea')).data, '30 min');
      expect(tester.widget<Text>(k('entry-notice/value/Actual Quantity')).data, '733');
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
      await tester.enterText(box('actualQty'), '732');
      await tester.pump();
      expect(form(tester).entries[0]['actualQty'], '732');
    });

    testWidgets('ACTUAL OK past Actual is refused with the sheet\'s words', (tester) async {
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('okQty'));
      await tester.enterText(box('okQty'), '100');
      await tester.pump();
      expect(toasts.any((t) => t.contains("ACTUAL OK Quantity can't be more than Actual Quantity (99)")), isTrue);
    });

    testWidgets('Save with Actual over IDEAL pops why, then moves there; nothing is sent', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '800');
      await tester.pump();
      await save(tester);
      await tester.pumpAndSettle();
      expect(tester.widget<Text>(k('entry-notice/value/Actual Quantity')).data, '800');
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(form(tester).focusTarget!['field'], 'actualQty');
      expect(find.text("Actual can't be more than Ideal Quantity (732)"), findsOneWidget);
      expect(api.called('PUT', rowPath), isEmpty);
    });

    testWidgets('Others downtime needs its remark; a bad Setting Time is flagged', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'otherMin', '5');
      form(tester).onChange(0, 'settingOnTime', '25:00');
      await tester.pumpAndSettle();
      expect(find.textContaining('Remark for Others downtime', findRichText: true), findsOneWidget);
      await save(tester);
      await tester.pumpAndSettle();
      expect(find.text('Remark is required when Others downtime is entered'), findsOneWidget);
      expect(find.text('Enter a valid time'), findsOneWidget);
    });
  });

  group('Save', () {
    testWidgets('a complete entry PUTs the web body: the Part\'s figures, Setting Time, no Rejected', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'settingOnTime', '08:00');
      form(tester).onChange(0, 'settingOffTime', '08:15');
      await tester.pump();
      await save(tester);
      await tester.pumpAndSettle();
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['machine'], 'm3');
      expect(put['slot'], 'auto');
      expect(put['item'], 'i1');
      expect(put['drawingNo'], 'IE0726');
      expect(put['operation'], 'DRILLING');
      expect(put['noOfHoles'], 2);
      expect(put['strokeRequired'], 2);
      expect(put['totalCycleSec'], 50);
      expect(put['settingOnTime'], '08:00');
      expect(put['settingOffTime'], '08:15');
      expect(put['actualQty'], 99);
      expect(put['okQty'], 99);
      expect(put['plannedOperatorShiftHours'], 10.666667);
      expect(put['lunchMin'], 30);
      expect(put.containsKey('rejectedQty'), isFalse);
      expect(put.containsKey('rejectBreakdown'), isFalse);
      expect(put.containsKey('workingStatus'), isFalse);
    });

    testWidgets('two overlapping entries on one machine save together (no overlap error)', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      await tester.ensureVisible(k('entry-add'));
      await tester.tap(k('entry-add'));
      await tester.pumpAndSettle();
      // The new block asks for its machine: the same one is offered (not "already added").
      expect(find.textContaining('already added'), findsNothing);
      await tester.tap(find.text('4/B').last);
      await tester.pumpAndSettle();
      final f = form(tester);
      f.onChange(1, 'operator', 'VISHAL');
      f.onItemSelect(1, 'i1');
      f.onChange(1, 'totalCycleSec', '20');
      f.onChange(1, 'machineOnTime', '14:50');
      f.onChange(1, 'machineOffTime', '15:25');
      f.onChange(1, 'actualQty', '75');
      f.onChange(1, 'okQty', '75');
      f.onChange(1, 'plannedOperatorShiftHours', '0.58');
      await tester.pumpAndSettle(const Duration(seconds: 5));
      await save(tester);
      await tester.pumpAndSettle();
      expect(find.textContaining('overlaps another entry'), findsNothing);
      expect(api.called('PUT', rowPath).length, 2);
    });

    testWidgets('an empty entry flags every required field in the sheet\'s words', (tester) async {
      final api = await openEditor(tester);
      await pickMachine(tester, 'm3');
      await save(tester);
      await tester.pumpAndSettle();
      for (final msg in [
        'Operator is required',
        'Part Name is required',
        'Total Cycle Time is required',
        'Machine Time ON is required',
        'Machine Time OFF is required',
        'Actual Quantity is required',
        'OK Quantity is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(msg, skipOffstage: false), findsOneWidget, reason: msg);
      }
      expect(api.called('PUT', rowPath), isEmpty);
    });
  });

  group('Working Status', () {
    testWidgets('Non Working: only the head line (Reasons For Not Working, Operator optional), the note and REMARKS', (tester) async {
      final api = await openEditor(tester);
      await pickMachine(tester, 'm2');
      await tester.ensureVisible(k('entry0/workingMode/Non Working'));
      await tester.tap(k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      expect(describeLines(openFormLines(tester)), describeLines(<FormLineLabels>[
        ('Date, MC NO., Operator, Working Status', ['Date *', 'MC NO. *', 'Operator', 'Working Status', 'Reasons For Not Working']),
        webLines.last,
      ]));
      expect(
        find.textContaining('Pick a reason if you like (W.OFF and the like go in REMARKS) and press Save.', findRichText: true),
        findsOneWidget,
      );
      await tester.tap(k('entry0/machineStatus/No Planning'));
      await tester.pumpAndSettle();
      await save(tester);
      await tester.pumpAndSettle();
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['workingMode'], 'Non Working');
      expect(put['machineStatus'], ['No Planning']);
      expect(put['item'], isNull);
      expect(put['operation'], '');
    });
  });

  group('Planned Operator Shift and the folding lines', () {
    setUp(() {
      EntryLineCard.foldOptional = true;
      addTearDown(() => EntryLineCard.foldOptional = false);
    });

    testWidgets('a locked process fills 12 and folds its line; Setting Time, Downtime and REMARKS start folded', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm1');
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      expect(find.descendant(of: toggle('Planned Operator Shift, Lunch / Tea / Washroom'), matching: find.text('Shift fixed — Lunch / Tea optional')), findsOneWidget);
      for (final title in ['Setting Time ON – OFF', 'Downtime (min)', 'REMARKS']) {
        expect(find.descendant(of: toggle(title), matching: find.text('Optional — tap to add')), findsOneWidget, reason: title);
      }
      await tester.ensureVisible(toggle('Setting Time ON – OFF'));
      await tester.tap(toggle('Setting Time ON – OFF'));
      await tester.pumpAndSettle();
      expect(find.text('Setting Time ON'), findsOneWidget);
    });
  });

  group('responsive', () {
    testWidgets('a 360×640 phone at text scale 1.6, dark, does not overflow', (tester) async {
      await openEditor(tester, size: const Size(360, 640), textScale: 1.6, dark: true);
      await fillValid(tester, machine: 'm2');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('a landscape tablet edit does not overflow', (tester) async {
      await openEditor(tester, size: const Size(1366, 1024), row: _saved(machine: 'm2', extra: {'vendor': 'v1', 'vendorName': 'Acme Tools'}));
      expect(find.text('Acme Tools'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the list: order, table and detail', () {
    test('a machine\'s entries read in Machine Time ON order (then slot), as the web sorts them', () {
      final rows = [
        {'_id': 'a', 'date': '2024-05-10', 'machine': 'm1', 'slot': 1, 'machineOnTime': '14:50'},
        {'_id': 'b', 'date': '2024-05-10', 'machine': 'm1', 'slot': 2, 'machineOnTime': '08:15'},
        {'_id': 'c', 'date': '2024-05-10', 'machine': 'm1', 'slot': 3, 'machineOnTime': ''},
      ];
      List<String> order(bool byOn) => [
            for (final e in buildSheetDays(
              rows: rows,
              filters: SheetFilters.empty,
              search: '',
              machineName: const {'m1': '4/B'},
              rankOf: (_) => 0,
              byMachineOn: byOn,
            ).single.machines.single.entries)
              '${e['_id']}',
          ];
      expect(order(true), ['b', 'a', 'c']);
      expect(order(false), ['a', 'b', 'c'], reason: 'every other sheet: slot order');
    });

    Map<String, dynamic> tableRow(String id, {Map<String, dynamic> extra = const {}}) => {
          ..._saved(machine: 'm1', extra: extra),
          '_id': id,
          'date': '${list.today}T00:00:00.000Z',
        };

    FakeApi installList(List<Map<String, dynamic>> rows) {
      final api = FakeApi.install();
      api.on('GET', spec.api.list, (r) => {
            'isOk': true,
            'data': rows,
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
          });
      api.list(Endpoints.machines, [
        {'_id': 'm1', 'machineName': '4/B'},
      ]);
      api.list(Endpoints.items, _items);
      api.list(Endpoints.machineOperators, _operators);
      api.list(Endpoints.processes, []);
      api.list(Endpoints.vendors, []);
      api.list(Endpoints.companyHolidays, []);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', spec.api.extent, (_) => {'isOk': true, 'data': {'from': '2024-01-01', 'to': list.today}});
      api.on('GET', spec.api.filterOptions, (_) => {
            'isOk': true,
            'data': {'machine': ['m1'], 'operator': ['VISHAL'], 'item': ['24 PIN FRAME BIG']},
          });
      return api;
    }

    testWidgets('the sheet\'s columns; two overlapping entries keep their own figures, earlier ON first', (tester) async {
      SharedPreferences.setMockInitialValues({});
      installList([
        // Slot 1 is the later run: it reads second.
        tableRow('r1', extra: {
          'machineOnTime': '14:50', 'machineOffTime': '15:25', 'totalCycleSec': 20, 'actualQty': 75, 'okQty': 75,
          'plannedOperatorShiftHours': 0.583333, 'lunchMin': 0, 'materialShiftingMin': 0,
        }),
        tableRow('r2', extra: {'slot': 2}),
      ]);
      await pumpScreen(tester, ProductionSheetScreen(spec: spec), size: const Size(2600, 900));
      for (final key in [
        'operator', 'workingStatus', 'notWorkingReasons', 'itemName', 'drawingNo', 'operation', 'noOfHoles', 'strokeRequired', 'cycle',
        'on', 'off', 'settingOn', 'settingOff', 'shift', 'idealQty', 'idealQtyPerHour', 'actualQty', 'okQty', 'rejectedQty', 'pctOk',
        'plannedShift', 'totalStoppage', 'effective', 'unreported', 'efficiency', 'oeeLosses', 'review', 'remarks',
      ]) {
        expect(list.byKey('head-$key'), findsOneWidget, reason: key);
      }
      Finder cell(String id, String key, String text) => find.descendant(of: list.byKey('$id:$key'), matching: find.text(text));
      expect(cell('r2', 'idealQty', '732'), findsOneWidget);
      expect(cell('r2', 'idealQtyPerHour', '68.6'), findsOneWidget);
      expect(cell('r1', 'idealQty', '105'), findsOneWidget);
      expect(cell('r1', 'idealQtyPerHour', '180.0'), findsOneWidget);
      expect(cell('r2', 'efficiency', '12.89%'), findsOneWidget);
      expect(cell('r1', 'efficiency', '71.43%'), findsOneWidget);
      expect(cell('r2', 'operation', 'DRILLING'), findsOneWidget);
      // Each entry's own OEE, not the machine's combined day.
      final r1 = find.descendant(of: list.byKey('r1:oeeLosses'), matching: find.byType(Text));
      final r2 = find.descendant(of: list.byKey('r2:oeeLosses'), matching: find.byType(Text));
      expect(tester.widget<Text>(r1.first).data, isNot(tester.widget<Text>(r2.first).data));
      // 08:15 (r2) reads above 14:50 (r1).
      expect(tester.getTopLeft(list.byKey('r2:idealQty')).dy, lessThan(tester.getTopLeft(list.byKey('r1:idealQty')).dy));
      expect(tester.takeException(), isNull);
    });

    testWidgets('the detail lists every column in the sheet\'s words', (tester) async {
      final r = {..._saved(), 'settingOnTime': '08:00', 'remarks': 'burr'};
      await pumpScreen(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: EntryDetail(
              spec: spec,
              row: r,
              calc: spec.rowCalc(r),
              day: spec.dayCalc([r]).first,
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
      );
      for (final t in [
        'Part Name', 'Drawing No.', 'Process', 'No. of Holes in One Piece', 'Stroke Required for One Piece', 'Total Cycle Time (Sec)',
        'IDEAL Quantity', 'IDEAL Quantity/Hour', 'Actual Quantity', 'ACTUAL OK Quantity', 'Rejected Quantity', '% OK Quantity',
        'Machine Time ON', 'Setting Time ON', 'Machine Shift Time (Hour)', 'Total stoppage (Min)', 'Effective Machine Run Time (Hour)',
        'Unreported Time (Min)', 'Efficiency (%)', 'Working Status', 'REMARKS',
      ]) {
        expect(find.textContaining(t, findRichText: true), findsWidgets, reason: t);
      }
      expect(find.text('732'), findsOneWidget);
      expect(find.text('68.6'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
