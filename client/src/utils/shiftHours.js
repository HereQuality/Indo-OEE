/**
 * utils/shiftHours.js
 * ────────────────────
 * Hours the way a clock reads them (60 minutes to the hour, not 100).
 *
 * The server and the reports keep a shift length as decimal hours (3.5 = 3 h
 * 30 min). On the entry form a person types and reads it as H.MM — "3.30" is
 * 3 h 30 min, and a single minute digit is tens of minutes ("3.5" is 3 h
 * 50 min) — and sees it as "3:30". These helpers are the only place the two
 * meet. Keep in step with the phone app's shared/shift_hours.dart.
 */

// Decimal hours → "H:MM" (3.5 → "3:30"). "" when not a number.
export const hoursToHm = (hours) => {
  if (hours === "" || hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "";
  const total = Math.round(Number(hours) * 60);
  const abs = Math.abs(total);
  return `${total < 0 ? "-" : ""}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
};

// Decimal hours → what the H.MM box shows (7.5 → "7.30").
export const hoursToHmInput = (hours) => {
  if (hours === "" || hours === null || hours === undefined || !Number.isFinite(Number(hours))) return "";
  const abs = Math.abs(Math.round(Number(hours) * 60));
  return `${Math.floor(abs / 60)}.${String(abs % 60).padStart(2, "0")}`;
};

// "3.30" → { hours: 3.5 }, "3.5" → 3 h 50 min, "3" → 3. Minutes above 59 →
// { minutesTooBig: true }; anything else unusable (or blank) → { hours: null }.
export const parseHm = (text) => {
  const t = String(text ?? "").trim().replace(",", ".");
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return { hours: null, minutesTooBig: false };
  const frac = m[2] ?? "";
  const mm = frac === "" ? 0 : Number(frac.length === 1 ? `${frac}0` : frac);
  if (mm > 59) return { hours: null, minutesTooBig: true };
  return { hours: (Number(m[1]) * 60 + mm) / 60, minutesTooBig: false };
};

// Decimal hours for the server, without float noise (3 h 50 min → 3.833333).
export const hmToWireHours = (hours) => Number(hours.toFixed(6));
