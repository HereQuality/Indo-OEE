// Port of client/src/utils/rubberSheet.js — the RUBBER sheet's figures: the
// CNC sheet's own formulas (shared/production_sheet_calc.dart), unchanged, fed
// this sheet's fields:
//
//   Working Start / End Time      → machineOnTime / machineOffTime
//   Worker Shift Time             → Machine Shift Time
//   Total Cycle Time (sec)        → totalCycleSec
//   Effective working Time (hr)   → Effective Run Time, on OK Qty
//
// plus the two Productivity figures dayCalc works out per worker per date.
// There's no machine: each row's `machine` is its worker's id (the API sets
// it), so the shared table and day formulas group by worker. Verified against
// the REAL JS by golden vectors (test/production/processes/rubber).

import '../../shared/production_sheet_calc.dart';

/// Which sheet a process's data entry happens on is the page it is linked to in
/// Process Master (its "Data Entry Page"). A process not linked to any page yet
/// is taken as RUBBER if it is named so (web `isRubberProcess`).
bool isRubberProcess(Map<String, dynamic>? process) {
  final page = jsString(process?['dataEntryMenu'] ?? '');
  if (page.isNotEmpty) return RegExp(r'/rubber-data-entry/?$').hasMatch(page);
  return RegExp(r'\brubber\b', caseSensitive: false).hasMatch(jsString(process?['processName'] ?? ''));
}

/// Every Working Status but PRESENT is a day the worker didn't work — such an
/// entry is status-only (server/models/RubberEntry.js).
final List<String> rubberNonWorkingStatuses = [
  for (final s in workingStatuses)
    if (s != 'PRESENT') s,
];

/// JS `isStatusOnly`: a Working Status other than PRESENT.
bool rubberIsStatusOnly(Map<String, dynamic>? v) =>
    rubberNonWorkingStatuses.contains(jsTrim(jsString(v?['workingStatus'] ?? '')));

/// The sheet's stoppage columns, in its own order and wording — no B.D. Mech. /
/// B.D. Ele.: a worker has no machine to break down (`RUBBER_STOPPAGE_FIELDS`,
/// key / label).
const List<(String, String)> rubberStoppageFields = [
  ('plannedDownMin', 'Planned downtime (min)'),
  ('setupMin', 'Set-up Time (min)'),
  ('noManPowerMin', 'No Manpower (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('lunchMin', 'Lunch / Tea / Washroom etc (min)'),
  ('otherMin', 'Others (min)'),
];

/// The stoppage keys in sheet order (`RUBBER_MINUTE_KEYS`).
final List<String> rubberMinuteKeys = [for (final f in rubberStoppageFields) f.$1];

/// `rubberRowCalc`: the shared row formulas, as they are.
Map<String, dynamic> rubberRowCalc(Map<String, dynamic>? row) => rowCalc(row);

/// `rubberDayCalc`: the shared day formulas, one map per row in
/// `sortByMachineOn` order.
List<Map<String, dynamic>> rubberDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    dayCalc(rows ?? const <Map<String, dynamic>?>[]);

/// The formula popovers for this table's calculated headers (`RUBBER_FORMULAS`:
/// the web's shared FORMULAS with this sheet's own wording on top).
const Map<String, String> rubberFormulas = {
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, with Shift Hours and Lunch added up across every entry of this machine's date — so every entry of that machine/date shows the same figure. Shown as 0% when the result is below 0 and 100% when it is above 100.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      "OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'performance':
      'Performance = Cycle Time × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or stoppage.',
  'quality': 'Quality = OK Quantity ÷ (OK + Rejected), for this entry.',
  'review':
      'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
  // This sheet's own wording.
  'shift': 'Worker Shift Time = Working End Time − Working Start Time',
  'cycle': 'Total Cycle Time — filled in from the Part when picked, and can be changed for the day.',
  'idealQty': 'IDEAL Quantity = Worker Shift Time × 3600 ÷ Total Cycle Time, rounded down.',
  'idealQtyPerHour': 'IDEAL Quantity / Hour = IDEAL Quantity ÷ Worker Shift Time',
  'rejectedQty':
      'Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Worker Shift Time − every stoppage; Planned Production Time = Planned Operator Shift − Lunch / Tea − Planned downtime (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'totalStoppage': 'Total stoppage = every stoppage column added up, Lunch / Tea / Washroom included.',
  'effective': 'Effective working Time (hr) = Actual OK Quantity × Total Cycle Time ÷ 3600',
  'unreported':
      "Unreported Time (min) = Planned Operator Shift − Effective working Time − Total stoppage, combined across every entry of this worker's date.",
  'productivity':
      "Productivity without considering Lunch, Tea, etc. = Effective working Time ÷ Planned Operator Shift, combined across every entry of this worker's date.",
  'productivityLunch':
      "Productivity considering Lunch, Tea, etc. = Effective working Time ÷ (Planned Operator Shift − Lunch / Tea), combined across every entry of this worker's date.",
};
