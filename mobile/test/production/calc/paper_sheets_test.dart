import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

import 'golden_support.dart';

/// The three paper sheets that work every entry out on its own — Printing,
/// Injection Moulding and Before Powder Coating (pasted by the user
/// 2026-10-26). The same 51 rows client/src/utils/paperSheets.test.mjs checks
/// (fixtures/paper_sheets.json is copied from it): each row entered as its sheet
/// has it, Planned Operator Shift typed equal to its Machine Shift, the process
/// unlocked — every OEE and Unreported Time figure must equal the paper's.
void main() {
  final sheets = (loadFixture('paper_sheets.json') as Map).cast<String, dynamic>();

  Map<String, dynamic> entry(Map row) {
    final std = row['std'];
    return <String, dynamic>{
      'itemName': std == null ? '' : 'Part',
      'totalCycleSec': std ?? '',
      'machineOnTime': row['on'],
      'machineOffTime': row['off'],
      'actualQty': row['total'],
      'okQty': row['ok'],
      'runQtyBasis': 'total',
      'plannedOperatorShiftHours': spanMinutes(row['on'], row['off'])! / 60,
      ...(row['stops'] as Map).cast<String, dynamic>(),
    };
  }

  double pct(double v) => jsRound(v * 10000) / 100;

  for (final sheet in sheets.keys) {
    final rows = (sheets[sheet] as List).cast<Map>();
    final lossesExceptLunch = sheet == 'bpc';
    test('$sheet: every example row matches the paper sheet (${rows.length} rows)', () {
      for (final r in rows) {
        final row = r['row'] as Map;
        final paper = r['paper'] as Map;
        final d = entryDayCalc([entry(row)], lossesExceptLunch: lossesExceptLunch)[0];
        final c = rowCalc(entry(row));
        final want = (paper['oee'] as List).map((v) => (v as num).toDouble()).toList();
        final got = [d['oeeLosses'], d['oeeLunch'], d['oeeLunchCot']]
            .take(want.length)
            .map((v) => row['std'] == null ? 0.0 : pct(v as double))
            .toList();
        expect(got, want, reason: 'OEE ${row['on']}–${row['off']}');
        final dp = (paper['unrepDp'] as num?)?.toInt() ?? 6;
        expect(jsToFixed(d['unreportedMin'] as double, dp), jsToFixed((paper['unrep'] as num).toDouble(), dp),
            reason: 'Unreported ${row['on']}–${row['off']}');
        if (paper['eff'] != null) {
          expect(((c['effectiveHours'] as double?) ?? 0) - (paper['eff'] as num), closeTo(0, 1e-6),
              reason: 'Effective ${row['on']}–${row['off']}');
        }
      }
      expect(entryDayCalc([for (final r in rows) entry(r['row'] as Map)], lossesExceptLunch: lossesExceptLunch).length,
          rows.length);
    });
  }

  test("a day sharing one operator keeps each entry's own figures (Printing SUREKHA 13/05: 94.93% and 56.00%)", () {
    final ab = (sheets['printing'] as List).sublist(2, 4).map((r) => entry((r as Map)['row'] as Map)).toList();
    final res = entryDayCalc(ab);
    expect(res.map((d) => pct(d['oeeLosses'] as double)).toList(), [94.93, 56]);
  });

  test("a day on Process Master's 12 h lock is combined once, as on every other sheet", () {
    final ab = (sheets['printing'] as List)
        .sublist(2, 4)
        .map((r) => {...entry((r as Map)['row'] as Map), 'plannedOperatorShiftHours': 12, 'plannedLocked': true})
        .toList();
    final res = entryDayCalc(ab);
    expect(res[0]['oeeLosses'], res[1]['oeeLosses']);
    expect(res[0]['oeeLosses'] as double, closeTo((7.277777777777778 + 0.32666666666666666) / 11.5, 1e-9));
  });

  test("Printing's own three downtime columns count as stoppage when the row lists them", () {
    final row = {
      ...entry((sheets['printing'] as List)[2]['row'] as Map),
      'askQueryQcMin': 5, 'emptyBagTuggingMin': 7, 'stockCountingMin': 3,
    };
    expect(rowCalc(row)['totalStoppageMin'], 30);
    expect(rowCalc({...row, 'extraStoppageKeys': ['askQueryQcMin', 'emptyBagTuggingMin', 'stockCountingMin']})['totalStoppageMin'], 45);
  });
}
