const mongoose = require("mongoose");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const PressEntry = require("../models/PressEntry");
const ContactEntry = require("../models/ContactEntry");
const TrobeEntry = require("../models/TrobeEntry");
const SpringEntry = require("../models/SpringEntry");
const PowderCoatingEntry = require("../models/PowderCoatingEntry");
const RubberEntry = require("../models/RubberEntry");
const InjectionEntry = require("../models/InjectionEntry");
const EmbossingEntry = require("../models/EmbossingEntry");
const PrintingEntry = require("../models/PrintingEntry");
const BeforePowderCoatingEntry = require("../models/BeforePowderCoatingEntry");
const FinalAssemblyEntry = require("../models/FinalAssemblyEntry");
const RawCastingEntry = require("../models/RawCastingEntry");
const MfdEntry = require("../models/MfdEntry");
const MfaEntry = require("../models/MfaEntry");
const { sortMachines } = require("../utils/machineOrder");
const { machineNamesFor } = require("../utils/machineNames");
const { actorOf } = require("../utils/adminAccess");
const { canChangeShift, validOperatorIds } = require("../utils/shiftAccess");
const ShiftLockAccess = require("../models/ShiftLockAccess");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const { settingOf } = require("../utils/plannedShift");
const { viewableProcessIds } = require("../utils/processAccess");
const { CYCLE_SEC } = require("../utils/oeeMetrics");
const AuditLog = require("../models/AuditLog");
const { sendError, pageParams } = require("../utils/httpErrors");

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

// The Operator Planned Shift setting a request carries — { plannedShiftLocked,
// plannedShiftHours } with only the keys it actually sent — or a 400 message.
const pickShiftSetting = (body) => {
  const out = {};
  if (body.plannedShiftLocked !== undefined) out.plannedShiftLocked = body.plannedShiftLocked !== false && body.plannedShiftLocked !== "false";
  if (body.plannedShiftHours !== undefined && body.plannedShiftHours !== "" && body.plannedShiftHours !== null) {
    const hours = Number(body.plannedShiftHours);
    // 0.25 is the model's own minimum (models/Process.js) — checked here so the
    // message says so, rather than the model's validation error.
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 24) return { error: "Planned shift hours must be at least 0.25 and at most 24" };
    out.plannedShiftHours = hours;
  }
  return { setting: out };
};

// How a setting reads in the audit log: "Locked — 10 hr" / "Unlocked — entered on each entry".
const shiftText = (raw) => {
  const locked = raw.plannedShiftLocked !== false;
  return locked ? `Locked — ${Number(raw.plannedShiftHours ?? 12)} hr` : "Unlocked — entered on each entry";
};

// Only people the Super Admin allowed (see utils/shiftAccess.js) may change the
// Operator Planned Shift — the lock or the hours, even the hours kept behind a lock. Anyone else may still save
// the rest of the process, as long as what they send matches what's there
// (the form always sends it back unchanged).
const shiftChangeError = async (req, current, next) => {
  const before = { plannedShiftLocked: current?.plannedShiftLocked !== false, plannedShiftHours: current?.plannedShiftHours ?? 12 };
  const after = { ...before, ...next };
  const changed = before.plannedShiftLocked !== after.plannedShiftLocked || Number(before.plannedShiftHours) !== Number(after.plannedShiftHours);
  if (changed && !(await canChangeShift(req))) return { status: 403, message: "You have not been given access to lock or unlock the Operator Planned Shift. Ask the Super Admin." };
  return { changed, before, after };
};

const logShiftChange = async (req, process, before, after) => {
  try {
    await AuditLog.create({
      entityType: "process",
      entity: process._id,
      label: `Process · ${process.processName}`,
      action: "setting",
      changes: [{ field: "plannedShift", label: "Operator Planned Shift", from: shiftText(before), to: shiftText(after) }],
      actor: await actorOf(req),
    });
  } catch (error) {
    console.error("Error logging planned shift change:", error);
  }
};

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
    const { setting, error: settingError } = pickShiftSetting(req.body);
    if (settingError) return res.status(400).json({ isOk: false, message: settingError });
    // A new process starts locked at 12 hr; anything else needs Admin.
    const shift = await shiftChangeError(req, {}, setting);
    if (shift.status) return res.status(shift.status).json({ isOk: false, message: shift.message });
    const process = await Process.create({ ...data, ...setting });
    if (machineIds) await syncMachines(process._id, machineIds);
    if (shift.changed) await logShiftChange(req, process, shift.before, shift.after);
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
    const { setting, error: settingError } = pickShiftSetting(req.body);
    if (settingError) return res.status(400).json({ isOk: false, message: settingError });
    const current = mongoose.isValidObjectId(processId) ? await Process.findById(processId).lean() : null;
    if (!current) return res.status(404).json({ isOk: false, message: "Process not found" });
    const shift = await shiftChangeError(req, current, setting);
    if (shift.status) return res.status(shift.status).json({ isOk: false, message: shift.message });
    const process = await Process.findByIdAndUpdate(processId, { ...data, ...setting }, { new: true, runValidators: true });
    if (!process) return res.status(404).json({ isOk: false, message: "Process not found" });
    if (machineIds) await syncMachines(process._id, machineIds);
    if (shift.changed) await logShiftChange(req, process, shift.before, shift.after);
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
    sendError(res, error);
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
    sendError(res, error);
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
    sendError(res, error);
  }
};

