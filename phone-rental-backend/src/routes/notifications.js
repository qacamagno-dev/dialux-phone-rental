const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const { notifyMany } = require('../services/notify');
const { audit } = require('../services/audit');
const { NOTIFICATION_TYPES } = require('../constants');

const router = express.Router();
router.use(auth);   // notifications are always personal

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// The bell shows a short list, not an archive.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/* ---------------- reads ---------------- */

/**
 * GET /api/notifications?unread=1&limit=20
 *
 * Always returns the unread tally alongside the page of rows, so the header
 * badge and the dropdown come from a single request.
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.round(Number(req.query.limit) || DEFAULT_LIMIT))
    );

    const filter = { user: req.userId };
    if (req.query.unread === '1' || req.query.unread === 'true') filter.read = false;

    const [notifications, unread, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit),
      Notification.countDocuments({ user: req.userId, read: false }),
      Notification.countDocuments({ user: req.userId }),
    ]);

    res.json({ notifications, count: notifications.length, unread, total });
  } catch (err) { next(err); }
});

/* ---------------- writes ---------------- */

router.patch('/:id/read', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid notification id' });

    // Scoping the filter by user is the authorization check: another
    // customer's id simply matches nothing.
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: { read: true, readAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });

    const unread = await Notification.countDocuments({ user: req.userId, read: false });
    res.json({ notification, unread });
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const { modifiedCount } = await Notification.updateMany(
      { user: req.userId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({ ok: true, marked: modifiedCount, unread: 0 });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid notification id' });

    const gone = await Notification.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!gone) return res.status(404).json({ error: 'Notification not found' });

    const unread = await Notification.countDocuments({ user: req.userId, read: false });
    res.json({ ok: true, unread });
  } catch (err) { next(err); }
});

/** Clear the caller's whole list. */
router.delete('/', async (req, res, next) => {
  try {
    const { deletedCount } = await Notification.deleteMany({ user: req.userId });
    res.json({ ok: true, deleted: deletedCount, unread: 0 });
  } catch (err) { next(err); }
});

/* ---------------- admin broadcast ---------------- */

/**
 * POST /api/notifications/broadcast
 * Announce something to every customer — the promotions channel the
 * notification requirement asks for.
 */
router.post('/broadcast', auth, admin, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const link = String(req.body.link || '').trim();
    const type = NOTIFICATION_TYPES.includes(req.body.type) ? req.body.type : 'promo';
    const audience = req.body.audience === 'admins' ? 'admins' : 'all';

    if (!title) return res.status(400).json({ error: 'A title is required' });

    const filter = audience === 'admins' ? { role: 'admin' } : {};
    const recipients = await User.find(filter).select('_id');
    if (!recipients.length) return res.status(409).json({ error: 'No recipients matched' });

    const sent = await notifyMany(
      recipients.map(u => u._id),
      { type, title, message, link }
    );

    await audit(req, 'notification.broadcast', {
      targetType: 'Notification',
      targetLabel: title,
      details: { audience, type, recipients: recipients.length, sent },
    });

    res.status(201).json({ ok: true, sent, recipients: recipients.length });
  } catch (err) { next(err); }
});

module.exports = router;
