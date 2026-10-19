const mongoose = require('mongoose');
const { SUPPORT_STATUSES, SUPPORT_CATEGORIES } = require('../constants');

/* One reply on a ticket. Staff replies are flagged so the customer-facing
   thread can style them differently from their own messages. */
const replySchema = new mongoose.Schema({
  message:  { type: String, required: true, trim: true, maxlength: 4000 },
  byName:   { type: String, default: '' },
  byEmail:  { type: String, default: '' },
  fromStaff: { type: Boolean, default: false },
  at:       { type: Date, default: Date.now },
}, { _id: false });

/* A message from the contact form. Deliberately accepts submissions from
   signed-out visitors — `user` is filled in only when a session was present,
   which is what lets the customer see staff replies in their notifications. */
const supportTicketSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  name:    { type: String, required: true, trim: true, maxlength: 120 },
  email:   { type: String, required: true, trim: true, lowercase: true },
  phone:   { type: String, default: '', trim: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, enum: SUPPORT_CATEGORIES, default: 'other' },
  message: { type: String, required: true, trim: true, maxlength: 4000 },

  // Optional booking reference, so an admin can jump straight to the order.
  orderRef: { type: String, default: '', trim: true },

  status:  { type: String, enum: SUPPORT_STATUSES, default: 'open', index: true },
  replies: { type: [replySchema], default: [] },

  // Set the first time a member of staff answers, for a response-time stat.
  firstReplyAt: { type: Date },
}, { timestamps: true });

supportTicketSchema.index({ status: 1, createdAt: -1 });

/** Short, human-quotable ticket reference shown to the customer. */
supportTicketSchema.virtual('ref').get(function ref() {
  return `TKT-${String(this._id).slice(-6).toUpperCase()}`;
});

supportTicketSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
