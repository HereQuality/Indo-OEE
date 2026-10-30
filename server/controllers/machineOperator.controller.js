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
const { sendError, pageParams } = require("../utils/httpErrors");
const { viewableProcessIds } = require("../utils/processAccess");

// The processes this person's role can see (utils/processAccess.js) as a Set of
// id strings, or null when there is no limit (Super Admin, or a role that sees
// every process). Operators of a process they can't see are kept out of view.
const visibleProcesses = async (req) =>
  viewableProcessIds(req, await Process.find().select("processName dataEntryMenu isActive").lean());

// Is this operator (its `processes` ids or populated docs) in a process they may see?
const inScope = (operator, allowed) =>
  !allowed || (operator.processes || []).some((p) => allowed.has(String(p?._id || p)));

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

    if (name !== null && typeof name === "object") {
      return res.status(400).json({ isOk: false, message: "Operator name must be text" });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Operator name is required" });
    }

    const { ids, error } = await pickProcesses(req.body.processes, true);
    if (error) return res.status(400).json({ isOk: false, message: error });
    const allowed = await visibleProcesses(req);
    if (allowed && ids.some((id) => !allowed.has(String(id)))) {
      return res.status(403).json({ isOk: false, message: "You don't have access to one of the selected processes" });
    }

    const created = await MachineOperator.create({
      name: String(name).trim(),
      processes: ids,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({ isOk: true, data: created, message: "Operator created successfully" });
  } catch (error) {
    console.error("Error creating machine operator:", error);
    sendError(res, error);
  }
};

// ── Update ────────────────────────────────────────────────────────────────
exports.updateMachineOperator = async (req, res) => {
  try {
    const { operatorId } = req.params;
    const { name, isActive } = req.body;

    if (name !== null && typeof name === "object") {
      return res.status(400).json({ isOk: false, message: "Operator name must be text" });
    }
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Operator name cannot be empty" });
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (isActive !== undefined) update.isActive = isActive;
    if (req.body.processes !== undefined) {
      const { ids, error } = await pickProcesses(req.body.processes, true);
      if (error) return res.status(400).json({ isOk: false, message: error });
      const allowedNew = await visibleProcesses(req);
      if (allowedNew && ids.some((id) => !allowedNew.has(String(id)))) {
        return res.status(403).json({ isOk: false, message: "You don't have access to one of the selected processes" });
      }
      update.processes = ids;
    }

    const allowed = await visibleProcesses(req);
    if (allowed) {
      const existing = await MachineOperator.findById(operatorId).select("processes").lean();
      if (existing && !inScope(existing, allowed)) return res.status(404).json({ isOk: false, message: "Operator not found" });
    }
    const operator = await MachineOperator.findOneAndUpdate({ _id: operatorId }, update, { new: true });
    if (!operator) {
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    res.status(200).json({ isOk: true, data: operator, message: "Operator updated successfully" });
  } catch (error) {
    console.error("Error updating machine operator:", error);
    sendError(res, error);
  }
};

// ── Delete (soft first, then hard) ────────────────────────────────────────
exports.deleteMachineOperator = async (req, res) => {
  try {
    const { operatorId } = req.params;
    const operator = await MachineOperator.findById(operatorId);
    if (!operator || !inScope(operator, await visibleProcesses(req))) {
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
    sendError(res, error);
  }
};

// ── Get by ID ─────────────────────────────────────────────────────────────
exports.getMachineOperatorById = async (req, res) => {
  try {
    const operator = await MachineOperator.findById(req.params.operatorId);
    if (!operator || !inScope(operator, await visibleProcesses(req))) {
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }
    res.status(200).json({ isOk: true, data: operator });
  } catch (error) {
    console.error("Error fetching machine operator:", error);
    sendError(res, error);
  }
};

// ── List all (for dropdown) ───────────────────────────────────────────────
exports.listMachineOperators = async (req, res) => {
  try {
    const operators = await MachineOperator.find({ isActive: true }).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();
    res.status(200).json({ isOk: true, data: operators });
  } catch (error) {
    console.error("Error listing machine operators:", error);
    sendError(res, error);
  }
};

// ── Search / paginated list ───────────────────────────────────────────────
exports.listMachineOperatorsByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;
    const page = pageParams(skip, per_page);

    const query = {};
    // Matched as plain text, so a "(" or "*" typed in can't break the search.
    if (match) query.name = { $regex: String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (isActive !== undefined) query.isActive = isActive;
    const allowed = await visibleProcesses(req);
    if (allowed) {
      // Only operators of a process this person can see; a process picked in the
      // filter that they can't see gives nothing.
      const mine = [...allowed];
      query.processes = req.body.process ? (allowed.has(String(req.body.process)) ? req.body.process : { $in: [] }) : { $in: mine };
    } else if (req.body.process) query.processes = req.body.process;

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, operators] = await Promise.all([
      MachineOperator.countDocuments(query),
      // Case-insensitive, so "acme" sorts beside "Acme" rather than after every capital.
      MachineOperator.find(query).collation({ locale: "en", strength: 2 }).sort(sortQuery).skip(page.skip).limit(page.limit).populate("processes", "processName").lean(),
    ]);

    // Badges show only the processes they can see.
    const shown = allowed ? operators.map((o) => ({ ...o, processes: (o.processes || []).filter((p) => allowed.has(String(p?._id || p))) })) : operators;
    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: shown }] });
  } catch (error) {
    console.error("Error searching machine operators:", error);
    sendError(res, error);
  }
};
