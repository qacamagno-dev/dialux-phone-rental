const mongoose = require('mongoose');
const { ROLES, PICKUP_HUBS } = require('../constants');

/* Legacy single delivery profile. Kept because it is the shape the checkout
   routes and the frontend's currentProfile() have always read; it is now
   mirrored from whichever entry in `addresses` is the default, so old code
   and the new multi-address UI agree. */
const profileSchema = new mongoose.Schema({
  phone:   { type: String, default: '' },
  address: { type: String, default: '' },
  city:    { type: String, default: '' },
  zip:     { type: String, default: '' },
}, { _id: false });

/* One saved delivery address. A user may keep several; exactly one carries
   isDefault, and checkout preselects it. */
const addressSchema = new mongoose.Schema({
  label:     { type: String, default: 'Home', trim: true, maxlength: 40 },
  phone:     { type: String, default: '', trim: true },
  address:   { type: String, required: true, trim: true },
  city:      { type: String, default: '', trim: true },
  zip:       { type: String, default: '', trim: true },
  isDefault: { type: Boolean, default: false },
});

const riderDispatchSchema = new mongoose.Schema({
  homeHub: {
    type: String,
    enum: PICKUP_HUBS.map(h => h.id),
    default: 'cubao',
  },
  onDuty: { type: Boolean, default: false },
}, { _id: false });

// Subdocuments need a stable id for PATCH/DELETE /me/addresses/:addressId.
addressSchema.set('toJSON', {
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String },
  googleId: { type: String },
  avatar:   { type: String },
  role:     { type: String, enum: ROLES, default: 'user' },

  profile:   { type: profileSchema, default: () => ({}) },
  addresses: { type: [addressSchema], default: [] },
  riderDispatch: { type: riderDispatchSchema, default: () => ({}) },

  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

  resetTokenHash:    { type: String, select: false },
  resetTokenExpires: { type: Date, select: false },

  passwordChangedAt: { type: Date },
}, { timestamps: true });

userSchema.methods.syncDefaultAddress = function syncDefaultAddress() {
  if (!this.addresses.length) return this;

  let def = this.addresses.find(a => a.isDefault);
  if (!def) {
    def = this.addresses[0];
    def.isDefault = true;
  }

  this.addresses.forEach(a => {
    a.isDefault = a === def;
  });

  this.profile = {
    phone: def.phone || this.profile?.phone || '',
    address: def.address || '',
    city: def.city || '',
    zip: def.zip || '',
  };

  return this;
};

userSchema.methods.defaultAddress = function defaultAddress() {
  const def = this.addresses.find(a => a.isDefault) || this.addresses[0];

  if (def) return def;

  if (this.profile?.address) {
    return {
      label: 'Home',
      phone: this.profile.phone || '',
      address: this.profile.address,
      city: this.profile.city || '',
      zip: this.profile.zip || '',
      isDefault: true,
    };
  }

  return null;
};

userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;

    ret.hasPassword = Boolean(ret.password);

    delete ret.password;
    delete ret.resetTokenHash;
    delete ret.resetTokenExpires;

    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);