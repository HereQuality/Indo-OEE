import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/processes/spring/spring_spec.dart';

import '../twin_form_support.dart';
import '../twin_parity.dart';

void main() {
  registerTwinParity(springSpec, 'spring');

  group('SPRING FOR PINS spec', () {
    test('identity, endpoints and titles', () {
      expect(springSpec.key, 'spring');
      expect(springSpec.routePath, '/production/spring-data-entry');
      expect(springSpec.draftKey, 'springEntryDraft');
      expect(springSpec.addTitle, 'Add SPRING FOR PINS Entry');
      expect(springSpec.editTitle, 'Update SPRING FOR PINS Entry');
      expect(springSpec.api.list, '${Endpoints.v1}/spring-sheet');
      expect(springSpec.api.row, '${Endpoints.v1}/spring-sheet/row');
      expect(springSpec.api.extent, '${Endpoints.v1}/spring-sheet/extent');
      expect(
        springSpec.api.filterOptions,
        '${Endpoints.v1}/spring-sheet/filter-options',
      );
      expect(springSpec.api.occupied, '${Endpoints.v1}/spring-sheet/occupied');
      expect(springSpec.scopeItemsToProcess, isTrue);
    });

    test('the table: Spring\'s own columns (no Drawing No., Unutilized, Setup Efficiency)', () {
      final cols = springSpec.columns({}).middle;
      expect(
        [for (final c in cols) c.key],
        [
          'itemName',
          'vendorName',
          'operator',
          'machineStatus',
          'on',
          'off',
          'shift',
          'cycle',
          'totalQty',
          'okQty',
          'rejectedQty',
          'pctOk',
          'idealQty', //
          'idealQtyPerHour',
          'plannedShift',
          'totalStoppage',
          'effective',
          'unreported',
          'availability',
          'performance',
          'quality',
          'oeeLosses', 'oeeLunch', 'oeeLunchCot', 'review', 'remarks',
        ],
      );
      String labelOf(String k) => cols.firstWhere((c) => c.key == k).label;
      expect(labelOf('itemName'), 'Item Name');
      expect(labelOf('cycle'), 'Standard Time per Piece (Sec)');
      expect(labelOf('totalStoppage'), 'Total Idle Time (min)');
      expect(labelOf('okQty'), 'OK Qty');
      expect(labelOf('pctOk'), 'OK Quantity (%)');
      expect(labelOf('remarks'), 'Reason/Remarks for Rejection/Rework');
      expect(
        [for (final c in springSpec.columns({}).left) c.label],
        ['Date', 'MC No.'],
      );
      final subs = [
        for (final c in springSpec.columns({'downtime'}).middle)
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
    });

    test('Rejected Qty is Actual − OK and opens into the Rejection Master reasons; Total Qty stays', () {
      final closed = springSpec.columns({}).middle.firstWhere((c) => c.key == 'rejectedQty');
      expect(closed.label, 'Rejected Qty');
      expect(closed.formulaKey, 'rejectedQty');
      final open = springSpec.columns({'rejectedQty'}).middle;
      final subs = [for (final c in open) if (c.sub) c.key];
      expect(subs.first, 'Dimension Out');
      expect(subs.last, 'Other');
      expect(subs, hasLength(10));
      expect(springSpec.formulas['rejectedQty'], contains('Actual Quantity − OK Quantity'));
      expect([for (final c in open) c.key].where((k) => k == 'totalQty'), hasLength(1));
    });

    test('Effective Machine Run Time counts OK + Rejected (runQtyBasis total) and says so', () {
      final row = twinRow();
      final calc = springSpec.rowCalc(row);
      // (400 + 20) x 60 s / 3600
      expect(calc['effectiveHours'], closeTo(420 * 60 / 3600, 1e-12));
      expect(calc['totalCycleSec'], 60);
      expect(
        springSpec.formulas['effective'],
        contains('(OK Qty + Rejected Qty)'),
      );
      expect(
        springSpec.validateEntry({
          ...springSpec.toFormValues(row),
          'itemName': '',
        })['itemName'],
        'Item Name is required',
      );
      expect(
        springSpec.validateEntry({
          ...springSpec.toFormValues(row),
          'totalCycleSec': '',
        })['totalCycleSec'],
        'Standard Time per Piece is required',
      );
    });

    test('a row is shown with Actual, OK and Rejected (= Actual − OK) and the OEE figures', () {
      final row = {...twinRow(), 'workingStatus': 'PRESENT'};
      final calc = springSpec.rowCalc(row);
      expect(calc['actualQty'], 420);
      expect(calc['rejectedQty'], 20);
      final figures = springSpec.figures(row, calc);
      expect(figures.ok, 400);
      expect(figures.actual, 420);
      final detail = springSpec.detail(
        row,
        calc,
        springSpec.dayCalc([row]).first,
      );
      expect(detail.groups.map((g) => g.title), [
        'Quantities',
        'Time',
        'Idle Time',
        'Efficiency',
        'Entry',
      ]);
    });

    testWidgets(
      'the add form shows SPRING FOR PINS\'s cards (the CNC Production Master and Rejection Master, no operation ticks)',
      (tester) async {
        await openTwinEditor(tester, springSpec);
        expect(find.text('Add SPRING FOR PINS Entry'), findsOneWidget);
        expect(find.text('Date, Machine No., Operator'), findsOneWidget);
        expect(find.text('Machine Working Status'), findsOneWidget);
        expect(find.text('Item Name, Standard Time per Piece'), findsOneWidget);
        expect(find.text('Machine ON–OFF Time, Machine Shift'), findsOneWidget);
        expect(find.text('Production Master'), findsOneWidget);
        expect(find.text('Rejection Master (Qty)'), findsOneWidget);
        expect(
          find.text('Planned Operator Shift, Lunch / Rest'),
          findsOneWidget,
        );
        expect(find.text('Idle Time (min)'), findsOneWidget);
        expect(find.text('Downtime / Stoppage (min)'), findsNothing);
        // The line's title and, as on the web, the same words as the label over its box.
        expect(
          find.text('Reason / Remarks for Rejection / Rework'),
          findsNWidgets(2),
        );
        expect(find.text('Planned Downtime (min)'), findsOneWidget);
        expect(find.byKey(const ValueKey('entry0/actualQty')), findsOneWidget);
        expect(find.byKey(const ValueKey('entry0/okQty')), findsOneWidget);
        // Rejected is Actual − OK (greyed), the split is one box per reason.
        expect(
          find.byKey(const ValueKey('entry0/calc/rejectedQty')),
          findsOneWidget,
        );
        expect(find.byKey(const ValueKey('entry0/rejectedQty')), findsNothing);
        expect(
          find.byKey(const ValueKey('entry0/reject/Tool Mark'), skipOffstage: false),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('entry0/totalCycleSec')),
          findsOneWidget,
        );
        // The CNC operation ticks are not drawn.
        expect(find.textContaining('Operations in this cycle'), findsNothing);
      },
    );

    testWidgets('Non Working hides the production cards and keeps the status', (
      tester,
    ) async {
      await openTwinEditor(tester, springSpec);
      await tester.tap(
        find.byKey(const ValueKey('entry0/workingMode/Non Working')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Item Name, Standard Time per Piece'), findsNothing);
      expect(find.text('Production Master'), findsNothing);
      expect(find.text('Rejection Master (Qty)'), findsNothing);
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
      expect(find.text('Item Name, Standard Time per Piece'), findsOneWidget);
    });

    testWidgets(
      'Save PUTs the exact payload to /spring-sheet/row (and nowhere else)',
      (tester) async {
        final popped = <bool?>[];
        final api = await openTwinEditor(
          tester,
          springSpec,
          row: twinRow(),
          popped: popped,
        );
        expect(find.text('Update SPRING FOR PINS Entry'), findsOneWidget);
        await tester.tap(
          find
              .descendant(
                of: find.byType(Scaffold).last,
                matching: find.widgetWithText(FilledButton, 'Update'),
              )
              .first,
        );
        await tester.pumpAndSettle();
        final puts = api.called('PUT', '${Endpoints.v1}/spring-sheet/row');
        expect(puts, hasLength(1));
        final body = puts.single.body as Map;
        expect(
          body,
          springSpec.toPayload(
            springSpec.toFormValues(twinRow()),
            isEdit: true,
          ),
        );
        expect(body['_id'], 'r1');
        expect(body['slot'], 2);
        expect(body['actualQty'], 420);
        expect(body['okQty'], 400);
        expect(body.containsKey('rejectedQty'), isFalse, reason: 'the server derives it');
        expect(body['rejectBreakdown'], {'Tool Mark': 12, 'Dimension Out': 8});
        expect(body['rejectReason'], 'Tool Mark');
        expect(body['rejectOtherRemark'], '');
        expect(body['plannedOperatorShiftHours'], 9);
        expect(body['lunchMin'], 30);
        expect(body['workingMode'], 'Working');
        expect(api.called('PUT', Endpoints.productionSheetRow), isEmpty);
        expect(popped, [true]);
      },
    );
  });
}
