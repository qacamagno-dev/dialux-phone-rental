const mongoose = require('mongoose');
const { CATEGORIES, GRADES } = require('../constants');

const productSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  brand: { type: String, required: true, trim: true },
  cat:   { type: String, required: true, enum: CATEGORIES },
  grade: { type: String, required: true, enum: GRADES, default: 'Good' },

  // Rental rates in pesos.
  daily:   { type: Number, required: true, min: 0 },
  weekly:  { type: Number, required: true, min: 0 },
  monthly: { type: Number, required: true, min: 0 },

  deposit: { type: Number, required: true, min: 0 },
  stock:   { type: Number, required: true, min: 0, default: 0 },

  desc:     { type: String, default: '' },
  specs:    { type: Map, of: String, default: {} },
  included: { type: [String], default: [] },

  // `image` is the primary square photo and stays for backward compatibility.
  // `images` is the 1:1 gallery shown on the detail view; toJSON below
  // guarantees callers can always read `images` as a populated array.
  image:  { type: String, default: '' },
  images: { type: [String], default: [] },

  // Landscape (~16:9) crop used on catalog cards, where the frame is wide and
  // a square photo would get cropped top and bottom. Optional — the card
  // falls back to `image` when a device has no wide shot.
  cardImage: { type: String, default: '' },

  // Denormalized review aggregates, recomputed whenever a review is written.
  avgRating:   { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },

  // Soft delete: keeps historical orders readable after a device is
  // pulled from the catalog.
  active: { type: Boolean, default: true },
}, { timestamps: true });

productSchema.index({ cat: 1, brand: 1 });
productSchema.index({ name: 'text', desc: 'text' });

/**
 * Keep `image` and `images` consistent no matter which one a writer set.
 * Runs on save(); the toJSON transform below covers the read side, including
 * documents written through findOneAndUpdate.
 */
function normalizeGallery(doc) {
  if (!doc) return;
  const gallery = Array.isArray(doc.images) ? doc.images.filter(Boolean) : [];
  if (!gallery.length && doc.image) gallery.push(doc.image);
  if (!doc.image && gallery.length) doc.image = gallery[0];
  doc.images = [...new Set(gallery)];
}

// Mongoose 9 removed callback-style middleware: a hook takes no `next` and is
// either synchronous or returns a promise. Taking a `next` parameter here
// threw "next is not a function" on every product write.
productSchema.pre('save', function preSave() {
  normalizeGallery(this);
});

// Expose `id` and drop __v so the frontend keeps using a single `id` field
// instead of _id, and hand back a gallery that is never empty when there is
// at least one photo.
productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;

    const gallery = Array.isArray(ret.images) ? ret.images.filter(Boolean) : [];
    if (!gallery.length && ret.image) gallery.push(ret.image);
    ret.images = gallery;
    if (!ret.image && gallery.length) ret.image = gallery[0];

    return ret;
  },
});

module.exports = mongoose.model('Product', productSchema);
