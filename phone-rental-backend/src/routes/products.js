const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Order = require('../models/Order');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const { audit, diff } = require('../services/audit');
const { alertLowStock } = require('../services/stockAlert');
const { CATEGORIES, GRADES, QUALIFYING_REVIEW_STATUSES } = require('../constants');

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Gallery images are hotlinked, so only http(s) and protocol-relative URLs are
// accepted — a "javascript:" or "data:" value would be rendered into an <img>
// src on the detail page.
const SAFE_URL = /^(https?:\/\/|\/\/|\/)[^\s"'<>]+$/i;

const MAX_GALLERY = 8;

/** Recompute a product's denormalized rating aggregates from its reviews. */
async function refreshProductRating(productId) {
  const [agg] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const avgRating = agg ? Math.round(agg.avg * 10) / 10 : 0;
  const reviewCount = agg ? agg.count : 0;
  await Product.updateOne({ _id: productId }, { $set: { avgRating, reviewCount } });
  return { avgRating, reviewCount };
}

/**
 * Accept a gallery from either a real array or the newline/comma separated
 * text the admin form produces. Invalid and duplicate URLs are dropped rather
 * than rejected, so one bad paste doesn't lose the whole edit.
 */
function parseGallery(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/);

  const clean = raw
    .map(v => String(v).trim())
    .filter(Boolean)
    .filter(v => SAFE_URL.test(v));

  return [...new Set(clean)].slice(0, MAX_GALLERY);
}

/** Pull only the writable product fields off a request body. */
function pickProductFields(body) {
  const out = {};
  const strings = ['name', 'brand', 'cat', 'grade', 'desc', 'image', 'cardImage'];
  const numbers = ['daily', 'weekly', 'monthly', 'deposit', 'stock'];

  strings.forEach(k => { if (body[k] !== undefined) out[k] = String(body[k]).trim(); });
  numbers.forEach(k => {
    if (body[k] === undefined) return;
    const n = Number(body[k]);
    if (Number.isFinite(n)) out[k] = Math.max(0, Math.round(n));
  });

  if (body.specs && typeof body.specs === 'object') out.specs = body.specs;
  if (Array.isArray(body.included)) out.included = body.included.map(String);

  if (body.images !== undefined) out.images = parseGallery(body.images);

  // Keep the primary photo and the gallery consistent whichever one was sent,
  // matching the same normalisation the model does on save.
  if (out.images?.length && !out.image) out.image = out.images[0];
  if (out.image && SAFE_URL.test(out.image)) {
    if (out.images && !out.images.includes(out.image)) out.images.unshift(out.image);
  } else if (out.image && !SAFE_URL.test(out.image)) {
    out.image = '';
  }
  if (out.images) out.images = out.images.slice(0, MAX_GALLERY);

  // The wide card photo is standalone: it never joins the 1:1 detail gallery.
  // An unsafe value is dropped rather than rejected so the rest of the edit
  // still lands, and clearing the box on purpose still works.
  if (out.cardImage && !SAFE_URL.test(out.cardImage)) out.cardImage = '';

  if (body.active !== undefined) out.active = Boolean(body.active);

  return out;
}

function validateProduct(fields, { partial = false } = {}) {
  const errors = [];
  const need = (k) => !partial || fields[k] !== undefined;

  if (need('name')  && !fields.name)  errors.push('name is required');
  if (need('brand') && !fields.brand) errors.push('brand is required');
  if (fields.cat   !== undefined && !CATEGORIES.includes(fields.cat)) errors.push(`cat must be one of: ${CATEGORIES.join(', ')}`);
  if (fields.grade !== undefined && !GRADES.includes(fields.grade))   errors.push(`grade must be one of: ${GRADES.join(', ')}`);

  ['daily', 'weekly', 'monthly', 'deposit'].forEach(k => {
    if (need(k) && fields[k] === undefined) errors.push(`${k} is required`);
  });

  return errors;
}

/** The subset of a product worth recording in the audit trail. */
const auditSnapshot = (p) => ({
  name: p.name, brand: p.brand, cat: p.cat, grade: p.grade,
  daily: p.daily, weekly: p.weekly, monthly: p.monthly,
  deposit: p.deposit, stock: p.stock, active: p.active,
  images: Array.isArray(p.images) ? p.images.length : 0,
});

/* ---------------- public reads ---------------- */

// GET /api/products?cat=phone&brand=Apple&grade=Good&q=pro&maxWeekly=2500&sort=price-asc
router.get('/', async (req, res, next) => {
  try {
    const { cat, brand, grade, q, maxWeekly, sort } = req.query;
    const filter = { active: true };

    if (cat && cat !== 'all' && CATEGORIES.includes(cat)) filter.cat = cat;
    if (brand && brand !== 'all') filter.brand = brand;
    if (grade && grade !== 'all' && GRADES.includes(grade)) filter.grade = grade;

    const max = Number(maxWeekly);
    if (Number.isFinite(max) && max > 0) filter.weekly = { $lte: max };

    if (q) {
      // Escape regex metacharacters so a stray "(" can't 500 the route.
      const safe = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ name: rx }, { brand: rx }, { desc: rx }];
    }

    const sorts = {
      'price-asc':  { weekly: 1 },
      'price-desc': { weekly: -1 },
      'name':       { name: 1 },
      'stock':      { stock: -1 },
      'rating':     { avgRating: -1, reviewCount: -1 },
      'featured':   { createdAt: 1 },
    };

    const products = await Product.find(filter).sort(sorts[sort] || sorts.featured);
    res.json({ products, count: products.length });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
    const product = await Product.findById(req.params.id);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) { next(err); }
});

