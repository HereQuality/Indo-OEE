const Item = require("../models/Item");
const { MAX_CYCLE_OPS } = require("../models/Item");

// Keeps Op 1…Op 5 positional: blanks in the middle stay null so Op 3 never
// shifts into Op 2's column. Trailing blanks are trimmed.
const normalizeCycleOps = (ops) => {
  if (!Array.isArray(ops)) return [];
  const out = ops.slice(0, MAX_CYCLE_OPS).map((v) => (v === "" || v === null || v === undefined ? null : Number(v)));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};

const pickItem = ({ itemName, drawingNo, setupNo, cycleOpsSec, isActive }) => ({
  itemName,
  drawingNo,
  setupNo,
  ...(cycleOpsSec !== undefined ? { cycleOpsSec: normalizeCycleOps(cycleOpsSec) } : {}),
  isActive,
});

exports.createItem = async (req, res) => {
  try {
    const item = await Item.create(pickItem(req.body));
    res.status(201).json({ isOk: true, data: item, message: "Item created successfully" });
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(req.params.itemId, pickItem(req.body), { new: true, runValidators: true });
    if (!item) return res.status(404).json({ isOk: false, message: "Item not found" });
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

    if (item.isActive) {
      item.isActive = false;
      await item.save();
      return res.status(200).json({ isOk: true, message: "Item deactivated successfully" });
    }
    await Item.findByIdAndDelete(item._id);
    res.status(200).json({ isOk: true, message: "Item deleted successfully" });
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

// Active items — used by the data entry sheet's Item Name autofill.
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
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    const query = {};
    if (match) {
      query.$or = [
        { itemName: { $regex: match, $options: "i" } },
        { drawingNo: { $regex: match, $options: "i" } },
        { setupNo: { $regex: match, $options: "i" } },
      ];
    }
    if (isActive !== undefined) query.isActive = isActive;

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

exports.normalizeCycleOps = normalizeCycleOps;
