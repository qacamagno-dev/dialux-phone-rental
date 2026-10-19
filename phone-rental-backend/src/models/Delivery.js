const mongoose = require('mongoose');
const { DELIVERY_TYPES, DELIVERY_STATUSES } = require('../constants');

/* One checkpoint in a delivery's life — a rider tapping "Picked up", "On
   the way", etc, or the system creating the very first "unassigned" one.
   lat/lng are optional: this project has no live GPS integration, so a
   rider's device would need to supply them (e.g. from the browser's own
   geolocation API) for a checkpoint to carry a real location at all. */
const checkpointSchema = new mongoose.Schema({
  status: { type: String, enum: DELIVERY_STATUSES, required: true },
  at:     { type: Date, default: Date.now },
  lat:    { type: Number },
  lng:    { type: Number },
  note:   { type: String, default: '', trim: true, maxlength: 500 },
}, { _id: false });

/* A physical leg of an order's journey: the outbound delivery, or the
   return pickup. An order can have at most one of each (see the partial
   unique index below) — a failed delivery is recorded as a 'failed'
   checkpoint on the SAME document, not a new one, so its history isn't
   split across records. */
const deliverySchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // 'delivery' = outbound to the customer, 'pickup' = outbound to a hub
  // (kept distinct from 'delivery' even though pickup-hub orders currently
  // never get a rider assigned — see routes/orders.js's assign-rider route
  // — so the type is still meaningful if that ever changes), 'return' =
  // picking the device back up from the customer.
  type: { type: String, enum: DELIVERY_TYPES, required: true },

  status: { type: String, enum: DELIVERY_STATUSES, default: 'unassigned', index: true },

  checkpoints: { type: [checkpointSchema], default: [] },

  // Captured when a rider closes out a successful handover.
  proofUrl:      { type: String, default: '' },   // photo of the handover
  signature:     { type: String, default: '' },   // base64 signature, or a typed name
  recipientName: { type: String, default: '', trim: true },
  cashCollected: { type: Number, min: 0 },         // COD amount actually collected

  scheduledAt: { type: Date },
  completedAt: { type: Date },
}, { timestamps: true });

// One delivery per (order, type) — an order can't have two outbound
// deliveries, but CAN have one outbound and one separate return delivery.
deliverySchema.index({ order: 1, type: 1 }, { unique: true });

/** Append a checkpoint and keep `status` as the single source of truth for "where is it now". */
deliverySchema.methods.addCheckpoint = function addCheckpoint({ status, note = '', lat, lng }) {
  this.checkpoints.push({ status, note, lat, lng, at: new Date() });
  this.status = status;
  if (status === 'delivered' || status === 'failed') this.completedAt = new Date();
  return this;
};

deliverySchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Delivery', deliverySchema);