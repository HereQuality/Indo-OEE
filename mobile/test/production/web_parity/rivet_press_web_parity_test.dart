// Wave 2: the Rivet and Press Data Entry forms / editors / tables / details match
// the web pages for vendors, Process Master's planned shift, over-100% + OEE
// review, Machine Working Status and the limit popups — through the shared pieces
// (features/production/{entry_form,shared,sheet/table}), exactly as CNC does in
// cnc_web_parity_test.dart.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/theme/app_colors.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/press/press_spec.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/shared/limit_notice.dart';
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
  {'_id': 'm1', 'machineName': 'M 1', 'process': 'p1'},
  {'_id': 'm2', 'machineName': 'M 2', 'process': 'p3'},
  {'_id': 'm3', 'machineName': 'M 3'},
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
final _operators = <Map<String, dynamic>>[
  {'_id': 'o1', 'name': 'Ravi'},
];

/// What differs between the two processes in these tests.
class _P {
  _P(this.name, this.spec, this.items, this.fillExtra, this.partCard, {required this.cycle, required this.ideal});
  final String name;
  final ProcessSpec spec;
  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> fillExtra; // the process's own required fields
  final String partCard; // title of the Part card (hidden while Non Working)
  final String cycle; // 'Time per piece' in the quantity popup
  final num ideal; // Ideal Quantity of the 8 h run in fillValid
  String get row => spec.api.row;
  String get occupied => spec.api.occupied;
}

