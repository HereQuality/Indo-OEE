const MenuMaster = require("../models/MenuMaster");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const OperatorRoles = require("../models/OperatorRoles");

exports.createMenuMaster = async (req, res) => {
  try {
    const { menuName, menuGroup, menuUrl, sequence, isActive, isParent, parentMenu, icon } = req.body;
    console.log("Received createMenuMaster data:", req.body);

    const menuMaster = await MenuMaster.create({
      menuName,
      menuGroup,
      menuUrl,
      sequence,
      isActive,
      isParent: isParent || false,
      parentMenu: parentMenu || null,
      icon: icon || "",
    });

    res.status(201).json({
      isOk: true,
      message: "Menu master created successfully",
      data: menuMaster,
    });
  } catch (error) {
    console.log("Error in createMenuMaster:", error);
    res.status(500).json({
      isOk: false,
      message: "Error creating menu master",
      error: error.message,
    });
  }
};

exports.getAllMenuMasters = async (req, res) => {
  try {
    const menuMasters = await MenuMaster.find({ isActive: true }).lean();
    res.status(200).json({
      isOk: true,
      message: "Menu masters fetched successfully",
      data: menuMasters,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching menu masters",
      error: error.message,
    });
  }
};

exports.updateMenuMaster = async (req, res) => {
  try {
    const { menuMasterId } = req.params;
    const { menuName, menuGroup, menuUrl, sequence, isActive, isParent, parentMenu, icon } = req.body;
    console.log("Received updateMenuMaster data:", req.body);

    const menuMaster = await MenuMaster.findByIdAndUpdate(
      menuMasterId,
      {
        menuName,
        menuGroup,
        menuUrl,
        sequence,
        isActive,
        isParent: isParent || false,
        parentMenu: parentMenu || null,
        icon: icon || "",
      },
      { new: true }
    );

    res.status(200).json({
      isOk: true,
      message: "Menu master updated successfully",
      data: menuMaster,
    });
  } catch (error) {
    console.log("Error in updateMenuMaster:", error);
    res.status(500).json({
      isOk: false,
      message: "Error updating menu master",
      error: error.message,
    });
  }
};

exports.deleteMenuMaster = async (req, res) => {
  try {
    const { menuMasterId } = req.params;
    console.log("Deleting menu master with ID:", menuMasterId);

    const menuMaster = await MenuMaster.findById(menuMasterId);
    if (!menuMaster) {
      return res.status(404).json({ isOk: false, message: "Menu master not found" });
    }

    if (menuMaster.isActive) {
      // Soft Delete
      menuMaster.isActive = false;
      await menuMaster.save();
      return res.status(200).json({
        isOk: true,
        message: "Menu master deactivated successfully",
        data: menuMaster,
      });
    } else {
      // Hard Delete
      await MenuMaster.findByIdAndDelete(menuMasterId);
      return res.status(200).json({
        isOk: true,
        message: "Menu master deleted successfully",
      });
    }
  } catch (error) {
    console.log("Error in deleteMenuMaster:", error);
    res.status(500).json({
      isOk: false,
      message: "Error deleting menu master",
      error: error.message,
    });
  }
};

exports.getMenuMasterById = async (req, res) => {
  try {
    const { menuMasterId } = req.params;
    const menuMaster = await MenuMaster.findById(menuMasterId).populate("menuGroup").lean();
    res.status(200).json({
      isOk: true,
      message: "Menu master fetched successfully",
      data: menuMaster,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching menu master",
      error: error.message,
    });
  }
};

