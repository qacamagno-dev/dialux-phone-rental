const express = require('express');
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Settings = require('../models/Settings');
const auth = require('../middlewares/auth');
const customerOnly = require('../middlewares/customerOnly');
const {
  PLANS, bestValue, daysBetween, deliveryFeeFor, protectionFeeFor,
} = require('../constants');

const router = express.Router();
router.use(auth);          // the whole cart API is authenticated
router.use(customerOnly);  // ...and is for customer accounts only

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const isValidDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

async function loadCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

/**
 * Price out a cart. Lines whose product was deleted or deactivated are
 * dropped (and persisted away) rather than crashing the response.
 *
 * Fees come from the live Settings document, not the constants module, so an
 * administrator changing the delivery fee is reflected here and at checkout
 * without a restart — and the two always agree, because both call the same
 * deliveryFeeFor()/protectionFeeFor() helpers.
 */
async function serializeCart(cart) {
  await cart.populate('items.product');
  const settings = await Settings.get();

  const live = cart.items.filter(i => i.product && i.product.active);
  if (live.length !== cart.items.length) {
    cart.items = live.map(i => ({ product: i.product._id, plan: i.plan, qty: i.qty }));
    await cart.save();
    await cart.populate('items.product');
  }

  const days = (cart.startDate && cart.endDate)
    ? daysBetween(cart.startDate, cart.endDate)
    : 7;

  const lines = cart.items.map(i => {
    const p = i.product;
    const rate = bestValue(p, days);
    return {
      productId: p.id,
      name: p.name,
      cat: p.cat,
      brand: p.brand,
      grade: p.grade,
      image: p.image,
      stock: p.stock,
      plan: i.plan,
      qty: i.qty,
      rate,
      deposit: p.deposit,
      days,
      rentSubtotal: rate * i.qty,
      depositSubtotal: p.deposit * i.qty,
    };
  });

  const rent = lines.reduce((s, l) => s + l.rentSubtotal, 0);
  const deposit = lines.reduce((s, l) => s + l.depositSubtotal, 0);
  const delivery = lines.length ? deliveryFeeFor(rent, settings) : 0;
  const protectionFee = (lines.length && cart.protection)
    ? protectionFeeFor(rent, settings.protectionFeePct)
    : 0;

  return {
    lines,
    count: lines.reduce((s, l) => s + l.qty, 0),
    startDate: cart.startDate || '',
    endDate: cart.endDate || '',
    days,
    rent,
    deposit,
    delivery,
    protection: Boolean(cart.protection),
    protectionFee,
    // What protection *would* cost, so the checkbox can show its price even
    // while it is switched off.
    protectionQuote: lines.length ? protectionFeeFor(rent, settings.protectionFeePct) : 0,
    protectionPct: Number(settings.protectionFeePct) || 0,
    currencySymbol: settings.currencySymbol,
    total: rent + deposit + delivery + protectionFee,
  };
}

function findLine(cart, productId, plan) {
  return cart.items.find(i => String(i.product) === String(productId) && i.plan === plan);
}

/* ---------------- routes ---------------- */

