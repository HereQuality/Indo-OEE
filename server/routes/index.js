"use strict";
/**
 * routes/index.js — API v1 Router (Root)
 *
 * All routes are prefixed with /api/v1 (set in app.js).
 *
 * Route structure:
 *   POST   /api/v1/auth/register
 *   POST   /api/v1/auth/login
 *   POST   /api/v1/auth/logout
 *   POST   /api/v1/auth/refresh-token
 *   GET    /api/v1/auth/me
 *   ...
 *   GET    /api/v1/users         (admin)
 *   GET    /api/v1/inventory     (protected)
 *   ...
 *
 * Add new resource routes here as the app grows.
 */

const express = require("express");
const router = express.Router();

// ── Route modules (uncomment as you build them) ──────────────────────────────
const authRoutes = require("./auth.routes");
const menuRoutes = require("./menu.routes");
const departmentRoutes = require("./department.routes");
const roleRoutes = require("./role.routes");
const companyRoutes = require("./company.routes");
const operatorRolesRoutes = require("./operatorRoles.routes");
const operatorRoutes = require("./operator.routes");
const teamRoutes = require("./team.routes");
const ticketRoutes = require("./ticket.routes");
const notificationRoutes = require("./notification.routes");
const machineRoutes = require("./machine.routes");
const machineOperatorRoutes = require("./machineOperator.routes");
const itemRoutes = require("./item.routes");
const productionSheetRoutes = require("./productionSheet.routes");
const processRoutes = require("./process.routes");
const maintenanceRoutes = require("./maintenance.routes");
const announcementRoutes = require("./announcement.routes");
// const inventoryRoutes = require("./inventory.routes");

// ── Mount routes ─────────────────────────────────────────────────────────────
router.use("/auth", authRoutes);
router.use("/", menuRoutes);
router.use("/departments", departmentRoutes);
router.use("/roles", roleRoutes);
router.use("/companies", companyRoutes);
router.use("/operator-roles", operatorRolesRoutes);
router.use("/operators", operatorRoutes);
router.use("/teams", teamRoutes);
router.use("/tickets", ticketRoutes);
router.use("/notifications", notificationRoutes);
router.use("/machines", machineRoutes);
router.use("/machine-operators", machineOperatorRoutes);
router.use("/items", itemRoutes);
router.use("/production-sheet", productionSheetRoutes);
router.use("/processes", processRoutes);
router.use("/maintenance", maintenanceRoutes);
router.use("/announcement", announcementRoutes);
// router.use("/inventory", inventoryRoutes);

// ── API Info endpoint ─────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Internal_Audit API v1",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: "/api/v1/auth",
      users: "/api/v1/users",
      inventory: "/api/v1/inventory",
    },
  });
});

module.exports = router;