exports.listMenuMasterByParams = async (req, res) => {
  try {
    let { skip, per_page, sorton, sortdir, match, isActive } = req.body;

    let matchCondition = {};
    if (isActive !== undefined && isActive !== null && isActive !== "") {
      matchCondition.isActive = isActive;
    }

    let query = [
      { $match: matchCondition },
      {
        $lookup: {
          from: "menugroupmasters",
          localField: "menuGroup",
          foreignField: "_id",
          as: "menuGroup",
        },
      },
      {
        $unwind: {
          path: "$menuGroup",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          menuName: 1,
          menuGroup: "$menuGroup.menuGroupName",
          menuUrl: 1,
          sequence: 1,
          isActive: 1,
          icon: 1,
        },
      },
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
              { menuName: { $regex: match, $options: "i" } },
              { menuGroup: { $regex: match, $options: "i" } },
              { menuUrl: { $regex: match, $options: "i" } },
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

    const list = await MenuMaster.aggregate(query);

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

exports.getMenuByGroups = async (req, res) => {
  try {
    // SuperAdmin authors the global menu tree, so they always see
    // everything (that's what the Menu Master / Menu Group screens
    // manage). An Operator only sees the subset of menus/menu-groups
    // their specific Role has been explicitly granted "read" access to
    // (Operator Management > Manage Role). If an Operator's role has no
    // permissions configured yet, they see nothing — safer default than
    // silently showing everything.
    let allowedMenuIds = null; // null = no restriction (SuperAdmin)
    let readableGroupIds = null; // null = no restriction (non-Operator)

    if (req.user && req.user.roleType === "Operator" && req.user.roleId) {
      const roleDoc = await OperatorRoles.findOne({
        roleId: req.user.roleId,
        isActive: true,
      });

      const readableMenuIds = new Set();
      readableGroupIds = new Set();
      (roleDoc?.roles || []).forEach((perm) => {
        if (perm.view && perm.menuId) readableMenuIds.add(perm.menuId.toString());
        if (perm.view && perm.menuGroupId) readableGroupIds.add(perm.menuGroupId.toString());
      });

      allowedMenuIds = readableMenuIds;
    }

    const isAllowed = (menuId) => !allowedMenuIds || allowedMenuIds.has(menuId.toString());
    const isGroupAllowed = (groupId) => !readableGroupIds || readableGroupIds.has(groupId.toString());

    // Which portal is this request for? SuperAdmin only ever browses the
    // SuperAdmin portal; every Operator (whatever role they were given,
    // including a client's own top "Admin" role) is in the Operator
    // portal. A group only shows up if it's scoped to that portal (or to
    // "Both") — that's what separates the two sidebars; the Manage Role
    // filter above only limits *which* menus within a group an
    // individual role can see, not which groups exist in each portal.
    const currentPortal = req.user && req.user.roleType !== "SuperAdmin" ? "Operator" : "SuperAdmin";
    const isInPortal = (group) => {
      const groupPortal = group.portal || "Both"; // treat missing/null/"" as unrestricted
      return groupPortal === "Both" || groupPortal === currentPortal;
    };

    const menuGroups = (await MenuGroupMaster.find({ isActive: true }).sort({ sequence: 1 }).lean())
      .filter(isInPortal);
    const result = [];

    const buildMenuTree = async (parentId = null) => {
      const menus = await MenuMaster.find({
        parentMenu: parentId,
        isActive: true,
      }).sort({ sequence: 1 }).lean();

      const menuItems = [];
      for (const menu of menus) {
        const hasChildren = await MenuMaster.exists({
          parentMenu: menu._id,
          isActive: true,
        });

        const children = hasChildren ? await buildMenuTree(menu._id) : [];

        // Keep this item if it's directly authorized, or if it has at
        // least one authorized descendant (so parent items stay visible
        // when only some of their children are granted to the role).
        if (!isAllowed(menu._id) && children.length === 0) {
          continue;
        }

        const menuItem = {
          id: menu._id,
          name: menu.menuName,
          url: menu.menuUrl || "#",
          sequence: menu.sequence,
          isParent: !!hasChildren,
          icon: menu.icon,
        };

        if (hasChildren) {
          menuItem.children = children;
        }
        menuItems.push(menuItem);
      }
      return menuItems;
    };

    for (const group of menuGroups) {
      if (group.isLink) {
        // Direct-link groups (e.g. "Dashboard") are core navigation and
        // always visible to SuperAdmin, but for an Operator they're
        // gated by Manage Role just like any other menu item — only
        // shown if their role was explicitly granted read access to
        // this group via its menuGroupId.
        if (!isGroupAllowed(group._id)) {
          continue;
        }
        result.push({
          groupId: group._id,
          groupName: group.menuGroupName,
          sequence: group.sequence,
          isLink: true,
          url: group.menuUrl,
          icon: group.icon,
          menus: [],
        });
        continue;
      }

      const topLevelMenus = await MenuMaster.find({
        menuGroup: group._id,
        isActive: true,
        $or: [{ parentMenu: null }, { parentMenu: { $exists: false } }],
      }).sort({ sequence: 1 }).lean();

      const processedMenus = [];
      for (const menu of topLevelMenus) {
        const hasChildren = await MenuMaster.exists({
          parentMenu: menu._id,
          isActive: true,
        });

        const children = hasChildren ? await buildMenuTree(menu._id) : [];

        if (!isAllowed(menu._id) && children.length === 0) {
          continue;
        }

        const menuItem = {
          id: menu._id,
          name: menu.menuName,
          url: menu.menuUrl,
          sequence: menu.sequence,
          isParent: !!hasChildren,
          icon: menu.icon,
        };

        if (hasChildren) {
          menuItem.children = children;
        }
        processedMenus.push(menuItem);
      }

      // Drop the whole group once filtered down to nothing — an empty
      // "Operator Management" heading with no visible items underneath
      // would be confusing in the sidebar.
      if (processedMenus.length > 0) {
        result.push({
          groupId: group._id,
          groupName: group.menuGroupName,
          sequence: group.sequence,
          isLink: false,
          icon: group.icon,
          menus: processedMenus,
        });
      }
    }
    res.status(200).json({
      isOk: true,
      message: "Menus by groups fetched successfully",
      data: result,
    });
  } catch (error) {
    console.log("Error in getMenuByGroups:", error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching menus by groups",
      error: error.message,
    });
  }
};
exports.getMenuTest = async (req, res) => {
  try {
    const testData = [
      {
        groupId: "1",
        groupName: "Test Group 1",
        sequence: 1,
        menus: [
          {
            id: "1",
            name: "Test Menu 1",
            url: "/test1",
            sequence: 1,
          },
        ],
      },
    ];
    res.status(200).json({
      isOk: true,
      message: "Test menus fetched successfully",
      data: testData,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      isOk: false,
      message: "Error fetching test menus",
      error: error.message,
    });
  }
};
