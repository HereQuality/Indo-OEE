/// The formula popovers of the Contact / Trobe tables (web `CONTACT_FORMULAS`
/// = `FORMULAS` from utils/sheetFormulas.js with `cycle` reading "this entry's
/// own cycle time"). Copied verbatim; the parity test compares them with the
/// web's.
const Map<String, String> twinFormulas = {
  'cycle': 'Total Cycle Time = this entry\'s own cycle time — filled in from the Part when picked, and can be changed for the day.',
  'shift':
      'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty': 'Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so Actual Quantity can\'t be more than this.',
  'rejectedQty': 'Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.',
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized': 'Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone. Shown as 0% when the result is below 0 and 100% when it is above 100.',
  'totalStoppage': 'Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.',
  'effective': 'Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600, shown as hours:minutes (753 × 57 s = 11:55).',
  'unreported': 'Unreported Time (min) = Planned Operator Shift − Effective Run Time − Total Stoppage, in whole minutes, combined across every entry of this machine\'s date — so every entry of that machine/date shows the same figure.',
  'setupEff':
      'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses': 'OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine\'s date.',
  'oeeLunch': 'OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine\'s date.',
  'oeeLunchCot': 'OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine\'s date.',
  'availability': 'Availability = Operating Time ÷ Planned Production Time, for this entry. Operating Time = Machine Shift − every stoppage; Planned Production Time = Planned Operator Shift − Lunch − Planned Down Time (the planned stops). Above 100% (red) sends the entry to Admin review.',
  'performance': 'Performance = Cycle Time × (OK + Rejected) ÷ Operating Time, for this entry — how fast it ran against its ideal speed. Above 100% (red) sends the entry to Admin review: usually a wrong cycle time, quantity or stoppage.',
  'quality': 'Quality = OK Quantity ÷ (OK + Rejected), for this entry.',
  'review': 'Admin review: an entry whose Availability, Performance or Quality is above 100% is held as Pending review until an Admin or Super Admin approves or rejects it. Editing the figures sends it back for review; hover for details.',
};

/// Spring's table: the same, but Effective Machine Run Time counts every piece
/// run (web `SPRING_FORMULAS`).
final Map<String, String> springFormulasMap = {
  ...twinFormulas,
  'effective': 'Effective Machine Run Time = (OK Qty + Rejected Qty) × Standard Time per Piece ÷ 3600 — every piece run counts on this sheet.',
};
