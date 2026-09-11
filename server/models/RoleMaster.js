const mongoose = require('mongoose');
const { slugify } = require('../utils/slugify');

const roleMasterSchema = new mongoose.Schema({
  roleName: {
    type: String,
    required: true,
    trim: true,
  },
  roleCode: {
    type: String,
    required: true,
    trim: true,
  },
  // URL-safe slug derived from roleCode. This becomes the first path
  // segment for anyone logged in with this role, e.g. roleCode "Manager"
  // -> roleSlug "manager" -> localhost/manager/dashboard.
  // Unique across ALL companies/roles since it doubles as a route prefix.
  roleSlug: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  remark: {
    type: String,
    trim: true,
    maxlength: 200,
  },
}, { timestamps: true });

roleMasterSchema.pre('validate', function (next) {
  if (this.roleCode) {
    this.roleSlug = slugify(this.roleCode);
  }
  next();
});

module.exports = mongoose.model('RoleMaster', roleMasterSchema);