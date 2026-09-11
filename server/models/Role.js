const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
  },
  permissions: [{
    type: String,
    // Examples: 'view_inventory', 'edit_inventory', 'approve_requisition'
  }]
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);
