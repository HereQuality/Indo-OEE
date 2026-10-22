// The Data Entry list's search box: the web VMC page also matches the Work Order No.
// (other pages: part, operator, drawing no — Powder Coating: item, worker, vendor).
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart';
import 'package:indo/features/production/processes/powder_coating/powder_spec.dart';
import 'package:indo/features/production/processes/press/press_spec.dart';
import 'package:indo/features/production/processes/vmc/vmc_spec.dart';
import 'package:indo/features/production/sheet/sheet_model.dart';

List<String> _hits(ProcessSpec spec, String q, List<Map<String, dynamic>> rows) {
  final days = buildSheetDays(
    rows: rows,
    filters: SheetFilters.empty,
    search: q,
    machineName: const {'m1': 'VMC 1'},
    rankOf: (_) => 0,
    searchKeys: spec.searchKeys,
  );
  return [for (final d in days) for (final m in d.machines) for (final e in m.entries) '${e['_id']}'];
}

void main() {
  final rows = <Map<String, dynamic>>[
    {'_id': 'a', 'date': '2026-10-01', 'machine': 'm1', 'slot': 1, 'itemName': 'Bracket', 'operator': 'Ravi', 'drawingNo': 'D-100', 'workOrderNo': 'WO-2026-0042'},
    {'_id': 'b', 'date': '2026-10-01', 'machine': 'm1', 'slot': 2, 'itemName': 'Washer', 'operator': 'Asha', 'drawingNo': 'PG21', 'workOrderNo': ''},
  ];

  test('VMC finds an entry by its Work Order No. (and still by part / operator / drawing no)', () {
    expect(_hits(vmcSpec, 'wo-2026', rows), ['a']);
    expect(_hits(vmcSpec, '0042', rows), ['a']);
    expect(_hits(vmcSpec, 'asha', rows), ['b']);
    expect(_hits(vmcSpec, 'pg21', rows), ['b']);
    expect(_hits(vmcSpec, 'bracket', rows), ['a']);
    expect(vmcSpec.searchHint, 'Search part, operator, drawing / work order no…');
  });

  test('the other pages do not search the Work Order No., and say "drawing no" in the hint', () {
    expect(_hits(cncSpec, 'wo-2026', rows), isEmpty);
    expect(_hits(pressSpec, 'wo-2026', rows), isEmpty);
    expect(cncSpec.searchHint, 'Search part, operator, drawing no…');
    expect(pressSpec.searchHint, 'Search part, operator, drawing no…');
    expect(powderCoatingSpec.searchHint, 'Search item, worker, vendor…');
  });
}
