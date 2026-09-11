const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let ioInstance = null;

/**
 * socket/index.js
 * ─────────────────
 * Two kinds of rooms:
 *   - `<personId>`      — one per logged-in person (Operator or SuperAdmin),
 *                          used to push "new_notification" / unread-count
 *                          bumps to them regardless of which page they're on.
 *   - `ticket_<ticketId>` — joined only while a specific ticket's chat is
 *                          open, used to push "new_message" live.
 *
 * The initial `join` is authenticated with the same JWT used for the REST
 * API — the client can't just join an arbitrary person's room by guessing
 * their id. `join_ticket` additionally re-checks that this specific person
 * is actually allowed to see this specific ticket (same rule the REST
 * getTicketDetails endpoint uses) — without that check, anyone logged in
 * could join any ticket's room just by knowing/guessing its id and read
 * someone else's support conversation live.
 */
const initSocket = (httpServer) => {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "*",
      credentials: true,
    },
  });

  ioInstance.on("connection", (socket) => {
    socket.on("join", (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.data.personId = decoded.id;
        socket.data.roleType = decoded.roleType;
        socket.join(String(decoded.id));
      } catch {
        // Invalid/expired token — just don't join them to anything.
      }
    });

    socket.on("join_ticket", async (ticketId) => {
      const room = `ticket_${String(ticketId || "").trim()}`;
      if (!room || room === "ticket_") return;
      if (!socket.data.personId) return; // never authenticated via "join"

      try {
        // Lazy-require to avoid a require cycle at module-load time
        // (ticket.controller.js also requires this socket module).
        const Ticket = require("../models/Ticket");
        const { isSupportAgent } = require("../utils/supportAgent");
        const Operator = require("../models/Operator");

        const ticket = await Ticket.findById(ticketId).select("tier raisedById forwardedByEmployeeId").lean();
        if (!ticket) return;

        const isAdmin = socket.data.roleType === "SuperAdmin";
        const personId = String(socket.data.personId);
        let allowed = false;

        if (isAdmin) {
          allowed = ticket.tier === "admin";
        } else if (String(ticket.raisedById) === personId) {
          allowed = true;
        } else {
          const employee = await Operator.findById(personId).populate("roleId");
          const amAgent = employee ? await isSupportAgent(employee) : false;
          if (amAgent && (ticket.tier === "agent" || ticket.forwardedByEmployeeId)) {
            allowed = true;
          }
        }

        if (allowed) socket.join(room);
      } catch {
        // Any lookup failure -> fail closed, don't join.
      }
    });

    socket.on("leave_ticket", (ticketId) => {
      const room = `ticket_${String(ticketId || "").trim()}`;
      if (!room || room === "ticket_") return;
      socket.leave(room);
    });
  });

  return ioInstance;
};

const getSocketIo = () => ioInstance;

const emitNotificationToPerson = (personId, notification) => {
  const io = getSocketIo();
  if (!io) return;
  const room = String(personId || "").trim();
  if (!room) return;
  io.to(room).emit("new_notification", notification);
};

const emitUnreadCountRefresh = (personId) => {
  const io = getSocketIo();
  if (!io) return;
  const room = String(personId || "").trim();
  if (!room) return;
  io.to(room).emit("refresh_unread_count");
};

const emitMessageToTicket = (ticketId, message) => {
  const io = getSocketIo();
  if (!io) return;
  const room = `ticket_${String(ticketId || "").trim()}`;
  if (!room || room === "ticket_") return;
  io.to(room).emit("new_message", message);
};

const emitTicketUpdated = (ticketId) => {
  const io = getSocketIo();
  if (!io) return;
  const room = `ticket_${String(ticketId || "").trim()}`;
  if (room && room !== "ticket_") {
    io.to(room).emit("ticket_updated");
  }
  io.emit("ticket_updated"); // Broadcast globally to refresh all lists
};

module.exports = {
  initSocket,
  getSocketIo,
  emitNotificationToPerson,
  emitUnreadCountRefresh,
  emitMessageToTicket,
  emitTicketUpdated,
};
