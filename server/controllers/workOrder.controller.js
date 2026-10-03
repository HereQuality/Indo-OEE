const mongoose = require("mongoose");
const WorkOrder = require("../models/WorkOrder");
const Item = require("../models/Item");

/**
 * controllers/workOrder.controller.js
 * ─────────────────────────────────────
 * Work Order master (Production › Work Orders): a Work Order No. and the part it
 * makes. Same shape as the Part master's API — a plain active list for the data
 * entry pickers, a paged search for the master page, and a first delete that
 * deactivates while the second removes (entries keep their own copy of the
 * Work Order No., so a work order can always be removed).
 */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A blank Order Quantity stays unset rather than saved as 0.
const pickWorkOrder = ({ workOrderNo, item, orderQty, remarks, isActive }) => ({
  workOrderNo,
  item,
  orderQty: orderQty === "" || orderQty === null || orderQty === undefined ? null : Number(orderQty),
  remarks,
  isActive,
});

// The part a request names has to exist; returns a message when it doesn't.
const itemError = async (item) => {
  if (!item || !mongoose.isValidObjectId(item) || !(await Item.exists({ _id: item }))) return "Part not found";
  return null;
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
    const badItem = await itemError(req.body.item);
    if (badItem) return res.status(400).json({ isOk: false, message: badItem });
    const workOrder = await WorkOrder.create(pickWorkOrder(req.body));
    res.status(201).json({ isOk: true, data: workOrder, message: "Work order created successfully" });
  } catch (error) {
    console.error("Error creating work order:", error);
    failure(res, error);
  }
};

exports.updateWorkOrder = async (req, res) => {
  try {
    const badItem = await itemError(req.body.item);
    if (badItem) return res.status(400).json({ isOk: false, message: badItem });
    const workOrder = await WorkOrder.findByIdAndUpdate(req.params.workOrderId, pickWorkOrder(req.body), {
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
    const workOrder = await WorkOrder.findById(req.params.workOrderId);
    if (!workOrder) return res.status(404).json({ isOk: false, message: "Work order not found" });
    res.status(200).json({ isOk: true, data: workOrder });
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
      // The Work Order No., or the name of the part it makes.
      const pattern = { $regex: escapeRegex(match), $options: "i" };
      const itemIds = (await Item.find({ itemName: pattern }).select("_id").lean()).map((i) => i._id);
      query.$or = [{ workOrderNo: pattern }, { item: { $in: itemIds } }];
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

    res.status(200).json({ isOk: true, data: [{ count: totalCount, data: workOrders }] });
  } catch (error) {
    console.error("Error searching work orders:", error);
    failure(res, error);
  }
};
