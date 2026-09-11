"use strict";

const express = require("express");
const {
  createTicket,
  getTickets,
  getTicketDetails,
  replyToTicket,
  forwardTicket,
  startProgress,
  askForConfirmation,
  verifyTicket,
  deleteTicket,
  markMessagesAsRead,
  getUnreadTicketCount,
} = require("../controllers/ticket.controller");
const { protect } = require("../middlewares/auth.middleware");
const { uploadTicketAttachments } = require("../middlewares/upload.middleware");
const { rewriteUploadPaths } = require("../utils/fileUrl");

const router = express.Router();

router.use(protect);

router.get("/unread-count", getUnreadTicketCount);
router.get("/", getTickets);
router.post("/", uploadTicketAttachments.array("attachments", 5), rewriteUploadPaths, createTicket);
router.get("/:id", getTicketDetails);
router.post("/:id/reply", uploadTicketAttachments.array("attachments", 5), rewriteUploadPaths, replyToTicket);
router.post("/:id/forward", forwardTicket);
router.post("/:id/start-progress", startProgress);
router.post("/:id/ask-confirmation", askForConfirmation);
router.post("/:id/verify", verifyTicket);
router.patch("/:id/read", markMessagesAsRead);
router.delete("/:id", deleteTicket);

module.exports = router;
