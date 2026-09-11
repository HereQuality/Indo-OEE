"use strict";

const { aggregateBatchLevelTotals } = require("../services/productionCalculation.service");

/**
 * Aggregates a set of ProductionEntry rows into the same summary shape as
 * the Dashboard's "Efficiency Report (OEE)" table (client/src/pages/
 * Dashboard.jsx `reportData`). Single source of truth for that math so the
 * PDF report (per-day rows + totals row) never drifts from what's shown
 * on screen.
 *
 * Working Schedule Time / Available Working Time / Effective M/C Run Time
 * are no longer identical across a batch's rows (see productionCalculation.
 * service.js's 2026-09-02 history note — `calculated` is per-row now), so
 * they can't be read off one representative row per batchId anymore.
 * aggregateBatchLevelTotals recomputes the TRUE combined total for each
 * batch fresh from the raw rows, so a shift split across several entries
 * still only contributes its schedule time once. Production Qty / OK Qty /
 * Ideal Qty / Standard Minutes for Output are per-row and always summed
 * across every entry.
 */
function aggregateOee(entries) {
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

  // Availability = Effective Run Time ÷ Available Working Time, capped at
  // 100% (see productionCalculation.service.js's capping note). Performance
  // = Standard Minutes for Output ÷ Effective Run Time. Mirrors
  // productionCalculation.service.js's computeBatchCalculations.
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

module.exports = { aggregateOee };
