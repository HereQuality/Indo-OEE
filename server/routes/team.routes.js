"use strict";

/**
 * routes/team.routes.js
 * ──────────────────────
 * Every route requires the "/teams" menu's own read/write permission
 * (Manage Role) — this used to only check that the user was logged in,
 * which meant ANY employee could create/edit/delete teams regardless of
 * their assigned role. Fixed to match every other resource route.
 */
const express = require("express");
const {
  createTeam,
  getAllTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  searchTeams,
} = require("../controllers/team.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");

const router = express.Router();

const MENU_URL = "/teams";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/search", requireMenuPermission(MENU_URL, "read"), searchTeams);

router.route("/")
  .get(requireMenuPermission(MENU_URL, "read"), getAllTeams)
  .post(requireMenuPermission(MENU_URL, "write"), createTeam);

router.route("/:id")
  .get(requireMenuPermission(MENU_URL, "read"), getTeam)
  .put(requireMenuPermission(MENU_URL, "write"), updateTeam)
  .delete(requireMenuPermission(MENU_URL, "write"), deleteTeam);

module.exports = router;
