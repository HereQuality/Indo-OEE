const mongoose = require("mongoose");

const OperatorRolesSchema = new mongoose.Schema(
  {
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoleMaster",
      required: true,
    },
    roles: {
      type: [
        {
          menuId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MenuMaster",
            required: false,
            default: null,
          },
          menuGroupId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MenuGroupMaster",
            required: false,
            default: null,
          },
          // 4-flag RBAC model:
          // view   → can open/see the page
          // create → can add new records on this page
          // edit   → can modify existing records
          // delete → can remove records
          view: {
            type: Boolean,
            default: false,
          },
          create: {
            type: Boolean,
            default: false,
          },
          edit: {
            type: Boolean,
            default: false,
          },
          delete: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, collection: "employeeroles" },
);

// One permission set per role
OperatorRolesSchema.index({ roleId: 1 }, { unique: true });

module.exports = mongoose.model("OperatorRoles", OperatorRolesSchema);
