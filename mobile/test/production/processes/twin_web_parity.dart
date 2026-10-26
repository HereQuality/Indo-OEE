// Wave 2: Contact / Trobe / Spring match their web pages for vendors, Process
// Master's planned shift, over-100% + OEE review, Machine Working Status and the
// limit popups (shared pieces under features/production/{entry_form,shared,
// sheet/table}). One body, registered for each of the three specs.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/theme/app_colors.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_api.dart';
import '../sheet_list_test.dart' as list;

// m1: process p1 (planned shift locked at 8 h, no vendors)
// m2: process p3 (planned shift typed by hand; vendors v1 active, v2 inactive)
// m3: no process
final _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'MC 1', 'process': 'p1'},
  {'_id': 'm2', 'machineName': 'MC 2', 'process': 'p3'},
  {'_id': 'm3', 'machineName': 'MC 3'},
];
final _processes = <Map<String, dynamic>>[
  {'_id': 'p1', 'plannedShiftLocked': true, 'plannedShiftHours': 8},
  {'_id': 'p3', 'plannedShiftLocked': false},
];
final _vendors = <Map<String, dynamic>>[
  {'_id': 'v1', 'name': 'Acme Castings', 'isActive': true, 'processes': ['p3']},
  {'_id': 'v2', 'name': 'Retired Vendor', 'isActive': false, 'processes': ['p3']},
  {'_id': 'v9', 'name': 'Other Process Vendor', 'isActive': true, 'processes': ['p1x']},
];
final _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100', 'totalCycleSec': 60},
];
final _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
];

class _Launcher extends StatelessWidget {
  const _Launcher({required this.spec, this.row, this.vendors = const [], this.processes = const []});
  final ProcessSpec spec;
  final Map<String, dynamic>? row;
  final List<Map<String, dynamic>> vendors;
  final List<Map<String, dynamic>> processes;

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
                  processes: processes,
                  extra: {'vendors': vendors},
                ),
              ),
            ),
            child: const Text('Open editor'),
          ),
        ),
      );
}

/// A saved entry for [machine]: 08:00-16:00 on a 60 s part (Ideal 480), Actual
/// 400 = 390 OK + 10 Rejected (all Tool Mark).
Map<String, dynamic> _saved({String machine = 'm2', Map<String, dynamic> extra = const {}}) => {
      '_id': 'r1',
      'date': '2026-09-20',
      'machine': machine,
      'slot': 1,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'totalCycleSec': 60,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 400,
      'okQty': 390,
      'rejectedQty': 10,
      'rejectBreakdown': {'Tool Mark': 10},
      'plannedOperatorShiftHours': 9,
      'lunchMin': 30,
      ...extra,
    };

