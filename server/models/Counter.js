const mongoose = require("mongoose");

/**
 * models/Counter.js
 * ───────────────────
 * Generic atomic auto-increment counter (one document per `_id`/sequence
 * name). Used for Ticket.ticketId so numbers never collide or get reused
 * after a delete — countDocuments()-based numbering breaks the moment
 * anything is deleted (the count goes back down, so the next ticket
 * recomputes an already-used number). $inc on a single document is
 * atomic in MongoDB even under concurrent requests, unlike count-then-use.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // sequence name, e.g. "ticketId"
  seq: { type: Number, default: 1000 },
});

const Counter = mongoose.model("Counter", counterSchema);

const getNextSequence = async (name) => {
  // First time this counter is used, seed it from whatever's already in
  // the DB (e.g. upgrading an app that already has tickets numbered past
  // 1000 from the old countDocuments()-based scheme) instead of blindly
  // starting at 1000 and immediately colliding again.
  const existing = await Counter.findById(name);
  if (!existing && name === "ticketId") {
    const Ticket = mongoose.models.Ticket || mongoose.model("Ticket");
    const allIds = await Ticket.find({}).select("ticketId").lean();
    const highestNum = allIds.reduce((max, t) => {
      const n = parseInt(String(t.ticketId || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 1000);
    await Counter.findByIdAndUpdate(
      name,
      { $setOnInsert: { seq: highestNum } },
      { upsert: true }
    );
  }

  const result = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return result.seq;
};

module.exports = { Counter, getNextSequence };
