const mongoose = require('mongoose');

/* An append-only record of every privileged action.
   Written by services/audit.js, never edited or deleted through the API —
   an audit trail that can be rewritten is not an audit trail. */
const auditLogSchema = new mongoose.Schema({
  // Who did it. The email is denormalized so the log stays readable after
  // the account is deleted.
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userEmail: { type: String, default: '', index: true },
  userName:  { type: String, default: '' },

  // What they did, as a stable dotted verb: "product.update", "order.status",
  // "user.role", "settings.update", "page.update", "support.status".
  action: { type: String, required: true, index: true },

  // What they did it to.
  targetType:  { type: String, default: '' },   // Product | Order | User | …
  targetId:    { type: String, default: '' },
  targetLabel: { type: String, default: '' },   // human name at the time

  // Free-form before/after or payload detail. Mixed on purpose: the shape
  // differs per action and this is only ever read by a human.
  details: { type: mongoose.Schema.Types.Mixed, default: {} },

  ip: { type: String, default: '' },
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
