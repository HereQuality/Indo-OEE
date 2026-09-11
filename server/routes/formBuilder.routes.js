"use strict";
const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const {
  listFormDefinitions,
  getFormSchema,
  createFormField,
  updateFormField,
  deleteFormField,
  reorderFormFields,
} = require("../controllers/formBuilder.controller");

const router = express.Router();

// Configuring the form is a SuperAdmin capability — hiding or renaming a
// field changes Grinding Data Entry for everyone, not just the person doing
// it. Same reasoning as menu.routes.js's superAdminOnly.
const superAdminOnly = [protect, authorize("SuperAdmin")];

// The one exception: every logged-in user needs to READ the schema, because
// Grinding Data Entry renders its labels/order/visibility from it. Locking
// this down to SuperAdmin would leave operators with an unrenderable form.
router.get("/schema/:slug", protect, authorize("SuperAdmin", "Operator"), getFormSchema);

router.get("/", ...superAdminOnly, listFormDefinitions);
router.post("/:formDefinitionId/fields", ...superAdminOnly, createFormField);
router.put("/fields/reorder", ...superAdminOnly, reorderFormFields);
router.put("/fields/:fieldId", ...superAdminOnly, updateFormField);
router.delete("/fields/:fieldId", ...superAdminOnly, deleteFormField);

module.exports = router;
