"use strict";

/**
 * OEE Calculation Service — Glass Grinding
 *
 * ── History ───────────────────────────────────────────────────────────────
 * 2026-08-31: switched Working Schedule/Total Stoppage/Available Working/
 * Effective Run Time/Availability/Performance/Quality/OEE%/Overtime/Start
 * Delay/Early Closed to BATCH-level (identical across every entry saved
 * together from one "Add Entry" submission), to stop the Efficiency Report/
 * Dashboard OEE trend from double- or triple-counting a shift's schedule
 * time when it was split across multiple rows.
 *
 * 2026-09-02: reverted by explicit user decision — every row in a batch
 * showing identical numbers looked wrong for genuinely different entered
 * data (different M/C times, different quantities per row), so `calculated`
 * stored on each entry became PER-ROW, using ONLY that row's own M/C
 * Start/Off, quantities, and stoppage minutes. At that point Working
 * Schedule Time still extended every row out to the full shift envelope
 * (see the superseded formula below), so the double-counting problem was
 * handled separately at report time via aggregateBatchLevelTotals.
 *
 * 2026-09-03: Working Schedule Time redefined again, per the user's own
 * worked examples, to be POSITION-AWARE within a batch instead of every row
 * independently re-covering the whole shift:
 *   - Only the chronologically FIRST row in a batch can extend its own
 *     start backward past Shift On (if it began early) — or forward to
 *     Shift On (if it began late, pulling the pre-start gap into itself).
 *   - Only the chronologically LAST row can extend its own end forward past
 *     Shift Off (if it finished late) — or backward to Shift Off (if it
 *     finished early, pulling the post-end gap into itself).
 *   - Every row in between uses ONLY its own actual M/C Start/Off — no
 *     shift envelope at all.
 * A standalone entry (no batchId) is simultaneously first AND last, which
 * reduces to exactly the pre-2026-09-03 single-row formula — no behavior
 * change for solo entries. Overtime/Start Delay/Early Closed are similarly
 * gated: only the first row can show Start Delay/early-start Overtime, only
 * the last can show Early Closed/late-finish Overtime — a middle row always
 * shows zero for all three, since it isn't touching either shift boundary.
 *
 * This makes each row's Working Schedule Time a genuinely non-overlapping
 * slice of the shift timeline (any real gap BETWEEN two rows' own M/C times
 * — e.g. an unlogged break — belongs to neither row and simply isn't
 * "scheduled" time for anyone), so summing every row's own value across a
 * batch now gives the mathematically correct combined total directly — see
 * computeBatchCalculations below, which no longer needs a separate overall-
 * envelope calculation to avoid double-counting.
 *
 * Because a row's own Working Schedule Time (and Overtime/Start Delay/
 * Early Closed) now depend on whether it's first/last among its siblings —
 * not just its own fields — saving, editing, or deleting one row in a batch
 * DOES need to recompute its siblings again (see computeBatchRowCalculations
 * below and its callers in productionEntry.controller.js). This reinstates
 * the cross-row recompute that the 2026-09-02 per-row-only design had
 * removed as a simplification; that simplification no longer holds once
 * position within the batch matters.
 *
 * ── Per-row formulas (computeRowCalculations) ───────────────────────────
 *
 *   Working Schedule Time   = duration from [this row's own effective start]
 *                             to [this row's own effective end], where:
 *                               effective start = (isFirst) ? earlier of
 *                                 (Shift On, this row's M/C Start) : this
 *                                 row's own M/C Start
 *                               effective end = (isLast) ? later of
 *                                 (Shift Off, this row's M/C Off) : this
 *                                 row's own M/C Off
 *   Total Stoppage          = this row's own Downtime & Stoppage Reason
 *                             minutes, INCLUDING Planned Downtime (see the
 *                             2026-09-05 history note above).
 *   Available Working Time  = Working Schedule Time − Total Stoppage (NA
 *                             when Total Stoppage ≥ Working Schedule Time)
 *   Effective M/C Run Time  = this row's own actual on-time span (M/C Off
 *                             − M/C Start) — the real clock time the
 *                             machine ran for this row. Unaffected by the
 *                             first/last position logic above.
 *   Unreported Time         = Available Working Time − Effective M/C Run
 *                             Time (NA if AWT is NA), floored at 0. Only
 *                             captures a pause BETWEEN TWO PERIODS OF THE
 *                             SAME ROW (see the 2026-09-06 note) — a gap
 *                             between two different rows belongs to
 *                             neither (see the 2026-09-07 revert note).
 *   Availability Ratio      = Effective M/C Run Time ÷ Available Working
 *                             Time (NA if AWT is NA), capped at 100% (see
 *                             the note on capping below).
 *   Performance Ratio       = (this row's own Production Qty × Standard
 *                             Time) ÷ this row's own Effective M/C Run Time
 *                             (NA if AWT is NA) — the classic OEE
 *                             speed-loss ratio for this row alone.
 *   Quality Ratio           = this row's own OK Qty ÷ Production Qty.
 *   OEE %                   = Availability × Performance × Quality × 100
 *                             (NA if AWT is NA)
 *   Ideal Production (Qty)  = this row's own (M/C Off − M/C Start) ÷ its
 *                             own Standard Time per Glass — unaffected by
 *                             the first/last logic, already purely per-row.
 *   Overtime / Start Delay / Early Closed — derived from the shared Shift
 *   On/Off vs. THIS ROW's own M/C On/Off Time, gated by position:
 *     Start Delay    = (isFirst) ? max(0, M/C Start − Shift On) : 0
 *     early-start part of Overtime = (isFirst) ? max(0, Shift On − M/C Start) : 0
 *     Early Closed   = (isLast) ? max(0, Shift Off − M/C Off) : 0
 *     late-finish part of Overtime = (isLast) ? max(0, M/C Off − Shift Off) : 0
 *     Overtime       = early-start part + late-finish part
 *
 * NOTE on capping: Effective M/C Run Time is just the row's raw M/C Off −
 * M/C Start clock span — it doesn't itself subtract stoppage minutes
 * reported inside that same span. So if M/C Start/Off is entered as the
 * whole shift while stoppage is ALSO logged within it, Effective Run Time
 * (not stoppage-adjusted) can come out bigger than Available Working Time
 * (which IS stoppage-adjusted), which would otherwise give a
 * mathematically nonsensical >100% Availability Ratio / negative
 * Unreported Time — both are clamped to prevent that (added 2026-09-02).
 * This triggers more often for middle rows now (their Working Schedule
 * Time is exactly their own M/C span, same as Effective Run Time, so ANY
 * stoppage logged on a middle row pushes Effective past Available) — that's
 * expected, not a regression: it correctly flags "this row claims stoppage
 * minutes inside a window no bigger than its own claimed run time."
 *
 * `calculated` is computed server-side at save time and stored, so
 * historical rows never change unless explicitly recomputed (see
 * seed/recomputeCalculated.js).
 *
 * 2026-09-05: Total Stoppage now INCLUDES Planned Downtime (previously
 * excluded — Planned Downtime used to only ever show up as its own entered
 * field, never subtracted from anything). This only changes Total Stoppage/
 * Available Working Time/Availability Ratio/Unreported Time/OEE% — Ideal
 * Production and Performance Ratio deliberately stay based on this row's
 * own raw Effective M/C Run Time (unchanged), not Available Working Time,
 * since Performance is meant to measure this row's own actual run against
 * its own actual output, not against the whole shift's schedule.
 *
 * 2026-09-06: A single row can now have more than one M/C ON/OFF period
 * (mcStartTime/mcOffTime plus any `additionalPeriods`), still sharing one
 * production/downtime record. Effective M/C Run Time is the SUM of every
 * period's own duration for that row (never the raw span from the first
 * period's start to the last period's end), so a pause between two periods
 * of the SAME row is excluded from run time — and automatically flows into
 * that row's own Unreported Time via Available Working Time minus
 * Effective Run Time. Everywhere "this row's own start/end" previously
 * meant row.mcStartTime/row.mcOffTime directly (Working Schedule Time
 * bounds, Start Delay/Early Closed/Overtime, Ideal Production), it now
 * means the EARLIEST period's start / LATEST period's end (see rowPeriods/
 * rowOwnSpan below) — a no-op when there are no additional periods.
 *
 * 2026-09-07: REVERTED the 2026-09-05 gap-attribution change (a non-last
 * row's Working Schedule Time reaching forward to the NEXT row's own
 * start) — by explicit user decision, after seeing it inflate a row's own
 * Working Schedule Time past its own actual span (e.g. a row spanning
 * 09:30–11:15 showing 120 min of WST instead of its own 105-minute span,
 * because the next row didn't start until 11:30). A non-last row's
 * Working Schedule Time now stops at its OWN last period's end again,
 * matching the 2026-09-03 design: any gap between two rows' own M/C times
 * belongs to NEITHER row and simply isn't "scheduled" time for anyone — a
 * batch's total Working Schedule Time can legitimately be less than the
 * full shift when there are such gaps. This does NOT affect the 2026-09-06
 * multi-period behavior: a pause between two periods of the SAME row still
 * flows into that row's own Unreported Time, since that only depends on
 * this row's own span vs. its own summed run time, never the next row.
 */

