const mongoose = require("mongoose");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const { sortMachines } = require("../utils/machineOrder");
const { machineNamesFor } = require("../utils/machineNames");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Columns the Process Master table may sort by.
const SORTABLE = ["processName", "isActive", "createdAt"];
// Dashboards look across years, unlike the entry sheet's two-month window.
const MAX_RANGE_DAYS = 366 * 5;

const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};

const pickProcess = ({ processName, description, stats, charts, isActive, dataEntryMenu, dataEntryMenuLabel }) => ({
  processName,
  description,
  isActive,
  ...(Array.isArray(stats) ? { stats } : {}),
  ...(Array.isArray(charts) ? { charts } : {}),
  // "" from an unpicked select clears the link; undefined leaves it alone.
  ...(dataEntryMenu !== undefined
    ? { dataEntryMenu: dataEntryMenu || null, dataEntryMenuLabel: dataEntryMenu ? dataEntryMenuLabel || null : null }
    : {}),
});

const isDuplicateName = async (processName, excludeId) => {
  const escaped = String(processName || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const query = { processName: { $regex: `^${escaped}$`, $options: "i" } };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Process.exists(query));
};

const validMachineIds = (machineIds) =>
  Array.isArray(machineIds) && machineIds.every((id) => mongoose.isValidObjectId(id));

// Makes `machineIds` exactly the machines of this process: machines listed
// are moved in (from whichever process held them), machines no longer listed
// are released.
// A machine deleted from Machine Master isn't in the form's list, so it is never
// "released" here — it keeps its process, which is what keeps its past entries on
// that process's dashboard.
const syncMachines = async (processId, machineIds) => {
  await Machine.updateMany(
    { process: processId, _id: { $nin: machineIds }, isDeleted: { $ne: true } },
    { $set: { process: null } },
  );
  if (machineIds.length) await Machine.updateMany({ _id: { $in: machineIds } }, { $set: { process: processId } });
};

// { processId: [machine, …] } in sheet order. The order itself is for everyone;
// the sequence number is Super Admin's alone (see machine.controller.js), so it
// is dropped from the payload unless `withSequence`.
const machinesByProcess = async (processIds, onlyActive, withSequence = false) => {
  const query = { process: { $in: processIds }, isDeleted: { $ne: true } };
  if (onlyActive) query.isActive = true;
  const machines = sortMachines(
    await Machine.find(query).select("machineName color sequence isActive process").lean(),
  );
  const map = {};
  for (const { sequence, ...rest } of machines) {
    (map[String(rest.process)] ||= []).push(withSequence ? { ...rest, sequence } : rest);
  }
  return map;
};

const isSuperAdmin = (req) => req.user?.roleType === "SuperAdmin";

const withMachines = async (processes, onlyActive = false, withSequence = false) => {
  const map = await machinesByProcess(processes.map((p) => p._id), onlyActive, withSequence);
  return processes.map((p) => ({ ...p, machines: map[String(p._id)] || [] }));
};

