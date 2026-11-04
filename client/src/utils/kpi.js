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

const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export const fmtQty = (n) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? qtyFmt.format(Number(n)) : "—");
export const fmtPct = (n) => (Number.isFinite(Number(n)) && n !== null ? `${Number(n).toFixed(1)}%` : "—");

// "1,200 Qty" / "85%" / "—" for a { value, uom }.
export const measureText = (m) => {
  if (!m || m.value === null || m.value === undefined || m.value === "") return "—";
  return m.uom === "%" ? fmtPct(m.value) : fmtQty(m.value);
};

// What the OK Qty column of a month shows, in the objective's chosen unit.
export const okQtyText = (monthRow, okQtyUom) => (okQtyUom === "%" ? fmtPct(monthRow.pctOfTarget) : fmtQty(monthRow.okQty));

// A palette for one line per objective on the Graph page.
export const LINE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#b45309", "#1d4ed8"];

export const blankMeasure = () => ({ value: "", uom: "Qty" });
