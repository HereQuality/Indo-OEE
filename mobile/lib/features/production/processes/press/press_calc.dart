import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumber, spanMinutes;

/// Port of client/src/utils/pressSheet.js — the PRESS sheet's figures.
///
/// PRESS works its cycle time out from a standard time, then hands the row to
/// the shared CNC formulas (`rowCalc` / `dayCalc`), so Machine Shift, Effective
/// Run Time, Setup Efficiency, Unreported Time and the OEE figures are the very
/// same formulas on every sheet.
///
/// The shared Dart `rowCalc` / `dayCalc` carry the web's current figures
/// (Availability / Performance / Quality, the day's Unreported / Unutilized,
/// Productivity), so nothing is layered on here.

/// A PRESS part's Operation choices (PRESS_OPERATIONS; also OPERATIONS in
/// server/models/PressEntry.js).
const List<String> pressOperations = ['Bending', 'Tapping', 'Blank'];

/// The entry form's Setup No. choices (SETUP_NUMBERS in PressEntryForm.jsx).
const List<String> pressSetupNumbers = ['1', '2', '3', '4', '5'];

/// The two tick boxes of the form (PRESS_PROGRAM_FIELDS): per-entry notes only.
const List<Map<String, String>> pressProgramFields = [
  {'key': 'standardTimeMin', 'label': 'Standard Time Taken (min)'},
  {'key': 'pcsPerStandardTime', 'label': 'No. Piece in Standard Time'},
];

double? _num(Object? v) => jsNumber(v);

/// Product Cycle Time (sec) = Standard Time Taken (min) × 60 ÷ No. Piece in
/// Standard Time; null until both are usable.
double? standardCycleSec(Map<String, dynamic>? row) {
  final minutes = _num(row?['standardTimeMin']);
  final pieces = _num(row?['pcsPerStandardTime']);
  return isNum(minutes) && isNum(pieces) && pieces! > 0 ? (minutes! * 60) / pieces : null;
}

/// The row as the shared formulas read it: its own cycle time in `totalCycleSec`.
Map<String, dynamic> _withCycle(Map<String, dynamic>? row) => {
      ...?row,
      'totalCycleSec': standardCycleSec(row) ?? '',
    };

/// `pressRowCalc`: the shared row figures over the standard-time cycle, with
/// Ideal Quantity = FLOOR(Machine Shift (min) × pieces ÷ Standard Time (min)) —
/// from the whole numbers typed, so a cycle time that doesn't divide evenly
/// can't tip a floor over by 1.
Map<String, dynamic> pressRowCalc(Map<String, dynamic>? row) {
  final r = _withCycle(row);
  final c = calc.rowCalc(r);
  final shiftMin = spanMinutes(r['machineOnTime'], r['machineOffTime']);
  final minutes = _num(r['standardTimeMin']);
  final pieces = _num(r['pcsPerStandardTime']);
  if (shiftMin == null || !isNum(minutes) || minutes! <= 0 || !isNum(pieces)) return c;
  final idealQty = (shiftMin * pieces! / minutes).floorToDouble();
  final shiftHours = c['shiftHours'] as double?;
  return {
    ...c,
    'idealQty': idealQty,
    'idealQtyPerHour': (shiftHours != null && shiftHours != 0 && !shiftHours.isNaN) ? idealQty / shiftHours : null,
  };
}

/// `pressDayCalc`: one result per row of one machine's one date — the shared
/// dayCalc over the standard-time cycle (it sorts by Machine ON like the controller).
List<Map<String, dynamic>> pressDayCalc(Iterable<Map<String, dynamic>?>? rows) =>
    calc.dayCalc([for (final r in rows ?? const <Map<String, dynamic>?>[]) if (r != null) _withCycle(r)]);

/// The most stoppage (Lunch / Rest included) an entry can account for — the
/// Machine Shift itself (entryValidation.js `stoppageLimitMin`): stoppage
/// happens inside the machine's own ON–OFF span. null until both times are usable.
double? pressStoppageLimitMin(Map<String, dynamic> v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

/// `PRESS_FORMULAS`: the shared formula texts (web `FORMULAS`) minus
/// `rejectedQty`, with the two that read differently here.
const Map<String, String> pressFormulas = {
  'cycle': 'Product Cycle Time = Standard Time Taken (min) × 60 ÷ No. Piece in Standard Time.',
  'shift': 'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty':
      'Ideal Quantity = FLOOR(Machine Shift Time (min) × No. Piece in Standard Time ÷ Standard Time Taken (min)) — the most the shift could make, so Actual OK + Rejected can\'t be more than this.',
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized':
      'Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, with Shift Hours and Lunch added up across every entry of this machine\'s date — so every entry of that machine/date shows the same figure. Shown as 0% when the result is below 0 and 100% when it is above 100.',
  'totalStoppage': 'Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.',
  'effective':
      'Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600, shown as hours:minutes (753 × 57 s = 11:55).',
  'unreported':
      'Unreported Time (min) = Planned Operator Shift − Effective Run Time − Total Stoppage, combined across every entry of this machine\'s date — so every entry of that machine/date shows the same figure.',
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      'OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine\'s date.',
  'oeeLunch':
      'OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine\'s date.',
  'oeeLunchCot':
      'OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine\'s date.',
  'availability':
      'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every stoppage; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'performance':
      'Performance = Cycle Time × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or stoppage.',
  'quality': 'Quality = OK Quantity ÷ (OK + Rejected), for this entry.',
  'review':
      'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
};
