// Wave 2: the VMC Data Entry form / editor / table / detail match the web VMC page
// (VmcDataEntry.jsx, VmcEntryForm.jsx, vmcColumns.jsx) for vendors, Process
// Master's planned shift, over-100% + OEE review, Machine Working Status and the
// limit popups — through the shared pieces under features/production/.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/theme/app_colors.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/processes/vmc/vmc_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_action_bar.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';
import '../../sheet_list_test.dart' as list;

final _rowPath = vmcSpec.api.row;
final _occupied = vmcSpec.api.occupied;

// m1: process p1 (planned shift locked at 8 h, no vendors)
// m2: process p3 (planned shift typed by hand; vendors v1 active, v2 inactive)
// m3: no process
final _machines = <Map<String, dynamic>>[
  {'_id': 'm1', 'machineName': 'VMC 1', 'process': 'p1'},
  {'_id': 'm2', 'machineName': 'VMC 2', 'process': 'p3'},
  {'_id': 'm3', 'machineName': 'VMC 3'},
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
// 6 min per program of 2 pieces = 180 s a piece; an 8 h shift makes 160.
final _items = <Map<String, dynamic>>[
  {'_id': 'i1', 'itemName': 'Housing', 'drawingNo': 'D-100', 'programTimeMin': 6, 'pcsPerProgram': 2},
];
final _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
];

class _Launcher extends StatelessWidget {
  const _Launcher({this.row, this.vendors = const [], this.processes = const []});
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
                  spec: vmcSpec,
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

Future<FakeApi> _openEditor(
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
  api.on('PUT', _rowPath, (r) => {'isOk': true, 'data': r.body});
  api.on('GET', _occupied, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(row: row, vendors: vendors ?? _vendors, processes: processes ?? _processes),
    ),
    size: size,
    textScale: textScale,
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}

ProductionEntryForm _form(WidgetTester t) => t.widget<ProductionEntryForm>(find.byType(ProductionEntryForm));
Finder _k(String key) => find.byKey(ValueKey(key));
Finder _box(String field) => find.descendant(of: _k('entry0/$field'), matching: find.byType(TextField));
Future<void> _pickMachine(WidgetTester t, String id) async {
  _form(t).onChange(0, 'machine', id);
  await t.pumpAndSettle();
  if (_k('entry0/expand').evaluate().isNotEmpty) {
    await t.tap(_k('entry0/expand'));
    await t.pumpAndSettle();
  }
}

Future<void> _fillValid(WidgetTester t, {String machine = 'm2', String planned = '9'}) async {
  await _pickMachine(t, machine);
  final f = _form(t);
  f.onChange(0, 'operator', 'Ravi');
  f.onItemSelect(0, 'i1');
  f.onChange(0, 'machineOnTime', '08:00');
  f.onChange(0, 'machineOffTime', '16:00');
  f.onChange(0, 'okQty', '100');
  f.onChange(0, 'rejectedQty', '5');
  f.onChange(0, 'plannedOperatorShiftHours', planned);
  f.onChange(0, 'lunchMin', '30');
  await t.pump();
}

Future<void> _save(WidgetTester t) async {
  await t.tap(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton)));
  await t.pump();
}

