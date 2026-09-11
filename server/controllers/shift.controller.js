const Shift = require("../models/Shift");

const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateShiftTimes(body) {
  const errors = {};
  if (!body.shiftOnTime) errors.shiftOnTime = "Shift On Time is required";
  else if (!timeRx.test(body.shiftOnTime)) errors.shiftOnTime = "Shift On Time must be HH:mm";
  if (!body.shiftOffTime) errors.shiftOffTime = "Shift Off Time is required";
  else if (!timeRx.test(body.shiftOffTime)) errors.shiftOffTime = "Shift Off Time must be HH:mm";
  return errors;
}

// Create Shift
exports.createShift = async (req, res) => {
  try {
    const { shiftName, shiftOnTime, shiftOffTime, isActive } = req.body;

    if (!shiftName || !shiftName.trim()) {
      return res.status(400).json({ isOk: false, message: "Shift name is required" });
    }

    const timeErrors = validateShiftTimes(req.body);
    if (Object.keys(timeErrors).length > 0) {
      return res.status(400).json({ isOk: false, errors: timeErrors, message: "Please fix the highlighted fields" });
    }

    const newShift = await Shift.create({
      shiftName: shiftName.trim(),
      shiftOnTime,
      shiftOffTime,
      isActive,
    });

    res.status(201).json({
      isOk: true,
      data: newShift,
      message: "Shift created successfully",
    });
  } catch (error) {
    console.error("Error creating shift:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Shift
exports.updateShift = async (req, res) => {
  try {
    const { shiftId } = req.params;

    const timeErrors = validateShiftTimes(req.body);
    if (Object.keys(timeErrors).length > 0) {
      return res.status(400).json({ isOk: false, errors: timeErrors, message: "Please fix the highlighted fields" });
    }

    const shift = await Shift.findOneAndUpdate({ _id: shiftId }, req.body, {
      new: true,
      runValidators: true,
    });

    if (!shift) {
      return res.status(404).json({ isOk: false, message: "Shift not found" });
    }

    res.status(200).json({
      isOk: true,
      data: shift,
      message: "Shift updated successfully",
    });
  } catch (error) {
    console.error("Error updating shift:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Delete Shift (soft then hard, same pattern as Machine/Process)
exports.deleteShift = async (req, res) => {
  try {
    const { shiftId } = req.params;

    const shift = await Shift.findById(shiftId);
    if (!shift) {
      return res.status(404).json({ isOk: false, message: "Shift not found" });
    }

    if (shift.isActive) {
      shift.isActive = false;
      await shift.save();
      return res.status(200).json({ isOk: true, message: "Shift deactivated successfully" });
    } else {
      await Shift.findByIdAndDelete(shiftId);
      return res.status(200).json({ isOk: true, message: "Shift deleted successfully" });
    }
  } catch (error) {
    console.error("Error deleting shift:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Shift By Id
exports.getShiftById = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const shift = await Shift.findOne({ _id: shiftId });

    if (!shift) {
      return res.status(404).json({ isOk: false, message: "Shift not found" });
    }

    res.status(200).json({ isOk: true, data: shift });
  } catch (error) {
    console.error("Error fetching shift:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Shifts (no pagination) — used to populate the Shift dropdown
// on Process/Machine/Item Master.
exports.listShifts = async (req, res) => {
  try {
    const shifts = await Shift.find({ isActive: true }).sort({ shiftName: 1 });
    res.status(200).json({ isOk: true, data: shifts });
  } catch (error) {
    console.error("Error listing shifts:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Shifts By Params (Pagination)
exports.listShiftByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    let query = {};
    if (match) {
      query.shiftName = { $regex: match, $options: "i" };
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, shifts] = await Promise.all([
      Shift.countDocuments(query),
      Shift.find(query)
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({
      isOk: true,
      data: [{ count: totalCount, data: shifts }],
    });
  } catch (error) {
    console.error("Error searching shifts:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
