const Notification = require("../models/Notification");
const { emitNotificationToPerson } = require("../socket");

/**
 * services/notification.service.js
 * ───────────────────────────────────
 * @param {string} recipientModel - "Operator" | "User"
 */
const createNotification = async (recipientModel, recipientId, title, message, type, referenceId) => {
  const scopedId = String(recipientId || "").trim();
  if (!scopedId) throw new Error("recipientId is required to create a notification");

  const payload = {
    recipientModel,
    recipientId: scopedId,
    title: String(title || "Notification").trim(),
    message: String(message || "").trim(),
    type: String(type || "general").trim(),
    referenceId: referenceId || null,
    isRead: false,
  };

  const notification = await Notification.create(payload);
  const lean = notification.toObject();

  emitNotificationToPerson(scopedId, lean);

  return lean;
};

/**
 * @param {Array<{model: "Operator"|"User", id: string}>} recipients
 */
const createNotificationForMany = async (recipients, title, message, type, referenceId) => {
  const list = Array.isArray(recipients) ? recipients : [];
  if (list.length === 0) return [];

  const created = await Promise.allSettled(
    list.map((r) => createNotification(r.model, r.id, title, message, type, referenceId))
  );

  return created.filter((r) => r.status === "fulfilled").map((r) => r.value);
};

module.exports = { createNotification, createNotificationForMany };
