const Machine = require("../models/Machine");

const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;

const PROCESSES_POPULATE = { path: "processes", select: "processName" };
const SHIFTS_POPULATE = { path: "shifts", select: "shiftName shiftOnTime shiftOffTime" };

// Attaches `shiftTime` ({ onTime, offTime } | null) to each machine —
// exactly the machineOnTime/machineOffTime the user entered as Shift Time
// Start/End on this machine, no other source. `null` when neither is set
// yet. This value itself is never directly editable — only
// machineOnTime/machineOffTime (the raw inputs) are.
function attachShiftTime(machines) {
  return machines.map((m) => {
    const machineObj = typeof m.toObject === "function" ? m.toObject() : { ...m };
    const { machineOnTime: mOn, machineOffTime: mOff } = machineObj;
    machineObj.shiftTime = (mOn && mOff) ? { onTime: mOn, offTime: mOff } : null;
    return machineObj;
  });
}

function validateMachineTimes(body) {
  const errors = {};
  if (!body.machineOnTime) errors.machineOnTime = "Shift Time Start is required";
  else if (!timeRx.test(body.machineOnTime)) errors.machineOnTime = "Machine Start Time must be HH:mm";
  if (!body.machineOffTime) errors.machineOffTime = "Shift Time End is required";
  else if (!timeRx.test(body.machineOffTime)) errors.machineOffTime = "Machine End Time must be HH:mm";
  return errors;
}

// Create Machine
exports.createMachine = async (req, res) => {
  try {
    const { machineName, machineCode, description, processes, shifts, machineOnTime, machineOffTime, lunchStartTime, isActive } = req.body;

    if (!machineName || !machineName.trim()) {
      return res.status(400).json({ isOk: false, message: "Machine name is required" });
    }

    const timeErrors = validateMachineTimes(req.body);
    if (Object.keys(timeErrors).length > 0) {
      return res.status(400).json({ isOk: false, errors: timeErrors, message: "Please fix the highlighted fields" });
    }

    const newMachine = await Machine.create({
      machineName: machineName.trim(),
      machineCode: machineCode ? machineCode.trim() : "",
      description: description ? description.trim() : undefined,
      processes: Array.isArray(processes) ? processes : [],
      shifts: Array.isArray(shifts) ? shifts : [],
      machineOnTime: machineOnTime || undefined,
      machineOffTime: machineOffTime || undefined,
      lunchStartTime: lunchStartTime || undefined,
      isActive,
    });

    res.status(201).json({
      isOk: true,
      data: newMachine,
      message: "Machine created successfully",
    });
  } catch (error) {
    console.error("Error creating machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Machine
exports.updateMachine = async (req, res) => {
  try {
    const { machineId } = req.params;

    const timeErrors = validateMachineTimes(req.body);
    if (Object.keys(timeErrors).length > 0) {
      return res.status(400).json({ isOk: false, errors: timeErrors, message: "Please fix the highlighted fields" });
    }

    const machine = await Machine.findOneAndUpdate({ _id: machineId }, req.body, {
      new: true,
      runValidators: true,
    });

    if (!machine) {
      return res.status(404).json({ isOk: false, message: "Machine not found" });
    }

    res.status(200).json({
      isOk: true,
      data: machine,
      message: "Machine updated successfully",
    });
  } catch (error) {
    console.error("Error updating machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Delete Machine (soft then hard, same pattern as Department)
exports.deleteMachine = async (req, res) => {
  try {
    const { machineId } = req.params;

    const machine = await Machine.findById(machineId);
    if (!machine) {
      return res.status(404).json({ isOk: false, message: "Machine not found" });
    }

    if (machine.isActive) {
      machine.isActive = false;
      await machine.save();
      return res.status(200).json({ isOk: true, message: "Machine deactivated successfully" });
    } else {
      await Machine.findByIdAndDelete(machineId);
      return res.status(200).json({ isOk: true, message: "Machine deleted successfully" });
    }
  } catch (error) {
    console.error("Error deleting machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Machine By Id
exports.getMachineById = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await Machine.findOne({ _id: machineId }).populate(PROCESSES_POPULATE).populate(SHIFTS_POPULATE).lean();

    if (!machine) {
      return res.status(404).json({ isOk: false, message: "Machine not found" });
    }

    const [withShiftTime] = attachShiftTime([machine]);
    res.status(200).json({ isOk: true, data: withShiftTime });
  } catch (error) {
    console.error("Error fetching machine:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Machines (no pagination) — used to populate the M/C dropdown
exports.listMachines = async (req, res) => {
  try {
    const machines = await Machine.find({ isActive: true })
      .populate(PROCESSES_POPULATE)
      .populate(SHIFTS_POPULATE)
      .sort({ machineName: 1 })
      .lean();
    const withShiftTime = attachShiftTime(machines);
    res.status(200).json({ isOk: true, data: withShiftTime });
  } catch (error) {
    console.error("Error listing machines:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Machines By Params (Pagination)
exports.listMachineByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    let query = {};
    if (match) {
      query.$or = [
        { machineName: { $regex: match, $options: "i" } },
        { machineCode: { $regex: match, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, machines] = await Promise.all([
      Machine.countDocuments(query),
      Machine.find(query)
        .populate(PROCESSES_POPULATE)
        .populate(SHIFTS_POPULATE)
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);
    const withShiftTime = attachShiftTime(machines);

    res.status(200).json({
      isOk: true,
      data: [{ count: totalCount, data: withShiftTime }],
    });
  } catch (error) {
    console.error("Error searching machines:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
