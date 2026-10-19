const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const auth = require('../middlewares/auth');
const customerOnly = require('../middlewares/customerOnly');

const router = express.Router();
router.use(auth);          // a wishlist belongs to an account
router.use(customerOnly);  // ...and is for customer accounts only

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * The caller's wishlist as live product documents.
 *
 * Products are referenced, not copied, so a price change or a rename shows up
 * immediately. Soft-deleted devices are filtered out of the response and
 * pruned from the stored array, which keeps the list self-healing after an
 * administrator retires a device.
 */
async function serializeWishlist(userId) {
  const user = await User.findById(userId).populate({
    path: 'wishlist',
    match: { active: true },
  });
  if (!user) return null;

  const live = (user.wishlist || []).filter(Boolean);

  // populate() with `match` drops inactive refs from the array but leaves the
  // stored ids alone; persist the pruning once so it does not repeat forever.
  if (live.length !== (user.wishlist || []).length) {
    await User.updateOne(
      { _id: userId },
      { $set: { wishlist: live.map(p => p._id) } }
    );
  }

  return {
    products: live,
    ids: live.map(p => p.id),
    count: live.length,
  };
}

/* ---------------- routes ---------------- */

router.get('/', async (req, res, next) => {
  try {
    const data = await serializeWishlist(req.userId);
    if (!data) return res.status(401).json({ error: 'Account no longer exists' });
    res.json(data);
  } catch (err) { next(err); }
});

/** Save a device. Idempotent — $addToSet means a double-tap is harmless. */
router.post('/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product id' });

    const product = await Product.findById(productId);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });

    await User.updateOne(
      { _id: req.userId },
      { $addToSet: { wishlist: product._id } }
    );

    const data = await serializeWishlist(req.userId);
    res.status(201).json({ ...data, added: product.name });
  } catch (err) { next(err); }
});

router.delete('/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product id' });

    await User.updateOne(
      { _id: req.userId },
      { $pull: { wishlist: new mongoose.Types.ObjectId(String(productId)) } }
    );

    const data = await serializeWishlist(req.userId);
    if (!data) return res.status(401).json({ error: 'Account no longer exists' });
    res.json(data);
  } catch (err) { next(err); }
});

/** Empty the whole list. */
router.delete('/', async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.userId }, { $set: { wishlist: [] } });
    res.json({ products: [], ids: [], count: 0 });
  } catch (err) { next(err); }
});

module.exports = router;