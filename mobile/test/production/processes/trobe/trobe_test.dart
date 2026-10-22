import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/processes/trobe/trobe_spec.dart';

import '../twin_form_support.dart';
import '../twin_parity.dart';

void main() {
  registerTwinParity(trobeSpec, 'trobe');

  group('TROBE spec', () {
    test('identity, endpoints and titles', () {
      expect(trobeSpec.key, 'trobe');
      expect(trobeSpec.routePath, '/production/trobe-data-entry');
      expect(trobeSpec.draftKey, 'trobeEntryDraft');
      expect(trobeSpec.addTitle, 'Add TROBE Entry');
      expect(trobeSpec.editTitle, 'Update TROBE Entry');
      expect(trobeSpec.api.list, '${Endpoints.v1}/trobe-sheet');
      expect(trobeSpec.api.row, '${Endpoints.v1}/trobe-sheet/row');
      expect(trobeSpec.api.extent, '${Endpoints.v1}/trobe-sheet/extent');
      expect(
        trobeSpec.api.filterOptions,
        '${Endpoints.v1}/trobe-sheet/filter-options',
      );
      expect(trobeSpec.api.occupied, '${Endpoints.v1}/trobe-sheet/occupied');
      expect(trobeSpec.scopeItemsToProcess, isTrue);
    });

    test(
      'the table: TROBE\'s columns in the web order, no Working Status column',
      () {
        final keys = [for (final c in trobeSpec.columns({}).middle) c.key];
        expect(keys, [
          'operator',
          'machineStatus',
          'itemName',
          'vendorName',
          'drawingNo',
          'cycle',
          'on',
          'off',
          'shift',
          'idealQty',
          'idealQtyPerHour', //
          'okQty',
          'rejectedQty',
          'pctOk',
          'plannedShift',
          'unutilized',
          'totalStoppage',
          'effective',
          'unreported',
          'setupEff',
          'availability',
          'performance',
          'quality',
          'oeeLosses',
          'oeeLunch',
          'oeeLunchCot',
          'review',
          'remarks',
        ]);
        expect(
          [for (final c in trobeSpec.columns({}).left) c.label],
          ['Date', 'Machine'],
        );
        final open = trobeSpec.columns({'downtime'}).middle;
        final subs = [
          for (final c in open)
            if (c.sub) c.key,
        ];
        expect(subs, [
          'plannedDownMin',
          'setupMin',
          'noManPowerMin',
          'materialShiftingMin',
          'noMaterialMin',
          'bdMechMin',
          'bdEleMin',
          'noPowerMin',
          'lunchMin',
          'otherMin',
        ]);
      },
    );

    test('a row is shown with the typed OK / Rejected and the OEE figures', () {
      final row = {...twinRow(), 'workingStatus': 'PRESENT'};
      final calc = trobeSpec.rowCalc(row);
      expect(calc['actualQty'], 420);
      expect(calc['rejectedQty'], 20);
      final figures = trobeSpec.figures(row, calc);
      expect(figures.ok, 400);
      expect(figures.actual, 420);
      final detail = trobeSpec.detail(
        row,
        calc,
        trobeSpec.dayCalc([row]).first,
      );
      expect(detail.groups.map((g) => g.title), [
        'Quantities',
        'Time',
        'Stoppage',
        'Efficiency',
        'Entry',
      ]);
    });

    testWidgets(
      'the add form shows TROBE\'s cards (no CNC reject split, no operation ticks)',
      (tester) async {
        await openTwinEditor(tester, trobeSpec);
        expect(find.text('Add TROBE Entry'), findsOneWidget);
        expect(find.text('Date, Machine No., Operator'), findsOneWidget);
        expect(find.text('Machine Working Status'), findsOneWidget);
        expect(find.text('Part, Total Cycle Time'), findsOneWidget);
        expect(find.text('Machine ON–OFF Time, Machine Shift'), findsOneWidget);
        expect(find.text('Production (Qty)'), findsOneWidget);
        expect(
          find.text('Planned Operator Shift, Lunch / Rest'),
          findsOneWidget,
        );
        expect(find.text('Downtime / Stoppage (min)'), findsOneWidget);
        expect(find.text('Remarks'), findsWidgets);
        expect(find.text('Planned Downtime (min)'), findsOneWidget);
        expect(find.byKey(const ValueKey('entry0/okQty')), findsOneWidget);
        expect(
          find.byKey(const ValueKey('entry0/rejectedQty')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('entry0/totalCycleSec')),
          findsOneWidget,
        );
        // CNC-only cards are not drawn.
        expect(find.text('Rejection Master (Qty)'), findsNothing);
        expect(find.text('Actual Quantity'), findsNothing);
        expect(find.textContaining('Operations in this cycle'), findsNothing);
      },
    );

    testWidgets('Non Working hides the production cards and keeps the status', (
      tester,
    ) async {
      await openTwinEditor(tester, trobeSpec);
      await tester.tap(
        find.byKey(const ValueKey('entry0/workingMode/Non Working')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Part, Total Cycle Time'), findsNothing);
      expect(find.text('Production (Qty)'), findsNothing);
      expect(
        find.byKey(const ValueKey('entry0/machineStatus/No Manpower')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('entry0/machineStatus/No Manpower')),
      );
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('entry0/workingMode/Working')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Part, Total Cycle Time'), findsOneWidget);
    });

    testWidgets(
      'Save PUTs the exact payload to /trobe-sheet/row (and nowhere else)',
      (tester) async {
        final popped = <bool?>[];
        final api = await openTwinEditor(
          tester,
          trobeSpec,
          row: twinRow(),
          popped: popped,
        );
        expect(find.text('Update TROBE Entry'), findsOneWidget);
        await tester.tap(
          find
              .descendant(
                of: find.byType(Scaffold).last,
                matching: find.widgetWithText(FilledButton, 'Update'),
              )
              .first,
        );
        await tester.pumpAndSettle();
        final puts = api.called('PUT', '${Endpoints.v1}/trobe-sheet/row');
        expect(puts, hasLength(1));
        final body = puts.single.body as Map;
        expect(
          body,
          trobeSpec.toPayload(trobeSpec.toFormValues(twinRow()), isEdit: true),
        );
        expect(body['_id'], 'r1');
        expect(body['slot'], 2);
        expect(body['okQty'], 400);
        expect(body['rejectedQty'], 20);
        expect(body['plannedOperatorShiftHours'], 9);
        expect(body['lunchMin'], 30);
        expect(body['workingMode'], 'Working');
        expect(body.containsKey('actualQty'), isFalse);
        expect(body.containsKey('rejectBreakdown'), isFalse);
        expect(api.called('PUT', Endpoints.productionSheetRow), isEmpty);
        expect(popped, [true]);
      },
    );
  });
}
