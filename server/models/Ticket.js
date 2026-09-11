const mongoose = require("mongoose");

/**
 * models/Ticket.js
 * ─────────────────
 * Two-tier support escalation:
 *   - A regular Operator raises a ticket → tier = "agent". It's visible to
 *     every Operator whose role has WRITE ("edit") permission on the
 *     Support menu (see server/utils/supportAgent.js) — that's the support
 *     agent queue, not any one specific person.
 *   - A support-agent Operator raises their OWN ticket → tier = "admin"
 *     straight away (there's nobody else above them except SuperAdmin).
 *   - A support-agent Operator can also FORWARD an "agent" tier ticket
 *     (someone else's) up to "admin" — see forwardTicket in the controller.
 *   - SuperAdmin only ever sees "admin" tier tickets.
 *
 * `raisedByModel`/`raisedById` and each message's `senderModel`/`senderId`
 * use Mongoose's dynamic ref (refPath) since the sender can be either an
 * Operator or the SuperAdmin (User model) — two different collections.
 */

const messageSchema = new mongoose.Schema(
  {
    senderModel: {
      type: String,
      enum: ["Operator", "User"],
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "messages.senderModel",
    },
    // Denormalized at write time so the chat thread never has to chase a
    // populate across two different collections just to show a name.
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: [{ type: String }],
    isRead: {
      type: Boolean,
      default: false,
    },
    isSystem: {
      // Auto-generated messages ("Forwarded to Admin by X", status-change
      // notes) — styled differently in the UI, don't count toward unread.
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      unique: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "In Progress", "Confirmation", "Resolved", "Closed"],
      default: "Pending",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    platform: {
      type: String,
      enum: ["Web", "App"],
      default: "Web",
    },
    tier: {
      // "agent"  -> sits in the support-agent queue
      // "admin"  -> escalated / agent-raised, SuperAdmin's queue
      type: String,
      enum: ["agent", "admin"],
      required: true,
      index: true,
    },
    attachments: [{ type: String }],

    raisedByModel: {
      type: String,
      enum: ["Operator", "User"],
      required: true,
    },
    raisedById: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "raisedByModel",
      index: true,
    },
    raisedByName: {
      type: String,
      required: true,
      trim: true,
    },

    // Only set once an agent escalates someone else's ticket up to admin.
    forwardedByEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      default: null,
    },
    forwardedByName: {
      type: String,
      default: null,
    },
    forwardedAt: {
      type: Date,
      default: null,
    },

    messages: [messageSchema],
  },
  { timestamps: true }
);

// Auto-generate ticketId before saving — TKT-1001, TKT-1002, ...
const { getNextSequence } = require("./Counter");

// Auto-generate ticketId before saving — TKT-1001, TKT-1002, ... via an
// atomic counter (see models/Counter.js) so numbers never collide or get
// reused after a ticket is deleted.
ticketSchema.pre("save", async function () {
  if (this.isNew) {
    const seq = await getNextSequence("ticketId");
    this.ticketId = `TKT-${seq}`;
  }
});

ticketSchema.index({ tier: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Ticket", ticketSchema);
