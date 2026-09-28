import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/shared/shift_hours.dart';

import 'golden_support.dart';

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);

/// A block that passes every rule: 8 h shift, 45 s cycle (ideal 640), planned
/// 8.30 (H.MM: 8 h 30 min) leaves 30 min = the lunch, and the split covers the 10 rejected.
Map<String, dynamic> _valid([Map<String, dynamic> extra = const {}]) => {
      'date': '2026-04-06',
      'machine': 'm1',
      'operator': 'op1',
      'itemName': 'Part A',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'totalCycleSec': '45',
      'actualQty': '600',
      'okQty': '590',
      'rejectBreakdown': {'Dimension Out': '10'},
      'plannedOperatorShiftHours': '8.30',
      'lunchMin': '30',
      ...extra,
    };

void main() {
  final fixture = loadFixture('validation.json') as Map;

  group('golden: validateEntry (Dart == the real JS)', () {
    final cases = fixture['cases'] as List;

    test('${cases.length} blocks: same messages, same keys, same key order', () {
      expect(cases.length, greaterThan(600));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        // The web types Planned Operator Shift as decimal hours; the phone types
        // H.MM. Feed the phone the same time, and leave out the two fields whose
        // rules are the phone's own (Lunch / Rest is optional, Planned Operator
        // Shift is checked against the Machine Shift) — every other message,
        // and the order of them, is still the web's.
        final v = _m(c['v']);
        final planned = jsNumber(v['plannedOperatorShiftHours']);
        if (planned != null && planned > 0 && planned <= 24 && !isBlank(v['plannedOperatorShiftHours'])) {
          v['plannedOperatorShiftHours'] = hoursToHmInput(planned);
        }
        // A planned shift that isn't a usable time is reported on its own field,
        // so the phone has no stoppage allowance to compare against.
        final usable = planned != null && planned > 0 && planned <= 24;
        final own = {'lunchMin', 'plannedOperatorShiftHours', if (!usable) 'stoppageTotal'};
        final got = {for (final e in validateEntry(v).entries) if (!own.contains(e.key)) e.key: e.value};
        final want = {for (final e in (c['errors'] as Map).entries) if (!own.contains(e.key)) e.key: e.value};
        expect(diff(got, want), isNull, reason: 'case $i ${showCase(c['v'])}');
        expect(got.keys.toList(), [for (final k in c['keys'] as List) if (!own.contains(k)) k], reason: 'key order, case $i ${showCase(c['v'])}');
      }
    });

    test('cleanSplit / rowCalc agree on every block', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final v = _m(c['v']);
        expect(diff(cleanSplit(v['rejectBreakdown']), c['split']), isNull, reason: 'cleanSplit case $i ${showCase(c['v'])}');
        expect(diff(rowCalc(v), c['calc']), isNull, reason: 'rowCalc case $i ${showCase(c['v'])}');
      }
    });

    test('firstError orders by form order, falls back to the first key, null when clean', () {
      final lists = fixture['firstError'] as List;
      expect(lists.length, greaterThan(150));
      for (var i = 0; i < lists.length; i++) {
        final c = lists[i] as Map;
        final list = <Map<String, String>?>[
          for (final e in c['list'] as List) e == null ? null : {for (final k in (e as Map).keys) k as String: '${e[k]}'},
        ];
        expect(diff(firstError(list), c['out']), isNull, reason: 'firstError case $i ${showCase(c['list'])}');
      }
    });

    test('constants match the web file', () {
      expect(fieldOrder, fixture['fieldOrder']);
      expect(downtimeKeys, fixture['downtimeKeys']);
    });
  });

  group('validateEntry by hand', () {
    test('a fully valid block has no errors', () {
      expect(validateEntry(_valid()), isEmpty);
    });

    test('every required field, with the web wording', () {
      final e = validateEntry({});
      expect(e['date'], 'Date is required');
      expect(e['machine'], 'Machine No. is required');
      expect(e['operator'], 'Operator is required');
      expect(e['itemName'], 'Part Name is required');
      expect(e['machineOnTime'], 'Machine ON Time is required');
      expect(e['machineOffTime'], 'Machine OFF Time is required');
      expect(e['actualQty'], 'Actual Quantity is required');
      expect(e['okQty'], 'OK Quantity is required');
      expect(e['plannedOperatorShiftHours'], 'Planned Operator Shift is required');
      // Lunch is only asked for once the shift leaves time over — not while times are missing.
      expect(e.containsKey('lunchMin'), isFalse);
      expect(e.keys.first, 'date');
    });

    test('whitespace-only text is blank', () {
      final e = validateEntry(_valid({'operator': '   ', 'date': ' '}));
      expect(e['operator'], 'Operator is required');
      expect(e['date'], 'Date is required');
    });

    test('times must parse; the forgiving forms are accepted', () {
      expect(validateEntry(_valid({'machineOnTime': '25:00'}))['machineOnTime'], 'Enter a valid time');
      expect(validateEntry(_valid({'machineOffTime': 'abc'}))['machineOffTime'], 'Enter a valid time');
      expect(validateEntry(_valid({'machineOnTime': '8', 'machineOffTime': '16.00'})), isEmpty);
    });

    test('Actual cannot beat Ideal; OK cannot beat Actual', () {
      expect(validateEntry(_valid({'actualQty': '641', 'okQty': '641', 'rejectBreakdown': {}}))['actualQty'], "Actual can't be more than Ideal Quantity (640)");
      expect(validateEntry(_valid({'actualQty': '640', 'okQty': '640', 'rejectBreakdown': {}, 'lunchMin': '0'})), isEmpty); // the whole shift made parts: no stoppage left
      expect(validateEntry(_valid({'okQty': '601', 'rejectBreakdown': {}}))['okQty'], "OK can't be more than Actual Quantity (600)");
      expect(validateEntry(_valid({'actualQty': '-1'}))['actualQty'], 'Must be 0 or more');
      expect(validateEntry(_valid({'actualQty': 'abc'}))['actualQty'], 'Must be 0 or more');
      expect(validateEntry(_valid({'okQty': '-5'}))['okQty'], 'Must be 0 or more');
    });

    test('no Actual cap while Ideal is unknown (no Part / times)', () {
      expect(validateEntry(_valid({'machineOnTime': '', 'actualQty': '99999', 'okQty': '99999', 'rejectBreakdown': {}})).containsKey('actualQty'), isFalse);
    });

    test('reject split: under, over, and nothing rejected', () {
      expect(
        validateEntry(_valid({'rejectBreakdown': {'Dimension Out': '4'}}))['rejectBreakdown'],
        '6 of 10 rejected piece(s) still have no reason — the boxes must add up to the rejected quantity',
      );
      expect(validateEntry(_valid({'rejectBreakdown': {}}))['rejectBreakdown'], startsWith('10 of 10 rejected piece(s)'));
      expect(
        validateEntry(_valid({'rejectBreakdown': {'Dimension Out': '6', 'Tool Mark': '5'}}))['rejectBreakdown'],
        'Split is 1 more than the 10 rejected — the boxes must add up to the rejected quantity',
      );
      expect(
        validateEntry(_valid({'okQty': '600', 'rejectBreakdown': {'Tool Mark': '2'}}))['rejectBreakdown'],
        'Nothing was rejected (Actual − OK is 0), so these boxes should be empty',
      );
      expect(validateEntry(_valid({'okQty': '600', 'rejectBreakdown': {}})), isEmpty);
      expect(validateEntry(_valid({'rejectBreakdown': {'Dimension Out': '-1'}}))['rejectBreakdown'], 'Rejected quantities must be 0 or more');
      expect(validateEntry(_valid({'rejectBreakdown': {'Dimension Out': 'x'}}))['rejectBreakdown'], 'Rejected quantities must be 0 or more');
      // blank and zero boxes are ignored
      expect(validateEntry(_valid({'rejectBreakdown': {'Dimension Out': '10', 'Tool Mark': '', 'Other': '0'}})), isEmpty);
    });

    test('rejecting as Other needs a remark', () {
      final withOther = _valid({'rejectBreakdown': {'Other': '10'}});
      expect(validateEntry(withOther)['rejectOtherRemark'], 'Remark is required when "Other" is a reject reason');
      expect(validateEntry({...withOther, 'rejectOtherRemark': '  '})['rejectOtherRemark'], isNotNull);
      expect(validateEntry({...withOther, 'rejectOtherRemark': 'burr'}), isEmpty);
      // Other with 0 pieces needs nothing
      expect(validateEntry(_valid({'rejectBreakdown': {'Dimension Out': '10', 'Other': '0'}})), isEmpty);
    });

    test('Planned Operator Shift is typed H.MM: 0:00 < time <= 24:00, minutes 00-59', () {
      const msg = 'Must be more than 0:00 and at most 24:00';
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '0'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '24.30'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': 'abc'}))['plannedOperatorShiftHours'], 'Enter hours and minutes like 8.30');
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '-1'}))['plannedOperatorShiftHours'], 'Enter hours and minutes like 8.30');
      // 60 minutes to the hour, not 100.
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8.75'}))['plannedOperatorShiftHours'], 'Minutes must be 00–59 (3.30 means 3 h 30 min)');
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '24', 'lunchMin': '0'})).containsKey('plannedOperatorShiftHours'), isFalse);
      // a single minute digit is tens of minutes: 8.5 is 8 h 50 min
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8.5', 'lunchMin': '0'})).containsKey('plannedOperatorShiftHours'), isFalse);
    });

    test('Planned Operator Shift can not be less than the Machine Shift', () {
      // machine ran 8:00, planned 7 h 30 min
      expect(
        validateEntry(_valid({'plannedOperatorShiftHours': '7.30'}))['plannedOperatorShiftHours'],
        "Planned Operator Shift (7:30) can't be less than Machine Shift (8:00)",
      );
      // equal is fine, and so is more
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8.00', 'lunchMin': '0'})), isEmpty);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '9', 'lunchMin': '0'})), isEmpty);
    });

    test('Lunch / Rest is optional: blank counts as 0, and it must fit like any other stoppage', () {
      expect(validateEntry(_valid({'lunchMin': ''})), isEmpty);
      expect(validateEntry(_valid({'lunchMin': '0'})), isEmpty);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8', 'lunchMin': ''})), isEmpty);
      expect(validateEntry(_valid({'lunchMin': '1441'}))['lunchMin'], '0–1440');
      expect(validateEntry(_valid({'lunchMin': '-1'}))['lunchMin'], '0–1440');
      expect(validateEntry(_valid({'lunchMin': 'x'}))['lunchMin'], '0–1440');
    });

    // _valid: 8 h run, planned 8.30 -> 30 min of stoppage (Lunch / Rest included).
    test('less stoppage than allowed saves; only Planned Operator Shift − Machine Shift is allowed', () {
      expect(validateEntry(_valid({'lunchMin': '20', 'setupMin': '5'})), isEmpty); // 25 of 30
      expect(validateEntry(_valid({'lunchMin': '20', 'setupMin': '10'})), isEmpty); // exactly 30
      expect(
        validateEntry(_valid({'lunchMin': '20', 'setupMin': '11'}))['stoppageTotal'],
        'Total stoppage is 31 min but only 30 min is allowed (Planned Operator Shift − Machine Shift)',
      );
      // 13 h planned on a 12 h run -> 60 min allowed
      final long = _valid({'machineOnTime': '08:00', 'machineOffTime': '20:00', 'plannedOperatorShiftHours': '13', 'totalCycleSec': '57', 'actualQty': '600', 'okQty': '590', 'lunchMin': '30', 'setupMin': '30'});
      expect(validateEntry(long).containsKey('stoppageTotal'), isFalse);
    });

    test('stoppage: each downtime box 0-1440 and the total capped by planned - shift', () {
      expect(validateEntry(_valid({'setupMin': '1441', 'lunchMin': '0'}))['setupMin'], '0–1440');
      expect(validateEntry(_valid({'noPowerMin': '-1'}))['noPowerMin'], '0–1440');
      // no allowance at all -> any stoppage is over the cap
      expect(
        validateEntry(_valid({'plannedOperatorShiftHours': '8.00', 'lunchMin': '0', 'setupMin': '1'}))['stoppageTotal'],
        'Total stoppage is 1 min but only 0 min is allowed (Planned Operator Shift − Machine Shift)',
      );
      // Planned Down Time is part of the total too
      expect(validateEntry(_valid({'plannedDownMin': '50'}))['stoppageTotal'], isNotNull);
      // A new entry can't run through midnight any more (one entry per date)…
      final overnight = _valid({'machineOnTime': '22:00', 'machineOffTime': '06:00', 'plannedOperatorShiftHours': '9', 'lunchMin': '20'});
      expect(validateEntry(overnight)['machineOffTime'], 'Machine OFF Time must be after Machine ON Time');
      // …but an older overnight row (22:00 -> 06:00 is 8 h) still saves while its times are untouched.
      expect(validateEntry(overnight, saved: {'machineOnTime': '22:00', 'machineOffTime': '06:00'}), isEmpty);
    });

    test('Other downtime needs a remark', () {
      final v = _valid({'otherMin': '5', 'lunchMin': '20'});
      expect(validateEntry(v)['otherMinRemark'], 'Remark is required when Other downtime is entered');
      expect(validateEntry({...v, 'otherMinRemark': 'power cut'}), isEmpty);
      expect(validateEntry(_valid({'otherMin': '0'})), isEmpty);
    });

    test('cycle-op boxes must be 0 or more', () {
      expect(validateEntry(_valid({'drillingSec': '-5'}))['drillingSec'], 'Must be 0 or more');
      expect(validateEntry(_valid({'otherOp2Sec': 'x'}))['otherOp2Sec'], 'Must be 0 or more');
      expect(validateEntry(_valid({'clampDeclampSec': '3'})), isEmpty);
    });
  });

  group('helpers', () {
    test('stoppageLimitMin = round(planned*60 - shift), never below 0, null until both exist', () {
      // (the sheet's stored rows hold decimal hours; the form's H.MM goes through withDecimalPlanned)
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '8.5'})), 30);
      expect(stoppageLimitMin(withDecimalPlanned(_valid())), 30);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '7'})), 0);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '8.004'})), 0); // 0.24 rounds to 0
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '8.0084'})), 1);
      expect(stoppageLimitMin(_valid({'machineOffTime': ''})), isNull);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': ''})), isNull);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': 'abc'})), isNull);
    });

    test('cleanSplit keeps only positive numbers', () {
      expect(cleanSplit({'a': '3', 'b': '', 'c': '0', 'd': '-1', 'e': 'x', 'f': 2.5, 'g': ' '}), {'a': 3.0, 'f': 2.5});
      expect(cleanSplit(null), isEmpty);
      expect(cleanSplit({}), isEmpty);
    });

    test('isBlank', () {
      expect(isBlank(null), isTrue);
      expect(isBlank(''), isTrue);
      expect(isBlank('  \t'), isTrue);
      expect(isBlank('0'), isFalse);
      expect(isBlank(0), isFalse);
      expect(isBlank('x'), isFalse);
    });

    test('firstError: first block, then form order within a block', () {
      expect(firstError([]), isNull);
      expect(firstError([{}, {}]), isNull);
      expect(firstError([null]), isNull);
      expect(firstError([{'okQty': 'x', 'date': 'y'}]), {'index': 0, 'field': 'date'});
      expect(firstError([{}, {'lunchMin': 'a', 'actualQty': 'b'}]), {'index': 1, 'field': 'actualQty'});
      expect(firstError([{}, {'zzz': 'unknown key'}]), {'index': 1, 'field': 'zzz'});
      expect(firstError([{'stoppageTotal': 's'}, {'date': 'd'}]), {'index': 0, 'field': 'stoppageTotal'});
    });

    test('fieldOrder reads top to bottom like the form', () {
      expect(fieldOrder.first, 'date');
      expect(fieldOrder.indexOf('okQty'), lessThan(fieldOrder.indexOf('rejectBreakdown')));
      expect(fieldOrder.indexOf('lunchMin'), lessThan(fieldOrder.indexOf('setupMin')));
      expect(fieldOrder.indexOf('otherMin'), lessThan(fieldOrder.indexOf('stoppageTotal')));
      expect(fieldOrder.indexOf('otherMinRemark'), lessThan(fieldOrder.indexOf('drillingSec')));
      expect(fieldOrder.last, 'clampDeclampSec');
      expect(fieldOrder.toSet().length, fieldOrder.length);
    });
  });
}
