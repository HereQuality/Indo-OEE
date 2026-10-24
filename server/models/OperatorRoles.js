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
    // "Full access" — ticked in Manage Role. Lets the role's people do the admin
    // things: review OEE entries over 100%, unlock a locked entry for 24 hours
    // and change a process's Operator Planned Shift (see utils/adminAccess.js).
    // Absent = never ticked or unticked, which is why it has no default: a role
    // coded "admin" from before this checkbox existed keeps its access until
    // someone saves the box explicitly.
    fullAccess: { type: Boolean, default: undefined },
  },
  { timestamps: true, collection: "employeeroles" },
);

// One permission set per role
OperatorRolesSchema.index({ roleId: 1 }, { unique: true });

module.exports = mongoose.model("OperatorRoles", OperatorRolesSchema);
