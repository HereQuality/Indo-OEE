const Ticket = require("../models/Ticket");
const { isSupportAgent } = require("../utils/supportAgent");
const { emitMessageToTicket, emitTicketUpdated, getSocketIo } = require("../socket");

/**
 * controllers/ticket.controller.js
 * ───────────────────────────────────
 * Status workflow (matches the old project exactly):
 *   Pending -> In Progress -> Confirmation -> Resolved/Closed
 *
 *   - Pending -> In Progress: the handler (support agent for an "agent"
 *     tier ticket, SuperAdmin for an "admin" tier ticket) starts work.
 *   - In Progress -> Confirmation: the handler asks the person who raised
 *     it to confirm the fix.
 *   - Confirmation -> Closed: ONLY the person who raised it can accept
 *     (verifyTicket, action="Accept").
 *   - Confirmation -> In Progress: ONLY the raiser can reject with a
 *     reason (verifyTicket, action="Reject") — reopens it.
 */

// Who is making this request, in the shape everything below needs.
const identify = (req) => {
  const isAdmin = req.user.roleType === "SuperAdmin";
  return {
    isAdmin,
    model: isAdmin ? "User" : "Operator",
    id: String(req.user._id),
    name: isAdmin ? (req.user.name || "Admin") : req.user.employeeName,
  };
};

const hasAccess = async (ticket, user, who) => {
  // SuperAdmin sees ONLY admin tier tickets (forwarded by managers or raised by managers directly)
  if (who.isAdmin) return ticket.tier === "admin";
  // Operator who raised the ticket always sees it
  if (String(ticket.raisedById) === who.id) return true;
  // Support agents (edit permission on Support) can see tier=agent + forwarded (tier=admin) tickets
  const amAgent = await isSupportAgent(user);
  if (amAgent && (ticket.tier === "agent" || ticket.forwardedByEmployeeId)) return true;
  return false;
};

// Can this person act as the "handler" (start progress / ask for
// confirmation / delete) on this specific ticket?
const canHandleTicket = async (ticket, req, who) =>
  who.isAdmin ? ticket.tier === "admin" : ticket.tier === "agent" && (await isSupportAgent(req.user));

