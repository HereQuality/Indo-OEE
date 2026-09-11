const Notification = require("../models/Notification");

const identify = (req) => ({
  model: req.user.roleType === "SuperAdmin" ? "User" : "Operator",
  id: String(req.user._id),
});

exports.getNotifications = async (req, res) => {
  try {
    const who = identify(req);
    const notifications = await Notification.find({
      recipientModel: who.model,
      recipientId: who.id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ isOk: true, data: notifications });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.getUnreadNotificationCount = async (req, res) => {
  try {
    const who = identify(req);
    const unreadCount = await Notification.countDocuments({
      recipientModel: who.model,
      recipientId: who.id,
      isRead: false,
    });
    res.json({ isOk: true, unreadCount });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const who = identify(req);
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientModel: who.model, recipientId: who.id },
      { isRead: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ isOk: false, message: "Notification not found" });
    res.json({ isOk: true, data: notification });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const who = identify(req);
    await Notification.updateMany(
      { recipientModel: who.model, recipientId: who.id, isRead: false },
      { isRead: true }
    );
    res.json({ isOk: true });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};
