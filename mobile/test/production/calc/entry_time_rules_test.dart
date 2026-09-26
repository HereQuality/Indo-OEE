import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart';

import 'golden_support.dart';

// Machine ON/OFF times: OFF after ON, and no overlap between one machine's
// entries on a date. The golden cases are produced by the REAL web code
// (client/src/utils/entryValidation.js, see tool/gen_golden.mjs); the hand
// cases mirror client/src/utils/entryValidation.test.mjs.

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);

OccupiedTimes _occupied(dynamic raw) => {
      for (final e in (raw as Map).entries)
        '${e.key}': [for (final o in e.value as List) _m(o)],
    };

Map<String, dynamic> _entry([Map<String, dynamic> o = const {}]) =>
    {'date': '2026-09-25', 'machine': 'm1', 'machineOnTime': '08:00', 'machineOffTime': '12:00', ...o};

final OccupiedTimes _saved = {
  'm1|2026-09-25': [
    {'slot': 1, 'machineOnTime': '08:00', 'machineOffTime': '12:00'},
    {'slot': 2, 'machineOnTime': '14:00', 'machineOffTime': '18:00'},
  ],
};

void main() {
  final fixture = loadFixture('overlap.json') as Map;

  group('golden: Dart == the real web code', () {
    final cases = fixture['cases'] as List;

    test('${cases.length} overlap / booked / validate cases', () {
      expect(cases.length, greaterThan(300));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final entries = [for (final e in c['entries'] as List) _m(e)];
        final occupied = _occupied(c['occupied']);
        final editSlot = (c['editSlot'] as num?)?.toInt();
        final saved = c['saved'] == null ? null : _m(c['saved']);
        final why = 'case $i ${c['entries']} editSlot=$editSlot saved=$saved';

        expect(diff(overlapErrors(entries, occupied, editSlot: editSlot, saved: saved), c['out']), isNull, reason: 'overlapErrors $why');
        expect(
          diff([for (final e in entries) bookedRanges(e, occupied, editSlot: editSlot)], c['booked']),
          isNull,
          reason: 'bookedRanges $why',
        );
        expect(
          diff([for (final e in entries) validateEntry(e, saved: saved)], c['validate']),
          isNull,
          reason: 'validateEntry $why',
        );
      }
    });

    test('timeInterval agrees on every ON / OFF pair', () {
      final list = fixture['intervals'] as List;
      expect(list.length, greaterThan(250));
      for (final c in list) {
        final got = timeInterval((c as Map)['on'], c['off']);
        final want = c['out'];
        if (want == null) {
          expect(got, isNull, reason: '${c['on']} → ${c['off']}');
        } else {
          expect(got, isNotNull, reason: '${c['on']} → ${c['off']}');
          expect([got!.start, got.end], [(want as Map)['start'], want['end']], reason: '${c['on']} → ${c['off']}');
        }
      }
    });

    test('fmt12Minutes and isTimeRuleMessage agree', () {
      for (final c in fixture['fmt12'] as List) {
        expect(fmt12Minutes((c as Map)['m'] as int), c['out'], reason: 'minutes ${c['m']}');
      }
      for (final c in fixture['ruleMessages'] as List) {
        expect(isTimeRuleMessage((c as Map)['m'] as String), c['out'], reason: '${c['m']}');
      }
    });
  });

  group('OFF must be after ON', () {
    String? offError(Map<String, dynamic> o, {Map<String, dynamic>? saved}) => validateEntry(_entry(o), saved: saved)['machineOffTime'];

    test('equal and earlier are refused, later is fine', () {
      expect(offError({}), isNull);
      expect(offError({'machineOffTime': '08:00'}), 'Machine OFF Time must be after Machine ON Time');
      expect(offError({'machineOffTime': '07:55'}), 'Machine OFF Time must be after Machine ON Time');
      expect(offError({'machineOffTime': '08:05'}), isNull);
      expect(offError({'machineOnTime': '23:00', 'machineOffTime': '06:00'}), 'Machine OFF Time must be after Machine ON Time');
    });

    test('blank and invalid times keep their own messages', () {
      expect(offError({'machineOffTime': ''}), 'Machine OFF Time is required');
      expect(offError({'machineOffTime': '25:99'}), 'Enter a valid time');
      expect(validateEntry(_entry({'machineOnTime': ''}))['machineOffTime'], isNull, reason: 'no order complaint without a start');
    });

    test('an older row keeps saving while its times are untouched', () {
      final saved = {'machineOnTime': '22:00', 'machineOffTime': '06:00'};
      final legacy = {'machineOnTime': '22:00', 'machineOffTime': '06:00'};
      expect(offError(legacy, saved: saved), isNull);
      expect(offError({...legacy, 'machineOffTime': '05:00'}, saved: saved), 'Machine OFF Time must be after Machine ON Time');
    });
  });

  group('no overlap', () {
    test('starting inside a saved entry flags the ON box and names the clash', () {
      final e = overlapErrors([_entry({'machineOnTime': '10:00', 'machineOffTime': '13:00'})], _saved).single;
      expect(e.keys, ['machineOnTime']);
      expect(e['machineOnTime'], contains('overlaps another entry for this machine on this date (8:00 AM – 12:00 PM)'));
    });

    test('running into the next one flags the OFF box', () {
      final e = overlapErrors([_entry({'machineOnTime': '12:00', 'machineOffTime': '15:00'})], _saved).single;
      expect(e.keys, ['machineOffTime']);
      expect(e['machineOffTime'], contains('2:00 PM – 6:00 PM'));
    });

    test('touching entries are fine; other machines, dates and unfinished times never clash', () {
      expect(overlapErrors([_entry({'machineOnTime': '12:00', 'machineOffTime': '14:00'})], _saved), [<String, String>{}]);
      expect(overlapErrors([_entry({'machine': 'm2', 'machineOnTime': '09:00', 'machineOffTime': '10:00'})], _saved), [<String, String>{}]);
      expect(overlapErrors([_entry({'date': '2026-09-26', 'machineOnTime': '09:00', 'machineOffTime': '10:00'})], _saved), [<String, String>{}]);
      expect(overlapErrors([_entry({'machineOffTime': ''})], _saved), [<String, String>{}]);
    });

    test('two blocks of one form cannot overlap each other (both are flagged)', () {
      final errs = overlapErrors([
        _entry({'machineOnTime': '08:00', 'machineOffTime': '10:00'}),
        _entry({'machineOnTime': '09:00', 'machineOffTime': '11:00'}),
        _entry({'machine': 'm2', 'machineOnTime': '09:00', 'machineOffTime': '11:00'}),
      ], {});
      expect(errs[0]['machineOffTime'], isNotNull);
      expect(errs[1]['machineOnTime'], isNotNull);
      expect(errs[2], isEmpty);
    });

    test('editing: the row itself is not "another", its neighbours still are', () {
      expect(overlapErrors([_entry({'machineOnTime': '09:00', 'machineOffTime': '11:00'})], _saved, editSlot: 1), [<String, String>{}]);
      final grown = overlapErrors([_entry({'machineOnTime': '09:00', 'machineOffTime': '15:00'})], _saved, editSlot: 1).single;
      expect(grown['machineOffTime'], contains('2:00 PM – 6:00 PM'));
    });

    test('an older overlapping row is left alone while its times are untouched', () {
      final saved = {'machineOnTime': '10:00', 'machineOffTime': '13:00'};
      expect(
        overlapErrors([_entry({'machineOnTime': '10:00', 'machineOffTime': '13:00'})], _saved, editSlot: 3, saved: saved),
        [<String, String>{}],
      );
      final changed = overlapErrors([_entry({'machineOnTime': '10:00', 'machineOffTime': '13:05'})], _saved, editSlot: 3, saved: saved).single;
      expect(changed['machineOnTime'], isNotNull);
    });

    test('bookedRanges lists what the machine has, minus the row being edited', () {
      expect(bookedRanges(_entry(), _saved), ['8:00 AM – 12:00 PM', '2:00 PM – 6:00 PM']);
      expect(bookedRanges(_entry(), _saved, editSlot: 1), ['2:00 PM – 6:00 PM']);
      expect(bookedRanges(_entry({'machine': 'm9'}), _saved), isEmpty);
    });
  });
}
