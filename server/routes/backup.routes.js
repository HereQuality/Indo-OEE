const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { list, create, link, download } = require("../controllers/backup.controller");

/**
 * routes/backup.routes.js — mounted at /api/v1/backups
 * (controllers/backup.controller.js). Super Admin only: a backup holds every
 * record of the app. The download itself is opened by a short-lived link
 * (POST /:name/link), which is its own proof.
 */
const router = express.Router();

router.get("/download", download);

router.use(protect, authorize("SuperAdmin"));
router.get("/", list);
router.post("/", create);
router.post("/:name/link", link);

module.exports = router;