final _rivet = _P(
  'Rivet',
  rivetSpec,
  [
    {
      '_id': 'i1', 'itemName': 'Rivet 4mm', 'drawingNo': 'R-4', 'totalCycleSec': 45,
      'rivetLoadingSec': 10, 'rivetProcessSec': 20, 'rivetUnloadingCleaningSec': 10, 'rivetOtherOperationsSec': 5,
    },
  ],
  {'processType': 'Rivet', 'noOfHoles': '4'},
  'Process, Part, Total Cycle Time',
  cycle: '45 sec',
  ideal: 640,
);
final _press = _P(
  'Press',
  pressSpec,
  [
    {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100', 'standardTimeMin': 1, 'pcsPerStandardTime': 1},
  ],
  {'operation': 'Bending', 'setupNo': '1'},
  'Part, Operation, Setup No.',
  cycle: '60 sec',
  ideal: 480,
);

class _Launcher extends StatelessWidget {
  const _Launcher(this.p, {this.row, this.vendors = const [], this.processes = const []});
  final _P p;
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
                  spec: p.spec,
                  row: row,
                  machines: _machines,
                  items: p.items,
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
  WidgetTester tester,
  _P p, {
  Map<String, dynamic>? row,
  List<Map<String, dynamic>>? vendors,
  List<Map<String, dynamic>>? processes,
  Size? size,
}) async {
  SharedPreferences.setMockInitialValues({});
  EntryNotices.reset();
  final api = FakeApi.install();
  api.on('PUT', p.row, (r) => {'isOk': true, 'data': r.body});
  api.on('GET', p.occupied, (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: _Launcher(p, row: row, vendors: vendors ?? _vendors, processes: processes ?? _processes),
    ),
    size: size ?? const Size(390, 844),
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

Future<void> _fillValid(WidgetTester t, _P p, {String machine = 'm2', String planned = '9'}) async {
  await _pickMachine(t, machine);
  final f = _form(t);
  f.onChange(0, 'operator', 'Ravi');
  f.onItemSelect(0, 'i1');
  for (final e in p.fillExtra.entries) {
    f.onChange(0, e.key, e.value);
  }
  f.onChange(0, 'machineOnTime', '08:00');
  f.onChange(0, 'machineOffTime', '16:00');
  f.onChange(0, 'actualQty', '320');
  f.onChange(0, 'okQty', '300');
  f.onRejectChange(0, 'Dimension Out', '20');
  f.onChange(0, 'plannedOperatorShiftHours', planned);
  f.onChange(0, 'lunchMin', '30');
  await t.pump();
}

Future<void> _save(WidgetTester t) async {
  await t.tap(find.descendant(of: find.byType(EntryActionBar), matching: find.byType(FilledButton)));
  await t.pump();
}

/// A saved row for the editor / table / detail.
Map<String, dynamic> _saved(_P p, String id, {Map<String, dynamic> extra = const {}}) => {
      '_id': id,
      'date': '${list.today}T00:00:00.000Z',
      'machine': 'm2',
      'slot': 1,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': p.items.first['itemName'],
      'drawingNo': p.items.first['drawingNo'],
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 320,
      'okQty': 300,
      'rejectBreakdown': {'Dimension Out': 20},
      'plannedOperatorShiftHours': 9,
      'lunchMin': 30,
      if (p.spec.key == 'rivet') ...{
        'processType': 'Rivet', 'noOfHoles': 4, 'totalCycleSec': 45,
        'rivetLoadingSec': 10, 'rivetProcessSec': 20, 'rivetUnloadingCleaningSec': 10, 'rivetOtherOperationsSec': 5,
      } else ...{
        'operation': 'Bending', 'setupNo': '1', 'standardTimeMin': 1, 'pcsPerStandardTime': 1,
      },
      ...extra,
    };

/// The list screen of [p] over a fake API (the shared list harness is CNC's).
FakeApi _installList(_P p, List<Map<String, dynamic>> rows, {List<Map<String, dynamic>> vendors = const []}) {
  final api = FakeApi.install();
  final a = p.spec.api;
  api.on('GET', a.list, (r) => {
        'isOk': true,
        'data': (int.tryParse('${r.query['page']}') ?? 1) == 1 ? rows : const <Map<String, dynamic>>[],
        'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
      });
  api.list(Endpoints.machines, [
    {'_id': 'm1', 'machineName': '7A'},
    {'_id': 'm2', 'machineName': '7B'},
  ]);
  api.list(Endpoints.items, p.items);
  api.list(Endpoints.machineOperators, _operators);
  api.list(Endpoints.processes, []);
  api.list(Endpoints.vendors, vendors);
  api.list(Endpoints.companyHolidays, []);
  api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
  api.on('GET', a.extent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': list.today}});
  api.on('GET', a.filterOptions, (_) => {
        'isOk': true,
        'data': {'machine': ['m1', 'm2'], 'operator': ['Ravi'], 'item': ['x']},
      });
  return api;
}

Future<void> _openList(WidgetTester tester, _P p) =>
    pumpScreen(tester, ProductionSheetScreen(spec: p.spec), size: const Size(2600, 900));

void main() {
  setUp(() {
    EntryFormToast.reset();
    EntryNotices.reset();
  });

  for (final p in [_rivet, _press]) {
    group('${p.name}: Vendor Name', () {
      testWidgets('shown only when the machine\'s process has active vendors; picking sends the id', (tester) async {
        final api = await _openEditor(tester, p);
        await _pickMachine(tester, 'm1');
        expect(_k('entry0/vendor'), findsNothing);
        await _pickMachine(tester, 'm3');
        expect(_k('entry0/vendor'), findsNothing);

        await _fillValid(tester, p);
        await tester.pumpAndSettle();
        expect(_k('entry0/vendor'), findsOneWidget);
        await tester.ensureVisible(_k('entry0/vendor'));
        await tester.tap(_k('entry0/vendor'));
        await tester.pumpAndSettle();
        expect(find.text('Acme Castings'), findsOneWidget);
        expect(find.text('Retired Vendor'), findsNothing);
        expect(find.text('Other Process Vendor'), findsNothing);
        await tester.tap(find.text('Acme Castings'));
        await tester.pumpAndSettle();
        expect(_form(tester).entries[0]['vendor'], 'v1');

        await _save(tester);
        await tester.pumpAndSettle();
        final put = api.called('PUT', p.row).single.body as Map;
        expect(put['vendor'], 'v1');
        expect(put.containsKey('vendorName'), isFalse, reason: 'the server derives the name');
        expect(put['workingMode'], 'Working');
      });

      testWidgets('an entry that names a vendor keeps showing it even with no vendors loaded', (tester) async {
        await _openEditor(tester, p, vendors: const [], row: _saved(p, 'r1', extra: {'vendor': 'vOld', 'vendorName': 'Gone Vendor Ltd'}));
        expect(_k('entry0/vendor'), findsOneWidget);
        expect(find.text('Gone Vendor Ltd'), findsOneWidget);
      });
    });

    group('${p.name}: Planned Operator Shift from Process Master', () {
      testWidgets('a locked process fills the box, makes it read-only and says why', (tester) async {
        await _openEditor(tester, p);
        await _pickMachine(tester, 'm1');
        expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '8');
        await tester.ensureVisible(_box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isFalse);
        expect(find.textContaining('Fixed at 8:00 hr — locked in Process Master'), findsOneWidget);
      });

      testWidgets('an unlocked process, or a machine in none, leaves the box to the person', (tester) async {
        await _openEditor(tester, p);
        await _pickMachine(tester, 'm2');
        expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '');
        await tester.ensureVisible(_box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isTrue);
        await _pickMachine(tester, 'm3');
        expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isTrue);
      });

      testWidgets('editing keeps the shift the entry was saved with', (tester) async {
        await _openEditor(tester, p, row: _saved(p, 'r1', extra: {'machine': 'm1', 'plannedOperatorShiftHours': 9.5}));
        expect(_form(tester).entries[0]['plannedOperatorShiftHours'], '9.5');
        await tester.ensureVisible(_box('plannedOperatorShiftHours'));
        expect(tester.widget<TextField>(_box('plannedOperatorShiftHours')).enabled, isFalse);
        expect(find.textContaining('Kept as this entry was saved'), findsOneWidget);
      });
    });

    group('${p.name}: Machine Working Status', () {
      testWidgets('Non Working hides the production cards, shows Status chips; Save needs only Date + Machine', (tester) async {
        final api = await _openEditor(tester, p);
        await _pickMachine(tester, 'm2');
        expect(find.text(p.partCard), findsOneWidget);
        expect(_k('entry0/machineStatus/No Manpower'), findsNothing, reason: 'Status is for Non Working only');

        await tester.ensureVisible(_k('entry0/workingMode/Non Working'));
        await tester.tap(_k('entry0/workingMode/Non Working'));
        await tester.pumpAndSettle();
        expect(_form(tester).entries[0]['workingMode'], 'Non Working');
        for (final st in ['Machine Breakdown', 'No Manpower', 'No Planning', 'Remarks']) {
          expect(_k('entry0/machineStatus/$st'), findsOneWidget, reason: st);
        }
        expect(find.text(p.partCard, skipOffstage: false), findsNothing);
        expect(find.text('Production Master', skipOffstage: false), findsNothing);
        expect(find.text('Rejection Master (Qty)', skipOffstage: false), findsNothing);
        expect(find.text('Downtime / Stoppage (min)', skipOffstage: false), findsNothing);
        expect(find.text('Remarks', skipOffstage: false), findsWidgets, reason: 'the Remarks card stays');
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
        final put = api.called('PUT', p.row).single.body as Map;
        expect(put['workingMode'], 'Non Working');
        expect(put['machineStatus'], ['Machine Breakdown', 'No Planning']);
        expect(put['operator'], '', reason: 'Operator is optional on a Non Working day');
      });

      testWidgets('going back to Working drops the Status', (tester) async {
        await _openEditor(tester, p);
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
        await _openEditor(tester, p);
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
        expect(tester.widget<FilterChip>(_k('entry0/machineStatus/Remarks')).selected, isTrue);
      });
    });

    group('${p.name}: over 100% check', () {
      testWidgets('the banner appears when Availability goes above 100% and names the metric', (tester) async {
        await _openEditor(tester, p);
        await _fillValid(tester, p, planned: '9');
        await tester.pumpAndSettle();
        expect(_k('entry0/oeeCheck'), findsNothing);
        _form(tester).onChange(0, 'plannedOperatorShiftHours', '7');
        await tester.pump();
        await tester.ensureVisible(_k('entry0/oeeCheck'));
        expect(_k('entry0/oeeCheck'), findsOneWidget);
        expect(find.textContaining('Availability'), findsWidgets);
        expect(find.textContaining('above 100% — this entry will still save, but goes to Admin review'), findsOneWidget);
      });
    });

    group('${p.name}: limit popups', () {
      testWidgets('typing Actual Quantity past Ideal raises the popup with the figures; no toast', (tester) async {
        final toasts = <String>[];
        EntryFormToast.sink = toasts.add;
        await _openEditor(tester, p);
        await _fillValid(tester, p);
        await tester.pumpAndSettle();
        await tester.ensureVisible(_box('actualQty'));
        final typed = '${p.ideal + 100}';
        await tester.enterText(_box('actualQty'), typed);
        await tester.pump();
        await tester.pump();
        expect(_k('entry-notice'), findsOneWidget);
        expect(find.text("Can't add this much quantity"), findsOneWidget);
        expect(find.textContaining('this machine can make at most ${p.ideal} pieces'), findsOneWidget);
        expect(find.text('8:00 hr'), findsOneWidget);
        expect(find.text(p.cycle), findsOneWidget);
        expect(tester.widget<Text>(_k('entry-notice/value/Actual Quantity')).data, typed);
        expect(toasts, isEmpty, reason: 'popup instead of a toast');
        await tester.tap(_k('entry-notice/ok'));
        await tester.pumpAndSettle();
        expect(_k('entry-notice'), findsNothing);
        expect(_form(tester).entries[0]['actualQty'], '320', reason: 'the box refused the keystroke');
      });

      testWidgets('typing OK Quantity past Actual is refused with a toast, not the Ideal popup', (tester) async {
        final toasts = <String>[];
        EntryFormToast.sink = toasts.add;
        await _openEditor(tester, p);
        await _fillValid(tester, p);
        await tester.pumpAndSettle();
        await tester.ensureVisible(_box('okQty'));
        await tester.enterText(_box('okQty'), '321');
        await tester.pump();
        await tester.pump();
        expect(_k('entry-notice'), findsNothing);
        expect(toasts, ["OK Quantity can't be more than Actual Quantity (320)"]);
        expect(_form(tester).entries[0]['okQty'], '300', reason: 'the box refused the keystroke');
      });

      testWidgets('typing a downtime past the Machine Shift raises the stoppage popup', (tester) async {
        await _openEditor(tester, p);
        await _fillValid(tester, p);
        await tester.pumpAndSettle();
        await tester.ensureVisible(_box('setupMin'));
        await tester.enterText(_box('setupMin'), '500'); // Machine Shift is 480 min, Lunch 30
        await tester.pump();
        await tester.pump();
        expect(find.text("Can't add this much stoppage"), findsOneWidget);
        expect(tester.widget<Text>(_k('entry-notice/value/Total stoppage')).data, '530 min');
        expect(find.text('480 min'), findsWidgets);
        await tester.tap(_k('entry-notice/ok'));
        await tester.pumpAndSettle();
      });

      testWidgets('Save with an over-limit quantity pops why, then moves to the field (nothing is sent)', (tester) async {
        final api = await _openEditor(tester, p);
        await _fillValid(tester, p);
        _form(tester).onChange(0, 'actualQty', '${p.ideal + 200}'); // set programmatically, past Ideal
        await tester.pump();
        await _save(tester);
        await tester.pumpAndSettle();
        expect(_k('entry-notice'), findsOneWidget);
        expect(tester.widget<Text>(_k('entry-notice/value/Actual Quantity')).data, '${p.ideal + 200}');
        expect(_form(tester).focusTarget, isNull, reason: 'focus moves after the popup is closed');
        await tester.tap(_k('entry-notice/ok'));
        await tester.pumpAndSettle();
        expect(_form(tester).focusTarget!['field'], 'actualQty');
        expect(api.called('PUT', p.row), isEmpty);
      });

      testWidgets('popups at 360x640 with text scale 1.6 do not overflow', (tester) async {
        tester.view.physicalSize = const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await _openEditor(tester, p, size: const Size(360, 640));
        await _fillValid(tester, p);
        await tester.pumpAndSettle();
        EntryNotices.show(tester.element(find.byType(ProductionEntryForm)), _qtyNoticeFor(p));
        await tester.pump();
        await tester.pump();
        expect(_k('entry-notice'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.tap(_k('entry-notice/ok'));
        await tester.pumpAndSettle();
      });
    });

    group('${p.name}: table, detail', () {
      final reviewed = _saved(p, 'r1', extra: {
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
      final plain = _saved(p, 'r2', extra: {'machine': 'm1', 'operator': 'Asha'});

      test('columns: Machine Working Status, Vendor, A / P / Q and OEE Review in the web order', () {
        final cols = p.spec.columns({});
        final keys = [for (final c in cols.middle) c.key];
        expect(keys.indexOf('machineStatus'), keys.indexOf('operator') + 1);
        expect(keys.indexOf('vendorName'), keys.indexOf('itemName') + 1);
        expect(keys.sublist(keys.indexOf('oeeLosses') - 3, keys.indexOf('oeeLosses')), ['availability', 'performance', 'quality']);
        expect(keys.sublist(keys.indexOf('oeeLunchCot') + 1), ['review', 'remarks']);
        expect([for (final c in cols.where(const SheetEnv(showVendor: false)).middle) c.key], isNot(contains('vendorName')));
        expect([for (final c in cols.where(const SheetEnv(showVendor: true)).middle) c.key], contains('vendorName'));
      });

      testWidgets('an over-100% figure is red, the review is a badge, vendor and status columns read', (tester) async {
        SharedPreferences.setMockInitialValues({});
        _installList(p, [reviewed, plain], vendors: _vendors);
        await _openList(tester, p);
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
      });

      testWidgets('the Vendor column stays hidden on a page with no vendors', (tester) async {
        SharedPreferences.setMockInitialValues({});
        _installList(p, [plain]);
        await _openList(tester, p);
        expect(list.byKey('head-vendorName'), findsNothing);
        expect(list.byKey('head-review'), findsOneWidget);
      });

      testWidgets('the detail shows A / P / Q (red over 100%), the review state and who/why, status and vendor', (tester) async {
        final r = {
          ...reviewed,
          'review': {
            'status': 'rejected',
            'flagged': [
              {'metric': 'availability', 'value': 1.23},
            ],
            'decidedBy': {'name': 'Asha'},
            'remark': 'recheck the cycle time',
          },
        };
        final calc = p.spec.rowCalc(r);
        await pumpScreen(
          tester,
          Scaffold(
            body: SingleChildScrollView(
              child: EntryDetail(
                spec: p.spec,
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

    test('${p.name}: spec hooks and Part picker scoping', () {
      expect(p.spec.scopeItemsToProcess, isTrue);
      expect(p.spec.usesVendors, isTrue);
      expect(p.spec.usesPlannedShiftSetting, isTrue);
      expect(p.spec.showLimitPopups, isTrue);
      expect(p.spec.referenceLists['vendors'], Endpoints.vendors);
    });
  }

  group('Press only', () {
    testWidgets('the time card uses the web\'s "Machine Time ON / OFF" wording', (tester) async {
      await _openEditor(tester, _press, size: const Size(390, 3000));
      await _pickMachine(tester, 'm2');
      expect(find.textContaining('Machine Time ON', findRichText: true, skipOffstage: false), findsWidgets);
      expect(find.textContaining('Machine Time OFF', findRichText: true, skipOffstage: false), findsWidgets);
      expect(find.textContaining('Machine ON Time', findRichText: true, skipOffstage: false), findsNothing);
    });

    testWidgets('Vendor Name comes after Setup No. in the Part card (web order)', (tester) async {
      await _openEditor(tester, _press);
      await _pickMachine(tester, 'm2');
      final setup = tester.getTopLeft(_k('entry0/setupNo')).dy;
      final vendor = tester.getTopLeft(_k('entry0/vendor')).dy;
      expect(vendor, greaterThan(setup));
    });

    test('the Part picker shows the plain part name, like the web (no cycle line)', () {
      expect(pressSpec.itemSubtitle({'itemName': 'x', 'standardTimeMin': 2, 'pcsPerStandardTime': 1}), isNull);
    });
  });

  group('Rivet only', () {
    testWidgets('Vendor Name sits right after Part Name; Total Cycle Time follows the operation ticks', (tester) async {
      await _openEditor(tester, _rivet);
      await _pickMachine(tester, 'm2');
      final part = tester.getTopLeft(_k('entry0/itemName')).dy;
      final vendor = tester.getTopLeft(_k('entry0/vendor')).dy;
      final process = tester.getTopLeft(_k('entry0/processType/Rivet')).dy;
      expect(vendor, greaterThan(part));
      expect(process, greaterThan(vendor));
      _form(tester).onItemSelect(0, 'i1');
      await tester.pump();
      final tick = tester.getTopLeft(_k('entry0/rivetLoadingSec')).dy;
      final cycle = tester.getTopLeft(_k('entry0/calc/totalCycleSec')).dy;
      expect(cycle, greaterThan(tick));
    });

    testWidgets('the OEE banner is part of the quantity card', (tester) async {
      await _openEditor(tester, _rivet);
      await _fillValid(tester, _rivet, planned: '7');
      await tester.pumpAndSettle();
      expect(_k('entry0/oeeCheck'), findsOneWidget);
    });
  });
}

EntryNotice _qtyNoticeFor(_P p) => qtyNotice(
      calc: p.spec.rowCalc({
        'machineOnTime': '08:00',
        'machineOffTime': '16:00',
        'itemName': 'x',
        ...p.items.first,
      }),
      entered: p.ideal + 100,
      label: 'Actual Quantity',
    );
