const mongoose = require('mongoose');
const { CATEGORIES, PLANS, ORDER_STATUSES, ORDER_TYPES, PAYMENT_METHODS, PAYMENT_STATUSES } = require('../constants');

/* Line items snapshot the name, rate and deposit at booking time so
   later catalog price changes never rewrite order history. */
const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name:    { type: String, required: true },
  cat:     { type: String, enum: CATEGORIES },
  image:   { type: String, default: '' },
  plan:    { type: String, enum: PLANS, required: true },
  qty:     { type: Number, required: true, min: 1 },
  rate:    { type: Number, required: true, min: 0 },
  deposit: { type: Number, required: true, min: 0 },
}, { _id: false });

/* Payment record. For gcash/maya/card this mirrors a PayMongo Checkout
   Session (routes/payments.js); for cash and bank-transfer there is no
   gateway involved and these fields are filled in by hand (or by the
   simulated fallback when no PAYMONGO_SECRET_KEY is configured).

   `status` is the source of truth for whether money has actually moved;
   the top-level `paid`/`paidAt` on the order are kept in lockstep for
   backward compatibility with code written against the old simulated
   flow (e.g. the return/refund eligibility checks below). */
const paymentSchema = new mongoose.Schema({
  gateway:     { type: String, default: 'paymongo' },        // 'paymongo' | 'manual' (cash/bank-transfer)
  method:      { type: String, enum: PAYMENT_METHODS },
  intentId:    { type: String, default: '' },                 // PayMongo checkout_session id (cs_...)
  status:      { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
  paidAt:      { type: Date },
  referenceNo: { type: String, default: '' },                  // customer-facing receipt number
  proofUrl:    { type: String, default: '' },                  // bank-transfer proof of payment
  verifiedByEmail: { type: String, default: '' },               // admin who verified a bank transfer
  failReason:  { type: String, default: '' },
}, { _id: false, timestamps: false });

/* Deposit refund, written by an administrator closing out a return. Also
   simulated — it records the decision, it does not move money. */
const refundSchema = new mongoose.Schema({
  amount:    { type: Number, min: 0 },
  method:    { type: String },
  ref:       { type: String },
  note:      { type: String, default: '' },
  deducted:  { type: Number, min: 0, default: 0 },   // total withheld (late penalty + damage)
  // Phase 3 breakdown, so the customer and the reports can see why.
  deposit:        { type: Number, min: 0 },
  overdueDays:    { type: Number, min: 0, default: 0 },
  overduePenalty: { type: Number, min: 0, default: 0 },
  damageCharge:   { type: Number, min: 0, default: 0 },
  shortfall:      { type: Number, min: 0, default: 0 },  // damage beyond what the deposit covered
  at:        { type: Date, default: Date.now },
  byEmail:   { type: String, default: '' },
}, { _id: false });

/* Phase 3: result of the technician's inspection of a returned device. */
const inspectionSchema = new mongoose.Schema({
  passed:       { type: Boolean, required: true },
  checklist: {
    screen:  { type: Boolean, default: true },
    body:    { type: Boolean, default: true },
    ports:   { type: Boolean, default: true },
    camera:  { type: Boolean, default: true },
    battery: { type: Boolean, default: true },
  },
  notes:        { type: String, default: '', maxlength: 2000 },
  damageCharge: { type: Number, min: 0, default: 0 },
  photos:       { type: [String], default: [] },
  byEmail:      { type: String, default: '' },
  at:           { type: Date, default: Date.now },
}, { _id: false });

/* Phase 3: customer answered "No" to "did you receive it as described?". */
const disputeSchema = new mongoose.Schema({
  reason:  { type: String, required: true, maxlength: 200 },
  details: { type: String, default: '', maxlength: 2000 },
  photos:  { type: [String], default: [] },
  at:      { type: Date, default: Date.now },
}, { _id: false });

/* Phase 3: how and when the customer is giving the device back. */
const returnPlanSchema = new mongoose.Schema({
  method: { type: String, enum: ['rider', 'hub'], required: true },
  date:   { type: String, default: '' },        // YYYY-MM-DD
  slot:   { type: String, default: '' },
  hub:    { type: String, default: '' },        // hub id when method === 'hub'
}, { _id: false });

const orderSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userEmail: { type: String, required: true },
  userName:  { type: String, default: '' },

  items: { type: [orderItemSchema], required: true, validate: v => v.length > 0 },

  rent:       { type: Number, required: true, min: 0 },
  deposit:    { type: Number, required: true, min: 0 },
  delivery:   { type: Number, required: true, min: 0 },
  // Optional damage cover, priced as a percentage of rent at booking time.
  protection:    { type: Boolean, default: false },
  protectionFee: { type: Number, min: 0, default: 0 },
  total:      { type: Number, required: true, min: 0 },

  // How the customer receives the device. `address` is always populated
  // (the delivery address, the hub's address, or "Meet-up: <location>") so
  // existing UI that just reads order.address keeps working regardless of
  // orderType; the three fields below carry the order-type-specific detail.
  orderType:      { type: String, enum: ORDER_TYPES, required: true, default: 'delivery' },
  pickupHub:      { type: String, default: '' },    // one of constants.PICKUP_HUBS ids, when orderType === 'pickup'
  meetupLocation: { type: String, default: '' },    // free text, when orderType === 'meetup'
  timeSlot:       { type: String, default: '' },    // free text / "HH:MM–HH:MM", for pickup and meetup

  address:   { type: String, required: true },
  phone:     { type: String, default: '' },
  startDate: { type: String, required: true },   // YYYY-MM-DD
  endDate:   { type: String, required: true },
  days:      { type: Number, min: 1, default: 1 },

  status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },

  // Rider/delivery system (Phase 2). `deliveryJob` is the outbound leg,
  // `returnDeliveryJob` the return leg (Phase 3) — an order may have one of
  // each, never more; see models/Delivery.js's unique (order, type) index.
  // Both are nullable: a pickup-hub order never gets either, since the
  // customer does the travelling themselves both ways.
  //
  // NOTE: the outbound link is NOT called `delivery`. That name already
  // holds the delivery FEE (a Number, declared above and read by invoices,
  // reports and the admin screen). A second `delivery` key in this schema
  // silently replaced the fee with an ObjectId, so every order failed to
  // save with "Cast to ObjectId failed for value 150 at path delivery".
  rider:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliveryJob:     { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },
  returnDeliveryJob: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery' },

  // Set by a rider closing out a cash-on-delivery handover — distinct from
  // payment.status, which is the source of truth for whether the customer
  // chose COD at all; this just confirms the cash physically changed hands.
  cashCollected:       { type: Boolean, default: false },
  proofOfDeliveryUrl:  { type: String, default: '' },
  proofOfReturnUrl:    { type: String, default: '' },

  // receivedAt (Phase 3): when the customer confirmed receipt — this, not
  // the delivery timestamp, is what the rental clock actually starts from.
  receivedAt: { type: Date },
  returnedAt: { type: Date },

  // `paid` flips true once payment.status reaches 'paid' — via a PayMongo
  // webhook, an admin verifying a bank transfer, or (local dev only, no
  // PAYMONGO_SECRET_KEY configured) the simulated payment fallback. Kept
  // alongside payment.status rather than replaced by it, since several
  // older routes (refund eligibility, the review gate) already read it.
  paid:    { type: Boolean, default: false },
  paidAt:  { type: Date },
  payment: { type: paymentSchema, default: undefined },

  // Return / inspection / refund workflow.
  returnNote:      { type: String, default: '' },
  inspectionNote:  { type: String, default: '' },
  refund:          { type: refundSchema, default: undefined },
  depositReturned: { type: Boolean, default: false },
  // Set once each so the return reminders (services/orderProgressor.js) are never re-sent.
  returnReminderAt:  { type: Date },
  overdueNotifiedAt: { type: Date },
  inspection:      { type: inspectionSchema, default: undefined },
  dispute:         { type: disputeSchema, default: undefined },
  returnPlan:      { type: returnPlanSchema, default: undefined },

  statusHistory: {
    type: [{
      status: { type: String, enum: ORDER_STATUSES },
      at:     { type: Date, default: Date.now },
      note:   { type: String, default: '' },
      byEmail: { type: String, default: '' },
      _id:    false,
    }],
    default: [],
  },

  // Set once stock has been returned to the catalog, so a cancel
  // followed by another cancel can't double-restock.
  stockReleased: { type: Boolean, default: false },
}, { timestamps: true });

/** Human-facing invoice number, derived from the id so it never collides. */
orderSchema.virtual('invoiceNo').get(function invoiceNo() {
  return `DLX-${String(this._id).slice(-8).toUpperCase()}`;
});

orderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Order', orderSchema);