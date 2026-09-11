/**
 * Client-side mirror of the batch-aggregate portion of
 * server/services/productionCalculation.service.js. Used by Dashboard.jsx's
 * on-screen Efficiency Report preview (via aggregateBatchLevelTotals, so it
 * never drifts from the server-generated PDF of the same report) AND by
 * GrindingEntry.jsx's per-batch "Total" row in the sheet (via
 * computeBatchCalculations directly).
 *
 * Working Schedule Time (and Overtime/Start Delay/Early Closed) is
 * position-aware within a batch (see the server file's 2026-09-03 note):
 * only the chronologically first row can extend backward to Shift On, only
 * the last can extend forward to Shift Off, every row in between uses only
 * its own actual M/C Start/Off. That makes each row's own Working Schedule
 * Time a non-overlapping slice of the shift, so summing every row's own
 * value across a batch gives the correct combined total directly —
 * computeBatchCalculations sorts the batch's rows, computes each one
 * position-aware, then sums the additive fields and re-derives the ratios
 * from those combined totals (never sums/averages a ratio directly).
 */

// 2026-09-05: includes plannedDowntimeMin — Total Stoppage/Available
// Working Time/Availability Ratio/Unreported Time/OEE% now account for
// Planned Downtime too. Ideal Production/Performance Ratio deliberately
// stay untouched (still based on this row's own raw Effective M/C Run
// Time) — see server/services/productionCalculation.service.js's matching
// 2026-09-05 history note.
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
  // Roll-up of admin-added downtime reasons (Form Builder) — mirrors the
  // server's STOPPAGE_KEYS so the live preview matches what gets saved.
  "customStoppageMin",
];

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function shiftDuration(startTime, offTime) {
  let diff = timeToMinutes(offTime) - timeToMinutes(startTime);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

function signedDiffMin(from, to) {
  let diff = (timeToMinutes(to) - timeToMinutes(from) + 1440) % 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

// Earlier/later of two HH:mm clock times — mirrors server earlierOf/laterOf.
function earlierOf(a, b) {
  return signedDiffMin(a, b) >= 0 ? a : b;
}
function laterOf(a, b) {
  return signedDiffMin(a, b) >= 0 ? b : a;
}

// This row's own M/C ON/OFF periods (primary mcStartTime/mcOffTime plus any
// `additionalPeriods` — 2026-09-06), sorted chronologically — mirrors server
// rowPeriods exactly.
export function rowPeriods(row) {
  const periods = [{ start: row.mcStartTime, end: row.mcOffTime }];
  if (Array.isArray(row.additionalPeriods)) {
    for (const p of row.additionalPeriods) {
      if (p && p.startTime && p.endTime) periods.push({ start: p.startTime, end: p.endTime });
    }
  }
  return periods.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

// This row's own overall span across ALL of its periods — mirrors server
// rowOwnSpan exactly.
export function rowOwnSpan(row) {
  const periods = rowPeriods(row);
  return { start: periods[0].start, end: periods[periods.length - 1].end };
}

// Sum of actual running time across every ON/OFF period for this row — NOT
// the span from first start to last end, so a pause between two periods of
// the SAME row is excluded (flows into Unreported Time instead) — mirrors
// server rowEffectiveRunMin exactly.
export function rowEffectiveRunMin(row) {
  return rowPeriods(row).reduce((sum, p) => sum + shiftDuration(p.start, p.end), 0);
}

function addMinutesToTime(hhmm, minutesToAdd) {
  const total = (timeToMinutes(hhmm) + minutesToAdd + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Lunch Break deduction for ONE row (2026-09-08 feature) — added directly
// into Total Stoppage, by explicit user decision, so Available Working
// Time/Availability/Performance/OEE% all account for it automatically —
// mirrors server computeLunchMin exactly. All-or-nothing: only when this
// row's own span (see rowOwnSpan) FULLY COVERS the machine's configured
// 1-hour Lunch Break window does the full 60 minutes count.
export function computeLunchMin(row, lunchStartTime) {
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

// Overtime / Start Delay / Early Closed, gated by this row's position in its
// batch — mirrors server deriveShiftDeltaForRow exactly. Only the first row
// can show Start Delay/early-start Overtime, only the last can show Early
// Closed/late-finish Overtime.
function deriveShiftDeltaForRow(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast) {
  if (!shiftOnTime || !shiftOffTime) {
    return { overtimeMin: 0, startDelayMin: 0, earlyClosedMin: 0 };
  }
  let startDelayMin = 0, earlyStartMin = 0, lateFinishMin = 0, earlyClosedMin = 0;
  if (isFirst) {
    const startDeltaMin = signedDiffMin(shiftOnTime, mcStartTime);
    startDelayMin = Math.max(0, startDeltaMin);
    earlyStartMin = Math.max(0, -startDeltaMin);
  }
  if (isLast) {
    const offDeltaMin = signedDiffMin(shiftOffTime, mcOffTime);
    lateFinishMin = Math.max(0, offDeltaMin);
    earlyClosedMin = Math.max(0, -offDeltaMin);
  }
  return { overtimeMin: earlyStartMin + lateFinishMin, startDelayMin, earlyClosedMin };
}

// Working Schedule Time for ONE row, position-aware — mirrors server
// rowWorkingScheduleMin exactly. A non-last row's end stops at its own
// M/C Off (2026-09-03 design); a gap-attribution extension tried
// 2026-09-05 was reverted 2026-09-07 by explicit user decision — a gap
// between two rows' own M/C times belongs to neither.
function rowWorkingScheduleMin(shiftOnTime, shiftOffTime, mcStartTime, mcOffTime, isFirst, isLast) {
  if (!shiftOnTime || !shiftOffTime) return shiftDuration(mcStartTime, mcOffTime);
  const start = isFirst ? earlierOf(shiftOnTime, mcStartTime) : mcStartTime;
  const end = isLast ? laterOf(shiftOffTime, mcOffTime) : mcOffTime;
  return shiftDuration(start, end);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

// Sorts a batch's rows chronologically and computes each one's own
// position-aware Working Schedule Time/Total Stoppage/Effective Run
// Time/Overtime/Start Delay/Early Closed — mirrors server
// computeBatchRowCalculations (the additive-fields subset needed here;
// idealProductionQty/Performance/Quality/OEE% aren't needed client-side
// since those are read from the server-computed `calculated` already
// stored on each row, or summed directly from raw quantities below).
function computeBatchRowScheduleCalcs(rows, shiftOnTime, shiftOffTime) {
  const num = (v) => Number(v) || 0;
  const sorted = [...rows].sort((a, b) => timeToMinutes(rowOwnSpan(a).start) - timeToMinutes(rowOwnSpan(b).start));
  return sorted.map((row, i) => {
    const isFirst = i === 0;
    const isLast = i === sorted.length - 1;
    const ownSpan = rowOwnSpan(row);
    const lunchMin = computeLunchMin(row, row.lunchStartTime);
    const totalStoppageMin = STOPPAGE_KEYS.reduce((s, k) => s + num(row[k]), 0) + lunchMin;
    const { overtimeMin, startDelayMin, earlyClosedMin } = deriveShiftDeltaForRow(
      shiftOnTime, shiftOffTime, ownSpan.start, ownSpan.end, isFirst, isLast,
    );
    return {
      workingScheduleMin: rowWorkingScheduleMin(shiftOnTime, shiftOffTime, ownSpan.start, ownSpan.end, isFirst, isLast),
      lunchMin,
      totalStoppageMin,
      effectiveMcRunTimeMin: rowEffectiveRunMin(row),
      overtimeMin,
      startDelayMin,
      earlyClosedMin,
    };
  });
}

// Every batch-level `calculated` field for a group of rows sharing one
// batchId — mirrors server computeBatchCalculations exactly (see
// productionCalculation.service.js's 2026-09-03 note). `rows` is every
// entry in the batch (a standalone entry is a batch of one). Used both by
// aggregateBatchLevelTotals below (Dashboard/report totals) and by
// GrindingEntry.jsx's per-batch "Total" row in the sheet.
export function computeBatchCalculations(rows, shiftOnTime, shiftOffTime) {
  const num = (v) => Number(v) || 0;

  const perRow = computeBatchRowScheduleCalcs(rows, shiftOnTime, shiftOffTime);

  const shiftDurationMin = (shiftOnTime && shiftOffTime) ? shiftDuration(shiftOnTime, shiftOffTime) : (perRow[0]?.effectiveMcRunTimeMin || 0);
  const lunchMin = round2(perRow.reduce((s, c) => s + c.lunchMin, 0));
  const totalStoppageMin = round2(perRow.reduce((s, c) => s + c.totalStoppageMin, 0));
  const workingScheduleMin = round2(perRow.reduce((s, c) => s + c.workingScheduleMin, 0));
  const overtimeMin = round2(perRow.reduce((s, c) => s + c.overtimeMin, 0));
  const startDelayMin = round2(perRow.reduce((s, c) => s + c.startDelayMin, 0));
  const earlyClosedMin = round2(perRow.reduce((s, c) => s + c.earlyClosedMin, 0));

  // Available Working Time floored at 0, NA only at the ratio level — see
  // server productionCalculation.service.js's matching 2026-09-05 note.
  const availableWorkingMin = round2(Math.max(0, workingScheduleMin - totalStoppageMin));

  const effectiveMcRunTimeMin = round2(perRow.reduce((s, c) => s + c.effectiveMcRunTimeMin, 0));

  const unreportedTimeMin = round2(Math.max(0, availableWorkingMin - effectiveMcRunTimeMin));

  const availabilityRatio = availableWorkingMin > 0 ? Math.min(1, effectiveMcRunTimeMin / availableWorkingMin) : null;

  // Performance stays anchored to the batch's combined raw Effective M/C
  // Run Time (not Available Working Time) — 2026-09-05 decision.
  const stdMinutesForOutput = rows.reduce((sum, r) => sum + num(r.processQty) * num(r.standardTimePerPieceMin), 0);
  const performanceRatio = effectiveMcRunTimeMin > 0 ? (stdMinutesForOutput / effectiveMcRunTimeMin) : null;

  const totalProcessQty = rows.reduce((s, r) => s + num(r.processQty), 0);
  const totalOkQty = rows.reduce((s, r) => s + num(r.okQty), 0);
  const qualityRatio = totalProcessQty > 0 ? totalOkQty / totalProcessQty : 0;

  const oeePercent = (availabilityRatio == null || performanceRatio == null)
    ? null
    : availabilityRatio * performanceRatio * qualityRatio * 100;

  return {
    shiftDurationMin:      round2(shiftDurationMin),
    lunchMin:              round2(lunchMin),
    totalStoppageMin:      round2(totalStoppageMin),
    workingScheduleMin:    round2(workingScheduleMin),
    availableWorkingMin:   round2(availableWorkingMin),
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

export function aggregateBatchLevelTotals(entries) {
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

// Mirrors server/utils/oeeAggregate.js's aggregateOee exactly — reduces a set
// of ProductionEntry rows (any grouping: a date range, a single day, a
// machine) to one combined Availability/Performance/Quality/OEE%, computed
// from summed quantities/minutes rather than averaged from per-entry ratios.
// Used by Dashboard.jsx for BOTH the Efficiency Report card (reportData) and
// the Daily OEE Trend chart (trendData, one call per day) — a day's trend
// point must be "that day's true combined OEE%", not an unweighted average
// of each entry's own OEE% (which would let one tiny job at 90% and one
// huge job at 10% average out to a misleading 50%).
export function aggregateOee(entries) {
  let sumProcess = 0;
  let sumOk = 0;
  let sumIdeal = 0;
  let sumStdMinutes = 0;

  for (const e of entries) {
    sumProcess += Number(e.processQty) || 0;
    sumOk += Number(e.okQty) || 0;
    sumIdeal += Number(e.calculated?.idealProductionQty) || 0;
    sumStdMinutes += (Number(e.processQty) || 0) * (Number(e.standardTimePerPieceMin) || 0);
  }

  const { workingScheduleMin: sumWork, availableWorkingMin: sumAvail, effectiveMcRunTimeMin: sumEffectiveRun } =
    aggregateBatchLevelTotals(entries);

  const availRatio = sumAvail > 0 ? Math.min(100, (sumEffectiveRun / sumAvail) * 100) : 0;
  const qualRatio = sumProcess > 0 ? (sumOk / sumProcess) * 100 : 0;
  const perfRatio = sumEffectiveRun > 0 ? (sumStdMinutes / sumEffectiveRun) * 100 : 0;
  const oee = (availRatio / 100) * (perfRatio / 100) * (qualRatio / 100) * 100;

  return {
    workMin: sumWork,
    availMin: sumAvail,
    availRatio,
    processQty: sumProcess,
    okQty: sumOk,
    qualRatio,
    idealQty: sumIdeal,
    perfRatio,
    oee,
  };
}
