const mongoose = require("mongoose");
const WorkOrder = require("../models/WorkOrder");
const Item = require("../models/Item");
const VmcEntry = require("../models/VmcEntry");

/**
 * controllers/workOrder.controller.js
 * ─────────────────────────────────────
 * Work Order master (Production › Work Orders): a Work Order No., the part it
 * makes, that part's description, the customer, the quantity and the dispatch
 * date. Same shape as the Part master's API — a plain active list for the data
 * entry pickers, a paged search for the master page, and a first delete that
 * deactivates while the second removes (entries keep their own copy of the
 * Work Order No., so a work order can always be removed).
 */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "YYYY-MM-DD" -> Date at UTC midnight, or null if it isn't a real date
// ("2026-02-30" is rejected, not rolled over into March).
const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};

// Production progress of work orders, worked out from the entries that picked
// them (today only the VMC sheet offers a Work Order No.): pieces made so far
// (OK quantity) and the Production Complete Date — the day the running total
// of OK pieces first reached the ordered quantity. Not stored, so it follows
// entry edits and deletions. null until the order is complete.
const progressFor = async (workOrders) => {
  const out = new Map();
  if (!workOrders.length) return out;
  const rows = await VmcEntry.find({
    $or: [{ workOrder: { $in: workOrders.map((w) => w._id) } }, { workOrderNo: { $in: workOrders.map((w) => w.workOrderNo) } }],
  })
    .select("workOrder workOrderNo date okQty")
    .sort({ date: 1, slot: 1 })
    .lean();
  for (const wo of workOrders) {
    const mine = rows.filter((r) => (r.workOrder && String(r.workOrder) === String(wo._id)) || (!r.workOrder && String(r.workOrderNo || "").toLowerCase() === String(wo.workOrderNo).toLowerCase()));
    let total = 0;
    let done = null;
    for (const r of mine) {
      total += Number(r.okQty) || 0;
      if (!done && wo.orderQty && total >= wo.orderQty) done = r.date;
    }
    out.set(String(wo._id), { producedQty: total, productionCompleteDate: done });
  }
  return out;
};

const withProgress = async (list) => {
  const map = await progressFor(list);
  return list.map((w) => ({ ...w, ...(map.get(String(w._id)) || { producedQty: 0, productionCompleteDate: null }) }));
};

const text = (v) => (v === undefined || v === null ? "" : String(v).trim());

// The part a request names has to exist; returns a message when it doesn't.
const itemError = async (item) => {
  if (!item || !mongoose.isValidObjectId(item) || !(await Item.exists({ _id: item }))) return "Part not found";
  return null;
};

// Checks a create/update body and builds the fields to store. Returns
// { error } with the first problem found, or { data } when it is all good.
const buildWorkOrder = async (body = {}) => {
  const workOrderNo = text(body.workOrderNo);
  if (!workOrderNo) return { error: "Work Order No. is required" };

  if (!body.item) return { error: "Part Name / Drawing No. is required" };
  const badItem = await itemError(body.item);
  if (badItem) return { error: badItem };

  const partDescription = text(body.partDescription);
  if (!partDescription) return { error: "Part Description is required" };

  // Quantity: required now — a blank no longer saves as "unset".
  const rawQty = body.orderQty;
  if (rawQty === undefined || rawQty === null || text(rawQty) === "") return { error: "Quantity is required" };
  const orderQty = typeof rawQty === "number" || typeof rawQty === "string" ? Number(rawQty) : NaN;
  if (!Number.isInteger(orderQty) || orderQty < 1) return { error: "Quantity must be a whole number, 1 or more" };

  if (!text(body.dispatchDate)) return { error: "Dispatch Date is required" };
  const dispatchDate = parseDay(text(body.dispatchDate));
  if (!dispatchDate) return { error: "Dispatch Date must be a valid date (YYYY-MM-DD)" };

  return {
    data: {
      workOrderNo,
      item: body.item,
      partDescription,
      customerName: text(body.customerName),
      orderQty,
      dispatchDate,
      remarks: text(body.remarks),
      isActive: body.isActive,
    },
  };
};

const failure = (res, error) => {
  if (error.code === 11000) {
    return res.status(400).json({ isOk: false, message: "This Work Order No. already exists" });
  }
  const status = error.name === "ValidationError" || error.name === "CastError" ? 400 : 500;
  return res.status(status).json({ isOk: false, message: error.message });
};

exports.createWorkOrder = async (req, res) => {
  try {
    const { error, data } = await buildWorkOrder(req.body);
    if (error) return res.status(400).json({ isOk: false, message: error });
    const workOrder = await WorkOrder.create(data);
    res.status(201).json({ isOk: true, data: workOrder, message: "Work order created successfully" });
  } catch (error) {
    console.error("Error creating work order:", error);
    failure(res, error);
  }
};