// Downtime & Stoppage Reason fields summed for Total Stoppage — INCLUDES
// plannedDowntimeMin (see the 2026-09-05 history note above) and excludes
// overtime (added separately, never subtracted here).
const STOPPAGE_KEYS = [
  "plannedDowntimeMin",
  "noManpowerMin",
  "mechanicalBreakdownMin",
  "electricalBreakdownMin",
  "rawMaterialNotAvailableMin",
  "humanErrorStoppageMin",
  "changeoverMin",
  "rawMaterialProblemMin",
  "noPowerMin",
  "othersMin",
  // Roll-up of admin-added downtime reasons (Form Builder). Derived in
  // productionEntry.controller.js from ProductionEntry.extraValues so this
  // service stays pure — it never needs to look up FormField definitions.
  "customStoppageMin",
];

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function shiftDuration(startTime, offTime) {
  let diff = timeToMinutes(offTime) - timeToMinutes(startTime);
  if (diff <= 0) diff += 24 * 60; // crosses midnight
  return diff;
}

// Shortest signed distance (in minutes) from `from` (HH:mm) to `to` (HH:mm)
// within a 24h cycle: positive when `to` comes after `from`, negative when
// `to` comes before `from`. Caps the wrap-forward distance at half a day so
// "5 min before" isn't mistaken for "1435 min after".
function signedDiffMin(from, to) {
  let diff = (timeToMinutes(to) - timeToMinutes(from) + 1440) % 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

// Earlier/later of two HH:mm clock times, using signedDiffMin's ±12h window
// convention (consistent with the rest of this file) rather than a raw
// timeToMinutes compare — so these agree with signedDiffMin about which
// time is "before" the other even near a midnight wrap.
function earlierOf(a, b) {
  return signedDiffMin(a, b) >= 0 ? a : b;
}
function laterOf(a, b) {
  return signedDiffMin(a, b) >= 0 ? b : a;
}

// This row's own M/C ON/OFF periods — normally just the primary
// mcStartTime/mcOffTime pair, plus any `additionalPeriods` (see the file
// header's 2026-09-06 note) — sorted chronologically by start time so input
// order never matters.
function rowPeriods(row) {
  const periods = [{ start: row.mcStartTime, end: row.mcOffTime }];
  if (Array.isArray(row.additionalPeriods)) {
    for (const p of row.additionalPeriods) {
      if (p && p.startTime && p.endTime) periods.push({ start: p.startTime, end: p.endTime });
    }
  }
  return periods.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

// This row's own overall span across ALL of its periods: the earliest
// period's start and the latest period's end. Equal to
// { start: row.mcStartTime, end: row.mcOffTime } when there are no
// additional periods — everywhere "this row's own start/end" is needed
// (Working Schedule Time bounds, Start Delay/Early Closed/Overtime, Ideal
// Production) now uses this instead of the raw fields directly.
function rowOwnSpan(row) {
  const periods = rowPeriods(row);
  return { start: periods[0].start, end: periods[periods.length - 1].end };
}

// Sum of actual running time across every ON/OFF period for this row — NOT
// the span from the first period's start to the last period's end, so a
// pause between two periods of the SAME row is excluded (see the file
// header's 2026-09-06 note).
function rowEffectiveRunMin(row) {
  return rowPeriods(row).reduce((sum, p) => sum + shiftDuration(p.start, p.end), 0);
}

// Adds `minutesToAdd` minutes to an HH:mm clock time, wrapping past
// midnight if needed. Used to derive a 1-hour Lunch Break window's end from
// its start — Machine Master only stores the start, the window is always
// exactly 1 hour.
function addMinutesToTime(hhmm, minutesToAdd) {
  const total = (timeToMinutes(hhmm) + minutesToAdd + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Lunch Break deduction for ONE row (2026-09-08 feature) — by explicit user
// decision this is added directly INTO Total Stoppage (see
// computeRowCalculations below), so Available Working Time/Availability/
// Performance/OEE% all account for it automatically with no separate
// formula changes. All-or-nothing: only when this row's own span (see
// rowOwnSpan) FULLY COVERS the machine's configured 1-hour Lunch Break
// window does the full 60 minutes count — e.g. a row ending at 12:59
// against a 12:00-13:00 lunch window gets 0 minutes, not a partial 59.
// `lunchStartTime` is this row's own snapshot of the Machine's Lunch Break
// config (see the model file) — blank when that machine has none set.
function computeLunchMin(row, lunchStartTime) {
  if (!lunchStartTime) return 0;
  const lunchEndTime = addMinutesToTime(lunchStartTime, 60);
  const ownSpan = rowOwnSpan(row);
  const lunchStartMin = timeToMinutes(lunchStartTime);
  let lunchEndMin = timeToMinutes(lunchEndTime);
  if (lunchEndMin <= lunchStartMin) lunchEndMin += 24 * 60;
  const rowStartMin = timeToMinutes(ownSpan.start);
  let rowEndMin = timeToMinutes(ownSpan.end);
  if (rowEndMin <= rowStartMin) rowEndMin += 24 * 60;
  const covers = rowStartMin <= lunchStartMin && rowEndMin >= lunchEndMin;
  return covers ? 60 : 0;
}

// Overtime / Start Delay / Early Closed, derived from Shift On/Off vs. the
// given M/C On/Off Time — gated by this row's position in its batch (see
// the file header's 2026-09-03 note): only the first row can show Start
// Delay / early-start Overtime, only the last can show Early Closed /
// late-finish Overtime. A standalone row (isFirst=isLast=true) shows both,
// unchanged from before. Returns zeros when shift times are absent.
function deriveShiftDeltaForRow(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast) {
  if (!shiftOnTime || !shiftOffTime) {
    return { overtimeMin: 0, startDelayMin: 0, earlyClosedMin: 0 };
  }
  let startDelayMin = 0;
  let earlyStartMin = 0;
  let lateFinishMin = 0;
  let earlyClosedMin = 0;
  if (isFirst) {
    const startDeltaMin = signedDiffMin(shiftOnTime, mcStartTime); // + late start, - early start
    startDelayMin = Math.max(0, startDeltaMin);
    earlyStartMin = Math.max(0, -startDeltaMin);
  }
  if (isLast) {
    const offDeltaMin = signedDiffMin(shiftOffTime, mcOffTime); // + late finish, - early finish
    lateFinishMin = Math.max(0, offDeltaMin);
    earlyClosedMin = Math.max(0, -offDeltaMin);
  }
  return { overtimeMin: earlyStartMin + lateFinishMin, startDelayMin, earlyClosedMin };
}

// Working Schedule Time bounds for ONE row, position-aware (see the file
// header's 2026-09-03 note; the 2026-09-05 forward-reach-to-next-row
// extension was reverted 2026-09-07 — see that history note):
//   effective start = isFirst ? earlier of (Shift On, this row's M/C Start)
//                             : this row's own M/C Start
//   effective end   = isLast  ? later of (Shift Off, this row's M/C Off)
//                             : this row's own M/C Off
// A middle row's end stops at its own M/C Off — any gap between two rows'
// own M/C times (e.g. an unscheduled break nobody logged as a stoppage
// reason) belongs to NEITHER row and simply isn't "scheduled" time for
// anyone (2026-09-03 design, reinstated 2026-09-07).
function rowWorkingScheduleBounds(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast) {
  if (!shiftOnTime || !shiftOffTime) return { start: mcStartTime, end: mcOffTime };
  const start = isFirst ? earlierOf(shiftOnTime, mcStartTime) : mcStartTime;
  const end = isLast ? laterOf(shiftOffTime, mcOffTime) : mcOffTime;
  return { start, end };
}

function rowWorkingScheduleMin(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast) {
  const { start, end } = rowWorkingScheduleBounds(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast);
  return shiftDuration(start, end);
}

// Per-row Ideal Production Qty — that row's own actual run time (summed
// across all of its ON/OFF periods, see rowEffectiveRunMin) ÷ its own
// Standard Time per Glass. Independent of any batch — purely "how many
// pieces should THIS row have made in the time it actually ran, at
// standard speed."
function computeRowIdealProductionQty(row) {
  const std = Number(row.standardTimePerPieceMin) || 0;
  if (std <= 0) return 0;
  const runMin = rowEffectiveRunMin(row);
  return runMin / std;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
// Ratio fields (0–1) are displayed as a percentage with 2 decimal places
// (e.g. 93.79%) — round2 on the raw 0–1 ratio only keeps whole-percent
// precision (0.94 → always "94.00%"), so these need 4 decimal places on
// the ratio itself to preserve 2 decimal places once ×100.
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Every `calculated` field for ONE row, using ONLY that row's own data plus
// its position among batch siblings (isFirst/isLast — see the file
// header's 2026-09-03 note). Defaults to isFirst=isLast=true so every
// existing call site that doesn't know about batch position (a standalone
// entry, or code not yet updated) keeps working exactly as a solo entry
// always has.
function computeRowCalculations(row, shiftOnTime, shiftOffTime, isFirst = true, isLast = true) {
  const num = (v) => Number(v) || 0;
  const ownSpan = rowOwnSpan(row);

  const shiftDurationMin = (shiftOnTime && shiftOffTime)
    ? shiftDuration(shiftOnTime, shiftOffTime)
    : shiftDuration(ownSpan.start, ownSpan.end);

  const { overtimeMin, startDelayMin, earlyClosedMin } = deriveShiftDeltaForRow(
    shiftOnTime, shiftOffTime, ownSpan.start, ownSpan.end, isFirst, isLast,
  );

  // Lunch Break (2026-09-08) is added directly into Total Stoppage, by
  // explicit user decision — see computeLunchMin's comment above.
  const lunchMin = computeLunchMin(row, row.lunchStartTime);
  const totalStoppageMin = STOPPAGE_KEYS.reduce((s, k) => s + num(row[k]), 0) + lunchMin;

  const workingScheduleMin = rowWorkingScheduleMin(shiftOnTime, shiftOffTime, ownSpan.start, ownSpan.end, isFirst, isLast);

  // Available Working Time never goes negative — floored at 0 rather than
  // becoming NA, so it always reads as a real (if zero) number. NA only
  // shows up one level up, on the RATIOS that would otherwise divide by it.
  const availableWorkingMin = round2(Math.max(0, workingScheduleMin - totalStoppageMin));

  // Sum of this row's own ON/OFF periods — excludes any pause between two
  // periods of this SAME row (see the file header's 2026-09-06 note).
  const effectiveMcRunTimeMin = rowEffectiveRunMin(row);

  // Unreported Time = Available Working Time not explained by either actual
  // run time or a logged stoppage reason — captures a pause BETWEEN TWO
  // PERIODS OF THE SAME ROW (2026-09-06 note), but not a gap to a
  // different row (that reverted 2026-09-05 behavior — see the 2026-09-07
  // history note).
  const unreportedTimeMin = round2(Math.max(0, availableWorkingMin - effectiveMcRunTimeMin));

  // Availability Ratio, capped at 100% (see the file header's capping
  // note) — NA (null) rather than 0 when Available Working Time is 0, since
  // 0 ÷ 0 is undefined, not "0% availability".
  const availabilityRatio = availableWorkingMin > 0 ? Math.min(1, effectiveMcRunTimeMin / availableWorkingMin) : null;

  // Performance Ratio deliberately stays based on this row's own raw
  // Effective M/C Run Time (not Available Working Time) — Performance
  // measures this row's own actual run against its own actual output, not
  // against the whole shift's schedule (2026-09-05 decision). NA (null)
  // rather than 0 when the machine never ran at all — undefined, not "0%
  // performance".
  const stdMinutesForOutput = num(row.processQty) * num(row.standardTimePerPieceMin);
  const performanceRatio = effectiveMcRunTimeMin > 0 ? (stdMinutesForOutput / effectiveMcRunTimeMin) : null;

  const qualityRatio = num(row.processQty) > 0 ? num(row.okQty) / num(row.processQty) : 0;

  const oeePercent = (availabilityRatio == null || performanceRatio == null)
    ? null
    : availabilityRatio * performanceRatio * qualityRatio * 100;

  return {
    shiftDurationMin:      round2(shiftDurationMin),
    lunchMin:              round2(lunchMin),
    totalStoppageMin:      round2(totalStoppageMin),
    workingScheduleMin:    round2(workingScheduleMin),
    availableWorkingMin:   round2(availableWorkingMin),
    idealProductionQty:    round2(computeRowIdealProductionQty(row)),
    effectiveMcRunTimeMin: round2(effectiveMcRunTimeMin),
    unreportedTimeMin:     round2(unreportedTimeMin),
    availabilityRatio:     availabilityRatio === null ? null : round4(availabilityRatio),
    performanceRatio:      performanceRatio === null ? null : round4(performanceRatio),
    qualityRatio:          round4(qualityRatio),
    oeePercent:            oeePercent === null ? null : round2(oeePercent),
    overtimeMin:           round2(overtimeMin),
    startDelayMin:         round2(startDelayMin),
    earlyClosedMin:        round2(earlyClosedMin),
  };
}

// Sorts a batch's rows chronologically by M/C Start Time and computes each
// one's own `calculated`, correctly aware of whether it's the first/last
// row in the batch (see the file header's 2026-09-03 note) — THE function
// to use whenever a batch's membership or ordering could have changed
// (create/update/delete), since a row's own Working Schedule Time no longer
// depends on just its own fields. Returns [{ row, calculated }, ...] in
// chronological (not necessarily input) order.
function computeBatchRowCalculations(rows, shiftOnTime, shiftOffTime) {
  const sorted = [...rows].sort((a, b) => timeToMinutes(rowOwnSpan(a).start) - timeToMinutes(rowOwnSpan(b).start));
  return sorted.map((row, i) => {
    const isLast = i === sorted.length - 1;
    return {
      row,
      calculated: computeRowCalculations(row, shiftOnTime, shiftOffTime, i === 0, isLast),
    };
  });
}

// ── Batch-level aggregate — kept ONLY for report/dashboard totals ─────────
// (see the 2026-09-02 history note above). Not used for what's stored on
// an entry anymore; computeRowCalculations is. `rows` is every entry
// sharing one batchId (a standalone entry is simply a batch of one).
//
// Since each row's own Working Schedule Time is now a genuinely non-
// overlapping slice of the shift timeline (2026-09-03), the combined batch
// total for every additive field is simply the SUM of each row's own
// (position-aware) value — no separate "overall envelope" computation is
// needed anymore, and none would even be correct: an overall min-start-to-
// max-end envelope would silently re-include any real gap BETWEEN two rows
// (e.g. an unlogged break) as if it were scheduled time, which the per-row
// design deliberately excludes. Only the three ratios + OEE% + Unreported
// Time are NOT summed — those are re-derived from the combined totals, same
// as computeRowCalculations does for one row.
function computeBatchCalculations(rows, shiftOnTime, shiftOffTime) {
  const num = (v) => Number(v) || 0;

  const perRow = computeBatchRowCalculations(rows, shiftOnTime, shiftOffTime).map((r) => r.calculated);

  const shiftDurationMin = perRow[0]?.shiftDurationMin || 0;
  const lunchMin = round2(perRow.reduce((s, c) => s + c.lunchMin, 0));
  const totalStoppageMin = round2(perRow.reduce((s, c) => s + c.totalStoppageMin, 0));
  const workingScheduleMin = round2(perRow.reduce((s, c) => s + c.workingScheduleMin, 0));
  const overtimeMin = round2(perRow.reduce((s, c) => s + c.overtimeMin, 0));
  const startDelayMin = round2(perRow.reduce((s, c) => s + c.startDelayMin, 0));
  const earlyClosedMin = round2(perRow.reduce((s, c) => s + c.earlyClosedMin, 0));

  // Available Working Time floored at 0, NA only at the ratio level — see
  // computeRowCalculations' matching 2026-09-05 note.
  const availableWorkingMin = round2(Math.max(0, workingScheduleMin - totalStoppageMin));

  const effectiveMcRunTimeMin = round2(perRow.reduce((s, c) => s + c.effectiveMcRunTimeMin, 0));

  const unreportedTimeMin = round2(Math.max(0, availableWorkingMin - effectiveMcRunTimeMin));

  const availabilityRatio = availableWorkingMin > 0 ? Math.min(1, effectiveMcRunTimeMin / availableWorkingMin) : null;

  // Performance stays anchored to the batch's combined raw Effective M/C
  // Run Time (not Available Working Time) — same per-row rule, summed.
  const stdMinutesForOutput = rows.reduce((sum, r) => sum + num(r.processQty) * num(r.standardTimePerPieceMin), 0);
  const performanceRatio = effectiveMcRunTimeMin > 0 ? (stdMinutesForOutput / effectiveMcRunTimeMin) : null;

  const totalProcessQty = rows.reduce((s, r) => s + num(r.processQty), 0);
  const totalOkQty = rows.reduce((s, r) => s + num(r.okQty), 0);
  const qualityRatio = totalProcessQty > 0 ? totalOkQty / totalProcessQty : 0;

  const oeePercent = (availabilityRatio == null || performanceRatio == null)
    ? null
    : availabilityRatio * performanceRatio * qualityRatio * 100;

  return {
    shiftDurationMin:     round2(shiftDurationMin),
    lunchMin:             round2(lunchMin),
    totalStoppageMin:     round2(totalStoppageMin),
    workingScheduleMin:   round2(workingScheduleMin),
    availableWorkingMin:  round2(availableWorkingMin),
    effectiveMcRunTimeMin:round2(effectiveMcRunTimeMin),
    unreportedTimeMin:    round2(unreportedTimeMin),
    availabilityRatio:    availabilityRatio === null ? null : round4(availabilityRatio),
    performanceRatio:     performanceRatio === null ? null : round4(performanceRatio),
    qualityRatio:         round4(qualityRatio),
    oeePercent:           oeePercent === null ? null : round2(oeePercent),
    overtimeMin:          round2(overtimeMin),
    startDelayMin:        round2(startDelayMin),
    earlyClosedMin:       round2(earlyClosedMin),
  };
}

// Groups `entries` by batchId (a standalone entry, with no batchId, is its
// own batch of one), computes the TRUE combined Working Schedule/Available
// Working/Effective M/C Run Time for EACH batch fresh via
// computeBatchCalculations, then returns those per-batch totals summed —
// so a shift split across several rows contributes its schedule time to a
// report ONCE, even though each row's own stored `calculated` (from
// computeRowCalculations) no longer matches its siblings'.
function aggregateBatchLevelTotals(entries) {
  const batches = new Map();
  for (const e of entries) {
    const key = e.batchId ? String(e.batchId) : `_solo:${e._id}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(e);
  }

  let workingScheduleMin = 0;
  let availableWorkingMin = 0;
  let effectiveMcRunTimeMin = 0;
  for (const rows of batches.values()) {
    const batchCalc = computeBatchCalculations(rows, rows[0].shiftOnTime, rows[0].shiftOffTime);
    workingScheduleMin += batchCalc.workingScheduleMin || 0;
    if (batchCalc.availableWorkingMin != null) availableWorkingMin += batchCalc.availableWorkingMin;
    effectiveMcRunTimeMin += batchCalc.effectiveMcRunTimeMin || 0;
  }
  return { workingScheduleMin, availableWorkingMin, effectiveMcRunTimeMin };
}

// Groups `entries` by batchId (a standalone entry is its own batch of one),
// sorts each batch chronologically, and returns a Map from entry `_id`
// (string) to `{ isFirst, isLast }` — for callers (e.g. the Shift Time
// Report) that need to know a row's batch position to display something
// derived from it (like rowWorkingScheduleBounds) without duplicating the
// batchId-grouping/sorting logic computeBatchRowCalculations already does.
function computeBatchPositions(entries) {
  const batches = new Map();
  for (const e of entries) {
    const key = e.batchId ? String(e.batchId) : `_solo:${e._id}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(e);
  }
  const positions = new Map();
  for (const rows of batches.values()) {
    const sorted = [...rows].sort((a, b) => timeToMinutes(rowOwnSpan(a).start) - timeToMinutes(rowOwnSpan(b).start));
    sorted.forEach((row, i) => {
      const isLast = i === sorted.length - 1;
      positions.set(String(row._id), { isFirst: i === 0, isLast });
    });
  }
  return positions;
}

module.exports = {
  computeRowCalculations,
  computeBatchRowCalculations,
  computeBatchCalculations,
  computeBatchPositions,
  rowWorkingScheduleBounds,
  aggregateBatchLevelTotals,
  computeRowIdealProductionQty,
  rowPeriods,
  rowOwnSpan,
  rowEffectiveRunMin,
  computeLunchMin,
  shiftDuration,
  signedDiffMin,
  STOPPAGE_KEYS,
};
