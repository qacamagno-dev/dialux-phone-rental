const mongoose = require('mongoose');
const { PAGE_SLUGS } = require('../constants');

/* A block of copy inside a CMS page. Kept deliberately simple — a heading
   and a body — so the admin editor is a pair of text fields per block and
   the rendered output needs no HTML sanitiser beyond escaping. */
const sectionSchema = new mongoose.Schema({
  heading: { type: String, default: '', trim: true, maxlength: 160 },
  body:    { type: String, default: '', maxlength: 8000 },
}, { _id: false });

/* Editable content for one of the six static pages. The HTML shells stay in
   the repository; a document here overrides the copy inside them. When no
   document exists the route serves the defaults from data/pageDefaults.js,
   so the editor is never blank and the site never loses its text. */
const pageSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    enum: PAGE_SLUGS,
  },
  title:    { type: String, required: true, trim: true, maxlength: 160 },
  intro:    { type: String, default: '', maxlength: 1000 },
  sections: { type: [sectionSchema], default: [] },

  // Shown on the page footer so visitors can see how current the copy is.
  published: { type: Boolean, default: true },

  updatedByEmail: { type: String, default: '' },
}, { timestamps: true });

pageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id ? ret._id.toString() : ret.slug;
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Page', pageSchema);
