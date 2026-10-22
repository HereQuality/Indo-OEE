// Wave 2: the After Powder Coating Data Entry page matches the current web page
// (PowderCoatingDataEntry.jsx, PowderCoatingEntryForm.jsx, powderCoatingColumns.jsx)
// for Vendor Name, the Planned Operator Shift from Process Master, the over-100%
// banner / red figures / OEE Review, Working Status + Reasons, the limit popups
// and the optional foldable sections (FormLine `optional`).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/theme/app_colors.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/sheet/sheet_model.dart' show Json;
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

const spec = powderCoatingSpec;
const rowPath = '/api/v1/powder-coating-sheet/row';
const occupiedPath = '/api/v1/powder-coating-sheet/occupied';
const listPath = '${Endpoints.v1}/powder-coating-sheet';

final operators = <Map<String, dynamic>>[
  {'_id': 'w1', 'name': 'Asha', 'processes': ['p1']},
  {'_id': 'w2', 'name': 'Ravi', 'processes': ['p1']},
];
final p1 = <String, dynamic>{'_id': 'p1', 'dataEntryMenu': '/hqepl/production/powder-coating-data-entry'};
final lockedAt8 = <Map<String, dynamic>>[
  {...p1, 'plannedShiftLocked': true, 'plannedShiftHours': 8},
];
final unlocked = <Map<String, dynamic>>[
  {...p1, 'plannedShiftLocked': false},
];
final workers = spec.scopeMachines(machines: const [], operators: operators, lockedProcess: p1);
final items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Panel', 'totalCycleSec': 45},
];
final vendorList = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Coaters', 'isActive': true, 'processes': ['p1']},
  {'_id': 'v2', 'name': 'Retired Vendor', 'isActive': false, 'processes': ['p1']},
  {'_id': 'v3', 'name': 'Other Process Vendor', 'isActive': true, 'processes': ['p2']},
];

class _Launcher extends StatelessWidget {
  const _Launcher({this.row, this.workerId, required this.processes, required this.vendors});
  final Map<String, dynamic>? row;
  final String? workerId;
  final List<Map<String, dynamic>> processes;
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
                  initialMachineId: workerId,
                  machines: workers,
                  items: items,
                  operators: operators,
                  processes: processes,
                  extra: {'vendors': vendors},
                  lockedProcess: p1,
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

Future<FakeApi> openEditor(
  WidgetTester tester, {
  Map<String, dynamic>? row,
  String? workerId = 'w1',
  List<Map<String, dynamic>>? processes,
  List<Map<String, dynamic>>? vendors,
  Size size = const Size(390, 2600),
  double textScale = 1,
}) async {
  SharedPreferences.setMockInitialValues({});
  EntryNotices.reset();
  EntryFormToast.reset();
  final api = FakeApi.install();
  api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
  api.on('GET', occupiedPath, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(row: row, workerId: workerId, processes: processes ?? lockedAt8, vendors: vendors ?? vendorList),
    ),
    size: size,
    textScale: textScale,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}

ProductionEntryForm form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder k(String key) => find.byKey(ValueKey(key));
Finder box(String field) => find.descendant(of: k('entry0/$field'), matching: find.byType(EditableText));
Finder saveBtn() => find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton));
bool canSave(WidgetTester t) => t.widget<EntryActionBar>(find.byType(EntryActionBar)).canSave;

Future<void> fillValid(WidgetTester t, {String? planned = '8.30'}) async {
  final f = form(t);
  f.onChange(0, 'machine', 'w1');
  f.onItemSelect(0, 'i1');
  f.onChange(0, 'machineOnTime', '08:00');
  f.onChange(0, 'machineOffTime', '16:00');
  f.onChange(0, 'actualQty', '600');
  f.onChange(0, 'lessCoatingQty', '5');
  if (planned != null) f.onChange(0, 'plannedOperatorShiftHours', planned);
  f.onChange(0, 'lunchMin', '30');
  await t.pump();
}

Future<void> tapSave(WidgetTester t) async {
  await t.tap(saveBtn());
  await t.pump();
}

