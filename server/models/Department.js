const mongoose = require("mongoose");

const DepartmentSchema = new mongoose.Schema(
  {
    departmentName: {
      type: String,
      required: true,
      trim: true,
    },
    departmentCode: {
      type: String,
      required: false,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    remark: {
      type: String,
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Department", DepartmentSchema);
