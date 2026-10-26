import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

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
  operatorTests();
  final fixture = loadFixture('validation.json') as Map;

  group('golden: validateEntry (Dart == the real JS)', () {
    final cases = fixture['cases'] as List;

    test('${cases.length} blocks: same messages, same keys, same key order', () {
      expect(cases.length, greaterThan(600));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        // Planned Operator Shift is decimal hours on both sides now, so every
        // message — and the order of them — is the web's, field for field.
        final v = _m(c['v']);
        final got = validateEntry(v);
        final want = Map<String, dynamic>.from(c['errors'] as Map);
        expect(diff(got, want), isNull, reason: 'case $i ${showCase(c['v'])}');
        expect(got.keys.toList(), [for (final k in c['keys'] as List) k], reason: 'key order, case $i ${showCase(c['v'])}');
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

    test('Planned Operator Shift is typed as decimal hours like the sheet: more than 0, at most 24', () {
      const msg = 'Must be more than 0:00 and at most 24:00';
      const bad = 'Enter hours as on the sheet, like 8.5 or 5.33';
      String? planned(String t, [Map<String, dynamic> o = const {}]) =>
          validateEntry(_valid({'plannedOperatorShiftHours': t, 'lunchMin': '0', ...o}))['plannedOperatorShiftHours'];
      expect(planned('0'), msg);
      expect(planned('24.5'), msg);
      expect(planned('abc'), bad);
      expect(planned('-1'), bad);
      expect(planned('8.3.4'), bad);
      expect(planned('24'), isNull);
      // 8.5 is 8 h 30 min (not 8 h 50), 5.33 is 5 h 20 min, 0.5 is half an hour
      expect(planned('8.5'), isNull);
      expect(planned('8.75'), isNull);
      expect(planned('5.33', {'machineOnTime': '08:00', 'machineOffTime': '13:20'}), isNull);
      expect(planned('0.5', {'machineOnTime': '08:00', 'machineOffTime': '08:30'}), isNull);
      expect(planned(' 8,5 '), isNull, reason: 'a comma is read as the point');
    });

    test('Planned Operator Shift can not be less than the Machine Shift', () {
      // machine ran 8:00, planned 7.3 h (7 h 18 min)
      expect(
        validateEntry(_valid({'plannedOperatorShiftHours': '7.30'}))['plannedOperatorShiftHours'],
        "Planned Operator Shift can't be less than the Machine Shift (8:00)",
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

    // _valid: 8 h run, planned 8.30. The web's stoppage cap is the Machine Shift itself
    // (entryValidation.js stoppageLimitMin: spanMinutes(ON, OFF)) = 480 min; the old
    // "Planned Operator Shift − Machine Shift" rule (30 min here) is gone from the web.
    test('stoppage is capped at the whole Machine Shift, whatever the Planned Operator Shift is', () {
      expect(validateEntry(_valid({'lunchMin': '20', 'setupMin': '11'})), isEmpty); // 31 min: fine now (cap 480)
      expect(validateEntry(_valid({'lunchMin': '100', 'setupMin': '380'})), isEmpty); // exactly 480
      expect(
        validateEntry(_valid({'lunchMin': '100', 'setupMin': '381'}))['stoppageTotal'],
        'Total stoppage is 481 min but the Machine Shift is only 480 min',
      );
      // a planned shift equal to the machine shift no longer forbids stoppage
      expect(validateEntry(_valid({'plannedOperatorShiftHours': '8', 'lunchMin': '0', 'setupMin': '60'})), isEmpty);
    });

    test('Non Working returns right after date and machine', () {
      expect(validateEntry({'workingMode': 'Non Working'}), {'date': 'Date is required', 'machine': 'Machine No. is required'});
      expect(validateEntry(_valid({'workingMode': 'Non Working', 'operator': '', 'itemName': '', 'okQty': 'x'})), isEmpty);
      expect(validateEntry(_valid({'workingMode': 'Working', 'operator': ''}))['operator'], 'Operator is required');
    });

    test('stoppage: each downtime box 0-1440 and the total capped by the machine shift', () {
      expect(validateEntry(_valid({'setupMin': '1441', 'lunchMin': '0'}))['setupMin'], '0–1440');
      expect(validateEntry(_valid({'noPowerMin': '-1'}))['noPowerMin'], '0–1440');
      // Planned Down Time is part of the total too
      expect(validateEntry(_valid({'plannedDownMin': '481', 'lunchMin': '0'}))['stoppageTotal'], isNotNull);
      expect(validateEntry(_valid({'plannedDownMin': '480', 'lunchMin': '0'})).containsKey('stoppageTotal'), isFalse);
      // A new entry can't run through midnight any more (one entry per date)…
      final overnight = _valid({'machineOnTime': '22:00', 'machineOffTime': '06:00', 'plannedOperatorShiftHours': '9', 'lunchMin': '20'});
      expect(validateEntry(overnight)['machineOffTime'], 'Machine OFF Time must be after Machine ON Time');
      // …but an older overnight row (22:00 -> 06:00 is 8 h) still saves while its times are untouched.
      final savedRow = {'date': overnight['date'], 'machine': overnight['machine'], 'machineOnTime': '22:00', 'machineOffTime': '06:00'};
      expect(validateEntry(overnight, saved: savedRow), isEmpty);
      // …until the row is moved to another date or machine
      expect(validateEntry({...overnight, 'date': '2026-09-29'}, saved: savedRow)['machineOffTime'], 'Machine OFF Time must be after Machine ON Time');
      expect(validateEntry({...overnight, 'machine': 'm9'}, saved: savedRow)['machineOffTime'], 'Machine OFF Time must be after Machine ON Time');
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
    test('stoppageLimitMin = the Machine Shift in minutes, null until ON and OFF exist', () {
      // (web: spanMinutes(ON, OFF); the Planned Operator Shift no longer enters into it)
      expect(stoppageLimitMin(_valid()), 480);
      expect(stoppageLimitMin(withDecimalPlanned(_valid())), 480);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': '7'})), 480);
      expect(stoppageLimitMin(_valid({'plannedOperatorShiftHours': ''})), 480);
      expect(stoppageLimitMin(_valid({'machineOnTime': '22:00', 'machineOffTime': '06:00'})), 480);
      expect(stoppageLimitMin(_valid({'machineOffTime': ''})), isNull);
      expect(stoppageLimitMin(_valid({'machineOnTime': 'abc'})), isNull);
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

void operatorTests() {
  group('one operator can not be on two machines at the same time', () {
    final mine = {'date': '2026-09-28', 'machine': 'm2', 'operator': 'Asha', 'machineOnTime': '10:00', 'machineOffTime': '14:00'};
    final saved = <String, List<Map<String, dynamic>>>{
      'Asha|2026-09-28': [
        {'machine': 'm1', 'machineName': '7A', 'slot': 1, 'machineOnTime': '08:00', 'machineOffTime': '12:00'},
      ],
    };

    test('a clash is flagged live, on the box that runs into it, naming the machine and time', () {
      final e = operatorOverlapErrors([mine], saved).single;
      expect(e['machineOnTime'], "Operator Asha is already on machine 7A from 08:00 – 12:00 on this date — an operator can't run two machines at the same time");
      expect(isTimeRuleMessage(e['machineOnTime']), isTrue);
      expect(operatorOverlapErrors([{...mine, 'machineOnTime': '06:00', 'machineOffTime': '09:00'}], saved).single.keys, ['machineOffTime']);
    });

    test('touching, another operator, another date and the same machine never clash', () {
      expect(operatorOverlapErrors([{...mine, 'machineOnTime': '12:00', 'machineOffTime': '16:00'}], saved).single, isEmpty);
      expect(operatorOverlapErrors([{...mine, 'operator': 'Ravi'}], saved).single, isEmpty);
      expect(operatorOverlapErrors([{...mine, 'date': '2026-09-29'}], saved).single, isEmpty);
      expect(operatorOverlapErrors([{...mine, 'machine': 'm1'}], saved).single, isEmpty);
    });

    test('the row being edited is not another entry; an older clash stays editable while untouched', () {
      final savedRow = {'date': '2026-09-28', 'machine': 'm2', 'machineOnTime': '10:00', 'machineOffTime': '14:00'};
      expect(
        operatorOverlapErrors([{...mine, 'machine': 'm1', 'machineOnTime': '09:00', 'machineOffTime': '11:00'}], saved, editing: (machine: 'm1', slot: 1)).single,
        isEmpty,
      );
      expect(
        operatorOverlapErrors([mine], saved, saved: {...savedRow, 'operator': 'Asha'}).single,
        isEmpty,
      );
      // ...moving the row to another date or machine brings it back too
      expect(operatorOverlapErrors([mine], saved, saved: {...savedRow, 'date': '2026-09-27', 'operator': 'Asha'}).single, isNotEmpty);
      expect(operatorOverlapErrors([mine], saved, saved: {...savedRow, 'machine': 'm3', 'operator': 'Asha'}).single, isNotEmpty);
      // ...but changing the operator or a time brings the rule back
      expect(
        operatorOverlapErrors([mine], saved, saved: {...savedRow, 'operator': 'Ravi'}).single,
        isNotEmpty,
      );
    });

    test('two blocks of one form with the same operator on different machines are both flagged', () {
      final a = {...mine, 'machine': 'm1', 'machineOnTime': '08:00', 'machineOffTime': '12:00'};
      final both = operatorOverlapErrors([a, mine], {}, machineName: (id) => {'m1': '7A', 'm2': '7B'}[id] ?? '');
      expect(both[0], isNotEmpty);
      expect(both[1], isNotEmpty);
      expect(both[1].values.single, contains('machine 7A'));
    });
  });
}