void registerTwinWebParity(ProcessSpec spec, {required String itemLabel}) {
  final rowPath = spec.api.row;
  final occupied = spec.api.occupied;

  Future<FakeApi> openEditor(
    WidgetTester tester, {
    Map<String, dynamic>? row,
    List<Map<String, dynamic>>? vendors,
    List<Map<String, dynamic>>? processes,
    Size size = const Size(390, 844),
    double textScale = 1,
  }) async {
    SharedPreferences.setMockInitialValues({});
    EntryNotices.reset();
    final api = FakeApi.install();
    api.on('PUT', rowPath, (r) => {'isOk': true, 'data': r.body});
    api.on('GET', occupied, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
    await pumpScreen(
      tester,
      ScaffoldMessenger(
        key: rootMessengerKey,
        child: _Launcher(spec: spec, row: row, vendors: vendors ?? _vendors, processes: processes ?? _processes),
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
  Finder box(String field) => find.descendant(of: k('entry0/$field'), matching: find.byType(TextField));

  Future<void> pickMachine(WidgetTester t, String id) async {
    form(t).onChange(0, 'machine', id);
    await t.pumpAndSettle();
    if (k('entry0/expand').evaluate().isNotEmpty) {
      await t.tap(k('entry0/expand'));
      await t.pumpAndSettle();
    }
  }

  Future<void> fillValid(WidgetTester t, {String machine = 'm2', String planned = '9'}) async {
    await pickMachine(t, machine);
    final f = form(t);
    f.onChange(0, 'operator', 'Ravi');
    f.onItemSelect(0, 'i1');
    f.onChange(0, 'machineOnTime', '08:00');
    f.onChange(0, 'machineOffTime', '16:00');
    f.onChange(0, 'actualQty', '400');
    f.onChange(0, 'okQty', '390');
    f.onRejectChange(0, 'Tool Mark', '10');
    f.onChange(0, 'plannedOperatorShiftHours', planned);
    f.onChange(0, 'lunchMin', '30');
    await t.pump();
  }

  Future<void> save(WidgetTester t) async {
    await t.tap(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton)));
    await t.pump();
  }

  group('${spec.key} web parity (wave 2)', () {
    setUp(() {
      EntryFormToast.reset();
      EntryNotices.reset();
    });

    test('the spec switches the four shared pieces on', () {
      expect(spec.usesVendors, isTrue);
      expect(spec.usesPlannedShiftSetting, isTrue);
      expect(spec.showLimitPopups, isTrue);
      expect(spec.referenceLists['vendors'], Endpoints.vendors);
      // Parts are scoped to the page's process (plus unassigned ones) like the web's scopedItems.
      expect(spec.scopeItemsToProcess, isTrue);
    });

    group('Vendor Name', () {
      testWidgets('shown only when the machine\'s process has active vendors; picking sends the id', (tester) async {
        final api = await openEditor(tester);
        await pickMachine(tester, 'm1');
        expect(k('entry0/vendor'), findsNothing);
        await pickMachine(tester, 'm3');
        expect(k('entry0/vendor'), findsNothing);

        await fillValid(tester);
        await tester.pumpAndSettle();
        expect(k('entry0/vendor'), findsOneWidget);
        expect(find.text('Vendor Name'), findsWidgets);
        await tester.ensureVisible(k('entry0/vendor'));
        await tester.tap(k('entry0/vendor'));
        await tester.pumpAndSettle();
        expect(find.text('Acme Castings'), findsOneWidget);
        expect(find.text('Retired Vendor'), findsNothing, reason: 'inactive vendors are not offered');
        expect(find.text('Other Process Vendor'), findsNothing, reason: 'only vendors ticked for the process');
        await tester.tap(find.text('Acme Castings'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['vendor'], 'v1');

        await save(tester);
        await tester.pumpAndSettle();
        final put = api.called('PUT', rowPath).single.body as Map;
        expect(put['vendor'], 'v1');
        expect(put.containsKey('vendorName'), isFalse, reason: 'the server derives it');
        expect(put['workingMode'], 'Working');
        expect(put['machineStatus'], <dynamic>[]);
      });

      testWidgets('an entry that names a vendor keeps showing it even with no vendors loaded', (tester) async {
        await openEditor(tester, vendors: const [], row: _saved(extra: {'vendor': 'vOld', 'vendorName': 'Gone Vendor Ltd'}));
        expect(k('entry0/vendor'), findsOneWidget);
        expect(find.text('Gone Vendor Ltd'), findsOneWidget);
      });
    });

    group('Planned Operator Shift from Process Master', () {
      testWidgets('a locked process fills the box, makes it read-only and says why', (tester) async {
        await openEditor(tester);
        await pickMachine(tester, 'm1');
        expect(form(tester).entries[0]['plannedOperatorShiftHours'], '8');
        await tester.ensureVisible(box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isFalse);
        expect(find.textContaining('Fixed at 8:00 hr — locked in Process Master'), findsOneWidget);
      });

      testWidgets('an unlocked process, or a machine in none, leaves the box to the person', (tester) async {
        await openEditor(tester);
        await pickMachine(tester, 'm2');
        expect(form(tester).entries[0]['plannedOperatorShiftHours'], '');
        await tester.ensureVisible(box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isTrue);
        expect(find.textContaining('Process Master'), findsNothing);
        await pickMachine(tester, 'm3');
        expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isTrue);
      });

      testWidgets('editing keeps the shift the entry was saved with', (tester) async {
        await openEditor(tester, row: _saved(machine: 'm1', extra: {'plannedOperatorShiftHours': 9.5}));
        expect(form(tester).entries[0]['plannedOperatorShiftHours'], '9.5');
        expect(form(tester).plannedShifts.single!.fromEntry, isTrue);
        await tester.ensureVisible(box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(box('plannedOperatorShiftHours')).enabled, isFalse);
        expect(find.textContaining('Kept as this entry was saved'), findsOneWidget);
      });
    });

    group('Machine Working Status', () {
      testWidgets('Non Working: Status chips incl. Remarks, only Date + Machine needed, payload carries the status', (tester) async {
        final api = await openEditor(tester);
        await pickMachine(tester, 'm2');
        expect(find.text('Machine Working Status'), findsOneWidget);
        expect(k('entry0/machineStatus/No Manpower'), findsNothing, reason: 'Status is for Non Working only');

        await tester.ensureVisible(k('entry0/workingMode/Non Working'));
        await tester.tap(k('entry0/workingMode/Non Working'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['workingMode'], 'Non Working');
        for (final st in ['Machine Breakdown', 'No Manpower', 'No Planning', 'Remarks']) {
          expect(k('entry0/machineStatus/$st'), findsOneWidget, reason: st);
        }
        expect(find.text('Production Master', skipOffstage: false), findsNothing);
        expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
        expect(find.text('Remarks', skipOffstage: false), findsWidgets, reason: 'the Remarks card stays');
        expect(find.textContaining('the machine did not run', skipOffstage: false), findsOneWidget);

        await tester.tap(k('entry0/machineStatus/No Planning'));
        await tester.pumpAndSettle();
        await tester.tap(k('entry0/machineStatus/Machine Breakdown'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['machineStatus'], ['Machine Breakdown', 'No Planning']);

        form(tester).onChange(0, 'date', '2026-09-20');
        await tester.pump();
        await save(tester);
        await tester.pumpAndSettle();
        final put = api.called('PUT', rowPath).single.body as Map;
        expect(put['workingMode'], 'Non Working');
        expect(put['machineStatus'], ['Machine Breakdown', 'No Planning']);
        expect(put['operator'], '', reason: 'Operator is optional on a Non Working day');
        expect(put['item'], isNull);
        expect(put['okQty'], '');
        expect(put['actualQty'], '');
        expect(put['rejectBreakdown'], <String, dynamic>{});
        expect(put.containsKey('rejectedQty'), isFalse);
      });

      testWidgets('going back to Working drops the Status', (tester) async {
        await openEditor(tester);
        await pickMachine(tester, 'm2');
        await tester.tap(k('entry0/workingMode/Non Working'));
        await tester.pumpAndSettle();
        await tester.tap(k('entry0/machineStatus/No Manpower'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['machineStatus'], ['No Manpower']);
        await tester.tap(k('entry0/workingMode/Working'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['machineStatus'], <dynamic>[]);
        expect(k('entry0/machineStatus/No Manpower'), findsNothing);
      });

      testWidgets('the "Remarks" tick opens the Remarks box and is not stored as a status', (tester) async {
        await openEditor(tester);
        await pickMachine(tester, 'm2');
        await tester.tap(k('entry0/workingMode/Non Working'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(k('entry0/machineStatus/Remarks'));
        await tester.tap(k('entry0/machineStatus/Remarks'));
        await tester.pumpAndSettle();
        expect(form(tester).entries[0]['machineStatus'], <dynamic>[]);
        expect(tester.widget<FilterChip>(k('entry0/machineStatus/Remarks')).selected, isTrue);
        expect(tester.widget<TextField>(box('remarks')).focusNode!.hasFocus, isTrue);
        await tester.enterText(box('remarks'), 'power cut all day');
        await tester.pump();
        await tester.tap(k('entry0/machineStatus/Remarks'));
        await tester.pump();
        expect(tester.widget<FilterChip>(k('entry0/machineStatus/Remarks')).selected, isTrue);
      });
    });

    group('over 100% check', () {
      testWidgets('the banner appears when Availability goes above 100% and names the metric', (tester) async {
        await openEditor(tester);
        await fillValid(tester, planned: '9');
        await tester.pumpAndSettle();
        expect(k('entry0/oeeCheck'), findsNothing);
        form(tester).onChange(0, 'plannedOperatorShiftHours', '7');
        await tester.pump();
        await tester.ensureVisible(k('entry0/oeeCheck'));
        expect(k('entry0/oeeCheck'), findsOneWidget);
        expect(find.textContaining('Availability'), findsWidgets);
        expect(find.textContaining('above 100% — this entry will still save, but goes to Admin review'), findsOneWidget);
      });
    });

    group('limit popups', () {
      testWidgets('typing Actual past Ideal raises the popup (Actual Quantity against Ideal); one dialog however many keys', (tester) async {
        final toasts = <String>[];
        EntryFormToast.sink = toasts.add;
        await openEditor(tester);
        await fillValid(tester);
        form(tester).onChange(0, 'actualQty', '');
        await tester.pumpAndSettle();
        await tester.ensureVisible(box('actualQty'));
        await tester.enterText(box('actualQty'), '500'); // Ideal is 480
        await tester.pump();
        await tester.pump();
        expect(k('entry-notice'), findsOneWidget);
        expect(find.text("Can't add this much quantity"), findsOneWidget);
        expect(find.textContaining('this machine can make at most 480 pieces'), findsOneWidget);
        expect(find.text('8:00 hr'), findsOneWidget);
        expect(find.text('60 sec'), findsOneWidget);
        expect(tester.widget<Text>(k('entry-notice/value/Actual Quantity')).data, '500');
        expect(toasts, isEmpty, reason: 'popup instead of a toast');
        await tester.tap(k('entry-notice/ok'));
        await tester.pumpAndSettle();
        expect(k('entry-notice'), findsNothing);
        expect(form(tester).entries[0]['actualQty'], isNot('500'), reason: 'the box refused the keystroke');
      });

      testWidgets('OK past Actual is refused with a toast; Rejected is Actual − OK; a reason box takes only what is left', (tester) async {
        final toasts = <String>[];
        EntryFormToast.sink = toasts.add;
        await openEditor(tester);
        await fillValid(tester); // Actual 400, OK 390, 10 Tool Mark
        await tester.pumpAndSettle();
        await tester.ensureVisible(box('okQty'));
        await tester.enterText(box('okQty'), '401');
        await tester.pump();
        expect(toasts.any((t) => t.contains("OK Quantity can't be more than Actual Quantity (400)")), isTrue);
        expect(form(tester).entries[0]['okQty'], '390');
        expect(find.descendant(of: k('entry0/calc/rejectedQty'), matching: find.text('10')), findsOneWidget);
        expect(spec.metrics(form(tester).entries[0]).rejected, 10);
        // 10 rejected, all given to Tool Mark: nothing left for another reason.
        final broken = find.descendant(of: k('entry0/reject/Broken'), matching: find.byType(TextField));
        await tester.ensureVisible(broken);
        await tester.enterText(broken, '1');
        await tester.pump();
        expect(toasts.any((t) => t.contains('Only 0 of the 10 rejected pieces are left')), isTrue);
        expect(find.textContaining('Split so far: '), findsOneWidget);
      });

      testWidgets('typing a downtime past the Machine Shift allowance raises the stoppage popup', (tester) async {
        await openEditor(tester);
        await fillValid(tester); // stoppage happens within the 480 min Machine Shift; Lunch uses 30
        await tester.pumpAndSettle();
        await tester.ensureVisible(box('setupMin'));
        await tester.enterText(box('setupMin'), '500');
        await tester.pump();
        await tester.pump();
        expect(find.text("Can't add this much stoppage"), findsOneWidget);
        expect(tester.widget<Text>(k('entry-notice/value/Total stoppage')).data, '530 min');
        expect(find.text('480 min'), findsWidgets);
        await tester.tap(k('entry-notice/ok'));
        await tester.pumpAndSettle();
      });

      testWidgets('Save with an over-limit quantity pops why, then moves to the field (nothing is sent)', (tester) async {
        final api = await openEditor(tester);
        await fillValid(tester);
        form(tester).onChange(0, 'actualQty', '550'); // > Ideal 480, set programmatically
        form(tester).onChange(0, 'okQty', '450');
        await tester.pump();
        await save(tester);
        await tester.pumpAndSettle();
        expect(k('entry-notice'), findsOneWidget);
        expect(tester.widget<Text>(k('entry-notice/value/Actual Quantity')).data, '550');
        expect(form(tester).focusTarget, isNull, reason: 'focus moves after the popup is closed');
        await tester.tap(k('entry-notice/ok'));
        await tester.pumpAndSettle();
        expect(form(tester).focusTarget!['field'], 'actualQty');
        expect(api.called('PUT', rowPath), isEmpty);
      });

      testWidgets('the popups fit a 360x640 phone at text scale 1.6 (no overflow)', (tester) async {
        await openEditor(tester, size: const Size(360, 640), textScale: 1.6);
        await fillValid(tester);
        form(tester).onChange(0, 'actualQty', '');
        await tester.pumpAndSettle();
        await tester.ensureVisible(box('actualQty'));
        await tester.enterText(box('actualQty'), '500');
        await tester.pump();
        await tester.pump();
        expect(k('entry-notice'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(k('entry-notice/ok'));
        await tester.tap(k('entry-notice/ok'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(box('setupMin'));
        await tester.enterText(box('setupMin'), '500');
        await tester.pump();
        await tester.pump();
        expect(find.text("Can't add this much stoppage"), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(k('entry-notice/ok'));
        await tester.tap(k('entry-notice/ok'));
        await tester.pumpAndSettle();
      });
    });

    group('table, detail', () {
      final reviewedExtra = <String, dynamic>{
        'plannedOperatorShiftHours': 7, // a 7 h plan against an 8 h run -> Availability above 100%
        'workingMode': 'Working',
        'machineStatus': ['No Planning'],
        'vendorName': 'Acme Castings',
        'review': {
          'status': 'pending',
          'flagged': [
            {'metric': 'availability', 'value': 1.23},
          ],
        },
      };
      Map<String, dynamic> tableRow(String id, {Map<String, dynamic> extra = const {}, String machine = 'm1'}) => {
            ..._saved(machine: machine, extra: {'workingStatus': 'PRESENT', ...extra}),
            '_id': id,
            'date': '${list.today}T00:00:00.000Z',
            'slot': id == 'r1' ? 1 : 2,
          };

      FakeApi installList(List<Map<String, dynamic>> rows) {
        final api = FakeApi.install();
        api.on('GET', spec.api.list, (r) => {
              'isOk': true,
              'data': rows,
              'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
            });
        api.list(Endpoints.machines, [
          {'_id': 'm1', 'machineName': '7A'},
          {'_id': 'm2', 'machineName': '7B'},
        ]);
        api.list(Endpoints.items, [
          {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100'},
        ]);
        api.list(Endpoints.machineOperators, [
          {'_id': 'o1', 'name': 'Ravi'},
        ]);
        api.list(Endpoints.processes, []);
        api.list(Endpoints.vendors, []);
        api.list(Endpoints.companyHolidays, []);
        api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
        api.on('GET', spec.api.extent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': list.today}});
        api.on('GET', spec.api.filterOptions, (_) => {
              'isOk': true,
              'data': {'machine': ['m1', 'm2'], 'operator': ['Ravi'], 'item': ['Bracket']},
            });
        return api;
      }

      Future<void> openList(WidgetTester tester) => pumpScreen(tester, ProductionSheetScreen(spec: spec), size: const Size(2600, 900));

      testWidgets('an over-100% figure is red, OEE Review is a pill, status and vendor columns read', (tester) async {
        SharedPreferences.setMockInitialValues({});
        installList([tableRow('r1', extra: reviewedExtra), tableRow('r2', machine: 'm2', extra: {'plannedOperatorShiftHours': 9})]);
        await openList(tester);
        for (final key in ['machineStatus', 'vendorName', 'availability', 'performance', 'quality', 'review']) {
          expect(list.byKey('head-$key'), findsOneWidget, reason: key);
        }
        Color colorOf(String cell) =>
            tester.widget<Text>(find.descendant(of: list.byKey(cell), matching: find.byType(Text)).first).style!.color!;
        final red = AppColors.readable(tester.element(list.byKey('r1:availability')), AppColors.critical);
        expect(colorOf('r1:availability'), red);
        expect(colorOf('r2:availability'), isNot(red));
        expect(find.descendant(of: list.byKey('r1:review'), matching: find.text('Pending review')), findsOneWidget);
        expect(list.byKey('pill-review-r1'), findsOneWidget);
        expect(find.descendant(of: list.byKey('r2:review'), matching: find.text('—')), findsOneWidget);
        expect(list.byKey('pill-review-r2'), findsNothing);
        expect(find.descendant(of: list.byKey('r1:machineStatus'), matching: find.text('Working — No Planning')), findsOneWidget);
        expect(find.descendant(of: list.byKey('r2:machineStatus'), matching: find.text('Working')), findsOneWidget);
        expect(find.descendant(of: list.byKey('r1:vendorName'), matching: find.text('Acme Castings')), findsOneWidget);
        // The column set per the web: Contact only has Working Status.
        expect(list.byKey('head-workingStatus'), spec.key == 'contact' ? findsOneWidget : findsNothing);
      });

      testWidgets('the Vendor Name column stays hidden on a page with no vendors', (tester) async {
        SharedPreferences.setMockInitialValues({});
        installList([tableRow('r1')]);
        await openList(tester);
        expect(list.byKey('head-vendorName'), findsNothing);
        expect(list.byKey('head-review'), findsOneWidget);
      });

      test('the Vendor column hides unless vendors are in play; A / P / Q and review carry the red / pill styles', () {
        final cols = spec.columns({});
        expect([for (final c in cols.where(const SheetEnv(showVendor: false)).middle) c.key], isNot(contains('vendorName')));
        expect([for (final c in cols.where(const SheetEnv(showVendor: true)).middle) c.key], contains('vendorName'));
        final keys = [for (final c in cols.middle) c.key];
        expect(keys.indexOf('vendorName'), keys.indexOf('itemName') + 1);
        final r = {..._saved(), ...reviewedExtra};
        final cd = CellData(row: r, calc: spec.rowCalc(r), day: spec.dayCalc([r]).first, machineName: '7A');
        CellStyle? styleOf(String key) => cols.middle.firstWhere((c) => c.key == key).style?.call(cd);
        expect(styleOf('availability'), CellStyle.danger);
        expect(styleOf('review'), const CellStyle(mark: CellMark.warn, pill: true, bold: true));
        final fine = {..._saved(), 'plannedOperatorShiftHours': 9};
        final cd2 = CellData(row: fine, calc: spec.rowCalc(fine), day: spec.dayCalc([fine]).first, machineName: '7A');
        expect(cols.middle.firstWhere((c) => c.key == 'availability').style?.call(cd2), isNull);
        expect(cols.middle.firstWhere((c) => c.key == 'review').style?.call(cd2), isNull);
      });

      testWidgets('the detail shows A / P / Q (red over 100%), the review state and who/why, status and vendor', (tester) async {
        final r = {
          ..._saved(),
          ...reviewedExtra,
          'review': {
            'status': 'rejected',
            'flagged': [{'metric': 'availability', 'value': 1.23}],
            'decidedBy': {'name': 'Asha'},
            'remark': 'recheck the cycle time',
          },
        };
        final calc = spec.rowCalc(r);
        await pumpScreen(
          tester,
          Scaffold(
            body: SingleChildScrollView(
              child: EntryDetail(
                spec: spec,
                row: r,
                calc: calc,
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
        for (final t in ['Availability (%)', 'Performance (%)', 'Quality (%)', 'OEE Review', 'Machine Working Status', 'Vendor Name', itemLabel]) {
          expect(find.textContaining(t, findRichText: true), findsWidgets, reason: t);
        }
        expect(find.text('Rejected'), findsOneWidget);
        expect(find.byKey(const ValueKey('detail-pill/OEE Review')), findsOneWidget);
        expect(find.text('Availability 123.00%'), findsOneWidget);
        expect(find.text('rejected by Asha'), findsOneWidget);
        expect(find.text('recheck the cycle time'), findsOneWidget);
        expect(find.text('Working — No Planning'), findsOneWidget);
        expect(find.text('Acme Castings'), findsOneWidget);
        final over = calc['availability'] as num;
        expect(over, greaterThan(1));
        final ctx = tester.element(find.textContaining('Availability (%)', findRichText: true).first);
        final valueText = tester.widget<Text>(find.text('${(over * 100).toStringAsFixed(2)}%').first);
        expect(valueText.style!.color, AppColors.readable(ctx, AppColors.critical));
      });
    });
  });
}
