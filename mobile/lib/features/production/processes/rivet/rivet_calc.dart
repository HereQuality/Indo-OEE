import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumber, jsString, jsTrim, jsTruthy;

// Port of client/src/utils/rivetSheet.js — the RIVET sheet's figures. A RIVET
// part's cycle time is set once on the Part: four named operations (Loading,
// Process, Unloading and Cleaning, Other Operations) summing to Total Cycle
// Time. Picking a part copies the sum (totalCycleSec) and the four operations
// onto the entry; unticking one subtracts its own seconds from THIS entry's
// Total Cycle Time only. The shared (CNC) formulas do the rest.

/// A RIVET part's Process choices (RIVET_PROCESS_TYPES; keep in step with
/// server/models/Item.js and RivetEntry.js).
const List<String> rivetProcessTypes = ['Rivet', 'Clamp'];

/// The named operation-time boxes, in sheet order (RIVET_OP_FIELDS).
const List<Map<String, dynamic>> rivetOpFields = [
  {'key': 'rivetLoadingSec', 'label': 'Loading (sec)'},
  {'key': 'rivetProcessSec', 'label': 'Process (sec)'},
  {'key': 'rivetUnloadingCleaningSec', 'label': 'Unloading and Cleaning (sec)'},
  {'key': 'rivetOtherOperationsSec', 'label': 'Other Operations (sec)'},
];

final List<String> rivetOpKeys = [for (final f in rivetOpFields) f['key'] as String];

double _sumOrZero(Iterable<double?> vals) => vals.fold<double>(0, (s, v) => s + (isNum(v) ? v! : 0));

/// Total Cycle Time (sec) = the Part's own Total Cycle Time (copied onto the
/// entry when picked) minus whichever of the four operations are unticked for
/// this entry. null without a Part Name (or without a usable own total).
double? rivetCycleSec(Map<String, dynamic>? row) {
  final name = row?['itemName'];
  if (jsTrim(jsTruthy(name) ? jsString(name) : '').isEmpty) return null;
  final raw = row?['excludedOps'];
  final excluded = raw is Iterable ? {for (final k in raw) '$k'} : <String>{};
  final excludedSec = _sumOrZero([
    for (final f in rivetOpFields)
      if (excluded.contains(f['key'])) jsNumber(row?[f['key']]),
  ]);
  final ownTotal = jsNumber(row?['totalCycleSec']);
  return isNum(ownTotal) ? ownTotal! - excludedSec : null;
}

/// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
Map<String, dynamic> _withCycle(Map<String, dynamic>? row) => {...?row, 'totalCycleSec': rivetCycleSec(row) ?? ''};

/// `rivetRowCalc`.
Map<String, dynamic> rivetRowCalc(Map<String, dynamic>? row) {
  return calc.rowCalc(_withCycle(row));
}

/// `rivetDayCalc`: one result per row of one machine's one date, same order and
/// meaning as the CNC dayCalc.
List<Map<String, dynamic>> rivetDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    calc.dayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) _withCycle(r)]);

/// `RIVET_FORMULAS`: the web's FORMULAS (utils/sheetFormulas.js) without
/// "rejectedQty" (typed on this sheet), with the RIVET cycle wording.
const Map<String, String> rivetFormulas = {
  'cycle': 'Total Cycle Time = Loading (Sec) + Process (Sec) + Unloading and Cleaning (Sec) + Other Operations (Sec).',
  'shift': 'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty':
      "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so Actual Quantity can't be more than this.",
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      'Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone. Shown as 0% when the result is below 0 and 100% when it is above 100.',
  'totalStoppage': 'Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.',
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
