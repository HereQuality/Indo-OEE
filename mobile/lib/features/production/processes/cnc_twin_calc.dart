import '../shared/production_sheet_calc.dart' as calc;
import '../shared/production_sheet_calc.dart' show jsString, jsTrim;

/// The figures of the "CNC twin" sheets — Contact, Trobe, Spring — which feed
/// the plain CNC formulas (client/src/utils/productionSheet.js) unchanged; the
/// shared calc carries the current web form (Availability / Performance /
/// Quality, the clamped Unutilized Machine Time, Productivity, `runQtyBasis`).

/// Web `NON_WORKING_STATUSES`: every Working Status but PRESENT.
const List<String> twinWorkingStatuses = calc.workingStatuses;
final List<String> twinNonWorkingStatuses = [
  for (final s in twinWorkingStatuses)
    if (s != 'PRESENT') s,
];

/// Web `isStatusOnly`: a day with a Working Status other than PRESENT carries
/// only its status (no part, times or quantities).
bool twinIsStatusOnly(Map<String, dynamic>? v) => twinNonWorkingStatuses
    .contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// Web `isNonWorking`: Machine Working Status = "Non Working".
bool twinIsNonWorking(Map<String, dynamic>? v) => calc.isNonWorking(v);

/// One entry's derived figures: the shared `rowCalc` (current with the web's
/// productionSheet.js). [totalBasis] is Spring's rule: Effective Machine Run Time
/// counts every piece run — OK + Rejected — not OK only (web `runQtyBasis: "total"`).
Map<String, dynamic> twinRowCalc(
  Map<String, dynamic>? row, {
  bool totalBasis = false,
}) {
  if (row == null) return <String, dynamic>{};
  return calc.rowCalc(totalBasis ? {...row, 'runQtyBasis': 'total'} : row);
}

/// Web `…DayCalc`: one result per row of one machine's date, sorted by Machine
/// ON time first. Figures that cover the whole date are shared by every row.
List<Map<String, dynamic>> twinDayCalc(
  Iterable<Map<String, dynamic>?>? rows, {
  bool totalBasis = false,
}) => calc.dayCalc(
  totalBasis
      ? [for (final r in rows ?? const <Map<String, dynamic>?>[]) if (r != null) {...r, 'runQtyBasis': 'total'}]
      : rows,
);
