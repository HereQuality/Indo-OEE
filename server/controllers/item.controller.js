const Item = require("../models/Item");

const PROCESS_POPULATE = { path: "process", select: "processName" };
const MACHINE_POPULATE = { path: "machine", select: "machineName machineCode" };

// Create Item
exports.createItem = async (req, res) => {
  try {
    const { itemName, itemCode, description, process, machine, cycleTimeMin, isActive } = req.body;

    if (!itemName || !itemName.trim()) {
      return res.status(400).json({ isOk: false, message: "Item name is required" });
    }
    if (!process) {
      return res.status(400).json({ isOk: false, message: "Process is required" });
    }
    if (!machine) {
      return res.status(400).json({ isOk: false, message: "Machine is required" });
    }
    if (!cycleTimeMin || Number(cycleTimeMin) <= 0) {
      return res.status(400).json({ isOk: false, message: "Cycle time must be greater than 0" });
    }

    const newItem = await Item.create({
      itemName: itemName.trim(),
      itemCode: itemCode ? itemCode.trim() : "",
      description: description ? description.trim() : undefined,
      process,
      machine,
      cycleTimeMin,
      isActive,
    });

    res.status(201).json({
      isOk: true,
      data: newItem,
      message: "Item created successfully",
    });
  } catch (error) {
    console.error("Error creating item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Item
exports.updateItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const item = await Item.findOneAndUpdate({ _id: itemId }, req.body, {
      new: true,
      runValidators: true,
    });

    if (!item) {
      return res.status(404).json({ isOk: false, message: "Item not found" });
    }

    res.status(200).json({
      isOk: true,
      data: item,
      message: "Item updated successfully",
    });
  } catch (error) {
    console.error("Error updating item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Delete Item (soft then hard, same pattern as Machine/Department)
exports.deleteItem = async (req, res) => {
  try {
    const { itemId } = req.params;

    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ isOk: false, message: "Item not found" });
    }

    if (item.isActive) {
      item.isActive = false;
      await item.save();
      return res.status(200).json({ isOk: true, message: "Item deactivated successfully" });
    } else {
      await Item.findByIdAndDelete(itemId);
      return res.status(200).json({ isOk: true, message: "Item deleted successfully" });
    }
  } catch (error) {
    console.error("Error deleting item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Item By Id
exports.getItemById = async (req, res) => {
  try {
    const { itemId } = req.params;
    const item = await Item.findOne({ _id: itemId }).populate(PROCESS_POPULATE).populate(MACHINE_POPULATE);

    if (!item) {
      return res.status(404).json({ isOk: false, message: "Item not found" });
    }

    res.status(200).json({ isOk: true, data: item });
  } catch (error) {
    console.error("Error fetching item:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Items (no pagination) — used to populate dropdowns
exports.listItems = async (req, res) => {
  try {
    const items = await Item.find({ isActive: true })
      .populate(PROCESS_POPULATE)
      .populate(MACHINE_POPULATE)
      .sort({ itemName: 1 });
    res.status(200).json({ isOk: true, data: items });
  } catch (error) {
    console.error("Error listing items:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Items By Params (Pagination)
exports.listItemByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    let query = {};
    if (match) {
      query.$or = [
        { itemName: { $regex: match, $options: "i" } },
        { itemCode: { $regex: match, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, items] = await Promise.all([
      Item.countDocuments(query),
      Item.find(query)
        .populate(PROCESS_POPULATE)
        .populate(MACHINE_POPULATE)
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({
      isOk: true,
      data: [{ count: totalCount, data: items }],
    });
  } catch (error) {
    console.error("Error searching items:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
