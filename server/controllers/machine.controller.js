const Machine = require("../models/Machine");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const PressEntry = require("../models/PressEntry");
const ContactEntry = require("../models/ContactEntry");
const TrobeEntry = require("../models/TrobeEntry");
const SpringEntry = require("../models/SpringEntry");
const InjectionEntry = require("../models/InjectionEntry");
const PrintingEntry = require("../models/PrintingEntry");
const { compareBySequence, sortMachines } = require("../utils/machineOrder");
const { sendError, pageParams } = require("../utils/httpErrors");
const Process = require("../models/Process");
const mongoose = require("mongoose");

// `process` is only touched when the request actually sends it, so a form
// that doesn't know about processes can't clear the link by accident.
// `sequence` is deliberately NOT picked here — it is Super Admin-only and is
// applied through placeMachine() below, never written straight from the body.
const pickMachine = ({ machineName, description, color, isActive, process }) => ({
  machineName,
  description,
  color,
  isActive,
  ...(process !== undefined ? { process: process || null } : {}),
});

// Machines deleted from Machine Master stay in the collection (see
// models/Machine.js) but are invisible to everything here.
const NOT_DELETED = { isDeleted: { $ne: true } };

const isSuperAdmin = (req) => req.user?.roleType === "SuperAdmin";

// Every sheet whose entries are made on a machine (After Powder Coating and
// RUBBER have a worker instead), for the count of entries a deleted machine keeps.
const MACHINE_ENTRY_MODELS = [ProductionEntry, VmcEntry, SpmEntry, RivetEntry, PressEntry, ContactEntry, TrobeEntry, SpringEntry];
// INJECTION MOULDING is made on a machine too.
MACHINE_ENTRY_MODELS.push(InjectionEntry);
// So is EMBOSSING.
MACHINE_ENTRY_MODELS.push(require("../models/EmbossingEntry"));
// So is MODULAR FRAME DRILLING.
MACHINE_ENTRY_MODELS.push(require("../models/MfdEntry"));
// Sheets kept per operator whose entries may still name a machine — PRINTING's
// optional MC No. — with the field that holds it.
const MC_ENTRY_MODELS = [[PrintingEntry, "mcMachine"]];

// Sequence is Super Admin-only: everyone else neither sets it nor sees it.
const present = (req, machine) => {
  const plain = typeof machine?.toObject === "function" ? machine.toObject() : { ...machine };
  if (!isSuperAdmin(req)) delete plain.sequence;
  return plain;
};

// The 1-based position a Super Admin asked for, or null when none was asked
// for (blank / 0 = "leave it where it is", or append for a new machine).
const requestedPosition = (req) => {
  if (!isSuperAdmin(req)) return null;
  const raw = req.body?.sequence;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw Object.assign(new Error("Sequence must be a whole number, 1 or more"), { status: 400 });
  }
  return n > 0 ? n : null;
};

// Puts one machine at `position` (1-based, clamped; Infinity = last) in the
// sheet order and renumbers EVERY machine 1..N — active or not, so
// reactivating one drops it back in its place (a deleted machine is out of the
// numbering). Everything at or after the
// position shifts down by one, so two machines never share a number and the
// numbers never have gaps. With no machine id it just re-closes the numbering
// (after a delete). Only machines whose number actually changes are written.
const placeMachine = async (machineId, position = Infinity) => {
  const all = await Machine.find(NOT_DELETED).select("machineName sequence").lean();
  const current = new Map(all.map((m) => [String(m._id), m.sequence]));
  let order = all.sort(compareBySequence).map((m) => String(m._id));
  if (machineId) {
    const id = String(machineId);
    order = order.filter((x) => x !== id);
    order.splice(Math.min(Math.max(1, position), order.length + 1) - 1, 0, id);
  }
  const ops = order
    .map((id, i) => ({ id, seq: i + 1 }))
    .filter(({ id, seq }) => current.get(id) !== seq)
    .map(({ id, seq }) => ({ updateOne: { filter: { _id: id }, update: { $set: { sequence: seq } } } }));
  if (ops.length) await Machine.bulkWrite(ops);
};

// A process id that points at nothing is refused (400) when a machine is saved; a blank
// process, or an id the schema itself rejects as malformed, behaves as it always did.
const checkProcessExists = async (processId) => {
  if (!processId || !mongoose.isValidObjectId(processId)) return;
  if (!(await Process.exists({ _id: processId }))) {
    throw Object.assign(new Error("Process not found"), { status: 400 });
  }
};

const isDuplicateName = async (machineName, excludeId) => {
  const escaped = String(machineName || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const query = { ...NOT_DELETED, machineName: { $regex: `^${escaped}$`, $options: "i" } };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Machine.exists(query));
};

