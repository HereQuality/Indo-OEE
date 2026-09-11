const mongoose = require("mongoose");

const TeamSchema = new mongoose.Schema(
  {
    teamName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    // Not required — a team can exist before a lead is assigned. Set
    // directly from the team create/edit form (TeamsBoard.jsx); "Manager
    // change" on a member's profile popup is separate — that's their
    // personal reportingManagerIds on the Operator record, not this field.
    teamLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Operator",
      required: false,
    },
    memberIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Operator",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    remark: {
      type: String,
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Team", TeamSchema);
