import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

import 'golden_support.dart';

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);

/// A block that passes every rule: 8 h shift, 45 s cycle (ideal 640), planned
/// 8.5 h leaves 30 min = the lunch, and the split covers the 10 rejected.
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
      'plannedOperatorShiftHours': '8.5',
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
        final v = _m(c['v']);
        final got = validateEntry(v);
        expect(diff(got, c['errors']), isNull, reason: 'case $i ${showCase(c['v'])}');
        expect(got.keys.toList(), c['keys'], reason: 'key order, case $i ${showCase(c['v'])}');
      }
    });

    test('stoppageLimitMin / lunchRequired / cleanSplit / rowCalc agree on every block', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final v = _m(c['v']);
        expect(diff(stoppageLimitMin(v), c['limit']), isNull, reason: 'limit case $i ${showCase(c['v'])}');
        expect(lunchRequired(v), c['lunchRequired'], reason: 'lunchRequired case $i ${showCase(c['v'])}');
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
      expect(validateEntry(_valid({'actualQty': '640', 'okQty': '640', 'rejectBreakdown': {}})), isEmpty);
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

    test('Planned Operator Shift: 0 < h <= 24', () {
      const msg = 'Must be more than 0 and at most 24 hours';
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '0'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '-1'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '24.5'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': 'abc'}))['plannedOperatorShiftHours'], msg);
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '24', 'lunchMin': '0'})).containsKey('plannedOperatorShiftHours'), isFalse);
    });

    test('Lunch / Rest is required only when the planned shift leaves time over', () {
      // 8.5 h planned, 8 h run -> 30 min allowance -> lunch required.
      expect(validateEntry(_valid({'lunchMin': ''}))['lunchMin'], 'Lunch / Rest is required (enter 0 if none)');
      expect(validateEntry(_valid({'lunchMin': '0'})), isEmpty);
      // machine ran the whole 8 h planned shift -> no room -> optional.
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8', 'lunchMin': ''})), isEmpty);
      // ...and a negative allowance is clamped to 0 (still optional).
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '7', 'lunchMin': ''})).containsKey('lunchMin'), isFalse);
      expect(validateEntry(_valid({'lunchMin': '1441'}))['lunchMin'], '0–1440');
      expect(validateEntry(_valid({'lunchMin': '-1'}))['lunchMin'], '0–1440');
      expect(validateEntry(_valid({'lunchMin': 'x'}))['lunchMin'], '0–1440');
    });

    test('stoppage: each downtime box 0-1440 and the total capped by planned - shift', () {
      expect(validateEntry(_valid({'setupMin': '1441', 'lunchMin': '0'}))['setupMin'], '0–1440');
      expect(validateEntry(_valid({'noPowerMin': '-1'}))['noPowerMin'], '0–1440');
      expect(validateEntry(_valid({'lunchMin': '20', 'setupMin': '10'})), isEmpty);
      expect(
        validateEntry(_valid({'lunchMin': '20', 'setupMin': '11'}))['stoppageTotal'],
        'Total stoppage is 31 min but only 30 min is allowed (Planned Operator Shift − Machine Shift)',
      );
      // no allowance at all -> any stoppage is over the cap
      expect(
        validateEntry(_valid({'plannedOperatorShiftHours': '8', 'lunchMin': '0', 'setupMin': '1'}))['stoppageTotal'],
        'Total stoppage is 1 min but only 0 min is allowed (Planned Operator Shift − Machine Shift)',
      );
      // Planned Down Time is part of the total too
      expect(validateEntry(_valid({'plannedDownMin': '50'}))['stoppageTotal'], isNotNull);
      // A new entry can't run through midnight any more (one entry per date)…
      final overnight = _valid({'machineOnTime': '22:00', 'machineOffTime': '06:00', 'plannedOperatorShiftHours': '9', 'lunchMin': '60'});
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
      expect(stoppageLimitMin(_valid()), 30);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '7'})), 0);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '8.004'})), 0); // 0.24 rounds to 0
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '8.0084'})), 1);
      expect(stoppageLimitMin(_valid({'machineOffTime': ''})), isNull);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': ''})), isNull);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': 'abc'})), isNull);
    });

    test('lunchRequired', () {
      expect(lunchRequired(_valid()), isTrue);
      expect(lunchRequired(_valid({'plannedOperatorShiftHours': '8'})), isFalse);
      expect(lunchRequired(_valid({'plannedOperatorShiftHours': '7'})), isFalse);
      expect(lunchRequired(_valid({'machineOnTime': ''})), isFalse); // unknown
      expect(lunchRequired({}), isFalse);
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