exports.createMachine = async (req, res) => {
  try {
    const data = pickMachine(req.body);
    const position = requestedPosition(req);
    await checkProcessExists(data.process);
    if (await isDuplicateName(data.machineName)) {
      return res.status(409).json({ isOk: false, message: `Machine "${data.machineName}" already exists` });
    }
    const created = await Machine.create({ ...data, sequence: 0 });
    // No position asked for (or not allowed to ask) = added at the end of the
    // sheet, not at the top the way a bare sequence of 0 would sort.
    await placeMachine(created._id, position ?? Infinity);
    const machine = await Machine.findById(created._id).lean();
    res.status(201).json({ isOk: true, data: present(req, machine), message: "Machine created successfully" });
  } catch (error) {
    console.error("Error creating machine:", error);
    res.status(error.status || 400).json({ isOk: false, message: error.message });
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const data = pickMachine(req.body);
    const position = requestedPosition(req);
    await checkProcessExists(data.process);
    if (data.machineName !== undefined && (await isDuplicateName(data.machineName, machineId))) {
      return res.status(409).json({ isOk: false, message: `Machine "${data.machineName}" already exists` });
    }
    const updated = await Machine.findOneAndUpdate({ _id: machineId, ...NOT_DELETED }, data, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ isOk: false, message: "Machine not found" });
    // A position from Super Admin moves it; a machine that was never given a
    // number (sequence 0) is settled at the end whoever saves it.
    if (position !== null || !(updated.sequence > 0)) await placeMachine(updated._id, position ?? Infinity);
    const machine = await Machine.findById(machineId).lean();
    res.status(200).json({ isOk: true, data: present(req, machine), message: "Machine updated successfully" });
  } catch (error) {
    console.error("Error updating machine:", error);
    res.status(error.status || 400).json({ isOk: false, message: error.message });
  }
};

// First delete deactivates (hides it from the sheet); deleting an already
// inactive machine removes it from Machine Master. The data entries made on it
// are left exactly as they are — the machine is hidden, not erased (see
// models/Machine.js), so they still show its name and still roll up into its
// process's dashboard.
exports.deleteMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await Machine.findOne({ _id: machineId, ...NOT_DELETED });
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });

    if (machine.isActive) {
      machine.isActive = false;
      await machine.save();
      return res.status(200).json({ isOk: true, message: "Machine deactivated successfully" });
    }

    // Sequence 0 takes it out of the numbering; placeMachine(null) then closes the
    // gap it leaves so the numbers stay 1..N.
    machine.isDeleted = true;
    machine.sequence = 0;
    await machine.save();
    await placeMachine(null);

    const counts = await Promise.all([
      ...MACHINE_ENTRY_MODELS.map((Model) => Model.countDocuments({ machine: machineId })),
      ...MC_ENTRY_MODELS.map(([Model, field]) => Model.countDocuments({ [field]: machineId })),
    ]);
    const kept = counts.reduce((sum, n) => sum + n, 0);
    res.status(200).json({
      isOk: true,
      message: kept
        ? `Machine deleted successfully. ${kept === 1 ? "Its 1 data entry is kept as it was." : `Its ${kept} data entries are kept as they were.`}`
        : "Machine deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting machine:", error);
    sendError(res, error);
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const machine = await Machine.findOne({ _id: req.params.machineId, ...NOT_DELETED }).lean();
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });
    res.status(200).json({ isOk: true, data: present(req, machine) });
  } catch (error) {
    console.error("Error fetching machine:", error);
    sendError(res, error);
  }
};

// Active machines in sheet order — used by the data entry sheet. Everyone
// gets the order; only Super Admin also gets the number itself.
exports.listMachines = async (req, res) => {
  try {
    const machines = sortMachines(await Machine.find({ isActive: true }).lean());
    res.status(200).json({ isOk: true, data: machines.map((m) => present(req, m)) });
  } catch (error) {
    console.error("Error listing machines:", error);
    sendError(res, error);
  }
};

const SORTABLE = ["machineName", "description", "sequence", "isActive"];

exports.listMachineByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = { ...NOT_DELETED };
    if (match) {
      // Matched as plain text, so a "(" or "*" typed in can't break the search.
      const escaped = String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { machineName: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
      ];
    }
    if (isActive !== undefined) query.isActive = isActive;

    // Sorted in memory (see utils/machineOrder.js) — a machine list is tens of
    // rows, and that keeps "unsequenced machines last" in one place. Nobody but
    // Super Admin can sort by the sequence column; for them it is just the
    // default order.
    const sortField = SORTABLE.includes(sorton) && sortdir && (sorton !== "sequence" || isSuperAdmin(req)) ? sorton : undefined;
    const all = sortMachines(await Machine.find(query).lean(), sortField, sortdir);
    const paging = pageParams(skip, per_page, { max: 1000 });
    const page = all.slice(paging.skip, paging.skip + paging.limit);

    res.status(200).json({ isOk: true, data: [{ count: all.length, data: page.map((m) => present(req, m)) }] });
  } catch (error) {
    console.error("Error searching machines:", error);
    sendError(res, error);
  }
};
