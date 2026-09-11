const StandardTime = require("../models/StandardTime");
const Machine = require("../models/Machine");

// ── Validation helper ─────────────────────────────────────────────────────
async function validatePayload(body, excludeId = null) {
  const errors = {};

  if (!body.machine) {
    errors.machine = "Machine is required";
  } else {
    const machine = await Machine.findById(body.machine);
    if (!machine) errors.machine = "Selected machine does not exist";
    else if (!machine.isActive) errors.machine = "Selected machine is inactive";
  }

  const w = Number(body.sizeWidthMm);
  if (!body.sizeWidthMm && body.sizeWidthMm !== 0) {
    errors.sizeWidthMm = "Width (mm) is required";
  } else if (isNaN(w) || w <= 0) {
    errors.sizeWidthMm = "Width must be greater than 0";
  }

  const h = Number(body.sizeHeightMm);
  if (!body.sizeHeightMm && body.sizeHeightMm !== 0) {
    errors.sizeHeightMm = "Height (mm) is required";
  } else if (isNaN(h) || h <= 0) {
    errors.sizeHeightMm = "Height must be greater than 0";
  }

  const thickness = typeof body.thicknessMm === "string" ? body.thicknessMm.trim() : body.thicknessMm;
  if (!thickness && thickness !== 0) {
    errors.thicknessMm = "Thickness (mm) is required";
  }

  const st = Number(body.standardTimeMin);
  if (!body.standardTimeMin && body.standardTimeMin !== 0) {
    errors.standardTimeMin = "Standard Time is required";
  } else if (isNaN(st) || st <= 0) {
    errors.standardTimeMin = "Standard Time must be greater than 0";
  }

  // Machine + Size + Thickness must be unique — check explicitly so the
  // error can be attached to a field instead of surfacing only as a
  // generic 11000 duplicate-key error after the insert/update is attempted.
  if (!errors.machine && !errors.sizeWidthMm && !errors.sizeHeightMm && !errors.thicknessMm) {
    const dupQuery = {
      machine: body.machine,
      sizeWidthMm: w,
      sizeHeightMm: h,
      thicknessMm: String(thickness),
    };
    if (excludeId) dupQuery._id = { $ne: excludeId };
    const dup = await StandardTime.findOne(dupQuery);
    if (dup) {
      errors.thicknessMm = "An entry already exists for this machine, size and thickness combination";
    }
  }

  return errors;
}

// ── Create ────────────────────────────────────────────────────────────────
exports.createStandardTime = async (req, res) => {
  try {
    const errors = await validatePayload(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ isOk: false, errors, message: "Please fix the highlighted fields" });
    }

    const record = await StandardTime.create({
      machine: req.body.machine,
      sizeWidthMm: Number(req.body.sizeWidthMm),
      sizeHeightMm: Number(req.body.sizeHeightMm),
      thicknessMm: String(req.body.thicknessMm).trim(),
      standardTimeMin: Number(req.body.standardTimeMin),
      isActive: req.body.isActive !== undefined ? req.body.isActive : true,
    });

    const populated = await record.populate("machine", "machineName machineCode");
    res.status(201).json({ isOk: true, data: populated, message: "Standard time created successfully" });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        isOk: false,
        message: "A standard time entry already exists for this machine + size + thickness combination",
      });
    }
    console.error("Error creating standard time:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Update ────────────────────────────────────────────────────────────────
exports.updateStandardTime = async (req, res) => {
  try {
    const { stdId } = req.params;

    const errors = await validatePayload(req.body, stdId);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ isOk: false, errors, message: "Please fix the highlighted fields" });
    }

    const record = await StandardTime.findOneAndUpdate(
      { _id: stdId },
      {
        machine: req.body.machine,
        sizeWidthMm: Number(req.body.sizeWidthMm),
        sizeHeightMm: Number(req.body.sizeHeightMm),
        thicknessMm: String(req.body.thicknessMm).trim(),
        standardTimeMin: Number(req.body.standardTimeMin),
        isActive: req.body.isActive,
      },
      { new: true },
    ).populate("machine", "machineName machineCode");

    if (!record) return res.status(404).json({ isOk: false, message: "Record not found" });

    res.status(200).json({ isOk: true, data: record, message: "Standard time updated successfully" });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        isOk: false,
        message: "A standard time entry already exists for this machine + size + thickness combination",
      });
    }
    console.error("Error updating standard time:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Delete ────────────────────────────────────────────────────────────────
exports.deleteStandardTime = async (req, res) => {
  try {
    const { stdId } = req.params;
    const record = await StandardTime.findById(stdId);
    if (!record) return res.status(404).json({ isOk: false, message: "Record not found" });

    if (record.isActive) {
      record.isActive = false;
      await record.save();
      return res.status(200).json({ isOk: true, message: "Standard time deactivated" });
    } else {
      await StandardTime.findByIdAndDelete(stdId);
      return res.status(200).json({ isOk: true, message: "Standard time deleted" });
    }
  } catch (error) {
    console.error("Error deleting standard time:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Get by ID ─────────────────────────────────────────────────────────────
exports.getStandardTimeById = async (req, res) => {
  try {
    const record = await StandardTime.findById(req.params.stdId).populate("machine", "machineName machineCode");
    if (!record) return res.status(404).json({ isOk: false, message: "Record not found" });
    res.status(200).json({ isOk: true, data: record });
  } catch (error) {
    console.error("Error fetching standard time:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── List (used by Production Data Entry form dropdown) ───────────────────
// GET ?machine=<id>&isActive=true
exports.listStandardTimes = async (req, res) => {
  try {
    const { machine, isActive } = req.query;
    const query = {};
    if (machine) query.machine = machine;
    // Default: only active entries for dropdown usage
    query.isActive = isActive === "false" ? false : true;

    const records = await StandardTime.find(query)
      .populate("machine", "machineName machineCode")
      .sort({ sizeWidthMm: 1, sizeHeightMm: 1, thicknessMm: 1 });

    res.status(200).json({ isOk: true, data: records });
  } catch (error) {
    console.error("Error listing standard times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Paginated search (used by StandardTime Master admin page) ─────────────
exports.searchStandardTimes = async (req, res) => {
  try {
    const { skip = 0, per_page = 50, machine, isActive } = req.body;

    const query = {};
    if (machine) query.machine = machine;
    if (isActive !== undefined) query.isActive = isActive;

    const [totalCount, records] = await Promise.all([
      StandardTime.countDocuments(query),
      StandardTime.find(query)
        .populate({
          path: "machine",
          select: "machineName machineCode processes",
          populate: { path: "processes", select: "processName" },
        })
        .sort({ "machine.machineName": 1, sizeWidthMm: 1, sizeHeightMm: 1, thicknessMm: 1 })
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: records }] });
  } catch (error) {
    console.error("Error searching standard times:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
