import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/routes.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/entry_form/entry_line_context.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart' as rules;
import 'package:indo/features/production/sheet/editor/entry_draft_store.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_logic.dart' as logic;
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/sheet_controller.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

/// A CNC twin under another name — what Contact / Trobe / Spring will be. It
/// proves the framework asks the spec, not CNC, for everything that differs:
/// endpoints, titles, draft key and the form's cards.
class _TwinSpec extends CncSpec {
  const _TwinSpec();

  @override
  String get key => 'twin';
  @override
  String get label => 'Twin';
  @override
  String get routePath => '/production/twin-data-entry';
  @override
  List<String> get routeAliases => const [];
  @override
  String get pageTitle => 'Twin data entry';
  @override
  String get addTitle => 'Add Twin Entry';
  @override
  String get editTitle => 'Update Twin Entry';
  @override
  String get draftKey => 'twinEntryDraft';
  @override
  SheetApi get api => SheetApi.segment('twin-sheet');
  @override
  bool get scopeItemsToProcess => true;
  @override
  EntryLines get lines => const _TwinLines();
}

class _TwinLines extends EntryLines {
  const _TwinLines();

  @override
  List<Widget> left(EntryLineContext c) => [Text('TWIN LEFT ${c.index}')];
  @override
  List<Widget> right(EntryLineContext c) => [Text('TWIN RIGHT ${c.metrics.calc['idealQty']}')];
  @override
  String collapsedSummary(Map<String, dynamic> values) => 'twin summary';
}

/// CNC's page, but scoping parts like the web (what every new port does).
class _ScopingSpec extends CncSpec {
  const _ScopingSpec();
  @override
  bool get scopeItemsToProcess => true;
}

/// Stands each operator in as a "machine" (what Powder Coating does with workers).
class _WorkerSpec extends CncSpec {
  const _WorkerSpec();
  @override
  List<Map<String, dynamic>> scopeMachines({
    required List<Map<String, dynamic>> machines,
    required List<Map<String, dynamic>> operators,
    required Map<String, dynamic>? lockedProcess,
  }) =>
      [
        for (final o in operators) {'_id': o['_id'], 'machineName': o['name'], 'process': lockedProcess?['_id']},
      ];
}

const twin = _TwinSpec();

