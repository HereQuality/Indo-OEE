import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/contact/contact_spec.dart';
import 'package:indo/features/production/processes/spring/spring_spec.dart';
import 'package:indo/features/production/processes/trobe/trobe_spec.dart';

import 'twin_form_support.dart';

void main() {
  final now = DateTime(2026, 9, 25);
  for (final ProcessSpec spec in [contactSpec, trobeSpec, springSpec]) {
    group('${spec.key} values (the page handlers)', () {
      test('a blank entry is the web emptyEntry', () {
        final e = spec.emptyEntry(now: now);
        expect(e['date'], '2026-09-25');
        expect(e['workingMode'], 'Working');
        expect(e['machineStatus'], isEmpty);
        expect(e['slot'], 1);
        for (final k in [
          'actualQty',
          'okQty',
          'totalCycleSec',
          'plannedOperatorShiftHours',
          'lunchMin',
          'plannedDownMin',
          'settingOnTime',
          'workingStatus',
        ]) {
          expect(e[k], '', reason: k);
        }
        // The Rejection Master starts empty; there is no typed Rejected any more
        // and none of CNC's operation ticks.
        expect(e['rejectBreakdown'], isEmpty);
        expect(e['rejectOtherRemark'], '');
        expect(e.containsKey('rejectedQty'), isFalse);
        expect(e.containsKey('excludedOps'), isFalse);
        expect(spec.entryHasData(e), isFalse);
        expect(spec.hasAnyEntryData([e]), isFalse);
      });

      test('an edited record becomes form text (planned shift as decimal hours) and validates clean', () {
        final v = spec.toFormValues({
          ...twinRow(),
          'plannedOperatorShiftHours': 8.5,
          'vendor': 'v1',
          'vendorName': 'Acme',
        }, now: now);
        expect(v['actualQty'], '420');
        expect(v['okQty'], '400');
        expect(v['rejectBreakdown'], {'Tool Mark': '12', 'Dimension Out': '8'});
        expect(v['totalCycleSec'], '60');
        // 8 h 30 min is typed 8.5 on the sheet; 5 h 20 min is 5.33.
        expect(v['plannedOperatorShiftHours'], '8.5');
        expect(
          spec.toFormValues({...twinRow(), 'plannedOperatorShiftHours': 5.3333333333})['plannedOperatorShiftHours'],
          '5.33',
        );
        expect(v['slot'], 2);
        expect(v['vendor'], 'v1');
        expect(spec.validateEntry(v), isEmpty);
        // The vendor the record carried is sent back untouched.
        expect(spec.toPayload(v, isEdit: true)['vendor'], 'v1');
      });

      test('an older record (OK + Rejected only) edits as Actual = their sum, its pieces on its one reason', () {
        final old = {...twinRow()}
          ..remove('actualQty')
          ..remove('rejectBreakdown');
        final v = spec.toFormValues(old, now: now);
        expect(v['actualQty'], '420');
        expect(v['okQty'], '400');
        expect(v['rejectBreakdown'], {'Tool Mark': '20'});
        expect(spec.validateEntry(v), isEmpty);
        // No reason either: nothing to carry over, and Save asks for one.
        final noReason = spec.toFormValues(
          {...old}..remove('rejectReason'),
          now: now,
        );
        expect(noReason['rejectBreakdown'], isEmpty);
        expect(spec.validateEntry(noReason)['rejectBreakdown'], contains('20 of 20 rejected piece(s) still have no reason'));
        // A reason that is not on the list is not carried.
        expect(
          spec.toFormValues({...old, 'rejectReason': 'Gone'}, now: now)['rejectBreakdown'],
          isEmpty,
        );
        // Only the reasons that exist survive from a stored split.
        expect(
          spec.toFormValues({
            ...twinRow(),
            'rejectBreakdown': {'Bogus': 3, 'Broken': 20},
          }, now: now)['rejectBreakdown'],
          {'Broken': '20'},
        );
      });

      test('the quantity rules: Actual within Ideal, OK within Actual, the split adds up, Other needs a remark', () {
        final v = spec.toFormValues(twinRow(), now: now);
        Map<String, String> errs(Map<String, dynamic> change) =>
            spec.validateEntry({...v, ...change});
        expect(errs({'actualQty': ''})['actualQty'], 'Actual Quantity is required');
        expect(errs({'actualQty': '481'})['actualQty'], "Actual can't be more than Ideal Quantity (480)");
        expect(errs({'actualQty': '480', 'okQty': '480', 'rejectBreakdown': <String, dynamic>{}}), isEmpty);
        expect(errs({'okQty': ''})['okQty'], 'OK Quantity is required');
        expect(errs({'okQty': '421'})['okQty'], "OK can't be more than Actual Quantity (420)");
        expect(errs({'okQty': '419'})['rejectBreakdown'], 'Split is 19 more than the 1 rejected — the boxes must add up to the rejected quantity');
        expect(errs({'rejectBreakdown': <String, dynamic>{}})['rejectBreakdown'], '20 of 20 rejected piece(s) still have no reason — the boxes must add up to the rejected quantity');
        expect(errs({'okQty': '420'})['rejectBreakdown'], 'Nothing was rejected (Actual − OK is 0), so these boxes should be empty');
        expect(errs({'rejectBreakdown': {'Other': '20'}})['rejectOtherRemark'], 'Remark is required when "Other" is a reject reason');
        expect(errs({'rejectBreakdown': {'Other': '20'}, 'rejectOtherRemark': 'bad weld'}), isEmpty);
        // The order the form reads, top to bottom.
        expect(
          spec.fieldOrder.sublist(
            spec.fieldOrder.indexOf('actualQty'),
            spec.fieldOrder.indexOf('plannedOperatorShiftHours'),
          ),
          ['actualQty', 'okQty', 'rejectBreakdown', 'rejectOtherRemark'],
        );
      });

      test('the metrics hand the shared cards their caps: Actual <= Ideal, OK <= Actual, each reason <= what is left', () {
        final m = spec.metrics(spec.toFormValues(twinRow(), now: now));
        expect(m.idealQty, 480);
        expect(m.okMax, 420);
        expect(m.rejected, 20);
        expect(m.splitTotal, 20);
        expect(m.splitMismatch, isFalse);
        expect(m.rejectRoom('Broken'), 0);
        expect(m.rejectRoom('Tool Mark'), 12);
        // No Actual yet: OK is held to Ideal.
        expect(spec.metrics({...spec.emptyEntry(now: now), 'itemName': 'Bracket', 'machineOnTime': '08:00', 'machineOffTime': '16:00', 'totalCycleSec': '60'}).okMax, 480);
      });

      test('a draft keeps (or gets) a Rejection Master and a typed split counts as data', () {
        expect(
          spec.mergeDraftEntry({'machine': 'm1'}, now: now)['rejectBreakdown'],
          isEmpty,
        );
        expect(
          spec.mergeDraftEntry({'rejectBreakdown': {'Broken': '2'}}, now: now)['rejectBreakdown'],
          {'Broken': '2'},
        );
        final e = spec.emptyEntry(now: now);
        expect(spec.entryHasData({...e, 'rejectBreakdown': {'Broken': '2'}}), isTrue);
        expect(spec.entryHasData({...e, 'rejectBreakdown': {'Broken': ''}}), isFalse);
        expect(spec.hasAnyEntryData([{...e, 'rejectBreakdown': {'Broken': '2'}}]), isTrue);
        expect(spec.hasAnyEntryData([{...e, 'actualQty': '5'}]), isTrue);
      });

      test('the payload sends Actual, OK and the cleaned split (top reason, Other remark only while used) — never rejectedQty', () {
        final v = {
          ...spec.toFormValues(twinRow(), now: now),
          'rejectBreakdown': {'Tool Mark': '4', 'Broken': '', 'Other': '6', 'Dimension Out': '0'},
          'rejectOtherRemark': '  bad weld  ',
          'actualQty': '410',
          'okQty': '400',
        };
        final p = spec.toPayload(v, isEdit: true);
        expect(p['actualQty'], 410);
        expect(p['okQty'], 400);
        expect(p.containsKey('rejectedQty'), isFalse);
        expect(p['rejectBreakdown'], {'Tool Mark': 4, 'Other': 6});
        expect(p['rejectReason'], 'Other');
        expect(p['rejectOtherRemark'], 'bad weld');
        final noOther = spec.toPayload({...v, 'rejectBreakdown': {'Tool Mark': '10'}}, isEdit: true);
        expect(noOther['rejectReason'], 'Tool Mark');
        expect(noOther['rejectOtherRemark'], '');
        final none = spec.toPayload({...v, 'rejectBreakdown': <String, dynamic>{}, 'okQty': '410'}, isEdit: true);
        expect(none['rejectBreakdown'], isEmpty);
        expect(none['rejectReason'], '');
      });

      test('picking a Part copies its Drawing No. and cycle time; clearing it blanks them', () {
        final items = [
          {
            '_id': 'i1',
            'itemName': 'Bracket',
            'drawingNo': 'D-1',
            'totalCycleSec': 12.5,
          },
        ];
        final v = spec.applyItemSelection(
          {...spec.emptyEntry(now: now), 'totalCycleSec': '99'},
          'i1',
          items,
        );
        expect(
          [v['item'], v['itemName'], v['drawingNo'], v['totalCycleSec']],
          ['i1', 'Bracket', 'D-1', '12.5'],
        );
        final cleared = spec.applyItemSelection(v, '', items);
        expect(
          [
            cleared['item'],
            cleared['itemName'],
            cleared['drawingNo'],
            cleared['totalCycleSec'],
          ],
          ['', '', '', ''],
        );
        expect(spec.applyItemSelection(v, 'zzz', items)['item'], '');
      });

      test('a new block copies the date above; a draft missing newer keys is filled in', () {
        final first = {...spec.emptyEntry(now: now), 'date': '2026-09-20'};
        expect(spec.newBlockAfter([first], now: now)['date'], '2026-09-20');
        expect(spec.newBlockAfter([], now: now)['date'], '2026-09-25');
        final merged = spec.mergeDraftEntry({
          'machine': 'm1',
          'okQty': '5',
        }, now: now);
        expect(merged['machine'], 'm1');
        expect(merged['workingMode'], 'Working');
        expect(merged['machineStatus'], isEmpty);
        expect(spec.hasAnyEntryData([merged]), isTrue);
      });

      test('a Non Working day validates on date + machine only and saves just its status', () {
        final v = {
          ...spec.emptyEntry(now: now),
          'machine': 'm1',
          'workingMode': 'Non Working',
          'machineStatus': ['No Planning'],
          'actualQty': '9',
          'okQty': '9',
          'rejectBreakdown': {'Broken': '1'},
          'itemName': 'x',
        };
        expect(spec.validateEntry(v), isEmpty);
        expect(spec.entryHasData(v), isTrue);
        final p = spec.toPayload(v, isEdit: false);
        expect(p['workingMode'], 'Non Working');
        expect(p['machineStatus'], ['No Planning']);
        expect(p['slot'], 'auto');
        expect(p['okQty'], '');
        expect(p['actualQty'], '');
        expect(p['rejectBreakdown'], <String, dynamic>{});
        expect(p['rejectReason'], '');
        expect(p['rejectOtherRemark'], '');
        expect(p.containsKey('rejectedQty'), isFalse);
        expect(p['itemName'], '');
        expect(p['item'], isNull);
        expect(p['lunchMin'], '');
      });

      test('the stoppage allowance is the Machine Shift (the web rule), not Planned − Machine', () {
        final v = spec.toFormValues(twinRow());
        final m = spec.metrics(v);
        expect(m.stoppageLimit, 480);
        expect(m.minutesLimit('setupMin').max, 480 - 30);
        // 40 min of stoppage already logged (lunch 30 + setup 10): 440 left for a box that holds 10.
        expect(m.totalStoppage, 40);
        expect(
          spec
              .metrics({...v, 'machineOnTime': ''})
              .minutesLimit('setupMin')
              .max,
          1440,
        );
      });
    });
  }
}
