// The EMBOSSING Add / Edit form against the web's (EmbossingEntryForm.jsx in
// EmbossingDataEntry.jsx) — INJECTION MOULDING's, but TOTAL QTY. is not capped: the same lines in the
// same order with the same boxes, labels and required stars; the grey figures;
// the caps and their popups; Planned Operator Shift from Process Master; the
// Working Status; Vendor Name; what Save sends — and the list's table and detail.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_layout.dart' show EntryLineCard;
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/embossing/embossing_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';
import '../../sheet_list_test.dart' as list;
import '../../web_parity/form_lines_support.dart';

const spec = embossingSpec;
const rowPath = '/api/v1/embossing-sheet/row';
const occupiedPath = '/api/v1/embossing-sheet/occupied';

// m1: process p1 (Planned Operator Shift locked at 12 h, no vendors)
// m2: process p3 (Planned typed by hand; vendor v1 active, v2 inactive)
// m3: no process
final _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'IMM 1', 'process': 'p1'},
  {'_id': 'm2', 'machineName': 'IMM 2', 'process': 'p3'},
  {'_id': 'm3', 'machineName': 'IMM 3'},
];
final _processes = <Map<String, dynamic>>[
  {'_id': 'p1', 'plannedShiftLocked': true, 'plannedShiftHours': 12},
  {'_id': 'p3', 'plannedShiftLocked': false},
];
final _vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Moulds', 'isActive': true, 'processes': ['p3']},
  {'_id': 'v2', 'name': 'Retired Vendor', 'isActive': false, 'processes': ['p3']},
];
final _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Cap 12', 'drawingNo': 'D-12', 'totalCycleSec': 38},
];
final _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'RAMESH'},
];

