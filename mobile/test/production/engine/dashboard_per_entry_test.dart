// The dashboard's per-entry counting (dashboard_engine.dart `summarize`), the
// port of client/src/utils/processDashboard.js `summarize`: a sheet whose
// entries are each worked out on their own (calcMode "perEntry", set by the
// server's dashboard feed — INJECTION MOULDING, PRINTING, BEFORE POWDER
// COATING) counts each ENTRY's Unreported / OEE figures, unless any entry of
// that machine-day carries Process Master's lock (then the day counts once);
// every other sheet stays one result per machine-day.
//
// The golden cases come from the REAL web summarize (written by
// test/production/processes/injection/tool/gen_injection_golden.mjs); the
// hand-made ones are utils/injectionSheet.test.mjs's dashboard checks on the
// paper sheet's real rows.
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart';
import 'package:indo/features/production/processes/injection/injection_calc.dart';

import '../calc/golden_support.dart';

const _dir = 'test/production/processes/injection/fixtures';

Map<String, dynamic> _m(Object? v) => Map<String, dynamic>.from(v as Map);

// [ON, OFF, Std (s), TOTAL, OK, downtime] — rows of the paper sheet.
const _paper = <(String, String, double, int, int, Map<String, dynamic>)>[
  ('08:30', '18:00', 20, 1608, 1600, {'lunchMin': 30}),
  ('08:30', '11:30', 15, 608, 600, {'setupMin': 30}),
  ('12:30', '16:30', 9, 1500, 1500, {}),
];

Map<String, dynamic> _entry(int i, [Map<String, dynamic> extra = const {}]) {
  final (on, off, std, total, ok, stops) = _paper[i];
  final shiftH = {0: 9.5, 1: 3.0, 2: 4.0}[i]!;
  return {
    '_id': 'e$i',
    'date': '2026-05-13',
    'machine': 'm1',
    'operator': 'RAMESH',
    'itemName': 'Part',
    'totalCycleSec': std,
    'machineOnTime': on,
    'machineOffTime': off,
    'actualQty': total,
    'okQty': ok,
    // The paper has no Planned column: each row works on its own Machine Shift.
    'plannedOperatorShiftHours': shiftH,
    ...stops,
    ...extra,
  };
}

// What GET /processes/entries hands over for INJECTION MOULDING.
Map<String, dynamic> _fed(int i, [Map<String, dynamic> extra = const {}]) =>
    _entry(i, {'runQtyBasis': 'total', 'calcMode': 'perEntry', ...extra});

void main() {
  group('summarize counts a per-entry sheet entry by entry', () {
    test('OEE averaged over the entries, Unreported added up over them', () {
      final rows = [_fed(1), _fed(2)];
      final s = summarize(rows);
      final each = injectionDayCalc(rows);
      expect(s['oeeLosses'], closeTo(((each[0]['oeeLosses'] as num) + (each[1]['oeeLosses'] as num)) / 2, 1e-12));
      expect(s['oeeLunch'], closeTo((0.8444444444444444 + 0.9375) / 2, 1e-9));
      expect(s['unreportedMin'], closeTo(-2 + 15, 1e-9));
      expect(s['effectiveHours'], closeTo((608 * 15 + 1500 * 9) / 3600, 1e-9), reason: 'Effective on TOTAL QTY.');
      expect(s['machineDays'], 1);
      expect(s['entries'], 2);
    });

    test('a locked day still counts once', () {
      final rows = [
        _fed(1, {'plannedOperatorShiftHours': 12, 'plannedLocked': true}),
        _fed(2, {'plannedOperatorShiftHours': 12, 'plannedLocked': true}),
      ];
      final s = summarize(rows);
      final d = injectionDayCalc(rows).first;
      expect(s['oeeLosses'], d['oeeLosses']);
      expect(s['unreportedMin'], d['unreportedMin']);
      // (608 × 15 + 1500 × 9) ÷ 3600 over 12 h less 30 min of Setup.
      expect(s['oeeLosses'], closeTo(((608 * 15 + 1500 * 9) / 3600) / 11.5, 1e-9));
    });

    test('one locked entry is enough to count that day once', () {
      final rows = [_fed(1, {'plannedOperatorShiftHours': 12, 'plannedLocked': true}), _fed(2)];
      final s = summarize(rows);
      expect(s['oeeLosses'], injectionDayCalc(rows).first['oeeLosses']);
      // Only `true` locks it (the server's Boolean); anything else is per entry.
      final loose = [_fed(1, {'plannedLocked': 'true'}), _fed(2)];
      expect(summarize(loose)['unreportedMin'], closeTo(-2 + 15, 1e-9));
    });

    test('every other sheet is still one figure per machine-day', () {
      final rows = [_entry(1), _entry(2)];
      final s = summarize(rows);
      // The two entries' runs (OK Qty — no runQtyBasis here) added up over their
      // Planned added up (3 h + 4 h) less the day's 30 min of Setup.
      expect(s['oeeLosses'], closeTo((600 * 15 + 1500 * 9) / 3600 / (3 + 4 - 0.5), 1e-9));
      expect(s['unreportedMin'], closeTo((3 + 4) * 60 - (600 * 15 + 1500 * 9) / 60 - 30, 1e-9));
    });

    test('the per-entry mode is read off the group\'s first row, machine-day by machine-day', () {
      final rows = [_fed(1), _fed(2), {..._entry(0), 'machine': 'c1'}, {..._entry(1), '_id': 'c-1', 'machine': 'c1'}];
      final s = summarize(rows);
      expect(s['machineDays'], 2);
      // Three OEE figures: the two INJECTION entries and the one CNC-style day.
      final perEntry = summarize([_fed(1), _fed(2)]);
      final perDay = summarize([{..._entry(0), 'machine': 'c1'}, {..._entry(1), '_id': 'c-1', 'machine': 'c1'}]);
      expect(s['oeeLosses'], closeTo(((perEntry['oeeLosses'] as num) * 2 + (perDay['oeeLosses'] as num)) / 3, 1e-12));
      expect(s['unreportedMin'], closeTo((perEntry['unreportedMin'] as num) + (perDay['unreportedMin'] as num), 1e-9));
    });
  });

  group('summarize matches the web (processDashboard.js) on per-entry feeds', () {
    final cases = loadFixture('dashboard_summary.json', dir: _dir) as List;
    test('${cases.length} feeds: entries, machine-days, Unreported, Unutilized and the three OEE', () {
      expect(cases.length, greaterThan(50));
      for (final c in cases) {
        final rows = [for (final r in (c as Map)['rows'] as List) _m(r)];
        final s = summarize(rows);
        final want = _m(c['out']);
        final got = {for (final k in want.keys) k: s[k]};
        expect(diff(got, want), isNull, reason: '${c['name']} ${showCase(c['rows'])}');
      }
    });
  });
}