/* ---------------- reviews ---------------- */

// Public: a device's reviews, newest first, plus the current aggregates and
// the 1–5 star histogram the detail page draws.
router.get('/:id/reviews', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });
    const reviews = await Review.find({ product: req.params.id }).sort({ createdAt: -1 });
    const product = await Product.findById(req.params.id).select('avgRating reviewCount');

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(r => {
      const star = Math.max(1, Math.min(5, Math.round(r.rating)));
      distribution[star] += 1;
    });

    res.json({
      reviews,
      count: product?.reviewCount ?? reviews.length,
      avgRating: product?.avgRating ?? 0,
      distribution,
    });
  } catch (err) { next(err); }
});

// Verified renters only: create or update the caller's review for a device.
router.post('/:id/reviews', auth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

    const rating = Math.round(Number(req.body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be a whole number from 1 to 5' });
    }
    const comment = String(req.body.comment || '').trim().slice(0, 1000);

    const product = await Product.findById(req.params.id);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });

    // The gate: the caller must own an order for this device that has at
    // least reached them (delivered or later).
    const rented = await Order.exists({
      user: req.userId,
      'items.product': req.params.id,
      status: { $in: QUALIFYING_REVIEW_STATUSES },
    });
    if (!rented) {
      return res.status(403).json({ error: 'Only customers who have rented this device can review it' });
    }

    const review = await Review.findOneAndUpdate(
      { product: req.params.id, user: req.userId },
      { $set: { rating, comment, userName: req.user?.name || '' } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const { avgRating, reviewCount } = await refreshProductRating(req.params.id);
    res.status(201).json({ review, avgRating, reviewCount });
  } catch (err) { next(err); }
});

/* ---------------- admin writes ---------------- */

router.post('/', auth, admin, async (req, res, next) => {
  try {
    const fields = pickProductFields(req.body);
    const errors = validateProduct(fields);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const product = await Product.create(fields);

    await audit(req, 'product.create', {
      targetType: 'Product',
      targetId: product.id,
      targetLabel: product.name,
      details: auditSnapshot(product),
    });

    res.status(201).json(product);
  } catch (err) { next(err); }
});

router.put('/:id', auth, admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

    const fields = pickProductFields(req.body);
    const errors = validateProduct(fields, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const before = await Product.findById(req.params.id);
    if (!before) return res.status(404).json({ error: 'Product not found' });
    const beforeSnapshot = auditSnapshot(before);
    const beforeStock = before.stock;

    // save() rather than findByIdAndUpdate so the pre-save hook that keeps
    // `image` and `images` in step actually runs.
    Object.assign(before, fields);
    await before.save();
    const product = before;

    await audit(req, 'product.update', {
      targetType: 'Product',
      targetId: product.id,
      targetLabel: product.name,
      details: diff(beforeSnapshot, auditSnapshot(product)),
    });

    // An edit can drop stock as surely as a booking can.
    if (fields.stock !== undefined) await alertLowStock(product, beforeStock);

    res.json(product);
  } catch (err) { next(err); }
});

// Relative stock adjustment: { delta: 1 } or { delta: -1 }.
router.patch('/:id/stock', auth, admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

    const delta = Number(req.body.delta);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero number' });
    }

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const before = product.stock;
    product.stock = Math.max(0, product.stock + Math.round(delta));
    await product.save();

    await audit(req, 'product.stock', {
      targetType: 'Product',
      targetId: product.id,
      targetLabel: product.name,
      details: { delta: Math.round(delta), from: before, to: product.stock },
    });

    await alertLowStock(product, before);

    res.json(product);
  } catch (err) { next(err); }
});

// Soft delete — order history keeps referencing the document.
router.delete('/:id', auth, admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { active: false } },
      { returnDocument: 'after' }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });

    await audit(req, 'product.delete', {
      targetType: 'Product',
      targetId: product.id,
      targetLabel: product.name,
      details: { soft: true, stockAtRemoval: product.stock },
    });

    res.json({ ok: true, id: product.id });
  } catch (err) { next(err); }
});

// Bring a soft-deleted device back into the catalog.
router.post('/:id/restore', auth, admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid product id' });

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $set: { active: true } },
      { returnDocument: 'after' }
    );
    if (!product) return res.status(404).json({ error: 'Product not found' });

    await audit(req, 'product.restore', {
      targetType: 'Product',
      targetId: product.id,
      targetLabel: product.name,
    });

    res.json(product);
  } catch (err) { next(err); }
});

// Admin-only: everything including retired devices, for the catalog table.
router.get('/all/including-inactive', auth, admin, async (req, res, next) => {
  try {
    const products = await Product.find({}).sort({ active: -1, createdAt: 1 });
    res.json({ products, count: products.length });
  } catch (err) { next(err); }
});

module.exports = router;
