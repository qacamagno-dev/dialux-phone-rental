const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../constants');

/* An in-app alert for one user. Written by the server whenever something
   happens to that customer's booking, account or support ticket — there is
   no mail transport in the default setup, so this is the delivery channel
   the customer actually sees (the bell in the header).

   Notifications are disposable: they carry a copy of the message rather than
   a reference, so deleting the order that produced one is harmless. */
const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type:    { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
  title:   { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, default: '', maxlength: 500 },

  // Where clicking the notification should land, e.g. "/order.html?id=…".
  link:    { type: String, default: '' },

  read:   { type: Boolean, default: false },
  readAt: { type: Date },
}, { timestamps: true });

// The bell only ever asks for "my notifications, newest first".
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });

notificationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Notification', notificationSchema);
