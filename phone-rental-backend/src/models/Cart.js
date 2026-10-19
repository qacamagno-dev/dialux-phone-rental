const mongoose = require('mongoose');
const { PLANS } = require('../constants');

/* One cart per user. Guests keep their cart in localStorage and it is
   merged into this document on sign-in. */
const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: {
    type: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
      plan:    { type: String, enum: PLANS, default: 'Weekly' },
      qty:     { type: Number, min: 1, default: 1 },
      _id:     false,
    }],
    default: [],
  },

  // The rental window that prices the whole cart. Optional until the
  // customer picks dates; serializeCart falls back to a 7-day estimate.
  startDate: { type: String, default: '' },   // YYYY-MM-DD
  endDate:   { type: String, default: '' },

  // Optional damage cover. Remembered on the cart so the choice survives a
  // reload and carries into checkout.
  protection: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Cart', cartSchema);
