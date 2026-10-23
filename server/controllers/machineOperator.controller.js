"use strict";
/**
 * controllers/machineOperator.controller.js
 * ────────────────────────────
 * CRUD for the shop-floor operator list used by Production Data Entry's
 * "Operator" dropdown (ProductionEntry.operator).
 *
 * Deliberately separate from operator.controller.js, which owns the
 * Operator MODEL — the platform's people/login records (employeeCode,
 * departments, roles, password). A MachineOperator is just a name on the
 * shop floor and never logs in, so the two are not interchangeable.
 */
const mongoose = require("mongoose");
const MachineOperator = require("../models/MachineOperator");
const Process = require("../models/Process");

// The request's processes as a de-duplicated id list, or { error }. Every id
// must be a real process. Required (at least one) when `required` is set.
const pickProcesses = async (raw, required) => {
  if (raw === undefined) return required ? { error: "Select at least one process" } : { ids: undefined };
  const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map((v) => String(v?._id || v || "").trim()).filter(Boolean))];
  if (required && !list.length) return { error: "Select at least one process" };
  if (list.some((id) => !mongoose.isValidObjectId(id))) return { error: "Unknown process selected" };
  if (list.length && (await Process.countDocuments({ _id: { $in: list } })) !== list.length) return { error: "Unknown process selected" };
  return { ids: list };
};

// ── Create ────────────────────────────────────────────────────────────────
exports.createMachineOperator = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Operator name is required" });
    }

    const { ids, error } = await pickProcesses(req.body.processes, true);
    if (error) return res.status(400).json({ isOk: false, message: error });

    const created = await MachineOperator.create({
      name: String(name).trim(),
      processes: ids,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({ isOk: true, data: created, message: "Operator created successfully" });
  } catch (error) {
    console.error("Error creating machine operator:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Update ────────────────────────────────────────────────────────────────
exports.updateMachineOperator = async (req, res) => {
  try {
    const { operatorId } = req.params;
    const { name, isActive } = req.body;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Operator name cannot be empty" });
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (isActive !== undefined) update.isActive = isActive;
    if (req.body.processes !== undefined) {
      const { ids, error } = await pickProcesses(req.body.processes, true);
      if (error) return res.status(400).json({ isOk: false, message: error });
      update.processes = ids;
    }

    const operator = await MachineOperator.findOneAndUpdate({ _id: operatorId }, update, { new: true });
    if (!operator) {
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    res.status(200).json({ isOk: true, data: operator, message: "Operator updated successfully" });
  } catch (error) {
    console.error("Error updating machine operator:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Delete (soft first, then hard) ────────────────────────────────────────
exports.deleteMachineOperator = async (req, res) => {
  try {
    const { operatorId } = req.params;
    const operator = await MachineOperator.findById(operatorId);
    if (!operator) {
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    if (operator.isActive) {
      operator.isActive = false;
      await operator.save();
      return res.status(200).json({ isOk: true, message: "Operator deactivated successfully" });
    }

    await MachineOperator.findByIdAndDelete(operatorId);
    return res.status(200).json({ isOk: true, message: "Operator deleted successfully" });
  } catch (error) {
    console.error("Error deleting machine operator:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Get by ID ─────────────────────────────────────────────────────────────
exports.getMachineOperatorById = async (req, res) => {
  try {
    const operator = await MachineOperator.findById(req.params.operatorId);
    if (!operator) {
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }
    res.status(200).json({ isOk: true, data: operator });
  } catch (error) {
    console.error("Error fetching machine operator:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── List all (for dropdown) ───────────────────────────────────────────────
exports.listMachineOperators = async (req, res) => {
  try {
    const operators = await MachineOperator.find({ isActive: true }).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();
    res.status(200).json({ isOk: true, data: operators });
  } catch (error) {
    console.error("Error listing machine operators:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Search / paginated list ───────────────────────────────────────────────
exports.listMachineOperatorsByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = {};
    // Matched as plain text, so a "(" or "*" typed in can't break the search.
    if (match) query.name = { $regex: String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (isActive !== undefined) query.isActive = isActive;
    if (req.body.process) query.processes = req.body.process;

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, operators] = await Promise.all([
      MachineOperator.countDocuments(query),
      // Case-insensitive, so "acme" sorts beside "Acme" rather than after every capital.
      MachineOperator.find(query).collation({ locale: "en", strength: 2 }).sort(sortQuery).skip(parseInt(skip)).limit(parseInt(per_page)).populate("processes", "processName").lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: operators }] });
  } catch (error) {
    console.error("Error searching machine operators:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
