const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  favicon: {
    type: String,
  },
  logo: {
    type: String,
  },

  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active',
  },
  plan: {
    type: String,
    default: 'Basic'
  },
  menus: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuMaster'
  }],
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
