"use strict";
/**
 * controllers/formBuilder.controller.js
 * ────────────────────────────
 * Admin CRUD behind Form Builder (PRD indo.md "Phase 4").
 *
 * The guardrails here are the whole point — see models/FormDefinition.js.
 * A core field is backed by a real, engine-read ProductionEntry column, so
 * it can be relabelled, reordered, hidden (when optional) or made
 * required/optional, but never deleted, re-keyed or retyped. Without that,
 * an admin could quietly delete `processQty` and every OEE number in the
 * system would silently become zero.
 */
const FormDefinition = require("../models/FormDefinition");
const FormField = require("../models/FormField");

// Core fields the OEE engine reads and the entry form cannot function
// without — these can never be hidden or made optional, even though they're
// core (which allows hiding for the optional stoppage/rejection ones).
const STRUCTURAL_KEYS = new Set([
  "machine", "date", "mcStartTime", "mcOffTime",
  "sizeWidthMm", "sizeHeightMm", "thicknessMm",
  "processQty", "okQty", "standardTimePerPieceMin",
]);

const bumpVersion = (formDefinitionId) =>
  FormDefinition.findByIdAndUpdate(formDefinitionId, { $inc: { version: 1 } });

// ── Definitions ───────────────────────────────────────────────────────────
exports.listFormDefinitions = async (req, res) => {
  try {
    const forms = await FormDefinition.find({}).sort({ name: 1 }).lean();
    res.status(200).json({ isOk: true, data: forms });
  } catch (error) {
    console.error("Error listing form definitions:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

/**
 * The schema the entry form renders from. Public to any logged-in user
 * (it's a rendering concern, not an admin action) — same shared-lookup
 * reasoning as the machine/standard-time lookups.
 */
exports.getFormSchema = async (req, res) => {
  try {
    const form = await FormDefinition.findOne({ slug: req.params.slug, isActive: true }).lean();
    if (!form) return res.status(404).json({ isOk: false, message: "Form not found" });

    const fields = await FormField.find({ formDefinitionId: form._id })
      .sort({ section: 1, order: 1 })
      .lean();

    res.status(200).json({ isOk: true, data: { ...form, fields } });
  } catch (error) {
    console.error("Error fetching form schema:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Fields ────────────────────────────────────────────────────────────────
exports.createFormField = async (req, res) => {
  try {
    const { formDefinitionId } = req.params;
    const { key, label, type, isRequired, isStoppageReason, section, order, defaultValue, dropdownSource, staticOptions } = req.body;

    const form = await FormDefinition.findById(formDefinitionId);
    if (!form) return res.status(404).json({ isOk: false, message: "Form not found" });

    if (!key || !label) {
      return res.status(400).json({ isOk: false, message: "Field key and label are required" });
    }

    const exists = await FormField.findOne({ formDefinitionId, key: String(key).trim() });
    if (exists) {
      return res.status(400).json({ isOk: false, message: `A field with key "${key}" already exists on this form` });
    }

    // A stoppage reason is summed into Total Stoppage as minutes, so it has
    // to be numeric — otherwise the roll-up would silently coerce text to 0.
    if (isStoppageReason && type && type !== "number") {
      return res.status(400).json({ isOk: false, message: "A stoppage-reason field must be of type number" });
    }

    const field = await FormField.create({
      formDefinitionId,
      key: String(key).trim(),
      label: String(label).trim(),
      type: type || "number",
      isRequired: !!isRequired,
      isStoppageReason: !!isStoppageReason,
      section: section || "Additional Fields",
      order: order ?? 0,
      defaultValue,
      dropdownSource: dropdownSource || "none",
      staticOptions: Array.isArray(staticOptions) ? staticOptions : [],
      isCore: false, // only the seeder creates core fields
      isVisible: true,
    });

    await bumpVersion(formDefinitionId);
    res.status(201).json({ isOk: true, data: field, message: "Field added successfully" });
  } catch (error) {
    console.error("Error creating form field:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.updateFormField = async (req, res) => {
  try {
    const field = await FormField.findById(req.params.fieldId);
    if (!field) return res.status(404).json({ isOk: false, message: "Field not found" });

    const { label, isRequired, isStoppageReason, section, order, isVisible, type, key, defaultValue, staticOptions } = req.body;

    // Presentation edits are always allowed.
    if (label !== undefined) {
      if (!String(label).trim()) return res.status(400).json({ isOk: false, message: "Label cannot be empty" });
      field.label = String(label).trim();
    }
    if (section !== undefined) field.section = section;
    if (order !== undefined) field.order = order;
    if (defaultValue !== undefined) field.defaultValue = defaultValue;
    if (staticOptions !== undefined) field.staticOptions = Array.isArray(staticOptions) ? staticOptions : [];

    if (field.isCore) {
      // Re-keying or retyping a core field would break the column the OEE
      // engine reads, so those edits are refused rather than ignored.
      if (key !== undefined && String(key).trim() !== field.key) {
        return res.status(400).json({ isOk: false, message: `"${field.label}" is a core field — its key is used by the OEE calculation and cannot be changed.` });
      }
      if (type !== undefined && type !== field.type) {
        return res.status(400).json({ isOk: false, message: `"${field.label}" is a core field — its type is used by the OEE calculation and cannot be changed.` });
      }
      if (isStoppageReason !== undefined && !!isStoppageReason !== field.isStoppageReason) {
        return res.status(400).json({ isOk: false, message: `"${field.label}" is a core field — whether it counts as stoppage is fixed by the OEE calculation.` });
      }
      if (STRUCTURAL_KEYS.has(field.key)) {
        if (isVisible === false) {
          return res.status(400).json({ isOk: false, message: `"${field.label}" is required by the OEE calculation and cannot be hidden.` });
        }
        if (isRequired === false) {
          return res.status(400).json({ isOk: false, message: `"${field.label}" is required by the OEE calculation and cannot be made optional.` });
        }
      }
    } else {
      if (key !== undefined && String(key).trim() !== field.key) {
        const clash = await FormField.findOne({ formDefinitionId: field.formDefinitionId, key: String(key).trim() });
        if (clash) return res.status(400).json({ isOk: false, message: `A field with key "${key}" already exists on this form` });
        field.key = String(key).trim();
      }
      if (type !== undefined) field.type = type;
      if (isStoppageReason !== undefined) field.isStoppageReason = !!isStoppageReason;
      if (field.isStoppageReason && field.type !== "number") {
        return res.status(400).json({ isOk: false, message: "A stoppage-reason field must be of type number" });
      }
    }

    if (isVisible !== undefined) field.isVisible = !!isVisible;
    if (isRequired !== undefined) field.isRequired = !!isRequired;

    await field.save();
    await bumpVersion(field.formDefinitionId);
    res.status(200).json({ isOk: true, data: field, message: "Field updated successfully" });
  } catch (error) {
    console.error("Error updating form field:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.deleteFormField = async (req, res) => {
  try {
    const field = await FormField.findById(req.params.fieldId);
    if (!field) return res.status(404).json({ isOk: false, message: "Field not found" });

    if (field.isCore) {
      return res.status(400).json({
        isOk: false,
        message: `"${field.label}" is a core field used by the OEE calculation and cannot be deleted. Hide it instead if you don't want it on the form.`,
      });
    }

    await FormField.findByIdAndDelete(field._id);
    await bumpVersion(field.formDefinitionId);
    // Existing entries keep their extraValues for this key on purpose —
    // deleting the field definition shouldn't rewrite historical rows.
    res.status(200).json({ isOk: true, message: "Field deleted successfully" });
  } catch (error) {
    console.error("Error deleting form field:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

/** Bulk reorder — the drag-to-sort save from Form Builder. */
exports.reorderFormFields = async (req, res) => {
  try {
    const { fields } = req.body; // [{ _id, order, section? }]
    if (!Array.isArray(fields)) {
      return res.status(400).json({ isOk: false, message: "fields must be an array" });
    }

    await Promise.all(
      fields.map((f) =>
        FormField.findByIdAndUpdate(f._id, {
          ...(f.order !== undefined ? { order: f.order } : {}),
          ...(f.section !== undefined ? { section: f.section } : {}),
        }),
      ),
    );

    if (fields[0]?._id) {
      const first = await FormField.findById(fields[0]._id).select("formDefinitionId");
      if (first) await bumpVersion(first.formDefinitionId);
    }

    res.status(200).json({ isOk: true, message: "Field order saved" });
  } catch (error) {
    console.error("Error reordering form fields:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
