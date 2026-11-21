"use strict";
/**
 * controllers/kpi.controller.js
 * ───────────────────────────────
 * Data Entry › KPI (department objectives, with their graph) and Company Level Objective.
 *
 * Who sees / edits what: Super Admin and Full access users, every department.
 * Anyone else only the departments on their own Employee record — "the
 * department's own person" adds its objectives. OK Qty is always summed from
 * the entries (utils/kpiOkQty.js); only Baseline, Target and the units are
 * typed.
 */
const mongoose = require("mongoose");
const KpiObjective = require("../models/KpiObjective");
const CompanyObjective = require("../models/CompanyObjective");
const Department = require("../models/Department");
const CompanyHistory = require("../models/CompanyHistory");
const CompanyMonthly = require("../models/CompanyMonthly");
const Process = require("../models/Process");
const { METRICS, METRIC_KEYS, summarizeMetrics, monthsWithFigures } = require("../utils/companyMetrics");
const { UOMS, TARGET_PERIODS } = require("../models/KpiObjective");
const { isAdminUser } = require("../utils/adminAccess");
const { sendError } = require("../utils/httpErrors");
const { okQtyByProcessMonth, monthsFor, okQtyAllByYearMonth } = require("../utils/kpiOkQty");

const thisYear = () => new Date().getFullYear();

const parseYear = (raw) => {
  const y = raw === undefined || raw === "" ? thisYear() : Number(raw);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : null;
};

// A typed { value, uom } — blank value stays unset; a bad one is an error.
const pickMeasure = (raw, label) => {
  const value = raw?.value === "" || raw?.value === null || raw?.value === undefined ? null : Number(raw.value);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return { error: `${label} must be a number of 0 or more` };
  const uom = raw?.uom === undefined ? "Qty" : raw.uom;
  if (!UOMS.includes(uom)) return { error: `${label} unit must be one of ${UOMS.join(", ")}` };
  return { measure: { value, uom } };
};

const nameOf = (req) => req.user?.employeeName || req.user?.name || "";

// null = every department; otherwise the Set of department ids this person may use.
const departmentScope = async (req) => {
  if (await isAdminUser(req)) return null;
  return new Set((req.user?.departmentIds || []).map((d) => String(d?._id || d)));
};

const inScope = (scope, departmentId) => !scope || scope.has(String(departmentId));

// Achievement for one month: OK Qty as a % of a Qty target (null when there is no such target).
const pctOfTarget = (okQty, target) =>
  target?.uom === "Qty" && Number(target.value) > 0 ? (okQty / Number(target.value)) * 100 : null;

// Quality % = OK ÷ (OK + Rejected); null when nothing was produced.
const qualityOf = (ok, rejected) => (ok + rejected > 0 ? (ok / (ok + rejected)) * 100 : null);

// Achievement against the target: a Qty target takes the OK Qty, a % target
// takes the Quality % (so "Target 89%" means at least 89% of the pieces OK).
const achievementOf = (okQty, qualityPct, target) => {
  if (target?.uom === "%") return Number(target.value) > 0 && qualityPct !== null ? (qualityPct / Number(target.value)) * 100 : null;
  return pctOfTarget(okQty, target);
};

// On track / Near / Behind for a month that has OK Qty, against its achievement %.
const statusOf = (pct) => (pct === null ? null : pct >= 100 ? "On track" : pct >= 80 ? "Near" : "Behind");

