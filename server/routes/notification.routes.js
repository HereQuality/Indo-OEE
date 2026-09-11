"use strict";

const express = require("express");
const {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notification.controller");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(protect);

router.get("/unread-count", getUnreadNotificationCount);
router.get("/", getNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);

module.exports = router;