exports.updateWorkOrder = async (req, res) => {
  try {
    const { error, data } = await buildWorkOrder(req.body);
    if (error) return res.status(400).json({ isOk: false, message: error });
    const workOrder = await WorkOrder.findByIdAndUpdate(req.params.workOrderId, data, {
      new: true,
      runValidators: true,
    });
    if (!workOrder) return res.status(404).json({ isOk: false, message: "Work order not found" });
    res.status(200).json({ isOk: true, data: workOrder, message: "Work order updated successfully" });
  } catch (error) {
    console.error("Error updating work order:", error);
    failure(res, error);
  }
};

// First delete deactivates, the second removes — like the Part master.
exports.deleteWorkOrder = async (req, res) => {
  try {
    const workOrder = await WorkOrder.findById(req.params.workOrderId);
    if (!workOrder) return res.status(404).json({ isOk: false, message: "Work order not found" });

    if (workOrder.isActive) {
      workOrder.isActive = false;
      await workOrder.save();
      return res.status(200).json({ isOk: true, message: "Work order deactivated successfully" });
    }
    await WorkOrder.findByIdAndDelete(workOrder._id);
    res.status(200).json({ isOk: true, message: "Work order deleted successfully" });
  } catch (error) {
    console.error("Error deleting work order:", error);
    failure(res, error);
  }
};

exports.getWorkOrderById = async (req, res) => {
  try {
    const workOrder = await WorkOrder.findById(req.params.workOrderId).lean();
    if (!workOrder) return res.status(404).json({ isOk: false, message: "Work order not found" });
    res.status(200).json({ isOk: true, data: (await withProgress([workOrder]))[0] });
  } catch (error) {
    console.error("Error fetching work order:", error);
    failure(res, error);
  }
};

// Active work orders — used by the data entry sheets' Work Order No. pickers. Each
// carries its part's id (`item`); a sheet narrows the list to the parts it runs.
exports.listWorkOrders = async (req, res) => {
  try {
    const workOrders = await WorkOrder.find({ isActive: true })
      .select("workOrderNo item orderQty")
      .sort({ workOrderNo: 1 })
      .collation({ locale: "en", numericOrdering: true })
      .lean();
    res.status(200).json({ isOk: true, data: workOrders });
  } catch (error) {
    console.error("Error listing work orders:", error);
    failure(res, error);
  }
};

exports.listWorkOrderByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive, item } = req.body;

    const query = {};
    if (match) {
      // The Work Order No., customer, part description, or the name / Drawing
      // No. of the part it makes.
      const pattern = { $regex: escapeRegex(match), $options: "i" };
      const itemIds = (await Item.find({ $or: [{ itemName: pattern }, { drawingNo: pattern }] }).select("_id").lean()).map(
        (i) => i._id,
      );
      query.$or = [
        { workOrderNo: pattern },
        { customerName: pattern },
        { partDescription: pattern },
        { item: { $in: itemIds } },
      ];
    }
    if (isActive !== undefined) query.isActive = isActive;
    if (item) {
      if (!mongoose.isValidObjectId(item)) return res.status(400).json({ isOk: false, message: "Invalid part" });
      query.item = item;
    }

    let sortQuery = { workOrderNo: 1 };
    if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

    const [totalCount, workOrders] = await Promise.all([
      WorkOrder.countDocuments(query),
      WorkOrder.find(query)
        .populate("item", "itemName drawingNo setupNo process")
        .sort(sortQuery)
        .collation({ locale: "en", numericOrdering: true })
        .skip(parseInt(skip, 10))
        .limit(parseInt(per_page, 10))
        .lean(),
    ]);

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: await withProgress(workOrders) }] });
  } catch (error) {
    console.error("Error searching work orders:", error);
    failure(res, error);
  }
};

// Progress of the work order with this number (the Add / Edit form's read-only
// Production Complete Date). An unknown number just has no progress yet.
exports.getWorkOrderProgress = async (req, res) => {
  try {
    const no = text(req.query.no);
    if (!no) return res.status(200).json({ isOk: true, data: { producedQty: 0, productionCompleteDate: null, found: false } });
    const workOrder = await WorkOrder.findOne({ workOrderNo: no }).collation({ locale: "en", strength: 2 }).lean();
    if (!workOrder) return res.status(200).json({ isOk: true, data: { producedQty: 0, productionCompleteDate: null, found: false } });
    const [row] = await withProgress([workOrder]);
    res.status(200).json({ isOk: true, data: { producedQty: row.producedQty, productionCompleteDate: row.productionCompleteDate, orderQty: row.orderQty, found: true } });
  } catch (error) {
    console.error("Error reading work order progress:", error);
    failure(res, error);
  }
};
