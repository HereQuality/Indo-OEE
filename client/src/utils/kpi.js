// Shared bits of the KPI, Graph and Company Level Objective pages.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const UOMS = ["Qty", "%"];

export const thisYear = () => new Date().getFullYear();
export const thisMonth = () => new Date().getMonth() + 1;

// The years a picker offers: three back, one ahead, plus any the data has.
export const yearOptions = (extra = []) => {
  const y = thisYear();
  return [...new Set([...extra, y + 1, y, y - 1, y - 2, y - 3])].filter(Number.isFinite).sort((a, b) => b - a);
};

// The years a form's Year box offers: ten back, five ahead, plus the record's
// own year if it's outside that (so an old objective still shows its year).
export const yearRange = (extra = []) => {
  const y = thisYear();
  const all = [...extra.filter(Number.isFinite)];
  for (let i = y + 5; i >= y - 10; i--) all.push(i);
  return [...new Set(all)].sort((a, b) => b - a);
};

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const fmtQty = (n) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? qtyFmt.format(Number(n)) : "—");
export const fmtPct = (n) => (Number.isFinite(Number(n)) && n !== null ? `${Number(n).toFixed(1)}%` : "—");

// "1,200 Qty" / "85%" / "—" for a { value, uom }.
export const measureText = (m) => {
  if (!m || m.value === null || m.value === undefined || m.value === "") return "—";
  return m.uom === "%" ? fmtPct(m.value) : fmtQty(m.value);
};

// What the OK Qty column of a month shows: the count, or as "%" the month's
// Quality % — OK ÷ (OK + Rejected) from the entries.
export const okQtyText = (monthRow, okQtyUom) => (okQtyUom === "%" ? fmtPct(monthRow.qualityPct) : fmtQty(monthRow.okQty));

// "1,200 OK · 30 rejected" for a tooltip.
export const okRejectedText = (monthRow) => `${fmtQty(monthRow.okQty)} OK · ${fmtQty(monthRow.rejectedQty || 0)} rejected`;

// A palette for one line per objective on the Graph page.
export const LINE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#b45309", "#1d4ed8"];

export const blankMeasure = () => ({ value: "", uom: "Qty" });
