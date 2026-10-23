const MenuGroupMaster = require("../models/MenuGroupMaster");

// A message when the name is blank (spaces only count as blank) or the
// sequence isn't a number of 0 or more; null when both are fine. Without it a
// bad value either failed as a 500 or, on an update, was saved as it came.
const menuGroupError = ({ menuGroupName, sequence }) => {
  if (!String(menuGroupName ?? "").trim()) return "Menu Group name is required";
  if (sequence === undefined || sequence === null || sequence === "") return "Sequence is required";
  const n = Number(sequence);
  if (!Number.isFinite(n) || n < 0) return "Sequence must be 0 or more";
  return null;
};

exports.createMenuGroup = async (req, res) => {
  try {
    const { menuGroupName, sequence, isActive, isLink, menuUrl, icon, portal } = req.body;
    console.log("Creating menu group:", req.body);

    const invalid = menuGroupError(req.body);
    if (invalid) return res.status(400).json({ isOk: false, message: invalid });

    const menuGroup = await MenuGroupMaster.create({
      menuGroupName: String(menuGroupName).trim(),
      sequence,
      isActive,
      isLink: isLink || false,
      menuUrl: isLink ? menuUrl : "#",
      icon: icon || "",
      portal: portal || "Both",
    });

    res.status(201).json({
      isOk: true,
      message: "Menu Group created successfully",
      data: menuGroup,
    });
  } catch (error) {
    console.log("Error creating menu group:", error);
    res.status(500).json({
      isOk: false,
      message: "Error creating menu group",
      error: error.message,
    });
  }
};

exports.getAllMenuGroups = async (req, res) => {
  try {
    const menuGroups = await MenuGroupMaster.find({ isActive: true });

    res.status(200).json({
      isOk: true,
      message: "Menu Groups fetched successfully",
      data: menuGroups,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching menu groups",
      error: error.message,
    });
  }
};

exports.getMenuGroupById = async (req, res) => {
  try {
    const { menuGroupId } = req.params;

    const menuGroup = await MenuGroupMaster.findById(menuGroupId);

    res.status(200).json({
      isOk: true,
      message: "Menu Group fetched successfully",
      data: menuGroup,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching menu group",
      error: error.message,
    });
  }
};

exports.updateMenuGroup = async (req, res) => {
  try {
    const { menuGroupId } = req.params;
    const { menuGroupName, sequence, isActive, isLink, menuUrl, icon, portal } = req.body;

    const invalid = menuGroupError(req.body);
    if (invalid) return res.status(400).json({ isOk: false, message: invalid });

    const menuGroup = await MenuGroupMaster.findByIdAndUpdate(
      menuGroupId,
      {
        menuGroupName: String(menuGroupName).trim(),
        sequence,
        isActive,
        isLink: isLink || false,
        menuUrl: isLink ? menuUrl : "#",
        icon: icon || "",
        portal: portal || "Both",
      },
      { new: true }
    );

    res.status(200).json({
      isOk: true,
      message: "Menu Group updated successfully",
      data: menuGroup,
    });
  } catch (error) {
    console.log("Error updating menu group:", error);
    res.status(500).json({
      isOk: false,
      message: "Error updating menu group",
      error: error.message,
    });
  }
};

exports.deleteMenuGroup = async (req, res) => {
  try {
    const { menuGroupId } = req.params;

    const menuGroup = await MenuGroupMaster.findById(menuGroupId);
    if (!menuGroup) {
      return res.status(404).json({ isOk: false, message: "Menu Group not found" });
    }

    if (menuGroup.isActive) {
      // Soft Delete
      menuGroup.isActive = false;
      await menuGroup.save();
      return res.status(200).json({
        isOk: true,
        message: "Menu Group deactivated successfully",
        data: menuGroup,
      });
    } else {
      // Hard Delete
      await MenuGroupMaster.findByIdAndDelete(menuGroupId);
      return res.status(200).json({
        isOk: true,
        message: "Menu Group deleted successfully",
      });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error deleting menu group",
      error: error.message,
    });
  }
};

exports.listMenuGroupByParams = async (req, res) => {
  try {
    let { skip, per_page, sorton, sortdir, match, isActive } = req.body;

    // Build the initial match condition
    let matchCondition = {};
    if (isActive !== undefined && isActive !== null && isActive !== "") {
      matchCondition.isActive = isActive;
    }

    let query = [
      { $match: matchCondition },
      {
        $facet: {
          stage1: [{ $group: { _id: null, count: { $sum: 1 } } }],
          stage2: [{ $skip: skip || 0 }, { $limit: per_page || 10 }],
        },
      },
      { $unwind: "$stage1" },
      {
        $project: {
          count: "$stage1.count",
          data: "$stage2",
        },
      },
    ];

    if (match) {
      query = [
        {
          $match: {
            $or: [
              // Matched as plain text, so a "(" or "*" typed in can't break the search.
              { menuGroupName: { $regex: String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
            ],
          },
        },
      ].concat(query);
    }

    if (sorton && sortdir) {
      let sort = {};
      sort[sorton] = sortdir === "desc" ? -1 : 1;
      query = [{ $sort: sort }].concat(query);
    } else {
      query = [{ $sort: { createdAt: -1 } }].concat(query);
    }

    const list = await MenuGroupMaster.aggregate(query);

    return res.status(200).json({
      isOk: true,
      data: list,
      status: 200,
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      isOk: false,
      message: error.message,
      status: 500,
    });
  }
};