router.get('/', async (req, res, next) => {
  try {
    const cart = await loadCart(req.userId);
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

/** Set the rental window and the protection choice that price the cart. */
router.patch('/', async (req, res, next) => {
  try {
    const { startDate, endDate, protection } = req.body || {};
    const cart = await loadCart(req.userId);

    let touched = false;

    if (startDate !== undefined || endDate !== undefined) {
      if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
        return res.status(400).json({ error: 'startDate and endDate must be YYYY-MM-DD' });
      }
      if (endDate < startDate) {
        return res.status(400).json({ error: 'endDate cannot be before startDate' });
      }
      cart.startDate = startDate;
      cart.endDate = endDate;
      touched = true;
    }

    if (protection !== undefined) {
      cart.protection = Boolean(protection);
      touched = true;
    }

    if (!touched) return res.status(400).json({ error: 'Nothing to update' });

    await cart.save();
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

router.post('/items', async (req, res, next) => {
  try {
    const { productId } = req.body;
    const plan = PLANS.includes(req.body.plan) ? req.body.plan : 'Weekly';
    const qty = Math.max(1, Math.round(Number(req.body.qty) || 1));

    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product id' });

    const product = await Product.findById(productId);
    if (!product || !product.active) return res.status(404).json({ error: 'Product not found' });
    if (product.stock === 0) return res.status(409).json({ error: `${product.name} is out of stock` });

    const cart = await loadCart(req.userId);
    const line = findLine(cart, productId, plan);
    const already = line ? line.qty : 0;

    if (already + qty > product.stock) {
      return res.status(409).json({
        error: `Only ${product.stock} unit${product.stock === 1 ? '' : 's'} of ${product.name} available`,
      });
    }

    if (line) line.qty = already + qty;
    else cart.items.push({ product: product._id, plan, qty });

    await cart.save();
    res.status(201).json(await serializeCart(cart));
  } catch (err) { next(err); }
});

router.patch('/items', async (req, res, next) => {
  try {
    const { productId, plan, newPlan } = req.body;
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product id' });
    if (!PLANS.includes(plan)) return res.status(400).json({ error: 'Unknown plan' });

    const cart = await loadCart(req.userId);
    const line = findLine(cart, productId, plan);
    if (!line) return res.status(404).json({ error: 'Item not in cart' });

    if (newPlan !== undefined) {
      if (!PLANS.includes(newPlan)) return res.status(400).json({ error: 'Unknown plan' });
      const existing = findLine(cart, productId, newPlan);
      if (existing && existing !== line) {
        // Switching onto a plan already in the cart — merge the two lines.
        existing.qty += line.qty;
        cart.items = cart.items.filter(i => i !== line);
      } else {
        line.plan = newPlan;
      }
    }

    if (req.body.qty !== undefined) {
      const product = await Product.findById(productId);
      if (!product) return res.status(404).json({ error: 'Product not found' });

      const wanted = Math.round(Number(req.body.qty));
      if (!Number.isFinite(wanted) || wanted < 1) {
        return res.status(400).json({ error: 'qty must be 1 or more' });
      }
      const target = findLine(cart, productId, newPlan ?? plan) || line;
      if (wanted > product.stock) {
        return res.status(409).json({
          error: `Only ${product.stock} unit${product.stock === 1 ? '' : 's'} available`,
        });
      }
      target.qty = wanted;
    }

    await cart.save();
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

router.delete('/items', async (req, res, next) => {
  try {
    const { productId, plan } = req.body || {};
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product id' });

    const cart = await loadCart(req.userId);
    const before = cart.items.length;
    cart.items = cart.items.filter(
      i => !(String(i.product) === String(productId) && (plan === undefined || i.plan === plan))
    );
    if (cart.items.length === before) return res.status(404).json({ error: 'Item not in cart' });

    await cart.save();
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

router.delete('/', async (req, res, next) => {
  try {
    const cart = await loadCart(req.userId);
    cart.items = [];
    await cart.save();
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

/**
 * Fold a guest's localStorage cart into the signed-in cart. Called once
 * right after login/registration. Quantities are capped at stock and
 * duplicate product+plan pairs are summed, not replaced.
 */
router.post('/merge', async (req, res, next) => {
  try {
    const incoming = Array.isArray(req.body.items) ? req.body.items : [];
    const cart = await loadCart(req.userId);

    for (const raw of incoming) {
      if (!isValidId(raw.productId)) continue;
      const plan = PLANS.includes(raw.plan) ? raw.plan : 'Weekly';
      const qty = Math.max(1, Math.round(Number(raw.qty) || 1));

      const product = await Product.findById(raw.productId);
      if (!product || !product.active || product.stock === 0) continue;

      const line = findLine(cart, raw.productId, plan);
      const total = (line ? line.qty : 0) + qty;
      const capped = Math.min(total, product.stock);

      if (line) line.qty = capped;
      else cart.items.push({ product: product._id, plan, qty: capped });
    }

    // Carry a guest's chosen dates over too, when the server cart has none.
    if (!cart.startDate && isValidDateStr(req.body.startDate) && isValidDateStr(req.body.endDate)) {
      if (req.body.endDate >= req.body.startDate) {
        cart.startDate = req.body.startDate;
        cart.endDate = req.body.endDate;
      }
    }

    await cart.save();
    res.json(await serializeCart(cart));
  } catch (err) { next(err); }
});

module.exports = router;