const withMonths = (objective, byProcess) => {
  // A process deleted from Process Master populates as null — dropped here so
  // the pages never see one, and its past OK Qty is simply no longer counted.
  const processes = (objective.processes || []).filter(Boolean);
  const ids = processes.map((p) => p?._id || p);
  const entries = monthsFor(byProcess, ids);
  const rejectedMonths = monthsFor(byProcess, ids, "rejected");
  // A month with no entries takes the figure uploaded from Excel, if any.
  const uploaded = new Map((objective.uploadedMonths || []).map((m) => [m.month, m.okQty]));
  const months = entries.map((ok, i) => (ok > 0 || !uploaded.has(i + 1) ? ok : uploaded.get(i + 1)));
  const yearly = objective.targetPeriod === "Yearly";
  let cumulative = 0, cumulativeRejected = 0;
  const rows = months.map((okQty, i) => {
    cumulative += okQty;
    // Rejected Qty only comes from the entries (an uploaded month has none).
    const rejectedQty = entries[i] > 0 ? rejectedMonths[i] : 0;
    cumulativeRejected += rejectedQty;
    const source = entries[i] > 0 ? "entries" : uploaded.has(i + 1) ? "excel" : null;
    const qualityPct = entries[i] > 0 ? qualityOf(okQty, rejectedQty) : null;
    // Yearly: the figures so far against the year's target; Monthly: this month's.
    const pct = yearly ? achievementOf(cumulative, qualityOf(cumulative, cumulativeRejected), objective.target) : achievementOf(okQty, qualityPct, objective.target);
    const has = okQty > 0;
    return { month: i + 1, okQty, rejectedQty, qualityPct, cumulative, cumulativeRejected, source, pctOfTarget: has ? pct : null, status: has ? statusOf(pct) : null };
  });
  const yearOkQty = cumulative;
  const yearRejectedQty = cumulativeRejected;
  const yearQualityPct = qualityOf(yearOkQty, yearRejectedQty);
  const withData = rows.filter((r) => r.pctOfTarget !== null);
  // The year's achievement: Yearly → the year so far against the target; Monthly → average of the months with data.
  const yearPct = yearly ? achievementOf(yearOkQty, yearQualityPct, objective.target) : withData.length ? withData.reduce((a, r) => a + r.pctOfTarget, 0) / withData.length : null;
  return { ...objective, processes, months: rows, yearOkQty, yearRejectedQty, yearQualityPct, yearPct, yearStatus: statusOf(yearPct), monthsWithData: withData.length };
};

// One line per department: how its year's objectives stand.
const summarizeDepartments = (objectives, departments) =>
  departments.map((d) => {
    const mine = objectives.filter((o) => String(o.department?._id || o.department) === String(d._id));
    const pcts = mine.map((o) => o.yearPct).filter((p) => p !== null);
    return {
      _id: d._id,
      departmentName: d.departmentName,
      objectives: mine.length,
      onTrack: mine.filter((o) => o.yearStatus === "On track").length,
      near: mine.filter((o) => o.yearStatus === "Near").length,
      behind: mine.filter((o) => o.yearStatus === "Behind").length,
      okQty: mine.reduce((a, o) => a + (o.yearOkQty || 0), 0),
      avgPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
    };
  });

// ── KPI objectives ────────────────────────────────────────────────────────

// GET /kpi/objectives?year=&department=  — each objective with its 12 months.
exports.listObjectives = async (req, res) => {
  try {
    const year = parseYear(req.query.year);
    if (!year) return res.status(400).json({ isOk: false, message: "Invalid year" });
    const scope = await departmentScope(req);
    const query = { year, isActive: { $ne: false } };
    if (req.query.department) {
      if (!mongoose.isValidObjectId(req.query.department)) return res.status(400).json({ isOk: false, message: "Invalid department" });
      if (!inScope(scope, req.query.department)) return res.status(403).json({ isOk: false, message: "You don't have access to this department" });
    }
    if (scope) query.department = { $in: [...scope] };

    const [all, byProcess, departments] = await Promise.all([
      KpiObjective.find(query).populate("department", "departmentName").populate("processes", "processName").sort({ createdAt: 1 }).lean(),
      okQtyByProcessMonth(year),
      // Active departments only (an inactive one keeps its old objectives under "All").
      Department.find({ isActive: { $ne: false }, ...(scope ? { _id: { $in: [...scope] } } : {}) }).select("departmentName").sort({ departmentName: 1 }).lean(),
    ]);
    const everything = all.map((o) => withMonths(o, byProcess));
    const wanted = req.query.department ? everything.filter((o) => String(o.department?._id || o.department) === String(req.query.department)) : everything;
    res.status(200).json({
      isOk: true,
      data: wanted,
      departments,
      // Every department this person can see, whatever the filter — the status summary.
      byDepartment: summarizeDepartments(everything, departments),
      canAddAnyDepartment: !scope,
    });
  } catch (error) {
    console.error("Error listing KPI objectives:", error);
    sendError(res, error);
  }
};