/// The words in section [id]'s header ('' while it is open and empty).
String foldNote(WidgetTester t, String id) {
  final note = find.byKey(ValueKey('entry0/fold/$id/note'));
  return note.evaluate().isEmpty ? '' : t.widget<Text>(note).data ?? '';
}

Future<void> pickWorkingStatus(WidgetTester t, String mode) async {
  await t.ensureVisible(k('entry0/workingMode'));
  await t.tap(k('entry0/workingMode'));
  await t.pumpAndSettle();
  await t.tap(find.text(mode).last);
  await t.pumpAndSettle();
}

void main() {
  setUp(() {
    EntryFormToast.reset();
    EntryNotices.reset();
  });

  group('Vendor Name', () {
    testWidgets('offers the active vendors ticked for the page\'s process; picking sends the id only', (tester) async {
      final api = await openEditor(tester);
      expect(k('entry0/vendor'), findsOneWidget);
      await tester.ensureVisible(k('entry0/vendor'));
      await tester.tap(k('entry0/vendor'));
      await tester.pumpAndSettle();
      expect(find.text('Acme Coaters'), findsOneWidget);
      expect(find.text('Retired Vendor'), findsNothing, reason: 'inactive vendors are not offered');
      expect(find.text('Other Process Vendor'), findsNothing, reason: 'only vendors ticked for this process');
      await tester.tap(find.text('Acme Coaters'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['vendor'], 'v1');
      // VendorSelect's onSelect writes the id only; the server derives the name.
      expect(form(tester).entries[0]['vendorName'], '');
      expect(find.text('Acme Coaters'), findsOneWidget);

      await fillValid(tester);
      await tapSave(tester);
      await tester.pumpAndSettle();
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['vendor'], 'v1');
      expect(put.containsKey('vendorName'), isFalse);
    });

    testWidgets('a vendor can be cleared again, and is optional', (tester) async {
      final api = await openEditor(tester);
      form(tester).onChange(0, 'vendor', 'v1');
      await tester.pump();
      await tester.ensureVisible(k('entry0/vendor'));
      await tester.tap(k('entry0/vendor'));
      await tester.pumpAndSettle();
      // The picker's clear option (allowClear) puts the box back to blank.
      await tester.tap(find.text('Clear'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['vendor'], '');
      await fillValid(tester);
      expect(canSave(tester), isTrue, reason: 'Vendor Name is optional on this sheet');
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(api.called('PUT', rowPath).single.body['vendor'], '');
    });

    testWidgets('no vendors for the process: no Vendor Name box', (tester) async {
      await openEditor(tester, vendors: const []);
      expect(k('entry0/vendor'), findsNothing);
    });

    testWidgets('an entry that names a vendor keeps showing it even with no vendors loaded', (tester) async {
      await openEditor(tester, vendors: const [], row: {
        '_id': 'e1', 'date': '2026-09-20', 'worker': 'w1', 'machine': 'w1', 'operator': 'Asha', 'slot': 1,
        'item': 'i1', 'itemName': 'Panel', 'totalCycleSec': 45, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'actualQty': 600, 'plannedOperatorShiftHours': 8.5,
        'vendor': 'vOld', 'vendorName': 'Gone Vendor Ltd',
      });
      expect(k('entry0/vendor'), findsOneWidget);
      expect(find.text('Gone Vendor Ltd'), findsOneWidget);
    });

    test('the table column is optional and the page is flagged to use vendors', () {
      expect(spec.usesVendors, isTrue);
      expect(spec.referenceLists['vendors'], Endpoints.vendors);
      final cols = spec.columns({});
      expect([for (final c in cols.where(const SheetEnv(showVendor: false)).middle) c.key], isNot(contains('vendorName')));
      final shown = [for (final c in cols.where(const SheetEnv(showVendor: true)).middle) c.key];
      expect(shown.indexOf('vendorName'), shown.indexOf('itemName') + 1);
      expect(shown.indexOf('machineStatus'), shown.indexOf('vendorName') + 1);
    });
  });

  group('Planned Operator Shift from Process Master (reached through the worker\'s process)', () {
    testWidgets('a locked process fills the box, makes it read-only and says why; the section folds', (tester) async {
      final api = await openEditor(tester);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '8.00');
      expect(form(tester).plannedShifts.single!.hours, 8);
      expect(foldNote(tester, 'plannedShift'), 'Fixed — nothing to enter');
      await tester.ensureVisible(k('entry0/fold/plannedShift'));
      await tester.tap(k('entry0/fold/plannedShift'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.descendant(of: k('entry0/plannedOperatorShiftHours'), matching: find.byType(TextField))).enabled, isFalse);
      expect(find.textContaining('Fixed at 8:00 hr — locked in Process Master'), findsOneWidget);

      // The locked hours are what Save sends — nothing to type.
      await fillValid(tester, planned: null);
      expect(canSave(tester), isTrue);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(api.called('PUT', rowPath).single.body['plannedOperatorShiftHours'], 8);
    });

    testWidgets('switching to another worker of the process keeps the lock; an unlocked process leaves the box to the person', (tester) async {
      await openEditor(tester, processes: unlocked);
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '');
      // Open from the start (nothing is fixed, so it needs typing) and not read-only.
      expect(foldNote(tester, 'plannedShift'), isNot('Optional — tap to add'));
      expect(foldNote(tester, 'plannedShift'), isNot('Fixed — nothing to enter'));
      final field = tester.widget<TextField>(find.descendant(of: k('entry0/plannedOperatorShiftHours'), matching: find.byType(TextField)));
      expect(field.enabled, isTrue);
      expect(find.textContaining('Process Master'), findsNothing);
      expect(find.text('Type hours.minutes — 3.30 is 3 h 30 min.'), findsOneWidget);
    });

    testWidgets('editing keeps the shift the entry was saved with', (tester) async {
      await openEditor(tester, workerId: null, row: {
        '_id': 'e1', 'date': '2026-09-20', 'worker': 'w2', 'machine': 'w2', 'operator': 'Ravi', 'slot': 1,
        'item': 'i1', 'itemName': 'Panel', 'totalCycleSec': 45, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'actualQty': 600, 'plannedOperatorShiftHours': 9.5,
      });
      expect(form(tester).entries[0]['plannedOperatorShiftHours'], '9.30');
      expect(form(tester).plannedShifts.single!.fromEntry, isTrue);
      await tester.ensureVisible(k('entry0/fold/plannedShift'));
      await tester.tap(k('entry0/fold/plannedShift'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Kept as this entry was saved — set by Process Master'), findsOneWidget);
    });
  });

  group('over 100% check', () {
    testWidgets('the banner names the metric exactly as the web OeeCheck does', (tester) async {
      await openEditor(tester);
      await fillValid(tester);
      expect(k('entry0/oeeCheck'), findsNothing);
      form(tester).onChange(0, 'actualQty', '700'); // Ideal = 640
      await tester.pump();
      await tester.ensureVisible(k('entry0/oeeCheck'));
      expect(k('entry0/oeeCheck'), findsOneWidget);
      expect(
        find.text('Performance above 100% — this entry will still save, but goes to Admin review. Check the cycle time, quantities and stoppage.'),
        findsOneWidget,
      );
      expect(canSave(tester), isTrue, reason: 'above 100% is flagged, never blocked');
    });
  });

  group('Working Status and Reasons For Not Working', () {
    testWidgets('Non Working: the shared Status list (with Remarks) in the web\'s order; Working clears them', (tester) async {
      final api = await openEditor(tester);
      expect(k('entry0/machineStatus/No Manpower'), findsNothing, reason: 'Reasons are for Non Working only');
      await pickWorkingStatus(tester, 'Non Working');
      expect(find.text('Reasons For Not Working'), findsOneWidget);
      for (final st in ['Machine Breakdown', 'No Manpower', 'No Planning', 'Remarks']) {
        expect(k('entry0/machineStatus/$st'), findsOneWidget, reason: st);
      }
      expect(find.textContaining('no inspection that day, so nothing else is needed'), findsOneWidget);
      expect(find.text('Inspection (Qty), Types of Defect / Rework'), findsNothing);

      await tester.tap(k('entry0/machineStatus/No Planning'));
      await tester.pump();
      await tester.tap(k('entry0/machineStatus/Machine Breakdown'));
      await tester.pump();
      expect(form(tester).entries[0]['machineStatus'], ['Machine Breakdown', 'No Planning']);

      await tapSave(tester);
      await tester.pumpAndSettle();
      final put = Map<String, dynamic>.from(api.called('PUT', rowPath).single.body as Map);
      expect(put['workingMode'], 'Non Working');
      expect(put['machineStatus'], ['Machine Breakdown', 'No Planning']);
      expect(put['itemName'], '');
    });

    testWidgets('going back to Working drops the reasons', (tester) async {
      await openEditor(tester);
      await pickWorkingStatus(tester, 'Non Working');
      await tester.tap(k('entry0/machineStatus/No Manpower'));
      await tester.pump();
      expect(form(tester).entries[0]['machineStatus'], ['No Manpower']);
      await pickWorkingStatus(tester, 'Working');
      expect(form(tester).entries[0]['machineStatus'], <dynamic>[]);
      expect(k('entry0/machineStatus/No Manpower'), findsNothing);
      expect(find.text('Item Name, Vendor Name, Standard Inspection Time'), findsOneWidget);
    });

    testWidgets('"Remarks" opens the folded Remarks section and puts the cursor in it; it is not stored', (tester) async {
      await openEditor(tester);
      await pickWorkingStatus(tester, 'Non Working');
      expect(foldNote(tester, 'remarks'), 'Optional — tap to add');
      await tester.ensureVisible(k('entry0/machineStatus/Remarks'));
      await tester.tap(k('entry0/machineStatus/Remarks'));
      await tester.pumpAndSettle();
      expect(form(tester).entries[0]['machineStatus'], <dynamic>[]);
      expect(tester.widget<FilterChip>(k('entry0/machineStatus/Remarks')).selected, isTrue);
      expect(foldNote(tester, 'remarks'), isNot('Optional — tap to add'));
      expect(tester.widget<EditableText>(box('remarks')).focusNode.hasFocus, isTrue, reason: 'the cursor is in the Remarks box');
      // Text written there keeps the tick on.
      await tester.enterText(box('remarks'), 'power cut all day');
      await tester.pump();
      await tester.tap(k('entry0/machineStatus/Remarks'));
      await tester.pump();
      expect(tester.widget<FilterChip>(k('entry0/machineStatus/Remarks')).selected, isTrue);
    });
  });

  group('limit popups', () {
    testWidgets('Save with Idle Time + Other Activity past the working hours pops up why (in the worker\'s words), then moves to it', (tester) async {
      final api = await openEditor(tester);
      await fillValid(tester);
      final f = form(tester);
      f.onChange(0, 'machineOffTime', '09:00'); // 60 min of Inspection Working Hours
      f.onChange(0, 'plannedOperatorShiftHours', '8.00');
      f.onChange(0, 'otherActivityMin', '50');
      f.onChange(0, 'otherActivity', 'Packing');
      f.onChange(0, 'lunchMin', '30');
      await tester.pump();
      expect(canSave(tester), isFalse);
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(k('entry-notice'), findsOneWidget);
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(find.text("Stoppage happens within the Inspection Working Hours, so all of it together can't be more than 60 min."), findsOneWidget);
      expect(find.text('Worker'), findsOneWidget);
      expect(find.text('Asha'), findsWidgets);
      expect(find.text('Inspection Working Hours'), findsWidgets);
      expect(find.text('60 min'), findsWidgets);
      expect(tester.widget<Text>(k('entry-notice/value/Total stoppage')).data, '80 min');
      expect(find.text('Check the stoppage minutes, or the Start / End Time.'), findsOneWidget);
      expect(form(tester).focusTarget, isNull, reason: 'focus moves after the popup is closed');
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(form(tester).focusTarget!['field'], 'stoppageTotal');
      expect(api.called('PUT', rowPath), isEmpty);
    });

    testWidgets('Total Qty past Ideal never raises a popup (it goes to OEE Review); Save just moves to the first missing field', (tester) async {
      final api = await openEditor(tester, processes: unlocked);
      await fillValid(tester, planned: null);
      form(tester).onChange(0, 'actualQty', '9999'); // far past Ideal (640)
      await tester.pump();
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(k('entry-notice'), findsNothing);
      expect(form(tester).focusTarget!['field'], 'plannedOperatorShiftHours');
      expect(api.called('PUT', rowPath), isEmpty);
    });

    testWidgets('typing past the allowance raises the popup (not a toast); with no times yet it is the one-day toast', (tester) async {
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await openEditor(tester);
      await fillValid(tester);
      form(tester).onChange(0, 'machineOffTime', '09:00');
      await tester.pump();
      await tester.tap(k('entry0/fold/otherActivity'));
      await tester.pumpAndSettle();
      await tester.enterText(box('otherActivityMin'), '70');
      await tester.pump();
      await tester.pump();
      expect(k('entry-notice'), findsOneWidget);
      // 30 lunch + the 70 typed.
      expect(tester.widget<Text>(k('entry-notice/value/Total stoppage')).data, '100 min');
      expect(toasts, isEmpty);
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
    });

    testWidgets('the popup fits a 360 x 640 screen at text size 1.6', (tester) async {
      await openEditor(tester, size: const Size(360, 640), textScale: 1.6);
      await fillValid(tester);
      form(tester).onChange(0, 'machineOffTime', '09:00');
      form(tester).onChange(0, 'plannedOperatorShiftHours', '8.00');
      form(tester).onChange(0, 'otherActivityMin', '50');
      form(tester).onChange(0, 'otherActivity', 'Packing');
      await tester.pump();
      await tester.ensureVisible(saveBtn());
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(k('entry-notice'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(k('entry-notice/ok'), findsOneWidget);
      // The dialog scrolls at this size; OK is one scroll away and then fully on screen.
      await tester.ensureVisible(k('entry-notice/ok'));
      await tester.pumpAndSettle();
      final ok = tester.getRect(k('entry-notice/ok'));
      expect(ok.top, greaterThanOrEqualTo(0));
      final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
      expect(ok.bottom, lessThanOrEqualTo(screen.height));
      expect(ok.right, lessThanOrEqualTo(screen.width));
      await tester.tap(k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(k('entry-notice'), findsNothing);
    });
  });

  group('optional sections fold like the web FormLine', () {
    testWidgets('Other Activity, Idle Time and Remarks start folded ("Optional — tap to add"); an unlocked shift is open', (tester) async {
      await openEditor(tester, processes: unlocked);
      for (final id in ['otherActivity', 'idle', 'remarks']) {
        expect(foldNote(tester, id), 'Optional — tap to add', reason: id);
      }
      expect(foldNote(tester, 'plannedShift'), isNot('Optional — tap to add'));
      // The boxes of a folded section are still built (Save can point at them) but not shown.
      expect(box('otherActivityMin'), findsNothing);
    });

    testWidgets('tapping the header opens and folds it; typing marks it "Filled in"', (tester) async {
      await openEditor(tester);
      await tester.ensureVisible(k('entry0/fold/idle'));
      await tester.tap(k('entry0/fold/idle'));
      await tester.pumpAndSettle();
      expect(foldNote(tester, 'idle'), '');
      expect(box('otherMin'), findsOneWidget);
      await tester.enterText(box('otherMin'), '5');
      await tester.pump();
      expect(foldNote(tester, 'idle'), 'Filled in');
      await tester.tap(k('entry0/fold/idle'));
      await tester.pumpAndSettle();
      expect(foldNote(tester, 'idle'), 'Filled in');
      expect(box('otherMin'), findsNothing);
      expect(form(tester).entries[0]['otherMin'], '5', reason: 'folding loses nothing');
    });

    testWidgets('editing an entry opens the sections that hold something', (tester) async {
      await openEditor(tester, workerId: null, row: {
        '_id': 'e1', 'date': '2026-09-20', 'worker': 'w1', 'machine': 'w1', 'operator': 'Asha', 'slot': 1,
        'item': 'i1', 'itemName': 'Panel', 'totalCycleSec': 45, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'actualQty': 600, 'plannedOperatorShiftHours': 8.5, 'remarks': 'two panels re-done', 'otherActivity': 'Packing', 'otherActivityMin': 20,
      });
      expect(foldNote(tester, 'remarks'), 'Filled in');
      expect(foldNote(tester, 'otherActivity'), 'Filled in');
      expect(foldNote(tester, 'idle'), 'Optional — tap to add');
      expect(box('remarks'), findsOneWidget);
    });

    testWidgets('after Save a folded section with an error opens and says "Check this line"', (tester) async {
      await openEditor(tester, processes: unlocked);
      await fillValid(tester);
      form(tester).onChange(0, 'otherMin', '5'); // "Other" idle time without its remark
      await tester.pump();
      expect(foldNote(tester, 'idle'), 'Filled in');
      // Fold it again, then press Save: the error brings it back.
      await tester.ensureVisible(k('entry0/fold/idle'));
      await tester.tap(k('entry0/fold/idle'));
      await tester.pumpAndSettle();
      await tapSave(tester);
      await tester.pumpAndSettle();
      expect(find.text('Remark is required when Other idle time is entered'), findsOneWidget);
      expect(find.text('Check this line'), findsWidgets);
      expect(box('otherMinRemark'), findsOneWidget);
    });
  });

  group('the table and detail', () {
    final reviewed = <String, dynamic>{
      '_id': 'e1',
      'date': '2026-09-20',
      'machine': 'w1',
      'operator': 'Asha',
      'slot': 1,
      'itemName': 'Panel',
      'vendorName': 'Acme Coaters',
      'totalCycleSec': 45,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 700, // Ideal is 640 -> Performance above 100%
      'lessCoatingQty': 5,
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'workingMode': 'Working',
      'machineStatus': ['No Planning'],
      'review': {
        'status': 'pending',
        'flagged': [
          {'metric': 'performance', 'value': 1.1},
        ],
      },
    };

    FakeApi installList({List<Map<String, dynamic>>? rows, List<Map<String, dynamic>>? vendors}) {
      final api = FakeApi.install();
      api.list(Endpoints.machines, []);
      api.list(Endpoints.items, items);
      api.list(Endpoints.machineOperators, operators);
      api.list(Endpoints.processes, [p1]);
      api.list(Endpoints.companyHolidays, []);
      api.list('${Endpoints.v1}/vendors', vendors ?? vendorList);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', '$listPath/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', '$listPath/filter-options', (_) => {
            'isOk': true,
            'data': {'machine': ['w1'], 'operator': <String>[], 'item': ['Panel']},
          });
      api.on('GET', listPath, (_) => {
            'isOk': true,
            'data': rows ?? [reviewed, {...reviewed, '_id': 'e2', 'machine': 'w2', 'operator': 'Ravi', 'actualQty': 300, 'review': null, 'vendorName': ''}],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
          });
      return api;
    }

    Future<void> openList(WidgetTester tester) => pumpScreen(tester, const ProductionSheetScreen(spec: spec), size: const Size(2600, 900));

    testWidgets('over-100% figures are red, the review is a badge, the vendor column shows when the process has vendors', (tester) async {
      SharedPreferences.setMockInitialValues({});
      installList();
      await openList(tester);
      for (final key in ['itemName', 'vendorName', 'machineStatus', 'availability', 'performance', 'quality', 'review']) {
        expect(k('head-$key'), findsOneWidget, reason: key);
      }
      Color colorOf(String cell) => tester.widget<Text>(find.descendant(of: k(cell), matching: find.byType(Text)).first).style!.color!;
      final red = AppColors.readable(tester.element(k('e1:performance')), AppColors.critical);
      expect(colorOf('e1:performance'), red);
      expect(colorOf('e2:performance'), isNot(red), reason: 'within 100%');
      expect(find.descendant(of: k('e1:review'), matching: find.text('Pending review')), findsOneWidget);
      expect(k('pill-review-e1'), findsOneWidget);
      expect(find.descendant(of: k('e2:review'), matching: find.text('—')), findsOneWidget);
      expect(k('pill-review-e2'), findsNothing);
      expect(find.descendant(of: k('e1:machineStatus'), matching: find.text('Working — No Planning')), findsOneWidget);
      expect(find.descendant(of: k('e1:vendorName'), matching: find.text('Acme Coaters')), findsOneWidget);
    });

    testWidgets('the Vendor column stays hidden on a page whose process has no vendors and no entry names one', (tester) async {
      SharedPreferences.setMockInitialValues({});
      installList(vendors: const [], rows: [
        {...reviewed, 'vendorName': ''},
      ]);
      await openList(tester);
      expect(k('head-vendorName'), findsNothing);
      expect(k('head-itemName'), findsOneWidget);
      expect(k('head-review'), findsOneWidget);
    });

    testWidgets('an entry naming a vendor shows the column even with no vendors in Vendor Master', (tester) async {
      SharedPreferences.setMockInitialValues({});
      installList(vendors: const [], rows: [reviewed]);
      await openList(tester);
      expect(k('head-vendorName'), findsOneWidget);
    });

    testWidgets('the detail shows A / P / Q (red over 100%), the review with who and why, the status, and the vendor only when named', (tester) async {
      final row = {
        ...reviewed,
        'review': {
          'status': 'rejected',
          'flagged': [
            {'metric': 'performance', 'value': 1.1},
          ],
          'decidedBy': {'name': 'Meera'},
          'remark': 'recheck the cycle time',
        },
      };
      final calc = spec.rowCalc(row);
      final day = spec.dayCalc([row]).single;
      Future<void> pumpDetail(Json r) => pumpScreen(
            tester,
            Scaffold(
              body: SingleChildScrollView(
                child: EntryDetail(
                  spec: spec,
                  row: r,
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
          );
      await pumpDetail(row);
      for (final t in ['Availability (%)', 'Performance (%)', 'Quality (%)', 'OEE Review', 'Working Status', 'Vendor Name']) {
        expect(find.textContaining(t, findRichText: true), findsWidgets, reason: t);
      }
      expect(find.text('Rejected'), findsOneWidget);
      expect(k('detail-pill/OEE Review'), findsOneWidget);
      expect(find.text('Performance 110.00%'), findsOneWidget);
      expect(find.text('rejected by Meera'), findsOneWidget);
      expect(find.text('recheck the cycle time'), findsOneWidget);
      expect(find.text('Working — No Planning'), findsOneWidget);
      expect(find.text('Acme Coaters'), findsOneWidget);
      final perf = calc['performance'] as num;
      expect(perf, greaterThan(1));
      final ctx = tester.element(find.textContaining('Performance (%)', findRichText: true).first);
      final value = tester.widget<Text>(find.text('${(perf * 100).toStringAsFixed(2)}%').first);
      expect(value.style!.color, AppColors.readable(ctx, AppColors.critical));

      // No vendor named: the row is left out.
      await pumpDetail({...row, 'vendorName': ''});
      expect(find.text('Vendor Name'), findsNothing);
    });

    test('the web column order, with Vendor Name and Working Status after Item Name', () {
      final keys = [for (final c in spec.columns({}).middle) c.key];
      expect(keys.sublist(0, 4), ['itemName', 'vendorName', 'machineStatus', 'on']);
      expect(keys.sublist(keys.indexOf('unreported')), [
        'unreported',
        'availability',
        'performance',
        'quality',
        'productivity',
        'productivityLunch',
        'review',
        'remarks',
      ]);
    });

    test('the day card\'s headline chip is the worker\'s Productivity (this sheet has no machine OEE)', () {
      final day = spec.dayCalc([reviewed]).single;
      expect(day['oeeLosses'], day['productivity']);
      expect(day['productivity'], isNotNull);
    });
  });
}
