const Machine = require("../models/Machine");
const ProductionEntry = require("../models/ProductionEntry");
const { compareBySequence, sortMachines } = require("../utils/machineOrder");

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

const isSuperAdmin = (req) => req.user?.roleType === "SuperAdmin";

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
// reactivating one drops it back in its place. Everything at or after the
// position shifts down by one, so two machines never share a number and the
// numbers never have gaps. With no machine id it just re-closes the numbering
// (after a delete). Only machines whose number actually changes are written.
const placeMachine = async (machineId, position = Infinity) => {
  const all = await Machine.find({}).select("machineName sequence").lean();
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

const isDuplicateName = async (machineName, excludeId) => {
  const escaped = String(machineName || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const query = { machineName: { $regex: `^${escaped}$`, $options: "i" } };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Machine.exists(query));
};

exports.createMachine = async (req, res) => {
  try {
    const data = pickMachine(req.body);
    const position = requestedPosition(req);
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
    if (data.machineName !== undefined && (await isDuplicateName(data.machineName, machineId))) {
      return res.status(409).json({ isOk: false, message: `Machine "${data.machineName}" already exists` });
    }
    const updated = await Machine.findByIdAndUpdate(machineId, data, { new: true, runValidators: true });
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
// inactive machine removes it, unless production rows still point at it.
exports.deleteMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await Machine.findById(machineId);
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });

    if (machine.isActive) {
      machine.isActive = false;
      await machine.save();
      return res.status(200).json({ isOk: true, message: "Machine deactivated successfully" });
    }

    const entryCount = await ProductionEntry.countDocuments({ machine: machineId });
    if (entryCount > 0) {
      return res.status(409).json({
        isOk: false,
        message: `Machine "${machine.machineName}" has ${entryCount} production entr${entryCount === 1 ? "y" : "ies"} and can't be deleted. It stays inactive instead.`,
      });
    }
    await Machine.findByIdAndDelete(machineId);
    // Close the gap it leaves so the numbers stay 1..N.
    await placeMachine(null);
    res.status(200).json({ isOk: true, message: "Machine deleted successfully" });
  } catch (error) {
    console.error("Error deleting machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.machineId).lean();
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });
    res.status(200).json({ isOk: true, data: present(req, machine) });
  } catch (error) {
    console.error("Error fetching machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
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
    res.status(500).json({ isOk: false, message: error.message });
  }
};

const SORTABLE = ["machineName", "description", "sequence", "isActive"];

exports.listMachineByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = {};
    if (match) {
      query.$or = [
        { machineName: { $regex: match, $options: "i" } },
        { description: { $regex: match, $options: "i" } },
      ];
    }
    if (isActive !== undefined) query.isActive = isActive;

    // Sorted in memory (see utils/machineOrder.js) — a machine list is tens of
    // rows, and that keeps "unsequenced machines last" in one place. Nobody but
    // Super Admin can sort by the sequence column; for them it is just the
    // default order.
    const sortField = SORTABLE.includes(sorton) && sortdir && (sorton !== "sequence" || isSuperAdmin(req)) ? sorton : undefined;
    const all = sortMachines(await Machine.find(query).lean(), sortField, sortdir);
    const from = Math.max(0, parseInt(skip, 10) || 0);
    const page = all.slice(from, from + (parseInt(per_page, 10) || 10));

    res.status(200).json({ isOk: true, data: [{ count: all.length, data: page.map((m) => present(req, m)) }] });
  } catch (error) {
    console.error("Error searching machines:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
