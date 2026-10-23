const mongoose = require("mongoose");
const Item = require("../models/Item");
const ItemLog = require("../models/ItemLog");
const Process = require("../models/Process");
const {
  MAX_CYCLE_OPS,
  CYCLE_OP_FIELDS,
  SPM_OP_FIELDS,
  SPM_REFERENCE_FIELDS,
  RIVET_OP_FIELDS,
  RIVET_PROCESS_TYPES,
  PRESS_OPERATIONS,
} = require("../models/Item");
const { diffItem, updateAction, partLabel } = require("../utils/itemDiff");

// Keeps Op 1…Op 5 positional: blanks in the middle stay null so Op 3 never
// shifts into Op 2's column. Trailing blanks are trimmed.
const normalizeCycleOps = (ops) => {
  if (!Array.isArray(ops)) return [];
  const out = ops.slice(0, MAX_CYCLE_OPS).map((v) => (v === "" || v === null || v === undefined ? null : Number(v)));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};

// A blank operation (or Total Cycle Time) box stays unset rather than being
// saved as 0, so an item that's never had, say, Boring measured doesn't
// quietly read as "Boring takes 0 seconds" once it's picked on an entry.
const pickCycleOps = (body) =>
  Object.fromEntries(
    [...CYCLE_OP_FIELDS.map((f) => f.key), "totalCycleSec"]
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// A VMC part's program: Program Time (min) and the pieces one program makes.
// Blank stays unset, like the operation times above.
const pickProgram = (body) =>
  Object.fromEntries(
    ["programTimeMin", "pcsPerProgram"]
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// A PRESS part's standard time: the same shape as pickProgram above, PRESS's
// own fields.
const pickPressProgram = (body) =>
  Object.fromEntries(
    ["standardTimeMin", "pcsPerStandardTime"]
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// An SPM part's four operations (Loading, Process, Unloading and Cleaning,
// Other Operations). Blank stays unset, like the CNC operation times above —
// totalCycleSec itself is already covered by pickCycleOps.
const pickSpmOps = (body) =>
  Object.fromEntries(
    SPM_OP_FIELDS.map((f) => f.key)
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// An SPM part's three reference figures (No. of Holes in One Piece, No. of
// Piece in One Cycle, Stroke Required for One Piece) — same shape as
// pickSpmOps above.
const pickSpmReference = (body) =>
  Object.fromEntries(
    SPM_REFERENCE_FIELDS.map((f) => f.key)
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// A RIVET part's four operations — same shape as pickSpmOps above, RIVET's own fields.
const pickRivetOps = (body) =>
  Object.fromEntries(
    RIVET_OP_FIELDS.map((f) => f.key)
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k] === "" || body[k] === null ? null : Number(body[k])]),
  );

// A RIVET part's Process choice (Rivet/Clamp) — a plain required dropdown,
// like Drawing No./Setup No. above, not a cycle-time figure.
const pickRivetProcessType = (body) => (body.rivetProcessType !== undefined ? { rivetProcessType: body.rivetProcessType } : {});

// A PRESS part's Operation choice — same shape as pickRivetProcessType above.
const pickPressOperation = (body) => (body.pressOperation !== undefined ? { pressOperation: body.pressOperation } : {});

// `process` is only touched when the request actually sends it, so a form that
// doesn't know about processes can't clear the link by accident; "" (the "Not
// in any process" choice) clears it.
const pickItem = ({ itemName, drawingNo, setupNo, cycleOpsSec, isActive, process }, body = {}) => ({
  itemName,
  drawingNo,
  setupNo,
  ...(cycleOpsSec !== undefined ? { cycleOpsSec: normalizeCycleOps(cycleOpsSec) } : {}),
  ...pickCycleOps(body),
  ...pickProgram(body),
  ...pickPressProgram(body),
  ...pickSpmOps(body),
  ...pickSpmReference(body),
  ...pickRivetOps(body),
  ...pickRivetProcessType(body),
  ...pickPressOperation(body),
  ...(process !== undefined ? { process: process || null } : {}),
  isActive,
});

// The process a request names has to exist; returns a message when it doesn't.
const processError = async (process) => {
  if (!process) return null;
  if (!mongoose.isValidObjectId(process) || !(await Process.exists({ _id: process }))) return "Process not found";
  return null;
};

// A RIVET part's Process box has to be one of its two choices.
const rivetProcessTypeError = (rivetProcessType) => {
  if (!rivetProcessType) return null;
  if (!RIVET_PROCESS_TYPES.includes(rivetProcessType)) return `"${rivetProcessType}" is not a valid Process`;
  return null;
};

// A PRESS part's Operation box has to be one of its listed choices.
const pressOperationError = (pressOperation) => {
  if (!pressOperation) return null;
  if (!PRESS_OPERATIONS.includes(pressOperation)) return `"${pressOperation}" is not a valid Operation`;
  return null;
};

// Who is saving: the logged-in Super Admin (a User) or Operator.
const actorOf = (user) => ({
  id: user?._id,
  model: user?.constructor?.modelName,
  name: user?.employeeName || user?.name || user?.username || "",
});

// Adds a row to the part's history (models/ItemLog.js). `before` / `after` are the
// part as it was and as it is — {} for one that didn't exist / no longer does. An
// "update" that changed nothing writes no row, and one that only switched Status
// is filed as a deactivate or a restore. The history is a record kept beside the
// save, so a failure to write it is reported but never turns a save that went
// through into an error.
const recordItemLog = async (req, action, before, after) => {
  try {
    const processIds = [before?.process, after?.process].filter(Boolean).map(String);
    const processes = processIds.length ? await Process.find({ _id: { $in: processIds } }).select("processName dataEntryMenu").lean() : [];
    const changes = diffItem(
      before,
      after,
      Object.fromEntries(processes.map((p) => [String(p._id), p.processName])),
      Object.fromEntries(processes.map((p) => [String(p._id), p.dataEntryMenu || ""])),
    );
    if (action === "update") {
      if (!changes.length) return;
      action = updateAction(changes);
    }
    const part = after?._id ? after : before;
    await ItemLog.create({ item: part._id, ...partLabel(part), action, changes, actor: actorOf(req.user) });
  } catch (error) {
    console.error("Error recording item history:", error);
  }
};

exports.createItem = async (req, res) => {
  try {
    const badProcess = await processError(req.body.process);
    if (badProcess) return res.status(400).json({ isOk: false, message: badProcess });
    const badRivetProcessType = rivetProcessTypeError(req.body.rivetProcessType);
    if (badRivetProcessType) return res.status(400).json({ isOk: false, message: badRivetProcessType });
    const badPressOperation = pressOperationError(req.body.pressOperation);
    if (badPressOperation) return res.status(400).json({ isOk: false, message: badPressOperation });
    const item = await Item.create(pickItem(req.body, req.body));
    await recordItemLog(req, "create", {}, item);
    res.status(201).json({ isOk: true, data: item, message: "Item created successfully" });
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const badProcess = await processError(req.body.process);
    if (badProcess) return res.status(400).json({ isOk: false, message: badProcess });
    const badRivetProcessType = rivetProcessTypeError(req.body.rivetProcessType);
    if (badRivetProcessType) return res.status(400).json({ isOk: false, message: badRivetProcessType });
    const badPressOperation = pressOperationError(req.body.pressOperation);
    if (badPressOperation) return res.status(400).json({ isOk: false, message: badPressOperation });
    // The part as it was, to work out afterwards what this save changed.
    const before = await Item.findById(req.params.itemId);
    if (!before) return res.status(404).json({ isOk: false, message: "Item not found" });
    const item = await Item.findByIdAndUpdate(req.params.itemId, pickItem(req.body, req.body), { new: true, runValidators: true });
    if (!item) return res.status(404).json({ isOk: false, message: "Item not found" });
    await recordItemLog(req, "update", before, item);
    res.status(200).json({ isOk: true, data: item, message: "Item updated successfully" });
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

// Production rows keep their own copy of the item's details, so an item
// can always be removed: first delete deactivates, second one deletes.
exports.deleteItem = async (req, res) => {
  try {
    const item = await Item.findById(req.params.itemId);
    if (!item) return res.status(404).json({ isOk: false, message: "Item not found" });

    // Copied before the save changes it — the history compares the two.
    const before = item.toObject();
    if (item.isActive) {
      item.isActive = false;
      await item.save();
      await recordItemLog(req, "update", before, item);
      return res.status(200).json({ isOk: true, message: "Part deactivated successfully" });
    }
    await Item.findByIdAndDelete(item._id);
    await recordItemLog(req, "delete", before, {});
    res.status(200).json({ isOk: true, message: "Part deleted successfully" });
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.getItemById = async (req, res) => {
  try {
    const item = await Item.findById(req.params.itemId);
    if (!item) return res.status(404).json({ isOk: false, message: "Item not found" });
    res.status(200).json({ isOk: true, data: item });
  } catch (error) {
    console.error("Error fetching item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Active items — used by the data entry sheets' Part Name pickers. Each carries
// its `process`, and a sheet narrows the list to its own process's parts.
exports.listItems = async (req, res) => {
  try {
    const items = await Item.find({ isActive: true }).sort({ itemName: 1, drawingNo: 1, setupNo: 1 }).lean();
    res.status(200).json({ isOk: true, data: items });
  } catch (error) {
    console.error("Error listing items:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.listItemByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive, process } = req.body;

    const query = {};
    if (match) {
      // Matched as plain text, so a "(" or "*" typed in can't break the search.
      const escaped = String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { itemName: { $regex: escaped, $options: "i" } },
        { drawingNo: { $regex: escaped, $options: "i" } },
        { setupNo: { $regex: escaped, $options: "i" } },
      ];
    }
    if (isActive !== undefined) query.isActive = isActive;
    // One process's parts, or "none" for the parts not in any process yet. Left
    // out (or "") it lists every part.
    if (process === "none") query.process = null;
    else if (process) {
      if (!mongoose.isValidObjectId(process)) return res.status(400).json({ isOk: false, message: "Invalid process" });
      query.process = process;
    }

    let sortQuery = { itemName: 1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, items] = await Promise.all([
      Item.countDocuments(query),
      Item.find(query).sort(sortQuery).skip(parseInt(skip)).limit(parseInt(per_page)).lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: items }] });
  } catch (error) {
    console.error("Error searching items:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// A page of history rows when the request doesn't say; the most it will give at once.
const DEFAULT_LOG_PAGE = 50;
const MAX_LOG_PAGE = 200;

// The edit history of one part (`:itemId`), or of every part when the route has
// none — which is also where a deleted part's history is still found. Newest
// first, paged with ?skip= and ?limit=.
exports.listItemLogs = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (itemId !== undefined && !mongoose.isValidObjectId(itemId)) return res.status(400).json({ isOk: false, message: "Invalid item" });

    const { skip, limit } = req.query || {};
    const query = itemId ? { item: itemId } : {};
    const [total, logs] = await Promise.all([
      ItemLog.countDocuments(query),
      ItemLog.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(Math.max(0, parseInt(skip, 10) || 0))
        .limit(Math.min(MAX_LOG_PAGE, Math.max(1, parseInt(limit, 10) || DEFAULT_LOG_PAGE)))
        .lean(),
    ]);
    res.status(200).json({ isOk: true, data: logs, total });
  } catch (error) {
    console.error("Error listing item history:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.normalizeCycleOps = normalizeCycleOps;