exports.listProcessByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;
    const page = pageParams(skip, per_page, { max: 1000 });

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
        .skip(page.skip)
        .limit(page.limit)
        .lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: await withMachines(processes, false, isSuperAdmin(req)) }] });
  } catch (error) {
    console.error("Error searching processes:", error);
    sendError(res, error);
  }
};

// Every sheet's own collection, and (for the sheets whose table works its
// cycle time out from other fields) that table's own cycle time — taken from
// utils/oeeMetrics.js's CYCLE_SEC, the server's copy of each sheet's rule
// (VMC/PRESS: per piece of a program or standard time; SPM/RIVET: the Part's
// Total Cycle Time minus the operations unticked on the entry). The client's
// shared rowCalc/dayCalc (utils/productionSheet.js) read `totalCycleSec` off
// the row however it's reached them, so once it's attached here every sheet's
// entries can be merged into one dashboard feed and show the same figures as
// their own Data Entry page. CNC needs none: rowCalc takes its unticked
// operations out itself.
const DASHBOARD_SHEETS = [
  { Model: ProductionEntry, cycleSec: null },
  { Model: VmcEntry, cycleSec: CYCLE_SEC.vmc },
  { Model: SpmEntry, cycleSec: CYCLE_SEC.spm },
  { Model: RivetEntry, cycleSec: CYCLE_SEC.rivet },
  { Model: PressEntry, cycleSec: CYCLE_SEC.press },
  { Model: ContactEntry, cycleSec: null },
  { Model: TrobeEntry, cycleSec: null },
  // SPRING FOR PINS works out Effective Run Time on OK + Rejected (its own
  // sheet's rule) — the flag tells the client's shared rowCalc to do so.
  { Model: SpringEntry, cycleSec: null, extra: { runQtyBasis: "total" } },
  // AFTER POWDER COATING has no machines: its entries carry their own process
  // and a worker, who stands in the machine's place on the dashboard. Its
  // Ideal Inspection Time counts Total Qty, like SPRING FOR PINS.
  { Model: PowderCoatingEntry, cycleSec: null, byProcess: true, extra: { runQtyBasis: "total" } },
  // RUBBER is per worker too; its Effective Working Time counts OK Qty, like CNC.
  { Model: RubberEntry, cycleSec: null, byProcess: true },
  // INJECTION MOULDING is a machine sheet: Effective Machine Run Time counts
  // TOTAL QTY like SPRING FOR PINS, and each entry is worked out on its own
  // (calcMode "perEntry", see client entryDayCalc).
  { Model: InjectionEntry, cycleSec: null, extra: { runQtyBasis: "total", calcMode: "perEntry" } },
  // EMBOSSING: the same as INJECTION MOULDING (a machine sheet, TOTAL QTY, per entry).
  { Model: EmbossingEntry, cycleSec: null, extra: { runQtyBasis: "total", calcMode: "perEntry" } },
  // PRINTING is per operator (byProcess; its optional MC No. is mcMachine, not
  // the row key). Effective Machine Run Time counts TOTAL QTY like SPRING FOR
  // PINS; each entry is worked out on its own (calcMode "perEntry", see client
  // entryDayCalc); its three own downtime columns count as stoppage too.
  {
    Model: PrintingEntry,
    cycleSec: null,
    byProcess: true,
    extra: { runQtyBasis: "total", calcMode: "perEntry", extraStoppageKeys: PrintingEntry.PRINTING_EXTRA_STOPPAGE_KEYS },
  },
  // BEFORE POWDER COATING is per operator (byProcess); Effective Machine Run
  // Time counts TOTAL QTY like SPRING FOR PINS; each entry is worked out on its
  // own (calcMode "perEntry", see client entryDayCalc), and its OEE considering
  // losses takes every stoppage off except Lunch.
  { Model: BeforePowderCoatingEntry, cycleSec: null, byProcess: true, extra: { runQtyBasis: "total", calcMode: "perEntry", lossesExceptLunch: true } },
  // FINAL ASSEMBLY is per worker (byProcess); Effective Time counts TOTAL QTY
  // like AFTER POWDER COATING, and each entry is worked out on its own.
  { Model: FinalAssemblyEntry, cycleSec: null, byProcess: true, extra: { runQtyBasis: "total", calcMode: "perEntry" } },
  // RAW CASTING is per worker (byProcess), on AFTER POWDER COATING's template:
  // Ideal Inspection Time counts TOTAL QTY, and each entry is worked out on its
  // own (calcMode "perEntry", see client entryDayCalc). Its Types of Defects are
  // its rejectBreakdown, so Rejection by Reason names them.
  { Model: RawCastingEntry, cycleSec: null, byProcess: true, extra: { runQtyBasis: "total", calcMode: "perEntry" } },
  // MODULAR FRAME DRILLING is a machine sheet: its cycle is the entry's own
  // Total Cycle Time (CYCLE_SEC.mfd), Effective Machine Run Time counts OK Qty
  // like CNC, and each entry is worked out on its own (calcMode "perEntry",
  // see client entryDayCalc). Its IDEAL Quantity takes Lunch / Tea out of the
  // shift (idealLessLunch), so the dashboard's Ideal QTY matches the table.
  { Model: MfdEntry, cycleSec: CYCLE_SEC.mfd, extra: { calcMode: "perEntry", idealLessLunch: true } },
  // MODULAR FRAME ASSEMBLY is per worker (byProcess), on RAW CASTING's template:
  // Ideal Assembly Time counts TOTAL QTY, and each entry is worked out on its
  // own (calcMode "perEntry", see client entryDayCalc).
  { Model: MfaEntry, cycleSec: null, byProcess: true, extra: { runQtyBasis: "total", calcMode: "perEntry" } },
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

    // Only the processes this person's role can view (utils/processAccess.js):
    // a process they can't is refused outright, and "All machines" covers just
    // theirs. null = no limit.
    const viewable = await viewableProcessIds(req, await Process.find().select("processName dataEntryMenu isActive").lean());

    const scope = {};
    let processScope = {};
    if (req.query.process) {
      if (!mongoose.isValidObjectId(req.query.process)) {
        return res.status(400).json({ isOk: false, message: "Invalid process" });
      }
      if (viewable && !viewable.has(String(req.query.process))) {
        return res.status(403).json({ isOk: false, message: "You don't have access to this process's dashboard" });
      }
      // Deliberately includes machines deleted from Machine Master: their past
      // entries still belong to this process's dashboard.
      const machineIds = await Machine.find({ process: req.query.process }).distinct("_id");
      scope.machine = { $in: machineIds };
      processScope = { process: req.query.process };
    } else if (viewable) {
      const mine = [...viewable];
      const machineIds = await Machine.find({ process: { $in: mine } }).distinct("_id");
      scope.machine = { $in: machineIds };
      processScope = { process: { $in: mine } };
    }

    const results = await Promise.all(
      DASHBOARD_SHEETS.map(async ({ Model, cycleSec, byProcess, extra }) => {
        const own = byProcess ? processScope : scope;
        const edge = (dir) => Model.findOne(own).sort({ date: dir }).select("date").lean();
        const [entries, first, last] = await Promise.all([
          Model.find({ ...own, date: { $gte: from, $lte: to } })
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
            machine: String(e.machine ?? e.worker),
            item: e.item ? String(e.item) : null,
            ...(cycleSec ? { totalCycleSec: cycleSec(e) } : {}),
            ...extra,
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
    sendError(res, error);
  }
};

// GET /processes/shift-access — can I change the Planned Shift, and (Super Admin
// only) who else may. The operator list is read fresh each time, so a newly
// created operator shows up in the dropdown on its own.
exports.getShiftAccess = async (req, res) => {
  try {
    const canChange = await canChangeShift(req);
    if (!isSuperAdmin(req)) return res.status(200).json({ isOk: true, data: { canChange, isSuperAdmin: false } });
    const [setting, operators, roles] = await Promise.all([
      ShiftLockAccess.findOne().select("operators roles").lean(),
      Operator.find({ isActive: true }).select("employeeName username").sort({ employeeName: 1 }).lean(),
      RoleMaster.find({ isActive: { $ne: false } }).select("roleName").sort({ roleName: 1 }).lean(),
    ]);
    res.status(200).json({
      isOk: true,
      data: {
        canChange,
        isSuperAdmin: true,
        configured: !!setting,
        selected: (setting?.operators || []).map(String),
        selectedRoles: (setting?.roles || []).map(String),
        roles: roles.map((r) => ({ _id: String(r._id), name: r.roleName })),
        operators: operators.map((o) => ({ _id: String(o._id), name: o.employeeName, username: o.username })),
      },
    });
  } catch (error) {
    console.error("Error reading shift access:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /processes/shift-access { operatorIds } — Super Admin only.
exports.setShiftAccess = async (req, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ isOk: false, message: "Only the Super Admin can choose who may lock or unlock the Planned Shift" });
    const { operatorIds, roleIds = [] } = req.body || {};
    if (!validOperatorIds(operatorIds)) return res.status(400).json({ isOk: false, message: "Invalid operator list" });
    if (!validOperatorIds(roleIds)) return res.status(400).json({ isOk: false, message: "Invalid role list" });
    const operators = [...new Set(operatorIds.map(String))];
    const roles = [...new Set(roleIds.map(String))];
    await ShiftLockAccess.findOneAndUpdate({}, { operators, roles }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.status(200).json({ isOk: true, data: { selected: operators, selectedRoles: roles }, message: "Access saved" });
  } catch (error) {
    console.error("Error saving shift access:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
