const mongoose = require("mongoose");

const MenuGroupMasterSchema = new mongoose.Schema(
  {
    menuGroupName: {
      type: String,
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    isLink: {
      type: Boolean,
      default: false,
    },
    menuUrl: {
      type: String,
      default: "#",
    },

    // Which portal this group belongs to. This is what getMenuByGroups
    // uses to split the SuperAdmin sidebar from the Operator sidebar.
    // Without this field on the schema, any "portal" value sent from the
    // create/update controllers or the admin UI form was silently dropped
    // by Mongoose, and every group fell back to "Both" — which is exactly
    // why groups meant for one portal were leaking into the other.
    portal: {
      type: String,
      enum: ["SuperAdmin", "Operator", "Both"],
      default: "Both",
    },
    icon: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MenuGroupMaster", MenuGroupMasterSchema);