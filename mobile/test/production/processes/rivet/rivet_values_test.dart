import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';

import '../../calc/golden_support.dart';

// toPayload / toFormValues / hasAnyEntryData / part pick == the page's handlers.
const dir = 'test/production/processes/rivet/fixtures';

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);

void main() {
  test('emptyEntry has the web keys', () {
    final expected = loadFixture('empty_entry.json', dir: dir);
    expect(diff(rivetSpec.emptyEntry(now: DateTime(2026, 1, 1)), expected), isNull);
  });

  group('golden: toPayload', () {
    final cases = loadFixture('payload.json', dir: dir) as List;
    test('${cases.length} typed blocks', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final payload = rivetSpec.toPayload(_m(c['values']), isEdit: c['isEdit'] as bool);
        expect(diff(payload, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])}');
      }
    });
  });

  group('golden: saved row -> form values -> payload', () {
    final cases = loadFixture('round_trip.json', dir: dir) as List;
    test('${cases.length} records', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final form = rivetSpec.toFormValues(_m(c['row']));
        final payload = rivetSpec.toPayload(form, isEdit: c['isEdit'] as bool);
        expect(diff(payload, c['payload']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });
  });

  group('golden: hasAnyEntryData / entryHasData', () {
    final cases = loadFixture('has_data.json', dir: dir) as List;
    test('${cases.length} lists', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = [for (final b in c['blocks'] as List) _m(b)];
        expect(rivetSpec.hasAnyEntryData(blocks), c['any'], reason: 'any case $i');
        expect([for (final b in blocks) rivetSpec.entryHasData(b)], c['each'], reason: 'each case $i');
      }
    });
  });

  group('golden: picking a part', () {
    final fx = loadFixture('apply_item.json', dir: dir) as Map;
    final items = [for (final i in fx['items'] as List) _m(i)];
    test('copies the part\'s master values (and only those)', () {
      for (final raw in fx['cases'] as List) {
        final c = raw as Map;
        final out = rivetSpec.applyItemSelection(_m(c['values']), c['itemId'] as String, items);
        expect(diff(out, c['out']), isNull, reason: 'item ${c['itemId']} ${showCase(c['values'])}');
      }
    });
  });

  group('by hand', () {
    final now = DateTime(2026, 9, 25);
    test('a numeric part master becomes text on the block and a number in the payload', () {
      final v = rivetSpec.applyItemSelection(
        {...rivetSpec.emptyEntry(now: now), 'machine': 'm1'},
        'i1',
        [
          {'_id': 'i1', 'itemName': 'Rivet A', 'totalCycleSec': 45, 'rivetLoadingSec': 10, 'rivetProcessSec': 20, 'rivetUnloadingCleaningSec': 10, 'rivetOtherOperationsSec': 5},
        ],
      );
      expect(v['totalCycleSec'], '45');
      expect(v['rivetProcessSec'], '20');
      expect(rivetSpec.toPayload(v, isEdit: false)['totalCycleSec'], 45);
    });

    test('a new block copies the date above; a draft fills in what it lacks', () {
      final first = {...rivetSpec.emptyEntry(now: now), 'date': '2026-09-01'};
      expect(rivetSpec.newBlockAfter([first], now: now)['date'], '2026-09-01');
      final merged = rivetSpec.mergeDraftEntry({'machine': 'm1', 'excludedOps': null}, now: now);
      expect(merged['excludedOps'], isEmpty);
      expect(merged['machineStatus'], isEmpty);
      expect(merged['workingMode'], 'Working');
      expect(merged['noOfHoles'], '');
      expect(merged['machine'], 'm1');
    });

    test('a Non Working day sends its status, a Working one sends none', () {
      final base = {...rivetSpec.emptyEntry(now: now), 'machine': 'm1', 'machineStatus': ['No Planning']};
      expect(rivetSpec.toPayload({...base, 'workingMode': 'Non Working'}, isEdit: false)['machineStatus'], ['No Planning']);
      expect(rivetSpec.toPayload(base, isEdit: false)['machineStatus'], isEmpty);
      expect(rivetSpec.validateEntry({...base, 'workingMode': 'Non Working'}), isEmpty);
    });

    test('an edit sends the document _id and its own slot', () {
      final p = rivetSpec.toPayload({...rivetSpec.emptyEntry(now: now), '_id': 'r9', 'slot': 2}, isEdit: true);
      expect(p['_id'], 'r9');
      expect(p['slot'], 2);
      expect(rivetSpec.toPayload({...rivetSpec.emptyEntry(now: now), '_id': 'r9'}, isEdit: false).containsKey('_id'), isFalse);
    });
  });
}
