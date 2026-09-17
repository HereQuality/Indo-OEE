const Machine = require("../models/Machine");
const ProductionEntry = require("../models/ProductionEntry");

// `process` is only touched when the request actually sends it, so a form
// that doesn't know about processes can't clear the link by accident.
const pickMachine = ({ machineName, description, color, sequence, isActive, process }) => ({
  machineName,
  description,
  color,
  sequence,
  isActive,
  ...(process !== undefined ? { process: process || null } : {}),
});

const isDuplicateName = async (machineName, excludeId) => {
  const escaped = String(machineName || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const query = { machineName: { $regex: `^${escaped}$`, $options: "i" } };
  if (excludeId) query._id = { $ne: excludeId };
  return !!(await Machine.exists(query));
};

exports.createMachine = async (req, res) => {
  try {
    const data = pickMachine(req.body);
    if (await isDuplicateName(data.machineName)) {
      return res.status(409).json({ isOk: false, message: `Machine "${data.machineName}" already exists` });
    }
    const machine = await Machine.create(data);
    res.status(201).json({ isOk: true, data: machine, message: "Machine created successfully" });
  } catch (error) {
    console.error("Error creating machine:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const data = pickMachine(req.body);
    if (data.machineName !== undefined && (await isDuplicateName(data.machineName, machineId))) {
      return res.status(409).json({ isOk: false, message: `Machine "${data.machineName}" already exists` });
    }
    const machine = await Machine.findByIdAndUpdate(machineId, data, { new: true, runValidators: true });
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });
    res.status(200).json({ isOk: true, data: machine, message: "Machine updated successfully" });
  } catch (error) {
    console.error("Error updating machine:", error);
    res.status(400).json({ isOk: false, message: error.message });
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
    res.status(200).json({ isOk: true, message: "Machine deleted successfully" });
  } catch (error) {
    console.error("Error deleting machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.machineId);
    if (!machine) return res.status(404).json({ isOk: false, message: "Machine not found" });
    res.status(200).json({ isOk: true, data: machine });
  } catch (error) {
    console.error("Error fetching machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Active machines in sheet order — used by the data entry sheet.
exports.listMachines = async (req, res) => {
  try {
    const machines = await Machine.find({ isActive: true }).sort({ sequence: 1, machineName: 1 }).lean();
    res.status(200).json({ isOk: true, data: machines });
  } catch (error) {
    console.error("Error listing machines:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

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

    let sortQuery = { sequence: 1, machineName: 1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, machines] = await Promise.all([
      Machine.countDocuments(query),
      Machine.find(query).sort(sortQuery).skip(parseInt(skip)).limit(parseInt(per_page)).lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: machines }] });
  } catch (error) {
    console.error("Error searching machines:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
