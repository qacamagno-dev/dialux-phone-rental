const mongoose = require('mongoose');

/* A product review, written only by a customer who actually rented the
   device (enforced in the route). One review per user per product; a repeat
   submission updates the existing one rather than adding a duplicate. */
const reviewSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, default: '' },
  rating:   { type: Number, required: true, min: 1, max: 5 },
  comment:  { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

// One review per user per product.
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

reviewSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Review', reviewSchema);
