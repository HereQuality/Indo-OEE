import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/sheet/editor/entry_draft_store.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_logic.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A block that passes validateEntry: 8 h machine shift on a 60 s part
/// (ideal 480), 400 made / 390 OK, the 10 rejects split, 9 h planned shift
/// (60 min of allowance, 40 used).
Map<String, dynamic> validBlock({Map<String, dynamic> extra = const {}}) => {
      ...emptyEntry(now: DateTime(2026, 9, 25)),
      'machine': 'm1',
      'operator': 'Ravi',
      'item': 'i1',
      'itemName': 'Bracket',
      'drawingNo': 'D-100',
      'totalCycleSec': '60',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': '400',
      'okQty': '390',
      'rejectBreakdown': <String, dynamic>{'Tool Mark': '6', 'Dimension Out': '4'},
      'plannedOperatorShiftHours': '9',
      'lunchMin': '30',
      'setupMin': '10',
      ...extra,
    };

/// The exact key set the web's toPayload sends (client/src/pages/ProductionSheet.jsx),
/// written out independently of the port.
const webPayloadKeys = {
  'date', 'machine', 'slot', 'item', 'excludedOps', 'rejectBreakdown', 'rejectReason',
  'operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark',
  'machineOnTime', 'machineOffTime',
  'actualQty', 'okQty', 'plannedOperatorShiftHours', 'totalCycleSec',
  'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin',
  'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin',
  'drillingSec', 'boringSec', 'threadingSec', 'tappingSec', 'chamferingSec',
  'otherOp1Sec', 'otherOp2Sec', 'clampDeclampSec',
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('emptyEntry', () {
    test('is a blank block dated today with slot 1', () {
      final e = emptyEntry(now: DateTime(2026, 3, 7));
      expect(e['date'], '2026-03-07');
      expect(e['slot'], 1);
      expect(e['machine'], '');
      expect(e['item'], '');
      expect(e['rejectBreakdown'], <String, dynamic>{});
      expect(e['excludedOps'], <dynamic>[]);
      for (final k in ['operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark', 'machineOnTime', 'machineOffTime', 'actualQty', 'okQty', 'plannedOperatorShiftHours', 'totalCycleSec', 'lunchMin', 'otherMin', 'drillingSec', 'clampDeclampSec']) {
        expect(e[k], '', reason: k);
      }
    });

    test('two blocks never share their split map or ops list', () {
      final a = emptyEntry();
      final b = emptyEntry();
      (a['rejectBreakdown'] as Map)['Tool Mark'] = '1';
      expect(b['rejectBreakdown'], isEmpty);
    });
  });

  group('toFormValues', () {
    final row = {
      '_id': 'r1',
      'date': '2026-09-24',
      'machine': 'm2',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'drawingNo': null,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 400,
      'okQty': 390.5,
      'rejectedQty': 9.5,
      'plannedOperatorShiftHours': 9,
      'totalCycleSec': 60,
      'lunchMin': 0,
      'rejectBreakdown': {'Tool Mark': 6, 'Bogus Reason': 3, 'Other': 3.5},
      'excludedOps': ['drillingSec'],
    };

    test('turns stored numbers into the text the boxes show and keeps the slot', () {
      final v = toFormValues(row);
      expect(v['actualQty'], '400');
      expect(v['okQty'], '390.5');
      expect(v['plannedOperatorShiftHours'], '9');
      expect(v['lunchMin'], '0'); // a stored zero is a value, not blank
      expect(v['setupMin'], '');
      expect(v['drawingNo'], '');
      expect(v['slot'], 2);
      expect(v['machine'], 'm2');
      expect(v['item'], 'i1');
      expect(v['excludedOps'], ['drillingSec']);
      expect(v['_id'], 'r1');
    });

    test('keeps only known reasons of the stored split, as text', () {
      final v = toFormValues(row);
      expect(v['rejectBreakdown'], {'Tool Mark': '6', 'Other': '3.5'});
    });

    test('a legacy record with one rejectReason puts its rejected pieces on that reason', () {
      final v = toFormValues({
        'date': '2026-09-24',
        'machine': 'm1',
        'slot': 1,
        'rejectReason': 'Surface Finish',
        'rejectedQty': 12,
      });
      expect(v['rejectBreakdown'], {'Surface Finish': '12'});
    });

    test('a legacy record with nothing rejected, or an unknown reason, has an empty split', () {
      expect(toFormValues({'date': 'd', 'machine': 'm', 'slot': 1, 'rejectReason': 'Tool Mark', 'rejectedQty': 0})['rejectBreakdown'], isEmpty);
      expect(toFormValues({'date': 'd', 'machine': 'm', 'slot': 1, 'rejectReason': 'Nope', 'rejectedQty': 4})['rejectBreakdown'], isEmpty);
    });

    test('an item-less record gets an empty item id', () {
      expect(toFormValues({'date': 'd', 'machine': 'm', 'slot': 1, 'item': null})['item'], '');
    });
  });

  group('toPayload', () {
    test('a new entry sends exactly the web body: slot "auto", numbers, cleaned split, biggest reason', () {
      final p = toPayload(validBlock(), isEdit: false);
      expect(p.keys.toSet(), webPayloadKeys);
      expect(p['date'], '2026-09-25');
      expect(p['machine'], 'm1');
      expect(p['slot'], 'auto');
      expect(p['item'], 'i1');
      expect(p['excludedOps'], <dynamic>[]);
      expect(p['rejectBreakdown'], {'Tool Mark': 6, 'Dimension Out': 4});
      expect(p['rejectReason'], 'Tool Mark');
      expect(p['operator'], 'Ravi');
      expect(p['itemName'], 'Bracket');
      expect(p['drawingNo'], 'D-100');
      expect(p['machineOnTime'], '08:00');
      expect(p['machineOffTime'], '16:00');
      // Numbers, whole ones without a decimal point.
      expect(p['actualQty'], isA<int>());
      expect(p['actualQty'], 400);
      expect(p['okQty'], 390);
      expect(p['plannedOperatorShiftHours'], 9);
      expect(p['totalCycleSec'], 60);
      expect(p['lunchMin'], 30);
      expect(p['setupMin'], 10);
      // Blank stays '' so the server unsets it. rejectedQty is never sent.
      expect(p['noPowerMin'], '');
      expect(p['drillingSec'], '');
      expect(p.containsKey('rejectedQty'), isFalse);
    });

    test('fractional numbers stay fractional', () {
      final p = toPayload(validBlock(extra: {'plannedOperatorShiftHours': '8.5', 'okQty': '390.25'}), isEdit: false);
      expect(p['plannedOperatorShiftHours'], 8.5);
      expect(p['okQty'], 390.25);
    });

    test('an edit saves back to its own slot, as a number', () {
      expect(toPayload(validBlock(extra: {'slot': 3}), isEdit: true)['slot'], 3);
      expect(toPayload(validBlock(extra: {'slot': '2'}), isEdit: true)['slot'], 2);
    });

    test('an entry without a part sends item null', () {
      expect(toPayload(validBlock(extra: {'item': ''}), isEdit: false)['item'], isNull);
    });

    test('drops zero and blank boxes from the split and picks the biggest as rejectReason', () {
      final p = toPayload(
        validBlock(extra: {
          'rejectBreakdown': <String, dynamic>{'Tool Mark': '', 'Machine Fault': '0', 'Surface Finish': '3', 'Dimension Out': '7'},
        }),
        isEdit: false,
      );
      expect(p['rejectBreakdown'], {'Surface Finish': 3, 'Dimension Out': 7});
      expect(p['rejectReason'], 'Dimension Out');
    });

    test('a tie in the split goes to the first reason typed (stable, like the web)', () {
      final p = toPayload(
        validBlock(extra: {
          'rejectBreakdown': <String, dynamic>{'Machine Fault': '5', 'Tool Mark': '5'},
        }),
        isEdit: false,
      );
      expect(p['rejectReason'], 'Machine Fault');
    });

    test('an empty split sends {} and no reason', () {
      final p = toPayload(validBlock(extra: {'okQty': '400', 'rejectBreakdown': <String, dynamic>{}}), isEdit: false);
      expect(p['rejectBreakdown'], <String, dynamic>{});
      expect(p['rejectReason'], '');
    });

    test('the Other remarks are kept only while their figure is above zero', () {
      final both = toPayload(
        validBlock(extra: {
          'rejectBreakdown': <String, dynamic>{'Other': '10'},
          'rejectOtherRemark': '  burr on the edge ',
          'otherMin': '20',
          'otherMinRemark': ' waiting for crane ',
        }),
        isEdit: false,
      );
      expect(both['rejectOtherRemark'], 'burr on the edge');
      expect(both['otherMinRemark'], 'waiting for crane');

      final none = toPayload(
        validBlock(extra: {
          'rejectBreakdown': <String, dynamic>{'Tool Mark': '10'},
          'rejectOtherRemark': 'stale text',
          'otherMin': '',
          'otherMinRemark': 'stale text',
        }),
        isEdit: false,
      );
      expect(none['rejectOtherRemark'], '');
      expect(none['otherMinRemark'], '');

      final zero = toPayload(validBlock(extra: {'otherMin': '0', 'otherMinRemark': 'stale'}), isEdit: false);
      expect(zero['otherMinRemark'], '');
    });

    test('text is trimmed, the general remark is kept', () {
      final p = toPayload(validBlock(extra: {'operator': '  Ravi ', 'remarks': ' ok run '}), isEdit: false);
      expect(p['operator'], 'Ravi');
      expect(p['remarks'], 'ok run');
    });

    test('a loosely typed time goes out as HH:mm (the server rejects anything else)', () {
      final p = toPayload(validBlock(extra: {'machineOnTime': '8', 'machineOffTime': '1630'}), isEdit: false);
      expect(p['machineOnTime'], '08:00');
      expect(p['machineOffTime'], '16:30');
    });

    test('excludedOps travel as given', () {
      final p = toPayload(validBlock(extra: {'excludedOps': <dynamic>['drillingSec', 'boringSec']}), isEdit: false);
      expect(p['excludedOps'], ['drillingSec', 'boringSec']);
    });

    test('the payload survives JSON encoding (no NaN / Infinity)', () {
      final p = toPayload(validBlock(extra: {'lunchMin': 'abc', 'setupMin': 'Infinity'}), isEdit: false);
      expect(p['lunchMin'], '');
      expect(p['setupMin'], '');
    });
  });

  group('hasAnyEntryData', () {
    test('a fresh block has none, and so does one that only carries the default date', () {
      expect(hasAnyEntryData([emptyEntry()]), isFalse);
    });

    for (final c in <String, Map<String, dynamic>>{
      'machine': {'machine': 'm1'},
      'operator': {'operator': 'Ravi'},
      'part': {'itemName': 'Bracket'},
      'drawing': {'drawingNo': 'D'},
      'remarks': {'remarks': 'x'},
      'on time': {'machineOnTime': '08:00'},
      'off time': {'machineOffTime': '16:00'},
      'planned shift': {'plannedOperatorShiftHours': '8'},
      'actual': {'actualQty': '0'},
      'ok': {'okQty': '5'},
      'split': {'rejectBreakdown': <String, dynamic>{'Tool Mark': '2'}},
      'a stoppage box': {'noPowerMin': '5'},
      'a cycle op': {'boringSec': '3'},
    }.entries) {
      test('is true once ${c.key} is filled', () {
        expect(hasAnyEntryData([emptyEntry(), {...emptyEntry(), ...c.value}]), isTrue);
      });
    }

    test('a split of blanks and zeros is not data', () {
      expect(hasAnyEntryData([{...emptyEntry(), 'rejectBreakdown': <String, dynamic>{'Tool Mark': '', 'Other': '0'}}]), isFalse);
    });
  });

  group('applyItemSelection', () {
    final items = [
      {
        '_id': 'i1',
        'itemName': 'Bracket',
        'drawingNo': 'D-100',
        'totalCycleSec': 60,
        'drillingSec': 20,
        'boringSec': 15.5,
        'threadingSec': null,
      },
      {'_id': 'i2', 'itemName': 'Flange'},
    ];

    test('copies the part name, drawing no, cycle time and operations onto the block', () {
      final v = applyItemSelection({...emptyEntry(), 'excludedOps': <dynamic>['boringSec'], 'remarks': 'keep'}, 'i1', items);
      expect(v['item'], 'i1');
      expect(v['itemName'], 'Bracket');
      expect(v['drawingNo'], 'D-100');
      expect(v['totalCycleSec'], '60');
      expect(v['drillingSec'], '20');
      expect(v['boringSec'], '15.5');
      expect(v['threadingSec'], '');
      expect(v['excludedOps'], isEmpty, reason: 'a newly picked part starts with every operation ticked');
      expect(v['remarks'], 'keep');
    });

    test('a part with no drawing / times blanks them', () {
      final v = applyItemSelection({...emptyEntry(), 'drawingNo': 'old', 'totalCycleSec': '99', 'drillingSec': '5'}, 'i2', items);
      expect(v['drawingNo'], '');
      expect(v['totalCycleSec'], '');
      expect(v['drillingSec'], '');
    });

    test('clearing the part blanks item, name and ops but keeps the rest', () {
      final v = applyItemSelection({...emptyEntry(), 'item': 'i1', 'itemName': 'Bracket', 'excludedOps': <dynamic>['x'], 'totalCycleSec': '60'}, '', items);
      expect(v['item'], '');
      expect(v['itemName'], '');
      expect(v['excludedOps'], isEmpty);
      expect(v['totalCycleSec'], '60');
    });

    test('an id that is not in the list only clears the link', () {
      final v = applyItemSelection({...emptyEntry(), 'item': 'i1', 'itemName': 'Bracket'}, 'gone', items);
      expect(v['item'], '');
      expect(v['itemName'], 'Bracket');
    });
  });

  test('a new block copies only the date of the block above it', () {
    final b = newBlockAfter([
      {...emptyEntry(), 'date': '2026-09-01', 'machine': 'm1', 'operator': 'Ravi'},
      {...emptyEntry(), 'date': '2026-09-03', 'machine': 'm2'},
    ], now: DateTime(2026, 9, 25));
    expect(b['date'], '2026-09-03');
    expect(b['machine'], '');
    expect(b['operator'], '');
    expect(newBlockAfter(const [], now: DateTime(2026, 9, 25))['date'], '2026-09-25');
  });

  test('a draft from an older build gets the fields it lacks, and keeps its own shape', () {
    final v = mergeDraftEntry({'machine': 'm1', 'operator': 'Ravi', 'rejectBreakdown': 'junk', 'excludedOps': null});
    expect(v['machine'], 'm1');
    expect(v['lunchMin'], '');
    expect(v['rejectBreakdown'], <String, dynamic>{});
    expect(v['excludedOps'], <dynamic>[]);
    expect(v['date'], isNotEmpty);
  });

  group('EntryDraftStore', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    final t0 = DateTime(2026, 9, 25, 10, 0, 0);

    test('a draft comes back within a minute, with its values intact', () async {
      final blocks = [
        validBlock(),
        {...emptyEntry(), 'machine': 'm2'},
      ];
      await EntryDraftStore.save(blocks, now: t0);
      final back = await EntryDraftStore.load(now: t0.add(const Duration(seconds: 59)));
      expect(back, blocks);
    });

    test('is gone after 60 seconds, and the expired draft is removed', () async {
      await EntryDraftStore.save([validBlock()], now: t0);
      expect(await EntryDraftStore.load(now: t0.add(const Duration(seconds: 61))), isNull);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey(EntryDraftStore.key), isFalse);
    });

    test('nothing saved, garbage or an empty list is null', () async {
      expect(await EntryDraftStore.load(), isNull);
      SharedPreferences.setMockInitialValues({EntryDraftStore.key: 'not json'});
      expect(await EntryDraftStore.load(), isNull);
      SharedPreferences.setMockInitialValues({EntryDraftStore.key: '{"entries":[],"savedAt":${t0.millisecondsSinceEpoch}}'});
      expect(await EntryDraftStore.load(now: t0), isNull);
      SharedPreferences.setMockInitialValues({EntryDraftStore.key: '{"entries":[{"a":1}]}'});
      expect(await EntryDraftStore.load(now: t0), isNull);
    });

    test('clear removes it', () async {
      await EntryDraftStore.save([validBlock()], now: t0);
      await EntryDraftStore.clear();
      expect(await EntryDraftStore.load(now: t0), isNull);
    });

    test('uses the web key', () {
      expect(EntryDraftStore.key, 'productionEntryDraft');
    });
  });
}