const pickObjective = async (body, scope, { allowNoProcesses = false } = {}) => {
  const objective = String(body.objective || "").trim();
  if (!objective) return { error: "Objective is required" };
  if (!mongoose.isValidObjectId(body.department)) return { error: "Select a department" };
  if (!inScope(scope, body.department)) return { error: "You don't have access to this department", status: 403 };
  if (!(await Department.exists({ _id: body.department }))) return { error: "Unknown department" };
  const year = parseYear(body.year);
  if (!year) return { error: "Invalid year" };
  const processes = Array.isArray(body.processes) ? [...new Set(body.processes.map(String))] : [];
  if (!processes.length && !allowNoProcesses) return { error: "Select at least one process — its OK Qty is what the objective counts" };
  if (processes.some((id) => !mongoose.isValidObjectId(id)) || (await Process.countDocuments({ _id: { $in: processes } })) !== processes.length) {
    return { error: "Unknown process selected" };
  }
  const baseline = pickMeasure(body.baseline, "Baseline");
  if (baseline.error) return baseline;
  const target = pickMeasure(body.target, "Target");
  if (target.error) return target;
  const okQtyUom = body.okQtyUom === undefined ? "Qty" : body.okQtyUom;
  if (!UOMS.includes(okQtyUom)) return { error: `OK Qty unit must be one of ${UOMS.join(", ")}` };
  const targetPeriod = body.targetPeriod === undefined ? "Monthly" : body.targetPeriod;
  if (!TARGET_PERIODS.includes(targetPeriod)) return { error: `Target period must be one of ${TARGET_PERIODS.join(", ")}` };
  const owner = String(body.owner || "").trim().slice(0, 100);
  const remarks = String(body.remarks || "").trim().slice(0, 500);
  return { data: { objective, department: body.department, year, processes, baseline: baseline.measure, target: target.measure, okQtyUom, targetPeriod, owner, remarks } };
};

exports.createObjective = async (req, res) => {
  try {
    const scope = await departmentScope(req);
    const { data, error, status } = await pickObjective(req.body || {}, scope);
    if (error) return res.status(status || 400).json({ isOk: false, message: error });
    const created = await KpiObjective.create({ ...data, createdByName: nameOf(req) });
    res.status(201).json({ isOk: true, data: created, message: "Objective added" });
  } catch (error) {
    console.error("Error creating KPI objective:", error);
    sendError(res, error);
  }
};

const findMine = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await KpiObjective.findById(id);
  if (!doc || !inScope(await departmentScope(req), doc.department)) return null;
  return doc;
};

exports.updateObjective = async (req, res) => {
  try {
    const existing = await findMine(req, req.params.id);
    if (!existing) return res.status(404).json({ isOk: false, message: "Objective not found" });
    const scope = await departmentScope(req);
    const body = { ...existing.toObject(), ...(req.body || {}) };
    const { data, error, status } = await pickObjective(body, scope, { allowNoProcesses: (existing.uploadedMonths || []).length > 0 });
    if (error) return res.status(status || 400).json({ isOk: false, message: error });
    Object.assign(existing, data);
    if (req.body?.isActive !== undefined) existing.isActive = req.body.isActive !== false && req.body.isActive !== "false";
    await existing.save();
    res.status(200).json({ isOk: true, data: existing, message: "Objective updated" });
  } catch (error) {
    console.error("Error updating KPI objective:", error);
    sendError(res, error);
  }
};

exports.deleteObjective = async (req, res) => {
  try {
    const existing = await findMine(req, req.params.id);
    if (!existing) return res.status(404).json({ isOk: false, message: "Objective not found" });
    await existing.deleteOne();
    res.status(200).json({ isOk: true, message: "Objective deleted" });
  } catch (error) {
    console.error("Error deleting KPI objective:", error);
    sendError(res, error);
  }
};

