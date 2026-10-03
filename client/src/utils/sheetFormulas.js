/**
 * utils/sheetFormulas.js
 * ───────────────────────
 * The formula popovers shared by the Production Data Entry tables (CNC and VMC).
 */

// The plain-English formula behind every calculated column — shown in a
// popover from the eye icon next to its header, so nobody has to remember or
// ask what a grey box actually computed.
export const FORMULAS = {
  cycle: "The Part's own Total Cycle Time, minus any operation unticked for this entry.",
  shift: "Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24",
  idealQty:
    "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so Actual Quantity can't be more than this.",
  rejectedQty:
    "Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.",
  pctOk: "% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)",
  unutilized: "Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone.",
  totalStoppage:
    "Total Stoppage = Lunch / Rest + the downtime columns opened here: Setup Time … Other.",
  effective: "Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600, shown as hours:minutes (753 × 57 s = 11:55).",
  unreported:
    "Unreported Time (min) = Planned Operator Shift − Machine Shift − Total Stoppage, in whole minutes, combined across every entry of this machine's date — so every entry of that machine/date shows the same figure.",
  setupEff: "Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time",
  oeeLosses:
    "OEE considering losses = Effective Run Time ÷ (Available Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  oeeLunch:
    "OEE not considering losses but lunch = Effective Run Time ÷ (Available Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  oeeLunchCot:
    "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Available Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
};