void main() {
  group('registry and routes', () {
    test('CNC is registered, found by key, path and alias', () {
      expect(ProcessRegistry.all, contains(cncSpec));
      expect(ProcessRegistry.byKey('cnc'), same(cncSpec));
      expect(ProcessRegistry.byPath('/production/cnc-data-entry'), same(cncSpec));
      expect(ProcessRegistry.byPath('/production/data-entry'), same(cncSpec));
      expect(ProcessRegistry.byPath('/production/vmc-data-entry')?.key, 'vmc');
      expect(ProcessRegistry.byPath('/production/nope-data-entry'), isNull);
      expect(ProcessRegistry.byKey('nope'), isNull);
    });

    test('all nine processes are registered, each reachable by key and by its page', () {
      const pages = {
        'cnc': '/production/cnc-data-entry',
        'vmc': '/production/vmc-data-entry',
        'spm': '/production/spm-data-entry',
        'rivet': '/production/rivet-data-entry',
        'press': '/production/press-data-entry',
        'contact': '/production/contact-data-entry',
        'trobe': '/production/trobe-data-entry',
        'spring': '/production/spring-data-entry',
        'powder-coating': '/production/powder-coating-data-entry',
        'rubber': '/production/rubber-data-entry',
        'printing': '/production/printing-data-entry',
        'injection': '/production/injection-moulding-data-entry',
        'bpc': '/production/before-powder-coating-data-entry',
        'mfd': '/production/modular-frame-drilling-data-entry',
        'embossing': '/production/embossing-data-entry',
        'final-assembly': '/production/final-assembly-data-entry',
      };
      expect(ProcessRegistry.all.map((s) => s.key).toSet(), pages.keys.toSet());
      pages.forEach((key, path) {
        expect(ProcessRegistry.byKey(key)?.routePath, path);
        expect(ProcessRegistry.byPath(path)?.key, key);
      });
    });

    test('every registered spec has a route, aliases included', () {
      for (final spec in ProcessRegistry.all) {
        expect(AppRoutes.match(spec.routePath)?.path, spec.routePath);
        for (final a in spec.routeAliases) {
          expect(AppRoutes.match(a)?.path, spec.routePath, reason: 'alias $a');
        }
        // The role segment the DB stores is ignored, as for any menu URL.
        expect(AppRoutes.match('/hqepl${spec.routePath}')?.path, spec.routePath);
      }
      expect(AppRoutes.match('/production/data-entry')?.title, 'Data entry');
    });

    test('route paths and draft keys are unique', () {
      final paths = [for (final s in ProcessRegistry.all) ...[s.routePath, ...s.routeAliases]];
      expect(paths.toSet().length, paths.length);
      final keys = [for (final s in ProcessRegistry.all) s.draftKey];
      expect(keys.toSet().length, keys.length);
    });

    test('a process owns the page its dataEntryMenu resolves to (aliases count)', () {
      expect(cncSpec.ownsProcess({'dataEntryMenu': '/hqepl/production/cnc-data-entry'}), isTrue);
      expect(cncSpec.ownsProcess({'dataEntryMenu': '/hqepl/production/data-entry'}), isTrue);
      expect(cncSpec.ownsProcess({'dataEntryMenu': '/hqepl/production/vmc-data-entry'}), isFalse);
      expect(cncSpec.ownsProcess({'dataEntryMenu': null}), isFalse);
      expect(cncSpec.ownsProcess({}), isFalse);
    });
  });

  group('CncSpec is the existing CNC logic, unchanged', () {
    final now = DateTime(2026, 9, 25);
    final valid = {
      ...logic.emptyEntry(now: now),
      'machine': 'm1',
      'operator': 'Ravi',
      'item': 'i1',
      'itemName': 'Bracket',
      'totalCycleSec': '60',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': '400',
      'okQty': '390',
      'rejectBreakdown': <String, dynamic>{'Tool Mark': '10'},
      'plannedOperatorShiftHours': '9',
    };

    test('values, payload and validation delegate to the same functions', () {
      expect(cncSpec.emptyEntry(now: now), logic.emptyEntry(now: now));
      expect(cncSpec.toPayload(valid, isEdit: false), logic.toPayload(valid, isEdit: false));
      expect(cncSpec.validateEntry(valid), rules.validateEntry(valid));
      expect(cncSpec.validateEntry(valid), isEmpty);
      expect(cncSpec.validateEntry(logic.emptyEntry(now: now)), isNotEmpty);
      expect(cncSpec.fieldOrder, rules.fieldOrder);
      expect(cncSpec.entryHasData(valid), isTrue);
      expect(cncSpec.entryHasData(logic.emptyEntry(now: now)), isFalse);
    });

    test('firstError follows the spec field order', () {
      final errors = [cncSpec.validateEntry(logic.emptyEntry(now: now))];
      expect(cncSpec.firstError(errors), rules.firstError(errors));
      // A spec with its own order scrolls to ITS first field.
      expect(rules.firstError([{'okQty': 'x', 'actualQty': 'y'}], order: const ['okQty', 'actualQty'])?['field'], 'okQty');
      expect(rules.firstError([{'okQty': 'x', 'actualQty': 'y'}])?['field'], 'actualQty');
    });

    test('the reject split is changed through the spec', () {
      final v = cncSpec.applyRejectChange({'rejectBreakdown': <String, dynamic>{'A': '1'}}, 'B', '2');
      expect(v['rejectBreakdown'], {'A': '1', 'B': '2'});
    });

    test('endpoints are CNC\'s existing ones', () {
      expect(cncSpec.api.list, Endpoints.productionSheet);
      expect(cncSpec.api.row, Endpoints.productionSheetRow);
      expect(cncSpec.api.extent, Endpoints.productionSheetExtent);
      expect(cncSpec.api.filterOptions, Endpoints.productionSheetFilterOptions);
      expect(cncSpec.api.occupied, Endpoints.productionSheetOccupied);
      expect(cncSpec.api.operators, Endpoints.productionSheetOperators);
      expect(cncSpec.api.rejectReasons, Endpoints.productionSheetRejectReasons);
      expect(SheetApi.segment('vmc-sheet').row, '${Endpoints.v1}/vmc-sheet/row');
    });

    test('the table and detail are built by the spec', () {
      expect(cncSpec.columns({}).middle.any((c) => c.key == 'cycle'), isTrue);
      expect(cncSpec.columns({'cycle'}).middle.any((c) => c.key == 'drillingSec'), isTrue);
      expect(cncSpec.columns({}).expandSummary['downtime'], 'totalStoppage');
      expect(cncSpec.formulas.containsKey('oeeLosses'), isTrue);
      final row = {'okQty': 5, 'machineOnTime': '08:00', 'machineOffTime': '09:00', 'actualQty': 5};
      final calc = cncSpec.rowCalc(row);
      final detail = cncSpec.detail(row, calc, const {});
      expect(detail.oee.map((o) => o.formulaKey), ['oeeLosses', 'oeeLunch', 'oeeLunchCot']);
      expect(detail.groups.map((g) => g.title), ['Quantities', 'Time', 'Stoppage', 'Efficiency', 'Entry']);
      final figures = cncSpec.figures(row, calc);
      expect(figures.ok, 5);
      expect(figures.shiftHours, calc['shiftHours']);
    });
  });

  group('a spec other than CNC drives the framework', () {
    test('the list controller uses the spec\'s endpoints, for reads, delete and unlock', () async {
      final api = FakeApi.install();
      api.list(Endpoints.machines, [
        {'_id': 'm1', 'machineName': '7A'},
      ]);
      api.list(Endpoints.items, [
        {'_id': 'i1', 'itemName': 'Mine', 'process': 'p-twin'},
        {'_id': 'i2', 'itemName': 'Other process', 'process': 'p-other'},
        {'_id': 'i3', 'itemName': 'Unassigned'},
      ]);
      api.list(Endpoints.machineOperators, []);
      api.list(Endpoints.processes, []);
      api.list(Endpoints.companyHolidays, []);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', '${Endpoints.v1}/twin-sheet/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', '${Endpoints.v1}/twin-sheet/filter-options', (_) => {'isOk': true, 'data': {'machine': ['m1'], 'operator': [], 'item': []}});
      api.on('GET', '${Endpoints.v1}/twin-sheet', (_) => {
            'isOk': true,
            'data': [
              {'_id': 'r1', 'date': '2026-09-20T00:00:00.000Z', 'machine': 'm1', 'slot': 1, 'machineOnTime': '08:00', 'machineOffTime': '16:00', 'okQty': 10},
            ],
            'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
          });
      api.on('DELETE', '${Endpoints.v1}/twin-sheet/row/r1', (_) => {'isOk': true, 'message': 'gone'});
      api.on('PUT', '${Endpoints.v1}/twin-sheet/row/r1/unlock', (_) => {'isOk': true, 'data': {'unlockedUntil': '2099-01-01T00:00:00.000Z'}});

      final c = SheetController(spec: twin);
      await c.start();
      expect(c.rows.single['_id'], 'r1');
      expect(c.spec, same(twin));
      expect(api.called('GET', Endpoints.productionSheet), isEmpty);
      expect(api.called('GET', Endpoints.productionSheetExtent), isEmpty);
      expect(api.called('GET', '${Endpoints.v1}/twin-sheet'), isNotEmpty);

      expect(await c.unlockRow(c.rows.single), isTrue);
      expect(api.called('PUT', '${Endpoints.v1}/twin-sheet/row/r1/unlock'), hasLength(1));
      expect(await c.deleteRow(c.rows.single), isTrue);
      expect(api.called('DELETE', '${Endpoints.v1}/twin-sheet/row/r1'), hasLength(1));
      expect(api.called('DELETE', '${Endpoints.productionSheetRow}/r1'), isEmpty);
      expect(api.misses.where((m) => m.path.contains('production-sheet')), isEmpty);
      c.dispose();
    });

    test('parts follow the spec\'s scoping once the page is linked to one process', () {
      final items = [
        {'_id': 'i1', 'itemName': 'Mine', 'process': 'p1'},
        {'_id': 'i2', 'itemName': 'Other', 'process': 'p2'},
        {'_id': 'i3', 'itemName': 'Unassigned'},
        {'_id': 'i4', 'itemName': 'Blank process', 'process': ''},
      ];
      final processes = [
        {'_id': 'p1', 'dataEntryMenu': '/hqepl/production/cnc-data-entry'},
        {'_id': 'p2', 'dataEntryMenu': '/hqepl/production/vmc-data-entry'},
      ];
      // CNC scopes like the web page does (ProductionSheet.jsx scopedItems): its
      // process's parts + the ones with no process yet.
      final cnc = SheetController(spec: cncSpec)
        ..items = items
        ..processes = processes;
      expect(cnc.lockedProcess?['_id'], 'p1');
      expect(cnc.scopedItems.map((i) => i['_id']), ['i1', 'i3', 'i4']);
      cnc.dispose();

      // A scoping spec on the same page offers its process's parts + unassigned ones.
      final scoped = SheetController(spec: const _ScopingSpec())
        ..items = items
        ..processes = processes;
      expect([for (final i in scoped.scopedItems) i['_id']], ['i1', 'i3', 'i4']);
      scoped.dispose();

      // Two processes pointing at the page (or none): nothing to scope by.
      final ambiguous = SheetController(spec: const _ScopingSpec())
        ..items = items
        ..processes = [
          {'_id': 'p1', 'dataEntryMenu': '/hqepl/production/cnc-data-entry'},
          {'_id': 'p3', 'dataEntryMenu': '/hqepl/production/data-entry'},
        ];
      expect(ambiguous.lockedProcess, isNull);
      expect(ambiguous.scopedItems, hasLength(4));
      ambiguous.dispose();
    });

    test('a spec can offer other "machines" (workers) and the list names them', () async {
      final api = FakeApi.install();
      api.list(Endpoints.machines, [
        {'_id': 'm1', 'machineName': '7A'},
      ]);
      api.list(Endpoints.items, []);
      api.list(Endpoints.machineOperators, [
        {'_id': 'o1', 'name': 'Asha'},
        {'_id': 'o2', 'name': 'Ravi'},
      ]);
      api.list(Endpoints.processes, []);
      api.list(Endpoints.companyHolidays, []);
      api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
      api.on('GET', Endpoints.productionSheetExtent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
      api.on('GET', Endpoints.productionSheetFilterOptions, (_) => {'isOk': true, 'data': {'machine': [], 'operator': [], 'item': []}});
      api.on('GET', Endpoints.productionSheet, (_) => {'isOk': true, 'data': [], 'meta': {'page': 1, 'totalPages': 1, 'totalDays': 0}});
      final c = SheetController(spec: const _WorkerSpec());
      await c.start();
      expect([for (final m in c.scopedMachines) m['_id']], ['o1', 'o2']);
      expect(c.machineName['o1'], 'Asha');
      expect(c.machineName['m1'], '7A');
      expect(c.rankOf('o1'), lessThan(c.rankOf('o2')));
      expect(c.rankOf('o2'), lessThan(1 << 30));
      expect(c.machineOf('o2')?['machineName'], 'Ravi');
      c.dispose();
    });

    test('drafts are kept apart per process', () async {
      SharedPreferences.setMockInitialValues({});
      final blocks = [
        {...logic.emptyEntry(), 'machine': 'm1'},
      ];
      await EntryDraftStore.save(blocks, draftKey: twin.draftKey);
      expect(await EntryDraftStore.load(draftKey: twin.draftKey), isNotNull);
      expect(await EntryDraftStore.load(), isNull, reason: 'CNC draft untouched');
      await EntryDraftStore.clear(draftKey: twin.draftKey);
      expect(await EntryDraftStore.load(draftKey: twin.draftKey), isNull);
    });

    testWidgets('the editor shows the spec\'s titles and cards, and saves to the spec\'s endpoint', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final api = FakeApi.install();
      api.on('PUT', '${Endpoints.v1}/twin-sheet/row', (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'});
      api.on('GET', '${Endpoints.v1}/twin-sheet/occupied', (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]});
      final popped = <bool?>[];
      final row = {
        '_id': 'r1',
        'date': '2026-09-20',
        'machine': 'm1',
        'slot': 1,
        'item': 'i1',
        'operator': 'Ravi',
        'itemName': 'Bracket',
        'machineOnTime': '08:00',
        'machineOffTime': '16:00',
        'actualQty': 400,
        'okQty': 400,
        'plannedOperatorShiftHours': 9,
        'totalCycleSec': 60,
        'lunchMin': 30,
      };
      await pumpScreen(
        tester,
        ScaffoldMessenger(
          key: rootMessengerKey,
          child: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async => popped.add(
                    await Navigator.of(context).push<bool>(
                      MaterialPageRoute<bool>(
                        builder: (_) => EntryEditorScreen(
                          spec: twin,
                          row: row,
                          machines: const [
                            {'_id': 'm1', 'machineName': '7A'},
                          ],
                          items: const [],
                          operators: const [],
                        ),
                      ),
                    ),
                  ),
                  child: const Text('Open editor'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open editor'));
      await tester.pumpAndSettle();

      expect(find.text('Update Twin Entry'), findsOneWidget);
      expect(find.text('Update Production Entry'), findsNothing);
      expect(find.text('TWIN LEFT 0'), findsOneWidget);
      expect(find.textContaining('TWIN RIGHT'), findsOneWidget);
      // The CNC cards are not drawn: the spec's lines replaced them.
      expect(find.text('Rejection Master (Qty)'), findsNothing);

      await tester.tap(find.descendant(of: find.byType(Scaffold).last, matching: find.widgetWithText(FilledButton, 'Update')).first);
      await tester.pumpAndSettle();
      expect(api.called('PUT', '${Endpoints.v1}/twin-sheet/row'), hasLength(1));
      expect(api.called('PUT', Endpoints.productionSheetRow), isEmpty);
      expect(popped, [true]);
    });
  });
}
