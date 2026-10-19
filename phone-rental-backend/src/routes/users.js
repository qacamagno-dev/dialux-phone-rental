const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const { notify } = require('../services/notify');
const { audit, diff } = require('../services/audit');
const { ROLES } = require('../constants');

const router = express.Router();
router.use(auth);

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Pull the writable address fields off a body. */
function pickAddressFields(body) {
  const out = {};
  if (body.label   !== undefined) out.label   = String(body.label).trim().slice(0, 40) || 'Home';
  if (body.phone   !== undefined) out.phone   = String(body.phone).trim();
  if (body.address !== undefined) out.address = String(body.address).trim();
  if (body.city    !== undefined) out.city    = String(body.city).trim();
  if (body.zip     !== undefined) out.zip     = String(body.zip).trim();
  return out;
}

/* ---------------- account details ---------------- */

/** Rename the account or update the contact number kept on the profile. */
router.patch('/me', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    let touched = false;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Your name cannot be blank' });
      if (name.length > 120) return res.status(400).json({ error: 'That name is too long' });
      user.name = name;
      touched = true;
    }

    if (req.body.phone !== undefined) {
      user.profile = { ...(user.profile?.toObject?.() || user.profile || {}), phone: String(req.body.phone).trim() };
      touched = true;
    }

    if (!touched) return res.status(400).json({ error: 'Nothing to update' });

    await user.save();
    res.json(user);
  } catch (err) { next(err); }
});

/**
 * Legacy single-address save. Kept because the cart and both checkout screens
 * have always read user.profile — this now writes through to the default entry
 * in `addresses` so the old and new shapes can never disagree.
 */
router.patch('/me/profile', async (req, res, next) => {
  try {
    const { phone, address, city, zip } = req.body;
    if ([phone, address, city, zip].every(v => v === undefined)) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    let target = user.addresses.find(a => a.isDefault) || user.addresses[0];

    if (!target) {
      // First save: promote the profile block into a proper address entry.
      if (address === undefined && !user.profile?.address) {
        return res.status(400).json({ error: 'A street address is required' });
      }
      user.addresses.push({
        label: 'Home',
        phone: phone !== undefined ? String(phone).trim() : (user.profile?.phone || ''),
        address: address !== undefined ? String(address).trim() : user.profile.address,
        city: city !== undefined ? String(city).trim() : (user.profile?.city || ''),
        zip: zip !== undefined ? String(zip).trim() : (user.profile?.zip || ''),
        isDefault: true,
      });
    } else {
      if (phone   !== undefined) target.phone   = String(phone).trim();
      if (address !== undefined) target.address = String(address).trim();
      if (city    !== undefined) target.city    = String(city).trim();
      if (zip     !== undefined) target.zip     = String(zip).trim();
    }

    user.syncDefaultAddress();
    await user.save();
    res.json(user);
  } catch (err) { next(err); }
});

/* ---------------- multiple delivery addresses ---------------- */

router.get('/me/addresses', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    res.json({ addresses: user.addresses, count: user.addresses.length });
  } catch (err) { next(err); }
});

router.post('/me/addresses', async (req, res, next) => {
  try {
    const fields = pickAddressFields(req.body);
    if (!fields.address) return res.status(400).json({ error: 'A street address is required' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    if (user.addresses.length >= 10) {
      return res.status(409).json({ error: 'You can keep up to 10 saved addresses' });
    }

    // The first address is always the default; later ones only if asked.
    const makeDefault = Boolean(req.body.isDefault) || user.addresses.length === 0;
    if (makeDefault) user.addresses.forEach(a => { a.isDefault = false; });

    user.addresses.push({ ...fields, isDefault: makeDefault });
    user.syncDefaultAddress();
    await user.save();

    res.status(201).json(user);
  } catch (err) { next(err); }
});

router.patch('/me/addresses/:addressId', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    const entry = user.addresses.id(req.params.addressId);
    if (!entry) return res.status(404).json({ error: 'Address not found' });

    const fields = pickAddressFields(req.body);
    if (fields.address !== undefined && !fields.address) {
      return res.status(400).json({ error: 'A street address is required' });
    }
    Object.assign(entry, fields);

    if (req.body.isDefault === true) {
      user.addresses.forEach(a => { a.isDefault = a === entry; });
    }

    user.syncDefaultAddress();
    await user.save();
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/me/addresses/:addressId/default', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    const entry = user.addresses.id(req.params.addressId);
    if (!entry) return res.status(404).json({ error: 'Address not found' });

    user.addresses.forEach(a => { a.isDefault = a === entry; });
    user.syncDefaultAddress();
    await user.save();
    res.json(user);
  } catch (err) { next(err); }
});