// "Jan" / "January" / "1" / "01" → 1…12, else null.
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const parseMonth = (raw) => {
  const t = String(raw ?? "").trim().toLowerCase();
  if (/^\d{1,2}$/.test(t)) { const n = Number(t); return n >= 1 && n <= 12 ? n : null; }
  const i = MONTH_NAMES.findIndex((m) => t.startsWith(m));
  return i >= 0 ? i + 1 : null;
};
const parseQty = (raw) => {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

// POST /kpi/objectives/import { rows: [{ department, objective, year, month, okQty,
// baseline?, baselineUom?, target?, targetUom?, targetPeriod?, owner?, processes? }] }
// Old sheets: one row per objective-month. The objective is matched by
// department + name + year (made if missing, with the row's Baseline / Target
// / processes when given), and the month's OK Qty is stored as uploaded.
exports.importObjectives = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ isOk: false, message: "No rows to import" });
    if (rows.length > 5000) return res.status(400).json({ isOk: false, message: "At most 5,000 rows in one upload" });
    const scope = await departmentScope(req);
    const [departments, processes] = await Promise.all([Department.find().select("departmentName").lean(), Process.find().select("processName").lean()]);
    const deptByName = new Map(departments.map((d) => [d.departmentName.trim().toLowerCase(), d]));
    const procByName = new Map(processes.map((p) => [p.processName.trim().toLowerCase(), p]));
    const errors = [];
    const cache = new Map();
    let imported = 0, created = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const line = Number(r.row) || i + 2;
      const dept = deptByName.get(String(r.department || "").trim().toLowerCase());
      if (!dept) { errors.push({ row: line, message: `Department "${r.department || ""}" not found` }); continue; }
      if (!inScope(scope, dept._id)) { errors.push({ row: line, message: `No access to department "${dept.departmentName}"` }); continue; }
      const objective = String(r.objective || "").trim();
      if (!objective) { errors.push({ row: line, message: "Objective is blank" }); continue; }
      const year = parseYear(r.year);
      if (!year) { errors.push({ row: line, message: `Year "${r.year}" is not valid` }); continue; }
      const month = parseMonth(r.month);
      if (!month) { errors.push({ row: line, message: `Month "${r.month}" is not valid` }); continue; }
      const okQty = parseQty(r.okQty);
      if (okQty === null || Number.isNaN(okQty)) { errors.push({ row: line, message: `OK Qty "${r.okQty}" is not a number` }); continue; }
      const key = `${dept._id}|${objective.toLowerCase()}|${year}`;
      let doc = cache.get(key);
      if (!doc) {
        doc = await KpiObjective.findOne({ department: dept._id, year, objective: new RegExp(`^${objective.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
        if (!doc) {
          const procNames = String(r.processes || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
          const procIds = procNames.map((n) => procByName.get(n.toLowerCase())?._id).filter(Boolean);
          if (procNames.length && procIds.length !== procNames.length) { errors.push({ row: line, message: `A process in "${r.processes}" was not found` }); continue; }
          const baseline = pickMeasure({ value: r.baseline ?? "", uom: r.baselineUom || "Qty" }, "Baseline");
          const target = pickMeasure({ value: r.target ?? "", uom: r.targetUom || "Qty" }, "Target");
          if (baseline.error || target.error) { errors.push({ row: line, message: baseline.error || target.error }); continue; }
          const targetPeriod = TARGET_PERIODS.includes(r.targetPeriod) ? r.targetPeriod : "Monthly";
          doc = await KpiObjective.create({ department: dept._id, objective, year, processes: procIds, baseline: baseline.measure, target: target.measure, targetPeriod, owner: String(r.owner || "").trim().slice(0, 100), remarks: "Loaded from Excel", createdByName: nameOf(req), uploadedMonths: [] });
          created += 1;
        }
        cache.set(key, doc);
      }
      doc.uploadedMonths = [...(doc.uploadedMonths || []).filter((m) => m.month !== month), { month, okQty }];
      imported += 1;
    }
    await Promise.all([...cache.values()].map((d) => d.save()));
    res.status(200).json({ isOk: true, data: { imported, created, objectives: cache.size, errors }, message: `${imported} month figure${imported === 1 ? "" : "s"} loaded` });
  } catch (error) {
    console.error("Error importing KPI objectives:", error);
    sendError(res, error);
  }
};

// The metric figures of one row / form: { sales: 12.5, … } for the keys given
// (blank = leave as is). A bad number names the metric.
const pickMetricValues = (raw) => {
  const values = {};
  for (const m of METRICS) {
    if (raw?.[m.key] === undefined) continue;
    const n = parseQty(raw[m.key]);
    if (Number.isNaN(n)) return { error: `${m.label} "${raw[m.key]}" is not a number of 0 or more` };
    if (n !== null && m.unit === "%" && n > 100) return { error: `${m.label} must be 0–100%` };
    values[m.key] = n;
  }
  return { values };
};

// POST /kpi/company/import { rows: [{ year, month, okQty?, sales?, salary?, … }] }
// Old sheets, one row per month: OK Qty goes to CompanyHistory (a month with
// data entries keeps the entries); the business figures to CompanyMonthly.
exports.importCompanyHistory = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ isOk: false, message: "No rows to import" });
    if (rows.length > 5000) return res.status(400).json({ isOk: false, message: "At most 5,000 rows in one upload" });
    const errors = [];
    let imported = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const line = Number(r.row) || i + 2;
      const year = parseYear(r.year);
      if (!year) { errors.push({ row: line, message: `Year "${r.year}" is not valid` }); continue; }
      const month = parseMonth(r.month);
      if (!month) { errors.push({ row: line, message: `Month "${r.month}" is not valid` }); continue; }
      const okQty = parseQty(r.okQty);
      if (Number.isNaN(okQty)) { errors.push({ row: line, message: `OK Qty "${r.okQty}" is not a number` }); continue; }
      const picked = pickMetricValues(r);
      if (picked.error) { errors.push({ row: line, message: picked.error }); continue; }
      // Only the figures the sheet has — blank cells never wipe a stored figure.
      const set = Object.fromEntries(Object.entries(picked.values).filter(([, v]) => v !== null).map(([k, v]) => [`values.${k}`, v]));
      if (okQty === null && !Object.keys(set).length) { errors.push({ row: line, message: "No figure on this row" }); continue; }
      if (okQty !== null) await CompanyHistory.findOneAndUpdate({ year, month }, { okQty, uploadedByName: nameOf(req) }, { upsert: true, new: true, setDefaultsOnInsert: true });
      if (Object.keys(set).length) await CompanyMonthly.findOneAndUpdate({ year, month }, { $set: { ...set, updatedByName: nameOf(req), source: "excel" } }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
      imported += 1;
    }
    res.status(200).json({ isOk: true, data: { imported, errors }, message: `${imported} month${imported === 1 ? "" : "s"} loaded` });
  } catch (error) {
    console.error("Error importing company history:", error);
    sendError(res, error);
  }
};

// PUT /kpi/company/monthly { year, month, values: { sales, salary, … } } —
// the month's business figures typed on the page; every metric is written
// (blank clears it).
exports.saveCompanyMonthly = async (req, res) => {
  try {
    const year = parseYear(req.body?.year);
    if (!year) return res.status(400).json({ isOk: false, message: "Invalid year" });
    const month = parseMonth(req.body?.month);
    if (!month) return res.status(400).json({ isOk: false, message: "Invalid month" });
    const raw = req.body?.values || {};
    const picked = pickMetricValues(Object.fromEntries(METRIC_KEYS.map((k) => [k, raw[k] ?? ""])));
    if (picked.error) return res.status(400).json({ isOk: false, message: picked.error });
    const doc = await CompanyMonthly.findOneAndUpdate(
      { year, month },
      { $set: { values: picked.values, updatedByName: nameOf(req), source: "entry" } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    res.status(200).json({ isOk: true, data: doc, message: "Monthly figures saved" });
  } catch (error) {
    console.error("Error saving company monthly figures:", error);
    sendError(res, error);
  }
};

// ── Company level objectives ──────────────────────────────────────────────

// GET /kpi/company?year=  — the year's objectives plus the OK Qty totals:
// by month for that year, by year for all time, the grand total, and the
// average achievement % across the year's department objectives.
exports.companySummary = async (req, res) => {
  try {
    const year = parseYear(req.query.year);
    if (!year) return res.status(400).json({ isOk: false, message: "Invalid year" });
    const [objectives, entriesAll, history, kpis, byProcess, monthlyDocs] = await Promise.all([
      CompanyObjective.find({ year, isActive: { $ne: false } }).sort({ createdAt: 1 }).lean(),
      okQtyAllByYearMonth(),
      CompanyHistory.find().select("year month okQty").lean(),
      KpiObjective.find({ year, isActive: { $ne: false } }).select("processes target targetPeriod").lean(),
      okQtyByProcessMonth(year),
      // This year's business figures and last year's, for the comparisons.
      CompanyMonthly.find({ year: { $in: [year, year - 1] } }).lean(),
    ]);
    // Entries first; an uploaded month only counts where the entries have nothing.
    const have = new Set(entriesAll.filter((r) => r.okQty > 0).map((r) => `${r.year}-${r.month}`));
    const all = [...entriesAll, ...history.filter((h) => !have.has(`${h.year}-${h.month}`)).map((h) => ({ ...h, source: "excel" }))];
    const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, okQty: 0, source: null }));
    const byYear = new Map();
    let total = 0;
    for (const r of all) {
      if (r.year === year) { byMonth[r.month - 1].okQty += r.okQty; if (r.source === "excel") byMonth[r.month - 1].source = "excel"; }
      byYear.set(r.year, (byYear.get(r.year) || 0) + r.okQty);
      total += r.okQty;
    }
    const yearOkQty = byMonth.reduce((a, m) => a + m.okQty, 0);
    // Average achievement %: each department objective's own year achievement
    // (withMonths), averaged over the objectives that have one.
    const pcts = kpis.map((k) => withMonths(k, byProcess).yearPct).filter((p) => p !== null);
    const avgAchievementPct = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
    const onTrack = pcts.filter((p) => p >= 100).length;
    res.status(200).json({
      isOk: true,
      data: {
        year,
        objectives: objectives.map((o) => {
          const achievedPct = pctOfTarget(yearOkQty, o.target);
          return { ...o, achievedPct, status: statusOf(achievedPct) };
        }),
        byMonth,
        byYear: [...byYear.entries()].map(([y, okQty]) => ({ year: y, okQty })).sort((a, b) => a.year - b.year),
        yearOkQty,
        totalOkQty: total,
        avgAchievementPct,
        kpiObjectiveCount: kpis.length,
        kpiOnTrack: onTrack,
        kpiBehind: pcts.filter((p) => p < 80).length,
        // The business figures: { sales: { months[12], year, prevYear }, … }.
        metrics: summarizeMetrics(monthlyDocs, year),
        monthsWithFigures: monthsWithFigures(monthlyDocs, year),
        monthly: monthlyDocs.filter((d) => d.year === year).map((d) => ({ month: d.month, values: d.values || {}, source: d.source, updatedByName: d.updatedByName })).sort((a, b) => a.month - b.month),
      },
    });
  } catch (error) {
    console.error("Error loading company summary:", error);
    sendError(res, error);
  }
};

const pickCompany = (body) => {
  const objective = String(body.objective || "").trim();
  if (!objective) return { error: "Objective is required" };
  const year = parseYear(body.year);
  if (!year) return { error: "Invalid year" };
  const target = pickMeasure(body.target, "Target");
  if (target.error) return target;
  const baseline = pickMeasure(body.baseline, "Baseline");
  if (baseline.error) return baseline;
  const owner = String(body.owner || "").trim().slice(0, 100);
  const remarks = String(body.remarks || "").trim().slice(0, 500);
  return { data: { objective, year, target: target.measure, baseline: baseline.measure, owner, remarks } };
};

exports.createCompanyObjective = async (req, res) => {
  try {
    const { data, error } = pickCompany(req.body || {});
    if (error) return res.status(400).json({ isOk: false, message: error });
    const created = await CompanyObjective.create({ ...data, createdByName: nameOf(req) });
    res.status(201).json({ isOk: true, data: created, message: "Objective added" });
  } catch (error) {
    console.error("Error creating company objective:", error);
    sendError(res, error);
  }
};

exports.updateCompanyObjective = async (req, res) => {
  try {
    const existing = mongoose.isValidObjectId(req.params.id) ? await CompanyObjective.findById(req.params.id) : null;
    if (!existing) return res.status(404).json({ isOk: false, message: "Objective not found" });
    const { data, error } = pickCompany({ ...existing.toObject(), ...(req.body || {}) });
    if (error) return res.status(400).json({ isOk: false, message: error });
    Object.assign(existing, data);
    await existing.save();
    res.status(200).json({ isOk: true, data: existing, message: "Objective updated" });
  } catch (error) {
    console.error("Error updating company objective:", error);
    sendError(res, error);
  }
};

exports.deleteCompanyObjective = async (req, res) => {
  try {
    const existing = mongoose.isValidObjectId(req.params.id) ? await CompanyObjective.findById(req.params.id) : null;
    if (!existing) return res.status(404).json({ isOk: false, message: "Objective not found" });
    await existing.deleteOne();
    res.status(200).json({ isOk: true, message: "Objective deleted" });
  } catch (error) {
    console.error("Error deleting company objective:", error);
    sendError(res, error);
  }
};
