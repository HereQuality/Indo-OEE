"use strict";
/**
 * controllers/machineOperator.controller.js
 * ────────────────────────────
 * CRUD for the shop-floor operator list used by Grinding Data Entry's
 * "Operator" dropdown (ProductionEntry.operator).
 *
 * Deliberately separate from operator.controller.js, which owns the
 * Operator MODEL — the platform's people/login records (employeeCode,
 * departments, roles, password). A MachineOperator is just a name on the
 * shop floor and never logs in, so the two are not interchangeable.
 */
const MachineOperator = require("../models/MachineOperator");

// ── Create ────────────────────────────────────────────────────────────────
exports.createMachineOperator = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Operator name is required" });
    }

    const created = await MachineOperator.create({
      name: String(name).trim(),
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
    const operators = await MachineOperator.find({ isActive: true }).sort({ name: 1 });
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
    if (match) query.name = { $regex: match, $options: "i" };
    if (isActive !== undefined) query.isActive = isActive;

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, operators] = await Promise.all([
      MachineOperator.countDocuments(query),
      MachineOperator.find(query).sort(sortQuery).skip(parseInt(skip)).limit(parseInt(per_page)).lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: operators }] });
  } catch (error) {
    console.error("Error searching machine operators:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