router.delete('/me/addresses/:addressId', async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    const entry = user.addresses.id(req.params.addressId);
    if (!entry) return res.status(404).json({ error: 'Address not found' });

    entry.deleteOne();

    if (!user.addresses.length) {
      // No addresses left — clear the mirrored profile too, so checkout
      // correctly reports that an address is still needed.
      user.profile = { phone: user.profile?.phone || '', address: '', city: '', zip: '' };
    } else {
      user.syncDefaultAddress();
    }

    await user.save();
    res.json(user);
  } catch (err) { next(err); }
});

/* ---------------- admin ---------------- */

/**
 * Every account, newest first, each with a light rental summary so the admin
 * table can show value per customer without a request per row.
 */
router.get('/', admin, async (req, res, next) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });

    const stats = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: '$user', orders: { $sum: 1 }, spend: { $sum: '$total' } } },
    ]);
    const byUser = new Map(stats.map(s => [String(s._id), s]));

    res.json({
      users: users.map(u => {
        const s = byUser.get(String(u._id));
        return { ...u.toJSON(), orderCount: s?.orders || 0, totalSpend: s?.spend || 0 };
      }),
      count: users.length,
    });
  } catch (err) { next(err); }
});

router.patch('/:id/role', admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

    const { role } = req.body;
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
    }

    // Don't let the last admin demote themselves (to anything) into a locked-out system.
    if (role !== 'admin' && String(req.params.id) === String(req.userId)) {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) {
        return res.status(409).json({ error: 'You are the only administrator — promote someone else first' });
      }
    }

    const before = await User.findById(req.params.id).select('role email name');
    if (!before) return res.status(404).json({ error: 'User not found' });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { role } },
      { returnDocument: 'after' }
    );

    await audit(req, 'user.role', {
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
      details: diff({ role: before.role }, { role: user.role }),
    });

    // Tell them, so a role change isn't a silent change to their account.
    if (before.role !== user.role) {
      const ROLE_COPY = {
        admin:      { title: 'You are now an administrator', message: 'The management dashboard is now available from your account menu.', link: '/admin.html' },
        rider:      { title: 'You are now a DiaLux rider', message: 'Your rider dashboard is ready — assigned deliveries will show up there.', link: '/rider.html' },
        technician: { title: 'You are now a DiaLux technician', message: 'You can now open return inspections from the admin dashboard.', link: '/admin.html' },
        user:       { title: 'Your account access was updated', message: 'Your account is back to standard customer access.', link: '/profile.html' },
      };
      const copy = ROLE_COPY[role] || ROLE_COPY.user;
      await notify(user._id, { type: 'account', ...copy });
    }

    res.json(user);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/users/:id
 *
 * Removes the account and the records that only make sense alongside it — the
 * cart and the notification feed. Orders are deliberately left in place: they
 * snapshot the customer's name and email, so the books, the revenue reports
 * and the audit trail stay intact after the account is gone.
 */
router.delete('/:id', admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

    if (String(req.params.id) === String(req.userId)) {
      return res.status(409).json({ error: 'You cannot delete your own account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'admin') {
      const admins = await User.countDocuments({ role: 'admin' });
      if (admins <= 1) {
        return res.status(409).json({ error: 'That is the only administrator account — promote someone else first' });
      }
    }

    // An open rental means a device is physically out with this person.
    const openOrders = await Order.countDocuments({
      user: user._id,
      status: { $nin: ['cancelled', 'completed', 'refunded'] },
    });
    if (openOrders) {
      return res.status(409).json({
        error: `That customer has ${openOrders} open booking${openOrders === 1 ? '' : 's'} — close or cancel them first`,
      });
    }

    const orderCount = await Order.countDocuments({ user: user._id });

    await Promise.all([
      Cart.deleteOne({ user: user._id }),
      Notification.deleteMany({ user: user._id }),
    ]);
    await User.deleteOne({ _id: user._id });

    await audit(req, 'user.delete', {
      targetType: 'User',
      targetId: String(user._id),
      targetLabel: user.email,
      details: { name: user.name, role: user.role, ordersKept: orderCount },
    });

    res.json({
      ok: true,
      id: String(user._id),
      email: user.email,
      ordersKept: orderCount,
    });
  } catch (err) { next(err); }
});

module.exports = router;