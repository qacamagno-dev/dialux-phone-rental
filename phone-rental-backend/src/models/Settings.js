const mongoose = require('mongoose');
const { DEFAULT_SETTINGS, PAYMENT_METHODS } = require('../constants');

/* Sub-schema for the auto-progression timers — see
   services/orderProgressor.js for how these minute values get used.
   Declared separately (rather than Mixed) so an admin editing just
   `speed` or `enabled` can't accidentally corrupt the minute tables.

   Restoring this: this field existed in an earlier version of the app
   (the order-tracking feature) but was missing from this schema — Mongoose
   silently strips any field not declared here, so orderProgressor.js's
   `Settings.get().orderProgress` was always undefined, and the feature was
   quietly doing nothing. Fixed as part of this pass since Phase 2 already
   needed a Settings.js read for other reasons. */
const orderProgressSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: true },
  speed: { type: String, enum: ['fast', 'real'], default: 'fast' },
  fastMinutes: {
    preparing: { type: Number, default: DEFAULT_SETTINGS.orderProgress.fastMinutes.preparing, min: 0 },
    readyForPickup: { type: Number, default: DEFAULT_SETTINGS.orderProgress.fastMinutes.readyForPickup, min: 0 },
  },
  realMinutes: {
    preparing: { type: Number, default: DEFAULT_SETTINGS.orderProgress.realMinutes.preparing, min: 0 },
    readyForPickup: { type: Number, default: DEFAULT_SETTINGS.orderProgress.realMinutes.readyForPickup, min: 0 },
  },
}, { _id: false });

/* Platform-wide configuration. Exactly one document exists, pinned by
   `key: 'global'` and a unique index, so there is no way to end up with two
   competing settings rows.

   Anything that prices an order reads this rather than the constants module:
   constants.DEFAULT_SETTINGS is only the seed. */
const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true, immutable: true },

  brandName:      { type: String, default: DEFAULT_SETTINGS.brandName, trim: true },
  currencyCode:   { type: String, default: DEFAULT_SETTINGS.currencyCode, trim: true, uppercase: true },
  currencySymbol: { type: String, default: DEFAULT_SETTINGS.currencySymbol, trim: true },

  deliveryFee:           { type: Number, default: DEFAULT_SETTINGS.deliveryFee, min: 0 },
  // 0 disables free delivery entirely.
  freeDeliveryThreshold: { type: Number, default: DEFAULT_SETTINGS.freeDeliveryThreshold, min: 0 },
  // Optional damage cover, charged as this percentage of the rent subtotal.
  protectionFeePct:      { type: Number, default: DEFAULT_SETTINGS.protectionFeePct, min: 0, max: 100 },

  lowStockThreshold: { type: Number, default: DEFAULT_SETTINGS.lowStockThreshold, min: 0 },
  minRentalDays:     { type: Number, default: DEFAULT_SETTINGS.minRentalDays, min: 1 },
  maxRentalDays:     { type: Number, default: DEFAULT_SETTINGS.maxRentalDays, min: 1 },
  // Convenience fee for the meet-up order type. 0 disables it. Restoring
  // this too — same missing-field situation as orderProgress above.
  meetupFee:         { type: Number, default: DEFAULT_SETTINGS.meetupFee, min: 0 },
  // Phase 3: late-return penalty = daysOverdue × daily rate × this.
  overduePenaltyMultiplier: { type: Number, default: DEFAULT_SETTINGS.overduePenaltyMultiplier, min: 0 },

  orderProgress: { type: orderProgressSchema, default: () => ({}) },

  // Which of the simulated methods the checkout offers.
  paymentMethods: {
    type: [String],
    default: DEFAULT_SETTINGS.paymentMethods,
    validate: {
      validator: v => Array.isArray(v) && v.length > 0 && v.every(m => PAYMENT_METHODS.includes(m)),
      message: `paymentMethods must be a non-empty subset of: ${PAYMENT_METHODS.join(', ')}`,
    },
  },

  supportEmail:    { type: String, default: DEFAULT_SETTINGS.supportEmail, trim: true, lowercase: true },
  maintenanceMode: { type: Boolean, default: DEFAULT_SETTINGS.maintenanceMode },

  updatedByEmail: { type: String, default: '' },
}, { timestamps: true });

/* ---------------- read-through cache ----------------
   Settings are read on nearly every priced request but written maybe twice a
   year, so a short in-process cache removes a query per checkout without
   making an admin wait for a restart to see their change.
--------------------------------------------------------- */

const CACHE_MS = 30_000;
let cached = null;
let cachedAt = 0;

/**
 * The live settings document, creating it from the defaults on first call.
 * Cached for 30 seconds; save()/update through Settings.put() busts it.
 */
settingsSchema.statics.get = async function get({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });

  cached = doc;
  cachedAt = Date.now();
  return doc;
};

/** Drop the cache — call after any write. */
settingsSchema.statics.bust = function bust() {
  cached = null;
  cachedAt = 0;
};

settingsSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    delete ret.key;
    return ret;
  },
});

module.exports = mongoose.model('Settings', settingsSchema);