void main() {
  setUp(() {
    EntryFormToast.reset();
    EntryNotices.reset();
  });

  group('Vendor Name', () {
    testWidgets('shown only when the machine\'s process has active vendors; picking sends the id', (tester) async {
      final api = await _openEditor(tester);
      await _pickMachine(tester, 'm1');
      expect(_k('entry0/vendor'), findsNothing);
      await _pickMachine(tester, 'm3');
      expect(_k('entry0/vendor'), findsNothing);

      await _fillValid(tester);
      await tester.pumpAndSettle();
      expect(_k('entry0/vendor'), findsOneWidget);
      await tester.ensureVisible(_k('entry0/vendor'));
      await tester.tap(_k('entry0/vendor'));
      await tester.pumpAndSettle();
      expect(find.text('Acme Castings'), findsOneWidget);
      expect(find.text('Retired Vendor'), findsNothing, reason: 'inactive vendors are not offered');
      expect(find.text('Other Process Vendor'), findsNothing, reason: 'only vendors ticked for the process');
      await tester.tap(find.text('Acme Castings'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['vendor'], 'v1');

      await _save(tester);
      await tester.pumpAndSettle();
      final put = api.called('PUT', _rowPath).single.body as Map;
      expect(put['vendor'], 'v1');
      expect(put.containsKey('vendorName'), isFalse, reason: 'the server derives the name');
      expect(put['workingMode'], 'Working');
      expect(put['machineStatus'], <dynamic>[]);
    });

    testWidgets('an entry that names a vendor keeps showing it even with no vendors loaded', (tester) async {
      await _openEditor(tester, vendors: const [], row: {
        '_id': 'r1', 'date': '2026-09-20', 'machine': 'm2', 'slot': 1, 'item': 'i1', 'operator': 'Ravi',
        'itemName': 'Housing', 'programTimeMin': 6, 'pcsPerProgram': 2, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'okQty': 150, 'rejectedQty': 5, 'plannedOperatorShiftHours': 9,
        'vendor': 'vOld', 'vendorName': 'Gone Vendor Ltd',
      });
      expect(_k('entry0/vendor'), findsOneWidget);
      expect(find.text('Gone Vendor Ltd'), findsOneWidget);
    });
  });

  group('Planned Operator Shift from Process Master', () {
    testWidgets('a locked process fills the box, makes it read-only and says why', (tester) async {
      await _openEditor(tester);
      await _pickMachine(tester, 'm1');
      expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '8.00');
      await tester.ensureVisible(_box('plannedOperatorShiftHours'));
      expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isFalse);
      expect(find.textContaining('Fixed at 8:00 hr — locked in Process Master'), findsOneWidget);
    });

    testWidgets('an unlocked process, or a machine in none, leaves the box to the person', (tester) async {
      await _openEditor(tester);
      await _pickMachine(tester, 'm2');
      expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '');
      await tester.ensureVisible(_box('plannedOperatorShiftHours'));
      expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isTrue);
      await _pickMachine(tester, 'm3');
      expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isTrue);
    });

    testWidgets('editing keeps the shift the entry was saved with', (tester) async {
      await _openEditor(tester, row: {
        '_id': 'r1', 'date': '2026-09-20', 'machine': 'm1', 'slot': 1, 'item': 'i1', 'operator': 'Ravi',
        'itemName': 'Housing', 'programTimeMin': 6, 'pcsPerProgram': 2, 'machineOnTime': '08:00', 'machineOffTime': '16:00',
        'okQty': 150, 'rejectedQty': 5, 'plannedOperatorShiftHours': 9.5,
      });
      expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '9.30');
      await tester.ensureVisible(_box('plannedOperatorShiftHours'));
      expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isFalse);
      expect(find.textContaining('Kept as this entry was saved'), findsOneWidget);
    });
  });

  group('Machine Working Status (shared widget)', () {
    testWidgets('Non Working hides the production cards, shows Status chips and Save needs only Date + Machine', (tester) async {
      final api = await _openEditor(tester);
      await _pickMachine(tester, 'm2');
      expect(find.text('Part, Product Cycle Time'), findsOneWidget);
      expect(_k('entry0/machineStatus/No Manpower'), findsNothing, reason: 'Status is for Non Working only');

      await tester.ensureVisible(_k('entry0/workingMode/Non Working'));
      await tester.tap(_k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['workingMode'], 'Non Working');
      for (final st in ['Machine Breakdown', 'No Manpower', 'No Planning', 'Remarks']) {
        expect(_k('entry0/machineStatus/$st'), findsOneWidget, reason: st);
      }
      expect(find.text('Part, Product Cycle Time', skipOffstage: false), findsNothing);
      expect(find.text('Production (Qty)', skipOffstage: false), findsNothing);
      expect(find.textContaining('the machine did not run', skipOffstage: false), findsOneWidget);

      await tester.tap(_k('entry0/machineStatus/No Planning'));
      await tester.pumpAndSettle();
      await tester.tap(_k('entry0/machineStatus/Machine Breakdown'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['machineStatus'], ['Machine Breakdown', 'No Planning']);

      _form(tester).onChange(0, 'date', '2026-09-20');
      await tester.pump();
      await _save(tester);
      await tester.pumpAndSettle();
      final put = api.called('PUT', _rowPath).single.body as Map;
      expect(put['workingMode'], 'Non Working');
      expect(put['machineStatus'], ['Machine Breakdown', 'No Planning']);
      expect(put['operator'], '', reason: 'Operator is optional on a Non Working day');
    });

    testWidgets('going back to Working drops the Status', (tester) async {
      await _openEditor(tester);
      await _pickMachine(tester, 'm2');
      await tester.tap(_k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      await tester.tap(_k('entry0/machineStatus/No Manpower'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['machineStatus'], ['No Manpower']);
      await tester.tap(_k('entry0/workingMode/Working'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['machineStatus'], <dynamic>[]);
      expect(_k('entry0/machineStatus/No Manpower'), findsNothing);
    });

    testWidgets('the "Remarks" tick opens the Remarks box and is not stored as a status', (tester) async {
      await _openEditor(tester);
      await _pickMachine(tester, 'm2');
      await tester.tap(_k('entry0/workingMode/Non Working'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(_k('entry0/machineStatus/Remarks'));
      await tester.tap(_k('entry0/machineStatus/Remarks'));
      await tester.pumpAndSettle();
      expect(_form(tester).entries[0]['machineStatus'], <dynamic>[]);
      expect(tester.widget<FilterChip>(_k('entry0/machineStatus/Remarks')).selected, isTrue);
      expect(tester.widget<TextField>(_box('remarks')).focusNode!.hasFocus, isTrue);
      await tester.enterText(_box('remarks'), 'power cut all day');
      await tester.pump();
      await tester.tap(_k('entry0/machineStatus/Remarks'));
      await tester.pump();
      expect(tester.widget<FilterChip>(_k('entry0/machineStatus/Remarks')).selected, isTrue, reason: 'text keeps the tick on');
    });
  });

  group('over 100% check', () {
    testWidgets('the banner appears when Availability goes above 100% and names the metric', (tester) async {
      await _openEditor(tester);
      await _fillValid(tester, planned: '9');
      await tester.pumpAndSettle();
      expect(_k('entry0/oeeCheck'), findsNothing);
      // A 7 h plan against an 8 h run: Availability = 450 / (420 - 30) > 100%.
      _form(tester).onChange(0, 'plannedOperatorShiftHours', '7');
      await tester.pump();
      await tester.ensureVisible(_k('entry0/oeeCheck'));
      expect(_k('entry0/oeeCheck'), findsOneWidget);
      expect(find.textContaining('Availability'), findsWidgets);
      expect(find.textContaining('above 100% — this entry will still save, but goes to Admin review'), findsOneWidget);
    });
  });

  group('limit popups', () {
    testWidgets('typing OK past Ideal raises the popup with the figures (typed + Rejected); one dialog however many keys', (tester) async {
      final toasts = <String>[];
      EntryFormToast.sink = toasts.add;
      await _openEditor(tester);
      await _fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(_box('okQty'));
      await tester.enterText(_box('okQty'), '170'); // Ideal = 160, Rejected 5 -> room 155
      await tester.pump();
      await tester.pump();
      expect(_k('entry-notice'), findsOneWidget);
      expect(find.text("Can't add this much quantity"), findsOneWidget);
      expect(find.textContaining('this machine can make at most 160 pieces'), findsOneWidget);
      expect(find.text('8:00 hr'), findsOneWidget);
      expect(find.text('180 sec'), findsOneWidget);
      expect(tester.widget<Text>(_k('entry-notice/value/OK + Rejected')).data, '175');
      expect(toasts, isEmpty, reason: 'popup instead of a toast');
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(_k('entry-notice'), findsNothing);
      expect(_form(tester).entries[0]['okQty'], '100', reason: 'the box refused the keystroke');
    });

    testWidgets('typing Rejected past what OK leaves counts the other box too', (tester) async {
      await _openEditor(tester);
      await _fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(_box('rejectedQty'));
      await tester.enterText(_box('rejectedQty'), '70'); // 100 + 70 = 170 > 160
      await tester.pump();
      await tester.pump();
      expect(tester.widget<Text>(_k('entry-notice/value/OK + Rejected')).data, '170');
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
    });

    testWidgets('typing a downtime past the Machine Shift raises the stoppage popup', (tester) async {
      await _openEditor(tester);
      await _fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(_box('setupMin'));
      await tester.enterText(_box('setupMin'), '500'); // Machine Shift is 480 min, Lunch 30
      await tester.pump();
      await tester.pump();
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      expect(tester.widget<Text>(_k('entry-notice/value/Total stoppage')).data, '530 min');
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
    });

    testWidgets('typing Lunch / Rest past the Machine Shift raises the stoppage popup too (web: minutesBox)', (tester) async {
      await _openEditor(tester);
      await _fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(_box('lunchMin'));
      await tester.enterText(_box('lunchMin'), '500');
      await tester.pump();
      await tester.pump();
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
    });

    testWidgets('Save with an over-limit quantity pops why, then moves to the field (nothing is sent)', (tester) async {
      final api = await _openEditor(tester);
      await _fillValid(tester);
      _form(tester).onChange(0, 'okQty', '170'); // set programmatically, past Ideal 160
      await tester.pump();
      await _save(tester);
      await tester.pumpAndSettle();
      expect(_k('entry-notice'), findsOneWidget);
      expect(tester.widget<Text>(_k('entry-notice/value/OK + Rejected')).data, '175');
      expect(_form(tester).focusTarget, isNull, reason: 'focus moves after the popup is closed');
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(_form(tester).focusTarget!['field'], 'okQty');
      expect(api.called('PUT', _rowPath), isEmpty);
    });

    testWidgets('Save with over-limit stoppage pops the stoppage notice', (tester) async {
      final api = await _openEditor(tester);
      await _fillValid(tester);
      _form(tester).onChange(0, 'setupMin', '500');
      await tester.pump();
      await _save(tester);
      await tester.pumpAndSettle();
      expect(find.text("Can't add this much stoppage"), findsOneWidget);
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(_form(tester).focusTarget!['field'], 'stoppageTotal');
      expect(api.called('PUT', _rowPath), isEmpty);
    });

    testWidgets('the popup fits a 360x640 phone at text scale 1.6', (tester) async {
      await _openEditor(tester, size: const Size(360, 640), textScale: 1.6);
      await _fillValid(tester);
      await tester.pumpAndSettle();
      await tester.ensureVisible(_box('okQty'));
      await tester.enterText(_box('okQty'), '170');
      await tester.pump();
      await tester.pump();
      expect(_k('entry-notice'), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'no overflow');
      final dialog = tester.getRect(_k('entry-notice'));
      expect(dialog.bottom, lessThanOrEqualTo(640));
      expect(dialog.right, lessThanOrEqualTo(360));
      // The dialog scrolls inside itself: the OK button is one scroll away.
      await tester.ensureVisible(_k('entry-notice/ok'));
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.tap(_k('entry-notice/ok'));
      await tester.pumpAndSettle();
      expect(_k('entry-notice'), findsNothing);
    });
  });

  group('table, detail', () {
    Map<String, dynamic> vmcRow(String id, {String machine = 'm1', String operator = 'Ravi', Map<String, dynamic> extra = const {}}) =>
        list.row(id, machine: machine, operator: operator, extra: {
          'programTimeMin': 6,
          'pcsPerProgram': 2,
          'okQty': 150,
          'rejectedQty': 5,
          ...extra,
        });
    final reviewed = vmcRow('r1', extra: {
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
    });

    testWidgets('columns: Machine Working Status, Vendor, A / P / Q and OEE Review in the web order', (tester) async {
      final cols = vmcSpec.columns({});
      final keys = [for (final c in cols.middle) c.key];
      expect(keys.indexOf('machineStatus'), keys.indexOf('operator') + 1);
      expect(keys.indexOf('vendorName'), keys.indexOf('itemName') + 1);
      expect(keys.indexOf('drawingNo'), keys.indexOf('vendorName') + 1);
      expect(keys.sublist(keys.indexOf('drawingNo'), keys.indexOf('on')), ['drawingNo', 'programTimeMin', 'pcsPerProgram', 'cycle']);
      expect(keys.sublist(keys.indexOf('setupEff') + 1, keys.indexOf('oeeLosses')), ['availability', 'performance', 'quality']);
      expect(keys.sublist(keys.indexOf('oeeLunchCot') + 1), ['review', 'remarks']);
      expect([for (final c in cols.where(const SheetEnv(showVendor: false)).middle) c.key], isNot(contains('vendorName')));
      expect([for (final c in cols.where(const SheetEnv(showVendor: true)).middle) c.key], contains('vendorName'));
    });

    Future<void> openList(WidgetTester tester, List<Map<String, dynamic>> rows) async {
      SharedPreferences.setMockInitialValues({});
      final api = FakeApi.install();
      api.on('GET', vmcSpec.api.list, (r) => {
            'isOk': true,
            'data': (int.tryParse('${r.query['page']}') ?? 1) == 1 ? rows : const [],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
          });
      api.list(Endpoints.machines, [
        {'_id': 'm1', 'machineName': '7A'},
        {'_id': 'm2', 'machineName': '7B'},
      ]);
      api.list(Endpoints.items, [
        {'_id': 'i1', 'itemName': 'Housing', 'drawingNo': 'D-100'},
      ]);
      api.list(Endpoints.machineOperators, [
        {'_id': 'o1', 'name': 'Ravi'},
        {'_id': 'o2', 'name': 'Asha'},
      ]);
      api.list(Endpoints.processes, []);
      api.list(Endpoints.vendors, []);
      api.list(Endpoints.companyHolidays, []);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', vmcSpec.api.extent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': list.today}});
      api.on('GET', vmcSpec.api.filterOptions, (_) => {
            'isOk': true,
            'data': {'machine': ['m1', 'm2'], 'operator': ['Ravi', 'Asha'], 'item': ['Housing']},
          });
      await pumpScreen(tester, ProductionSheetScreen(spec: vmcSpec), size: const Size(2600, 900));
    }

    testWidgets('an over-100% figure is red in the table, the review is a badge, the vendor and status columns read', (tester) async {
      await openList(tester, [reviewed, vmcRow('r2', machine: 'm2', operator: 'Asha')]);
      for (final k in ['machineStatus', 'vendorName', 'availability', 'performance', 'quality', 'review']) {
        expect(list.byKey('head-$k'), findsOneWidget, reason: k);
      }
      Color colorOf(String cell) =>
          tester.widget<Text>(find.descendant(of: list.byKey(cell), matching: find.byType(Text)).first).style!.color!;
      final ctx = tester.element(list.byKey('r1:availability'));
      final red = AppColors.readable(ctx, AppColors.critical);
      expect(colorOf('r1:availability'), red);
      expect(colorOf('r2:availability'), isNot(red));
      expect(find.descendant(of: list.byKey('r1:review'), matching: find.text('Pending review')), findsOneWidget);
      expect(list.byKey('pill-review-r1'), findsOneWidget);
      expect(find.descendant(of: list.byKey('r2:review'), matching: find.text('—')), findsOneWidget);
      expect(list.byKey('pill-review-r2'), findsNothing);
      expect(find.descendant(of: list.byKey('r1:machineStatus'), matching: find.text('Working — No Planning')), findsOneWidget);
      expect(find.descendant(of: list.byKey('r1:vendorName'), matching: find.text('Acme Castings')), findsOneWidget);
      // VMC's own cells.
      expect(find.descendant(of: list.byKey('r1:cycle'), matching: find.text('180')), findsOneWidget);
    });

    testWidgets('the Vendor column stays hidden on a page with no vendors', (tester) async {
      await openList(tester, [vmcRow('r2', machine: 'm2')]);
      expect(list.byKey('head-vendorName'), findsNothing);
      expect(list.byKey('head-review'), findsOneWidget);
    });

    testWidgets('the detail shows A / P / Q (red over 100%), the review state and who/why, status and vendor', (tester) async {
      final r = {
        ...reviewed,
        'review': {
          'status': 'rejected',
          'flagged': [{'metric': 'availability', 'value': 1.23}],
          'decidedBy': {'name': 'Asha'},
          'remark': 'recheck the cycle time',
        },
      };
      final calc = vmcSpec.rowCalc(r);
      await pumpScreen(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: EntryDetail(
              spec: vmcSpec,
              row: r,
              calc: calc,
              day: const {},
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
      for (final t in ['Availability (%)', 'Performance (%)', 'Quality (%)', 'OEE Review', 'Machine Working Status', 'Vendor Name']) {
        expect(find.textContaining(t, findRichText: true), findsOneWidget, reason: t);
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
      final ctx = tester.element(find.textContaining('Availability (%)', findRichText: true));
      final valueText = tester.widget<Text>(find.text('${(over * 100).toStringAsFixed(2)}%').first);
      expect(valueText.style!.color, AppColors.readable(ctx, AppColors.critical));
    });
  });

  group('the Part picker', () {
    test('VMC scopes parts to the page\'s process like the web (VmcDataEntry.jsx scopedItems)', () {
      expect(vmcSpec.scopeItemsToProcess, isTrue);
      expect(vmcSpec.usesVendors, isTrue);
      expect(vmcSpec.usesPlannedShiftSetting, isTrue);
      expect(vmcSpec.showLimitPopups, isTrue);
      expect(vmcSpec.referenceLists['vendors'], Endpoints.vendors);
    });
  });
}