// ── Create a new ticket ──────────────────────────────────────────────────
exports.createTicket = async (req, res) => {
  try {
    const { subject, description, priority, platform } = req.body;
    if (!subject || !description) {
      return res.status(400).json({ isOk: false, message: "Subject and description are required" });
    }

    const who = identify(req);

    // SuperAdmin has nobody to raise a ticket TO — this feature is for
    // Operators (regular ones -> agent queue, agents -> admin directly).
    if (who.isAdmin) {
      return res.status(400).json({ isOk: false, message: "SuperAdmin doesn't raise support tickets." });
    }

    const amAgent = await isSupportAgent(req.user);
    const tier = amAgent ? "admin" : "agent";

    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map((f) => f.path || f.secure_url).filter(Boolean);
    }

    const ticket = await Ticket.create({
      subject,
      description,
      priority: priority || "Medium",
      platform: platform || "Web",
      tier,
      attachments,
      raisedByModel: who.model,
      raisedById: who.id,
      raisedByName: who.name,
      messages: [
        {
          senderModel: who.model,
          senderId: who.id,
          senderName: who.name,
          message: description,
          attachments,
          isRead: false,
        },
      ],
    });

    const io = getSocketIo();
    if (io) io.emit("refresh_unread_count");

    res.status(201).json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error creating ticket:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── List tickets, scoped to who's asking ─────────────────────────────────
exports.getTickets = async (req, res) => {
  try {
    const who = identify(req);
    let query;

    if (who.isAdmin) {
      query = { tier: "admin" }; // SuperAdmin sees only admin tier tickets
    } else {
      const amAgent = await isSupportAgent(req.user);
      query = amAgent
        ? { $or: [{ tier: "agent" }, { raisedById: who.id }, { forwardedByEmployeeId: { $exists: true, $ne: null } }] }
        : { raisedById: who.id };
    }

    const tickets = await Ticket.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const withUnread = tickets.map((t) => {
      const hasUnreadMessages = (t.messages || []).some(
        (msg) => String(msg.senderId) !== who.id && !msg.isRead
      );
      const requiresAction = t.status === "Confirmation" && String(t.raisedById) === who.id;
      
      const { messages, ...rest } = t;
      return { ...rest, hasUnread: hasUnreadMessages || requiresAction };
    });

    res.json({ isOk: true, data: withUnread });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── One ticket, full thread ──────────────────────────────────────────────
exports.getTicketDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);

    const ticket = await Ticket.findById(id).lean();
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    const canView = await hasAccess(ticket, req.user, who);
    if (!canView) return res.status(403).json({ isOk: false, message: "Access denied" });

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error fetching ticket details:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Reply ─────────────────────────────────────────────────────────────────
exports.replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ isOk: false, message: "Message cannot be empty" });

    const who = identify(req);
    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    const canView = await hasAccess(ticket, req.user, who);
    if (!canView) return res.status(403).json({ isOk: false, message: "Access denied" });

    let attachments = [];
    if (req.files && req.files.length > 0) {
      attachments = req.files.map((f) => f.path || f.secure_url).filter(Boolean);
    }

    ticket.messages.push({
      senderModel: who.model,
      senderId: who.id,
      senderName: who.name,
      message,
      attachments,
      isRead: false,
    });

    // First response from the handler moves it out of Pending.
    let statusChanged = false;
    const isRaiser = String(ticket.raisedById) === who.id;
    const isHandler = await canHandleTicket(ticket, req, who);
    const isReplyFromHandler = isHandler && !isRaiser;
    
    if (isReplyFromHandler && ticket.status === "Pending") {
      ticket.status = "In Progress";
      statusChanged = true;
    }

    await ticket.save();
    const addedMessage = ticket.messages[ticket.messages.length - 1];

    emitMessageToTicket(id, addedMessage);
    if (statusChanged) {
      emitTicketUpdated(id);
    }

    // Nudge the other side's unread badge.
    const io = getSocketIo();
    if (io) {
      const otherPersonId = String(ticket.raisedById) === who.id ? null : String(ticket.raisedById);
      if (otherPersonId) io.to(otherPersonId).emit("refresh_unread_count");
      if (ticket.tier === "agent" && who.id !== String(ticket.raisedById)) {
        // an agent replying — nudge every agent's badge too (shared queue)
        io.emit("refresh_unread_count");
      }
    }

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error replying to ticket:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Forward an "agent" tier ticket up to SuperAdmin ──────────────────────
exports.forwardTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);

    if (who.isAdmin) {
      return res.status(400).json({ isOk: false, message: "Already with SuperAdmin." });
    }
    const amAgent = await isSupportAgent(req.user);
    if (!amAgent) {
      return res.status(403).json({ isOk: false, message: "Only a support agent can forward a ticket." });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });
    if (ticket.tier === "admin") {
      return res.status(400).json({ isOk: false, message: "This ticket is already with SuperAdmin." });
    }

    ticket.tier = "admin";
    ticket.forwardedByEmployeeId = who.id;
    ticket.forwardedByName = who.name;
    ticket.forwardedAt = new Date();
    ticket.messages.push({
      senderModel: "Operator",
      senderId: who.id,
      senderName: who.name,
      message: `Forwarded this ticket to SuperAdmin.`,
      attachments: [],
      isSystem: true,
    });

    await ticket.save();
    const addedMessage = ticket.messages[ticket.messages.length - 1];

    emitMessageToTicket(id, addedMessage);
    emitTicketUpdated(id); // tier/ownership actually changed — worth a refetch
    const io = getSocketIo();
    if (io) io.emit("refresh_unread_count");

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error forwarding ticket:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Handler starts work: Pending -> In Progress ──────────────────────────
exports.startProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);
    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    if (!(await canHandleTicket(ticket, req, who))) {
      return res.status(403).json({ isOk: false, message: "You can't update this ticket." });
    }
    if (ticket.status !== "Pending") {
      return res.status(400).json({ isOk: false, message: `Ticket is already ${ticket.status}.` });
    }

    ticket.status = "In Progress";
    ticket.messages.push({
      senderModel: who.model,
      senderId: who.id,
      senderName: who.name,
      message: "Started working on this ticket.",
      attachments: [],
      isSystem: true,
    });
    await ticket.save();

    emitMessageToTicket(id, ticket.messages[ticket.messages.length - 1]);
    emitTicketUpdated(id);
    const io = getSocketIo();
    if (io) io.to(String(ticket.raisedById)).emit("refresh_unread_count");

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error starting progress:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Handler asks for confirmation: In Progress -> Confirmation ──────────
exports.askForConfirmation = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);
    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    if (!(await canHandleTicket(ticket, req, who))) {
      return res.status(403).json({ isOk: false, message: "You can't update this ticket." });
    }
    if (ticket.status !== "In Progress") {
      return res.status(400).json({ isOk: false, message: "Ticket must be In Progress first." });
    }

    ticket.status = "Confirmation";
    ticket.messages.push({
      senderModel: who.model,
      senderId: who.id,
      senderName: who.name,
      message: "Marked this ticket as resolved — waiting for confirmation.",
      attachments: [],
      isSystem: true,
    });
    await ticket.save();

    emitMessageToTicket(id, ticket.messages[ticket.messages.length - 1]);
    emitTicketUpdated(id);
    const io = getSocketIo();
    if (io) io.to(String(ticket.raisedById)).emit("refresh_unread_count");

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error asking for confirmation:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Raiser verifies: Confirmation -> Closed (Accept) or In Progress (Reject) ─
exports.verifyTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body; // action: "Accept" | "Reject"
    const who = identify(req);

    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    if (String(ticket.raisedById) !== who.id) {
      return res.status(403).json({ isOk: false, message: "Only the person who raised this ticket can verify it." });
    }
    if (ticket.status !== "Confirmation") {
      return res.status(400).json({ isOk: false, message: "This ticket isn't waiting for confirmation." });
    }

    if (action === "Accept") {
      ticket.status = "Closed";
      ticket.messages.push({
        senderModel: who.model,
        senderId: who.id,
        senderName: who.name,
        message: "Confirmed the fix — ticket closed.",
        attachments: [],
        isSystem: true,
      });
    } else if (action === "Reject") {
      ticket.status = "In Progress";
      ticket.messages.push({
        senderModel: who.model,
        senderId: who.id,
        senderName: who.name,
        message: reason ? `Not resolved yet: ${reason}` : "Not resolved yet — reopened.",
        attachments: [],
        isSystem: true,
      });
    } else {
      return res.status(400).json({ isOk: false, message: "action must be Accept or Reject" });
    }

    await ticket.save();

    emitMessageToTicket(id, ticket.messages[ticket.messages.length - 1]);
    emitTicketUpdated(id);
    const io = getSocketIo();
    if (io) io.emit("refresh_unread_count");

    res.json({ isOk: true, data: ticket });
  } catch (error) {
    console.error("Error verifying ticket:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Delete: the raiser, or whoever handles this tier, can remove it ──────
exports.deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);
    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    const isRaiser = String(ticket.raisedById) === who.id;
    if (!isRaiser) {
      return res.status(403).json({ isOk: false, message: "Only the ticket creator can delete it." });
    }

    // Once work has started, the ticket is a real record of what happened
    // (and who's handling it) — nobody can delete it past that point,
    // regardless of role. Only a still-Pending, untouched ticket can be
    // removed.
    if (ticket.status !== "Pending") {
      return res.status(400).json({ isOk: false, message: "This ticket is already in progress and can no longer be deleted." });
    }

    await Ticket.findByIdAndDelete(id);

    const io = getSocketIo();
    if (io) io.emit("refresh_unread_count");

    res.json({ isOk: true, message: "Ticket deleted." });
  } catch (error) {
    console.error("Error deleting ticket:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Mark every message NOT from me as read ───────────────────────────────
exports.markMessagesAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const who = identify(req);

    const ticket = await Ticket.findById(id);
    if (!ticket) return res.status(404).json({ isOk: false, message: "Ticket not found" });

    let updated = false;
    ticket.messages.forEach((msg) => {
      if (String(msg.senderId) !== who.id && !msg.isRead) {
        msg.isRead = true;
        updated = true;
      }
    });

    if (updated) {
      await ticket.save();
      const io = getSocketIo();
      if (io) {
        io.to(`ticket_${id}`).emit("messages_read", { ticketId: id, readBy: who.id });
        io.to(who.id).emit("refresh_unread_count");
      }
    }

    res.json({ isOk: true, updated });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Unread count for the bell / sidebar badge ─────────────────────────────
exports.getUnreadTicketCount = async (req, res) => {
  try {
    const who = identify(req);
    let query;

    if (who.isAdmin) {
      query = { tier: "admin" };
    } else {
      const amAgent = await isSupportAgent(req.user);
      query = amAgent
        ? { $or: [{ tier: "agent" }, { raisedById: who.id }, { forwardedByEmployeeId: { $exists: true } }] }
        : { raisedById: who.id };
    }

    const tickets = await Ticket.find(query).select("messages status raisedById").lean();

    let unreadCount = 0;
    tickets.forEach((ticket) => {
      const hasUnreadMessages = (ticket.messages || []).some(
        (msg) => String(msg.senderId) !== who.id && !msg.isRead
      );
      const requiresAction = ticket.status === "Confirmation" && String(ticket.raisedById) === who.id;
      if (hasUnreadMessages || requiresAction) unreadCount++;
    });

    res.json({ isOk: true, unreadCount });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
