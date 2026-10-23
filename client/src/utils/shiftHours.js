/**
 * utils/shiftHours.js
 * ────────────────────
 * The Planned Operator Shift is typed the way the paper sheet writes it:
 * decimal hours, 100 to the hour — 3.5 is 3 h 30 min, 5.33 is 5 h 20 min,
 * 3.7 is 3 h 42 min. Everything after that runs on clock minutes (60 to the
 * hour): what's typed is taken to the nearest whole minute, so the sheet's
 * two-decimal 5.33 lands on the 5 h 20 min it stands for rather than on
 * 5 h 19.8 min. The tables show it as "5:20". The server and the reports keep
 * it as decimal hours. These helpers are the only place the two meet.
 */

// Decimal hours → "H:MM" (3.5 → "3:30"). "" when not a number.
export const hoursToHm = (hours) => {
  if (hours === "" || hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "";
  const total = Math.round(Number(hours) * 60);
  const abs = Math.abs(total);
  return `${total < 0 ? "-" : ""}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
};

// Decimal hours → what the Planned box shows, as the sheet writes it
// (5 h 20 min → "5.33", 7.5 → "7.5"). Two decimals always read back to the
// same whole minute.
export const hoursToShiftInput = (hours) => {
  if (hours === "" || hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "";
  const minutes = Math.abs(Math.round(Number(hours) * 60));
  return String(Number((minutes / 60).toFixed(2)));
};

// "5.33" → { hours: 5 h 20 min }, "3.7" → 3 h 42 min, "8" → 8; blank or
// anything else unusable → { hours: null }.
export const parseShiftHours = (text) => {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d{0,3}(?:\.\d*)?$/.test(t) || !/\d/.test(t)) return { hours: null };
  return { hours: Math.round(Number(t) * 60) / 60 };
};

// Decimal hours for the server, without float noise (5 h 20 min → 5.333333).
export const hmToWireHours = (hours) => Number(hours.toFixed(6));