exports.createProcess = async (req, res) => {
  try {
    const data = pickProcess(req.body);
    const { machineIds } = req.body;
    if (machineIds !== undefined && !validMachineIds(machineIds)) {
      return res.status(400).json({ isOk: false, message: "Invalid machine list" });
    }
    if (await isDuplicateName(data.processName)) {
      return res.status(409).json({ isOk: false, message: `Process "${data.processName}" already exists` });
    }
    const process = await Process.create(data);
    if (machineIds) await syncMachines(process._id, machineIds);
    res.status(201).json({ isOk: true, data: process, message: "Process created successfully" });
  } catch (error) {
    console.error("Error creating process:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.updateProcess = async (req, res) => {
  try {
    const { processId } = req.params;
    const data = pickProcess(req.body);
    const { machineIds } = req.body;
    if (machineIds !== undefined && !validMachineIds(machineIds)) {
      return res.status(400).json({ isOk: false, message: "Invalid machine list" });
    }
    if (data.processName !== undefined && (await isDuplicateName(data.processName, processId))) {
      return res.status(409).json({ isOk: false, message: `Process "${data.processName}" already exists` });
    }
    const process = await Process.findByIdAndUpdate(processId, data, { new: true, runValidators: true });
    if (!process) return res.status(404).json({ isOk: false, message: "Process not found" });
    if (machineIds) await syncMachines(process._id, machineIds);
    res.status(200).json({ isOk: true, data: process, message: "Process updated successfully" });
  } catch (error) {
    console.error("Error updating process:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

// First delete deactivates (hides it from the dashboard); deleting an already
// inactive process removes it and releases its machines. Production entries
// hang off machines, not processes, so nothing is ever lost.
exports.deleteProcess = async (req, res) => {
  try {
    const process = await Process.findById(req.params.processId);
    if (!process) return res.status(404).json({ isOk: false, message: "Process not found" });

    if (process.isActive) {
      process.isActive = false;
      await process.save();
      return res.status(200).json({ isOk: true, message: "Process deactivated successfully" });
    }

    await Machine.updateMany({ process: process._id }, { $set: { process: null } });
    await Item.updateMany({ process: process._id }, { $set: { process: null } });
    await Process.findByIdAndDelete(process._id);
    res.status(200).json({ isOk: true, message: "Process deleted successfully" });
  } catch (error) {
    console.error("Error deleting process:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.getProcessById = async (req, res) => {
  try {
    const process = await Process.findById(req.params.processId).lean();
    if (!process) return res.status(404).json({ isOk: false, message: "Process not found" });
    const [data] = await withMachines([process], false, isSuperAdmin(req));
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error fetching process:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Active processes with their active machines, in display order (the order
// they were created) — what the dashboard landing page lays out.
exports.listProcesses = async (req, res) => {
  try {
    const processes = await Process.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();
    res.status(200).json({ isOk: true, data: await withMachines(processes, true, isSuperAdmin(req)) });
  } catch (error) {
    console.error("Error listing processes:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.listProcessByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = {};
    if (match) {
      const escaped = String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [{ processName: { $regex: escaped, $options: "i" } }];
    }
    if (isActive !== undefined) query.isActive = isActive;

    let sortQuery = { createdAt: 1 };
    if (SORTABLE.includes(sorton) && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1, createdAt: 1 };

    const [totalCount, processes] = await Promise.all([
      Process.countDocuments(query),
      Process.find(query)
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: await withMachines(processes, false, isSuperAdmin(req)) }] });
  } catch (error) {
    console.error("Error searching processes:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

const dashNum = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const dashIsNum = (v) => v !== null && Number.isFinite(v);

// Product Cycle Time (sec) = Program Time (min) × 60 ÷ pieces per program —
// VmcEntry's own formula (client/src/utils/vmcSheet.js's programCycleSec).
const vmcCycleSec = (e) => {
  const minutes = dashNum(e.programTimeMin);
  const pieces = dashNum(e.pcsPerProgram);
  return dashIsNum(minutes) && dashIsNum(pieces) && pieces > 0 ? (minutes * 60) / pieces : null;
};

// Total Cycle Time (sec) = Loading + Process + Unloading and Cleaning + Other
// Operations — SpmEntry's own formula (client/src/utils/spmSheet.js's cycle
// helper). RivetEntry does NOT use this: checked against real rows, those
// four fields are always blank there — RivetEntry stores totalCycleSec
// directly, typed per entry, same as CNC (see rivetSheet.js).
const fourPartCycleSec = (e) => {
  const parts = [e.loadingSec, e.processSec, e.unloadingCleaningSec, e.otherOperationsSec].map(dashNum);
  return parts.every(dashIsNum) ? parts.reduce((sum, n) => sum + n, 0) : null;
};

// Every sheet's own collection, and (for the ones that don't store a
// totalCycleSec of their own) the function that works it out from that
// collection's fields. CNC and RIVET both store totalCycleSec directly, so
// neither needs one. The client's shared rowCalc/dayCalc
// (utils/productionSheet.js) read `totalCycleSec` off the row however it's
// reached them, so once it's attached here every sheet's entries can be
// merged into one dashboard feed and treated identically from here on.
const DASHBOARD_SHEETS = [
  { Model: ProductionEntry, cycleSec: null },
  { Model: VmcEntry, cycleSec: vmcCycleSec },
  { Model: SpmEntry, cycleSec: fourPartCycleSec },
  { Model: RivetEntry, cycleSec: null },
];

// GET /processes/entries?from=YYYY-MM-DD&to=YYYY-MM-DD[&process=id]
// The raw entries a dashboard computes from — one process's machines, or
// every machine when `process` is omitted — pooled across every sheet's own
// collection (CNC, VMC, SPM, RIVET: see DASHBOARD_SHEETS), since a process's
// machines only ever carry entries in the one collection its own Data Entry
// page saves to. Same row shape as GET /production-sheet so the client's
// shared formulas apply unchanged.
//
// `extent` is the first and last date this process has ANY entry on, across
// every sheet (regardless of from/to), so the filter panel can offer the real
// years without a second request. `machineNames` names every machine the
// returned entries were made on.
exports.getDashboardEntries = async (req, res) => {
  try {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (!from || !to || to < from) {
      return res.status(400).json({ isOk: false, message: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required" });
    }
    if ((to - from) / 86400000 > MAX_RANGE_DAYS) {
      return res.status(400).json({ isOk: false, message: "Date range can't exceed 5 years" });
    }

    const scope = {};
    if (req.query.process) {
      if (!mongoose.isValidObjectId(req.query.process)) {
        return res.status(400).json({ isOk: false, message: "Invalid process" });
      }
      // Deliberately includes machines deleted from Machine Master: their past
      // entries still belong to this process's dashboard.
      const machineIds = await Machine.find({ process: req.query.process }).distinct("_id");
      scope.machine = { $in: machineIds };
    }

    const results = await Promise.all(
      DASHBOARD_SHEETS.map(async ({ Model, cycleSec }) => {
        const edge = (dir) => Model.findOne(scope).sort({ date: dir }).select("date").lean();
        const [entries, first, last] = await Promise.all([
          Model.find({ ...scope, date: { $gte: from, $lte: to } })
            .select("-__v -createdAt -updatedAt -updatedBy -updatedByModel")
            .sort({ date: 1 })
            .lean(),
          edge(1),
          edge(-1),
        ]);
        return {
          first,
          last,
          rows: entries.map((e) => ({
            ...e,
            date: e.date.toISOString().slice(0, 10),
            machine: String(e.machine),
            item: e.item ? String(e.item) : null,
            ...(cycleSec ? { totalCycleSec: cycleSec(e) } : {}),
          })),
        };
      }),
    );

    const data = results.flatMap((r) => r.rows);
    const firsts = results.map((r) => r.first).filter(Boolean);
    const lasts = results.map((r) => r.last).filter(Boolean);
    const extent = firsts.length
      ? {
          from: new Date(Math.min(...firsts.map((f) => f.date.getTime()))).toISOString().slice(0, 10),
          to: new Date(Math.max(...lasts.map((l) => l.date.getTime()))).toISOString().slice(0, 10),
        }
      : null;

    // The dashboard's machine list is active-only; an entry made on a machine
    // that has since been deactivated (or deleted) still needs its name.
    res.status(200).json({
      isOk: true,
      machineNames: await machineNamesFor(data.map((e) => e.machine)),
      extent,
      data,
    });
  } catch (error) {
    console.error("Error loading dashboard entries:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
