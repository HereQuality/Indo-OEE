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
          'okQty',
          'rejectedQty',
          'totalCycleSec',
          'plannedOperatorShiftHours',
          'lunchMin',
          'plannedDownMin',
          'settingOnTime',
          'workingStatus',
        ]) {
          expect(e[k], '', reason: k);
        }
        // No CNC-only keys.
        expect(e.containsKey('actualQty'), isFalse);
        expect(e.containsKey('rejectBreakdown'), isFalse);
        expect(e.containsKey('excludedOps'), isFalse);
        expect(spec.entryHasData(e), isFalse);
        expect(spec.hasAnyEntryData([e]), isFalse);
      });

      test('an edited record becomes form text (planned shift as H.MM) and validates clean', () {
        final v = spec.toFormValues({
          ...twinRow(),
          'plannedOperatorShiftHours': 8.5,
          'vendor': 'v1',
          'vendorName': 'Acme',
        }, now: now);
        expect(v['okQty'], '400');
        expect(v['totalCycleSec'], '60');
        expect(v['plannedOperatorShiftHours'], '8.30');
        expect(v['slot'], 2);
        expect(v['vendor'], 'v1');
        expect(spec.validateEntry(v), isEmpty);
        // The vendor the record carried is sent back untouched.
        expect(spec.toPayload(v, isEdit: true)['vendor'], 'v1');
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
          'okQty': '9',
          'itemName': 'x',
        };
        expect(spec.validateEntry(v), isEmpty);
        expect(spec.entryHasData(v), isTrue);
        final p = spec.toPayload(v, isEdit: false);
        expect(p['workingMode'], 'Non Working');
        expect(p['machineStatus'], ['No Planning']);
        expect(p['slot'], 'auto');
        expect(p['okQty'], '');
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