/// The lines of the web's Add Entry modal, in the order it draws them, each with
/// its boxes (a trailing " *" is the red required star) — a machine in no process,
/// so no Vendor Name and the shift typed by hand.
const webLines = <FormLineLabels>[
  ('Date, MC No., Operator, Working Status', ['Date *', 'MC No. *', 'Operator *', 'Working Status']),
  ('Item Name, Standard Time per Piece', ['Item Name *', 'Standard Time per Piece (in Sec) *']),
  ('Machine ON–OFF Time, Machine Shift Time', ['Machine ON Time *', 'Machine OFF Time *', 'Machine Shift Time (Hours)']),
  (
    'Production Master — TOTAL QTY., OK QTY., Rejected QTY',
    ['TOTAL QTY *', 'OK QTY *', 'Rejected QTY', 'Ok Quantity (%)', 'Ideal Quantity', 'Ideal Quantity/Hour', 'Effective Machine Run Time (hours)'],
  ),
  ('Planned Operator Shift, Lunch / Tea / Washroom', ['Planned Operator Shift (hours) *', 'Lunch / Tea / Washroom etc (Min)', 'Idle Time Allowed (min)']),
  (
    'Idle Time (min)',
    [
      'Planned Down Time (min)', 'Setup Time (min)', 'No Man Power (min)', 'Material Shifting (min)', 'No Material (min)',
      'B.D. Mech. (min)', 'B.D. Ele. (min)', 'No Power (min)', 'Other (Min)',
    ],
  ),
  ('Remarks', ['Remarks']),
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

/// A saved entry: the paper sheet's row — 08:30–17:55 at 38 s (Ideal 892.11),
/// TOTAL 828, OK 825, Lunch 30.
Map<String, dynamic> _saved({String machine = 'm3', Map<String, dynamic> extra = const {}}) => {
      '_id': 'r1',
      'date': '2026-05-13',
      'machine': machine,
      'slot': 1,
      'item': 'i1',
      'operator': 'RAMESH',
      'itemName': 'Cap 12',
      'drawingNo': 'D-12',
      'totalCycleSec': 38,
      'machineOnTime': '08:30',
      'machineOffTime': '17:55',
      'actualQty': 828,
      'okQty': 825,
      'rejectedQty': 3,
      'plannedOperatorShiftHours': 9.416667,
      'lunchMin': 30,
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

/// The paper sheet's row typed in: 08:30–17:55 at 38 s, TOTAL 828, OK 825.
Future<void> fillValid(WidgetTester t, {String machine = 'm3', String planned = '9.42'}) async {
  await pickMachine(t, machine);
  final f = form(t);
  f.onChange(0, 'operator', 'RAMESH');
  f.onItemSelect(0, 'i1');
  f.onChange(0, 'machineOnTime', '08:30');
  f.onChange(0, 'machineOffTime', '17:55');
  f.onChange(0, 'actualQty', '828');
  f.onChange(0, 'okQty', '825');
  if (machine != 'm1') f.onChange(0, 'plannedOperatorShiftHours', planned);
  f.onChange(0, 'lunchMin', '30');
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

  test('registered after MODULAR FRAME DRILLING, reachable by key and by its page', () {
    final keys = [for (final s in ProcessRegistry.all) s.key];
    expect(ProcessRegistry.byKey('embossing'), same(spec));
    expect(ProcessRegistry.byPath('/production/embossing-data-entry'), same(spec));
    expect(keys.indexOf('embossing'), greaterThan(keys.indexOf('mfd')));
    if (keys.contains('finalAssembly')) expect(keys.indexOf('finalAssembly'), greaterThan(keys.indexOf('embossing')));
    expect(spec.api.row, rowPath);
    expect(spec.draftKey, 'embossingEntryDraft');
    expect(spec.pageTitle, 'EMBOSSING Data Entry');
    expect(spec.addTitle, 'Add EMBOSSING Entry');
    expect(spec.editTitle, 'Update EMBOSSING Entry');
    expect(spec.searchHint, 'Search item, operator, drawing no…');
    // The shared web-parity pieces this page has.
    expect(spec.usesVendors, isTrue);
    expect(spec.usesPlannedShiftSetting, isTrue);
    expect(spec.showLimitPopups, isTrue);
    expect(spec.referenceLists['vendors'], Endpoints.vendors);
  });

  group('same lines and boxes as the web Add Entry modal', () {
    testWidgets('phone: the seven web lines, in the web order, each with the web boxes', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm3');
      expect(describeLines(openFormLines(tester)), describeLines(webLines));
      // No Rejection Master on this sheet.
      expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
      expect(find.text('Reason / Remarks for Rejection / Rework', skipOffstage: false), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tablet: two columns, the left one then the right one is the web order', (tester) async {
      await openEditor(tester, size: const Size(1024, 1180));
      await pickMachine(tester, 'm3');
      expect(describeLines(openFormLines(tester)), describeLines(webLines));
      final date = tester.getTopLeft(find.text('Date, MC No., Operator, Working Status'));
      final planned = tester.getTopLeft(find.text('Planned Operator Shift, Lunch / Tea / Washroom'));
      expect(planned.dx, greaterThan(date.dx + 200), reason: 'Planned (5th) sits in the right column');
      expect(tester.takeException(), isNull);
    });

    testWidgets('Vendor Name follows Standard Time per Piece when the process has vendors', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm2');
      final line = openFormLines(tester).firstWhere((l) => l.$1 == 'Item Name, Standard Time per Piece');
      expect(line.$2, ['Item Name *', 'Standard Time per Piece (in Sec) *', 'Vendor Name']);
      await tester.ensureVisible(k('entry0/vendor'));
      await tester.tap(k('entry0/vendor'));
      await tester.pumpAndSettle();
      expect(find.text('Retired Vendor'), findsNothing);
      await tester.tap(find.text('Acme Moulds'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['vendor'], 'v1');
    });

    testWidgets('MC No. box and an empty machine list say it in the sheet\'s words', (tester) async {
      await openEditor(tester);
      expect(find.textContaining('MC No.', findRichText: true), findsWidgets);
      expect(find.text('Select a machine — its entry fields open automatically'), findsOneWidget);
      expect(spec.noMachinesMessage, 'No machines yet — add them to EMBOSSING in Production › Machines.');
    });
  });

  group('the grey figures, worked out as the sheet does', () {
    testWidgets('Machine Shift, Rejected, Ok %, Ideal (2 decimals), Ideal/Hours, Effective on TOTAL', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      // 08:30–17:55 = 565 min; 38 s a piece; TOTAL 828, OK 825.
      expect(calcText('shiftHours', '9.42 (9:25 hr)'), findsOneWidget);
      expect(calcText('rejectedQty', '3'), findsOneWidget);
      expect(calcText('pctOk', '99.64%'), findsOneWidget);
      expect(calcText('idealQtyExact', '892.11'), findsOneWidget, reason: 'not rounded down, and not a cap');
      expect(calcText('idealQtyPerHour', '94.74'), findsOneWidget, reason: '3600 ÷ 38');
      expect(calcText('effectiveHours', '8.74 (8:44 hr)'), findsOneWidget, reason: '828 × 38 ÷ 3600');
      expect(calcText('stoppageAllowed', '565'), findsOneWidget, reason: 'Idle Time Allowed = the Machine Shift');
      expect(find.textContaining('Total Idle Time (with Lunch / Tea): ', findRichText: true), findsOneWidget);
      expect(find.text("Part's usual: 38 sec"), findsNothing);
      expect(find.text('Cap 12 — 38 sec'), findsOneWidget);
      form(tester).onChange(0, 'totalCycleSec', '40');
      await tester.pumpAndSettle();
      expect(find.text("Part's usual: 38 sec"), findsOneWidget);
      expect(find.text('= 9:25 hr'), findsOneWidget, reason: '9.42 h read back as hours:minutes');
    });

    testWidgets('a Planned Operator Shift under the Machine Shift says so at once', (tester) async {
      await openEditor(tester);
      await fillValid(tester, planned: '9');
      await tester.pumpAndSettle();
      expect(find.text("Planned Operator Shift can't be less than the Machine Shift (9:25)"), findsOneWidget);
    });
  });

  group('caps and popups', () {
    testWidgets('TOTAL QTY may be typed past Ideal: no popup, the box takes it, the banner says OEE Review', (tester) async {
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '');
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('actualQty'));
      await tester.enterText(box('actualQty'), '1200'); // Ideal 892.11
      await tester.pump();
      await tester.pump();
      expect(k('entry-notice'), findsNothing);
      expect(toasts, isEmpty);
      expect(form(tester).entries[0]['actualQty'], '1200');
      await tester.pumpAndSettle();
      await tester.ensureVisible(k('entry0/oeeCheck'));
      expect(find.textContaining('above 100% — this entry will still save, but goes to Admin review'), findsOneWidget);
    });

    testWidgets('OK QTY past TOTAL QTY is refused with the sheet\'s words', (tester) async {
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('okQty'));
      await tester.enterText(box('okQty'), '829');
      await tester.pump();
      expect(toasts.any((t) => t.contains("OK QTY can't be more than TOTAL QTY (828)")), isTrue);
      expect(form(tester).entries[0]['okQty'], '825');
    });

    testWidgets('typing downtime past the Machine Shift raises the stoppage popup', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('setupMin'));
      await tester.enterText(box('setupMin'), '600');
      await tester.pump();
      await tester.pump();
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(tester.widget<Text>(k('entry-notice/value/Total stoppage')).data, '630 min');
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
    });

    testWidgets('Save with TOTAL over Ideal saves (no limit popup): it goes to OEE Review instead', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'actualQty', '1200');
      form(tester).onChange(0, 'okQty', '1190');
      await tester.pump();
      await save(tester);
      await tester.pumpAndSettle();
      expect(k('entry-notice'), findsNothing);
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['actualQty'], 1200);
      expect(put['okQty'], 1190);
    });

    testWidgets('Other downtime needs its remark; the box shows only once Other is used', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      await tester.pumpAndSettle();
      expect(k('entry0/otherMinRemark'), findsNothing);
      form(tester).onChange(0, 'otherMin', '5');
      await tester.pumpAndSettle();
      expect(k('entry0/otherMinRemark'), findsOneWidget);
      expect(find.textContaining('Remark for Other downtime', findRichText: true), findsOneWidget);
      await save(tester);
      await tester.pumpAndSettle();
      expect(find.text('Remark is required when Other downtime is entered'), findsOneWidget);
    });
  });

  group('Save', () {
    testWidgets('a complete entry PUTs the web body: TOTAL / OK, no Rejected, decimal Planned', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      await save(tester);
      await tester.pumpAndSettle();
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['machine'], 'm3');
      expect(put['slot'], 'auto');
      expect(put['item'], 'i1');
      expect(put['itemName'], 'Cap 12');
      expect(put['drawingNo'], 'D-12');
      expect(put['totalCycleSec'], 38);
      expect(put['actualQty'], 828);
      expect(put['okQty'], 825);
      expect(put['plannedOperatorShiftHours'], 9.416667);
      expect(put['lunchMin'], 30);
      expect(put['setupMin'], '');
      expect(put['workingMode'], 'Working');
      expect(put['machineStatus'], <dynamic>[]);
      expect(put['vendor'], isNull);
      expect(put.containsKey('rejectedQty'), isFalse, reason: 'the server works out TOTAL − OK');
      expect(put.containsKey('rejectBreakdown'), isFalse, reason: 'no Rejection Master');
      expect(put.containsKey('vendorName'), isFalse);
    });

    testWidgets('an empty entry flags every required field in the sheet\'s words and sends nothing', (tester) async {
      final api = await openEditor(tester);
      await pickMachine(tester, 'm3');
      await save(tester);
      await tester.pumpAndSettle();
      for (final msg in [
        'Operator is required',
        'Item Name is required',
        'Standard Time per Piece is required',
        'Machine ON Time is required',
        'Machine OFF Time is required',
        'TOTAL QTY is required',
        'OK QTY is required',
        'Planned Operator Shift is required',
      ]) {
        expect(find.text(msg, skipOffstage: false), findsOneWidget, reason: msg);
      }
      expect(form(tester).focusTarget!['field'], 'operator');
      expect(api.called('PUT', rowPath), isEmpty);
    });
  });

  group('Working Status', () {
    testWidgets('Non Working: only the head line (Reasons For Not Working, Operator optional), the note and the remarks', (tester) async {
      final api = await openEditor(tester);
      await pickMachine(tester, 'm2');
      expect(k('entry0/machineStatus/No Manpower'), findsNothing);
      await tester.ensureVisible(k('entry0/workingMode/Non Working'));
      await tester.tap(k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      expect(describeLines(openFormLines(tester)), describeLines(<FormLineLabels>[
        ('Date, MC No., Operator, Working Status', ['Date *', 'MC No. *', 'Operator', 'Working Status', 'Reasons For Not Working']),
        webLines.last,
      ]));
      expect(
        find.textContaining(
          'Non Working — the machine did not run, so nothing else is needed. Pick a reason if you like (W.OFF and the like go in Remarks) and press Save.',
          findRichText: true,
        ),
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
      expect(put['actualQty'], '');
      expect(put['plannedOperatorShiftHours'], '');
    });

    testWidgets('going back to Working drops the reasons', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm3');
      await tester.tap(k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      await tester.tap(k('entry0/machineStatus/No Manpower'));
      await tester.pumpAndSettle();
      await tester.tap(k('entry0/workingMode/Working'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['machineStatus'], <dynamic>[]);
      expect(describeLines(openFormLines(tester)), describeLines(webLines));
    });

    testWidgets('an old status-only entry (ABSENT) shows only its status', (tester) async {
      await openEditor(tester, row: _saved(extra: {'workingStatus': 'ABSENT'}));
      expect(find.text('Item Name, Standard Time per Piece'), findsNothing);
      expect(
        find.textContaining('ABSENT — no production that day, so only Date, MC No. and Working Status are saved', findRichText: true),
        findsOneWidget,
      );
    });
  });

  group('Planned Operator Shift from Process Master, and the folding lines', () {
    setUp(() {
      EntryLineCard.foldOptional = true;
      addTearDown(() => EntryLineCard.foldOptional = false);
    });

    testWidgets('a locked process fills 12, makes the box read-only and folds its line', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm1');
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '12');
      final head = toggle('Planned Operator Shift, Lunch / Tea / Washroom');
      expect(find.descendant(of: head, matching: find.text('Shift fixed — Lunch / Tea optional')), findsOneWidget);
      await tester.ensureVisible(head);
      await tester.tap(head);
      await tester.pumpAndSettle();
      await tester.ensureVisible(box('plannedOperatorShiftHours'));
      expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isFalse);
      expect(find.textContaining('Fixed at 12:00 hr — locked in Process Master'), findsOneWidget);
    });

    testWidgets('typed by hand: the Planned line is open; Idle Time and the remarks start folded', (tester) async {
      await openEditor(tester);
      await pickMachine(tester, 'm2');
      expect(find.text('Shift fixed — Lunch / Tea optional'), findsNothing);
      expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isTrue);
      for (final title in ['Idle Time (min)', 'Remarks']) {
        expect(find.descendant(of: toggle(title), matching: find.text('Optional — tap to add')), findsOneWidget, reason: title);
      }
      expect(find.text('Setup Time (min)'), findsNothing, reason: 'folded');
      await tester.ensureVisible(toggle('Idle Time (min)'));
      await tester.tap(toggle('Idle Time (min)'));
      await tester.pumpAndSettle();
      expect(find.text('Setup Time (min)'), findsOneWidget);
    });

    testWidgets('editing keeps the shift the entry was saved with', (tester) async {
      await openEditor(tester, row: _saved(machine: 'm1', extra: {'plannedOperatorShiftHours': 9.5, 'plannedLocked': true}));
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '9.5');
      expect(form(tester).plannedShifts.single!.fromEntry, isTrue);
      expect(find.textContaining('Kept as this entry was saved', skipOffstage: false), findsOneWidget);
    });
  });

  group('responsive', () {
    testWidgets('a 360×640 phone at text scale 1.6, dark, does not overflow', (tester) async {
      await openEditor(tester, size: const Size(360, 640), textScale: 1.6, dark: true);
      await fillValid(tester, machine: 'm2');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(box('actualQty'));
      await tester.enterText(box('actualQty'), '1200');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('a landscape tablet edit does not overflow', (tester) async {
      await openEditor(tester, size: const Size(1366, 1024), row: _saved(machine: 'm2', extra: {'vendor': 'v1', 'vendorName': 'Acme Moulds'}));
      expect(find.text('Acme Moulds'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('the list: table and detail', () {
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
        {'_id': 'm1', 'machineName': 'IMM 1'},
      ]);
      api.list(Endpoints.items, _items);
      api.list(Endpoints.machineOperators, _operators);
      api.list(Endpoints.processes, []);
      api.list(Endpoints.vendors, []);
      api.list(Endpoints.companyHolidays, []);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', spec.api.extent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': list.today}});
      api.on('GET', spec.api.filterOptions, (_) => {
            'isOk': true,
            'data': {'machine': ['m1'], 'operator': ['RAMESH'], 'item': ['Cap 12']},
          });
      return api;
    }

    testWidgets('the sheet\'s columns; two entries of one machine-day keep their own OEE / Unreported', (tester) async {
      SharedPreferences.setMockInitialValues({});
      // The paper's 08:30–11:30 @ 15 s and 12:30–16:30 @ 9 s rows on one machine and date.
      installList([
        tableRow('r1', extra: {
          'machineOnTime': '08:30', 'machineOffTime': '11:30', 'totalCycleSec': 15, 'actualQty': 608, 'okQty': 600,
          'plannedOperatorShiftHours': 3, 'lunchMin': 0, 'setupMin': 30,
        }),
        tableRow('r2', extra: {
          'slot': 2, 'machineOnTime': '12:30', 'machineOffTime': '16:30', 'totalCycleSec': 9, 'actualQty': 1500, 'okQty': 1500,
          'plannedOperatorShiftHours': 4, 'lunchMin': 0,
        }),
      ]);
      await pumpScreen(tester, ProductionSheetScreen(spec: spec), size: const Size(2600, 900));
      for (final key in ['itemName', 'operator', 'workingStatus', 'notWorkingReasons', 'shift', 'cycle', 'totalQty', 'okQty', 'rejectedQty', 'pctOk', 'idealQty', 'idealQtyPerHour', 'plannedShift', 'totalStoppage', 'effective', 'unreported', 'oeeLosses', 'review', 'remarks']) {
        expect(list.byKey('head-$key'), findsOneWidget, reason: key);
      }
      for (final key in ['drawingNo', 'unutilized', 'setupEff', 'machineStatus']) {
        expect(list.byKey('head-$key'), findsNothing, reason: key);
      }
      Finder cell(String id, String key, String text) => find.descendant(of: list.byKey('$id:$key'), matching: find.text(text));
      // The paper's own figures, each entry its own.
      expect(cell('r1', 'oeeLosses', '101.33%'), findsOneWidget);
      expect(cell('r1', 'oeeLunch', '84.44%'), findsOneWidget);
      expect(cell('r2', 'oeeLosses', '93.75%'), findsOneWidget);
      expect(cell('r1', 'unreported', '-2'), findsOneWidget);
      expect(cell('r2', 'unreported', '15'), findsOneWidget);
      expect(cell('r1', 'shift', '3'), findsOneWidget);
      expect(cell('r1', 'idealQty', '720'), findsOneWidget);
      expect(cell('r1', 'idealQtyPerHour', '240'), findsOneWidget);
      expect(list.byKey('head-totalQty'), findsOneWidget);
      expect(cell('r1', 'totalQty', '608'), findsOneWidget);
      expect(cell('r1', 'rejectedQty', '8'), findsOneWidget);
      expect(cell('r1', 'effective', '2.53'), findsOneWidget, reason: '608 × 15 ÷ 3600, decimal hours');
      expect(cell('r1', 'workingStatus', 'Working'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the detail lists every column in the sheet\'s words', (tester) async {
      final r = {
        ..._saved(),
        'workingMode': 'Non Working',
        'machineStatus': ['No Manpower'],
        'remarks': 'W.OFF',
        'vendorName': 'Acme Moulds',
        'review': {
          'status': 'pending',
          'flagged': [{'metric': 'performance', 'value': 1.2}],
        },
      };
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
        'Standard Time per Piece (in Sec)', 'TOTAL QTY', 'OK QTY', 'Rejected QTY', 'Ok Quantity (%)', 'Ideal Quantity', 'Ideal Quantity/Hour',
        'Machine Shift Time (Hours)', 'Planned Operator Shift Time (hr:min)', 'Total Idle Time (Min)', 'Effective Machine Run Time (hours)',
        'Unreported Time (min)', 'Availability (%)', 'OEE Review', 'Item Name', 'Vendor Name', 'Working Status', 'Reasons For Not Working',
        'Remarks',
      ]) {
        expect(find.textContaining(t, findRichText: true), findsWidgets, reason: t);
      }
      expect(find.text('892.11'), findsOneWidget, reason: 'Ideal Quantity to 2 decimals');
      expect(find.text('No Manpower, W.OFF'), findsOneWidget);
      expect(find.text('Pending review'), findsOneWidget);
      expect(find.text('Performance 120.00%'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
