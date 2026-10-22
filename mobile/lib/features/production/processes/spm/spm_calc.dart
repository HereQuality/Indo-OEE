import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart' show Json;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumber, jsTrim, jsString, jsTruthy, stoppageFields;

/// Port of client/src/utils/spmSheet.js — the SPM sheet's figures.
///
/// Like CNC, an SPM part's cycle time is set once on the Part: its four named
/// operations (Loading, Process, Unloading and Cleaning, Other Operations) sum
/// to Total Cycle Time. Picking a part copies the sum (`totalCycleSec`) and the
/// four operations onto the entry; unticking one subtracts its own seconds from
/// THIS entry's cycle time. From there on the shared CNC formulas apply, so
/// [spmRowCalc] / [spmDayCalc] feed CNC's shared `rowCalc` / `dayCalc` the SPM
/// cycle ([_withCycle]).

/// The named operation-time boxes, in sheet order (web `SPM_OP_FIELDS`).
const List<Map<String, String>> spmOpFields = [
  {'key': 'loadingSec', 'label': 'Loading (sec)'},
  {'key': 'processSec', 'label': 'Process (sec)'},
  {'key': 'unloadingCleaningSec', 'label': 'Unloading and Cleaning (sec)'},
  {'key': 'otherOperationsSec', 'label': 'Other Operations (sec)'},
];

/// An SPM part's three reference figures (web `SPM_REFERENCE_FIELDS`) — shown,
/// not part of any formula.
const List<Map<String, String>> spmReferenceFields = [
  {'key': 'noOfHoles', 'label': 'No. of Holes in One Piece'},
  {'key': 'piecesPerCycle', 'label': 'No. of Piece in One Cycle'},
  {'key': 'strokeRequired', 'label': 'Stroke Required for One Piece'},
];

final List<String> spmOpKeys = [for (final f in spmOpFields) f['key']!];
final List<String> spmReferenceKeys = [for (final f in spmReferenceFields) f['key']!];

/// The form's wording of an operation (the label without its unit).
String spmOpLabel(Map<String, String> f) => f['label']!.replaceFirst(' (sec)', '');

/// Web `isSpmProcess`: a process is SPM when its Data Entry Page is the SPM
/// page, or — when it is linked to none yet — it is named so.
bool isSpmProcess(Json? process) {
  final page = process?['dataEntryMenu'];
  final text = jsTruthy(page) ? jsString(page) : '';
  if (text.isNotEmpty) return RegExp(r'/spm-data-entry/?$').hasMatch(text);
  final name = process?['processName'];
  return RegExp(r'\bspm\b', caseSensitive: false).hasMatch(jsTruthy(name) ? jsString(name) : '');
}

double _sumOrZero(Iterable<double?> vals) => vals.fold<double>(0, (s, v) => s + (isNum(v) ? v! : 0));

/// Web `spmCycleSec`: the Part's own Total Cycle Time minus whichever of the four
/// operations are unticked for this entry; blank without a Part Name.
double? spmCycleSec(Json? row) {
  final name = row?['itemName'];
  if (!(jsTruthy(name) && jsTrim(jsString(name)).isNotEmpty)) return null;
  final raw = row?['excludedOps'];
  final excluded = raw is Iterable ? {for (final k in raw) k} : <Object?>{};
  final excludedSec = _sumOrZero([
    for (final f in spmOpFields)
      if (excluded.contains(f['key'])) jsNumber(row?[f['key']]),
  ]);
  final ownTotal = jsNumber(row?['totalCycleSec']);
  return isNum(ownTotal) ? ownTotal! - excludedSec : null;
}

/// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
Json _withCycle(Json? row) => {...?row, 'totalCycleSec': spmCycleSec(row) ?? ''};

/// Web `rowCalc` for an SPM row (`spmRowCalc`): the shared figures over SPM's cycle
/// (Availability / Performance / Quality included).
Json spmRowCalc(Json? row) => calc.rowCalc(_withCycle(row));

/// Web `dayCalc` over [rows] with SPM's cycle (`spmDayCalc`): one map per row, in
/// Machine ON order. Unutilized, Unreported Time and the three OEE figures are
/// combined across the machine's whole date, so every entry of it shows the same.
/// (The web feeds the already-adjusted rows to the plain rowCalc, so an unticked
/// operation is only taken off once.)
List<Json> spmDayCalc(Iterable<Json?>? rows) =>
    calc.dayCalc((rows ?? const <Json?>[]).map(_withCycle));

/// The ⓘ texts of the SPM table (web `SPM_FORMULAS`): the shared sheet formulas
/// without `rejectedQty` (it is typed here) and with SPM's own `cycle`.
const Map<String, String> spmFormulas = {
  'cycle': 'Total Cycle Time = Loading (Sec) + Process (Sec) + Unloading and Cleaning (Sec) + Other Operations (Sec).',
  'shift': 'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty':
      "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so Actual Quantity can't be more than this.",
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      'Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone. Shown as 0% when the result is below 0 and 100% when it is above 100.',
  'totalStoppage': 'Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.',
  'stoppageAllowed':
      'Stoppage Allowed = the Machine Shift in minutes: all of Lunch / Rest and every downtime together can not be more than the machine ran.',
  'effective': 'Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600, shown as hours:minutes (753 × 57 s = 11:55).',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift − Effective Run Time − Total Stoppage, in whole minutes, combined across every entry of this machine's date — so every entry of that machine/date shows the same figure.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      "OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every stoppage; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Cycle Time × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or stoppage.',
  'quality': 'Quality = OK Quantity ÷ (OK + Rejected), for this entry.',
  'review':
      'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
};

/// The ten stoppage keys (web `STOPPAGE_FIELDS`).
final List<String> spmStoppageKeys = [for (final f in stoppageFields) f['key'] as String];
