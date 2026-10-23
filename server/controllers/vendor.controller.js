"use strict";
/**
 * controllers/vendor.controller.js
 * ────────────────────────────
 * CRUD for the vendor list used by the entry forms' type-to-search "Vendor
 * Name" box.
 *
 * A copy of machineOperator.controller.js — a name, the processes the vendor
 * is used in (at least one), and an active flag. Same rules otherwise: no
 * duplicate-name check, and delete deactivates first, then removes for good
 * on a second delete of an already inactive vendor.
 */
const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
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
exports.createVendor = async (req, res) => {
  try {
    const { name, isActive } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Vendor name is required" });
    }

    const { ids, error } = await pickProcesses(req.body.processes, true);
    if (error) return res.status(400).json({ isOk: false, message: error });

    const created = await Vendor.create({
      name: String(name).trim(),
      processes: ids,
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({ isOk: true, data: created, message: "Vendor created successfully" });
  } catch (error) {
    console.error("Error creating vendor:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Update ────────────────────────────────────────────────────────────────
exports.updateVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { name, isActive } = req.body;

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ isOk: false, message: "Vendor name cannot be empty" });
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (isActive !== undefined) update.isActive = isActive;
    if (req.body.processes !== undefined) {
      const { ids, error } = await pickProcesses(req.body.processes, true);
      if (error) return res.status(400).json({ isOk: false, message: error });
      update.processes = ids;
    }

    const vendor = await Vendor.findOneAndUpdate({ _id: vendorId }, update, { new: true });
    if (!vendor) {
      return res.status(404).json({ isOk: false, message: "Vendor not found" });
    }

    res.status(200).json({ isOk: true, data: vendor, message: "Vendor updated successfully" });
  } catch (error) {
    console.error("Error updating vendor:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Delete (soft first, then hard) ────────────────────────────────────────
exports.deleteVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ isOk: false, message: "Vendor not found" });
    }

    if (vendor.isActive) {
      vendor.isActive = false;
      await vendor.save();
      return res.status(200).json({ isOk: true, message: "Vendor deactivated successfully" });
    }

    await Vendor.findByIdAndDelete(vendorId);
    return res.status(200).json({ isOk: true, message: "Vendor deleted successfully" });
  } catch (error) {
    console.error("Error deleting vendor:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Get by ID ─────────────────────────────────────────────────────────────
exports.getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.vendorId);
    if (!vendor) {
      return res.status(404).json({ isOk: false, message: "Vendor not found" });
    }
    res.status(200).json({ isOk: true, data: vendor });
  } catch (error) {
    console.error("Error fetching vendor:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── List all (for the type-to-search box) ─────────────────────────────────
// Each vendor carries its `processes`; every form keeps only its own process's.
exports.listVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find({ isActive: true }).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();
    res.status(200).json({ isOk: true, data: vendors });
  } catch (error) {
    console.error("Error listing vendors:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Search / paginated list ───────────────────────────────────────────────
exports.listVendorsByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = {};
    // Matched as plain text, so a "(" or "*" typed in can't break the search.
    if (match) query.name = { $regex: String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (isActive !== undefined) query.isActive = isActive;
    if (req.body.process) query.processes = req.body.process;

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, vendors] = await Promise.all([
      Vendor.countDocuments(query),
      // Case-insensitive, so "acme" sorts beside "Acme" rather than after every capital.
      Vendor.find(query).collation({ locale: "en", strength: 2 }).sort(sortQuery).skip(parseInt(skip)).limit(parseInt(per_page)).populate("processes", "processName").lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: vendors }] });
  } catch (error) {
    console.error("Error searching vendors:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
