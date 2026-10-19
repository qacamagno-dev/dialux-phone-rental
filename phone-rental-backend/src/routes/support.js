const express = require('express');
const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const optionalAuth = require('../middlewares/optionalAuth');
const { notify } = require('../services/notify');
const { audit } = require('../services/audit');
const { supportReceiptMail } = require('../services/mailer');
const { SUPPORT_STATUSES, SUPPORT_CATEGORIES } = require('../constants');

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------------- public: submit a ticket ---------------- */

/**
 * POST /api/support
 *
 * The contact form. optionalAuth rather than auth on purpose — a visitor who
 * is not signed in must still be able to reach a human. When a session *is*
 * present the ticket is linked to the account, which is what lets a staff
 * reply land in that customer's notifications.
 */
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();
    const phone = String(req.body.phone || '').trim();
    const orderRef = String(req.body.orderRef || '').trim();
    const category = SUPPORT_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email and message are all required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'That email address looks invalid' });
    }
    if (message.length < 10) {
      return res.status(400).json({ error: 'Please add a little more detail (at least 10 characters)' });
    }

    const ticket = await SupportTicket.create({
      user: req.userId || null,
      name,
      email,
      phone,
      subject: subject || 'General enquiry',
      category,
      message: message.slice(0, 4000),
      orderRef,
      status: 'open',
    });

    // Best-effort acknowledgement. With no SMTP configured this prints to the
    // server log; the customer's confirmation is the on-screen ticket
    // reference either way, so a failed send is not an error.
    const mail = await supportReceiptMail({ to: email, name, ticket });

    if (req.userId) {
      await notify(req.userId, {
        type: 'support',
        title: `Support ticket ${ticket.ref} opened`,
        message: `We have your message about "${ticket.subject}" and will reply shortly.`,
        link: '/profile.html#support',
      });
    }

    res.status(201).json({
      ok: true,
      ticket,
      ref: ticket.ref,
      emailed: mail.delivered,
    });
  } catch (err) { next(err); }
});

/* ---------------- customer: my tickets ---------------- */

router.get('/mine', auth, async (req, res, next) => {
  try {
    const tickets = await SupportTicket.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json({ tickets, count: tickets.length });
  } catch (err) { next(err); }
});

/* ---------------- admin: the desk ---------------- */

/**
 * GET /api/support?status=open
 * Every ticket, newest first, plus per-status tallies for the dashboard.
 */
router.get('/', auth, admin, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && SUPPORT_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const [tickets, all] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }),
      SupportTicket.find({}).select('status'),
    ]);

    const byStatus = {};
    SUPPORT_STATUSES.forEach(s => { byStatus[s] = 0; });
    all.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

    res.json({ tickets, count: tickets.length, total: all.length, byStatus });
  } catch (err) { next(err); }
});

/** One ticket — the owner or any admin. */
router.get('/:id', auth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket id' });

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const me = await User.findById(req.userId).select('role');
    const owns = ticket.user && String(ticket.user) === String(req.userId);
    if (!owns && me?.role !== 'admin') {
      return res.status(403).json({ error: 'Not your ticket' });
    }

    res.json(ticket);
  } catch (err) { next(err); }
});

router.patch('/:id/status', auth, admin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket id' });

    const { status } = req.body;
    if (!SUPPORT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${SUPPORT_STATUSES.join(', ')}` });
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const from = ticket.status;
    ticket.status = status;
    await ticket.save();

    await audit(req, 'support.status', {
      targetType: 'SupportTicket',
      targetId: ticket.id,
      targetLabel: ticket.ref,
      details: { from, to: status },
    });

    if (ticket.user && ['resolved', 'closed'].includes(status)) {
      await notify(ticket.user, {
        type: 'support',
        title: `Ticket ${ticket.ref} ${status}`,
        message: `Your support request about "${ticket.subject}" was marked ${status}.`,
        link: '/profile.html#support',
      });
    }

    res.json(ticket);
  } catch (err) { next(err); }
});

/**
 * POST /api/support/:id/reply
 *
 * Both sides post here. An admin's reply is flagged as staff and notifies the
 * customer; the customer's own follow-up reopens a resolved ticket, because a
 * reply is the clearest signal that the problem is not actually finished.
 */
router.post('/:id/reply', auth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid ticket id' });

    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'A reply message is required' });

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const me = await User.findById(req.userId).select('role name email');
    if (!me) return res.status(401).json({ error: 'Account no longer exists' });

    const isStaff = me.role === 'admin';
    const owns = ticket.user && String(ticket.user) === String(req.userId);
    if (!isStaff && !owns) return res.status(403).json({ error: 'Not your ticket' });

    ticket.replies.push({
      message: message.slice(0, 4000),
      byName: me.name,
      byEmail: me.email,
      fromStaff: isStaff,
      at: new Date(),
    });

    if (isStaff) {
      if (!ticket.firstReplyAt) ticket.firstReplyAt = new Date();
      if (ticket.status === 'open') ticket.status = 'in-progress';
    } else if (['resolved', 'closed'].includes(ticket.status)) {
      ticket.status = 'open';
    }

    await ticket.save();

    if (isStaff) {
      await audit(req, 'support.reply', {
        targetType: 'SupportTicket',
        targetId: ticket.id,
        targetLabel: ticket.ref,
        details: { length: message.length },
      });

      if (ticket.user) {
        await notify(ticket.user, {
          type: 'support',
          title: `DiaLux replied to ${ticket.ref}`,
          message: message.slice(0, 200),
          link: '/profile.html#support',
        });
      }
    }

    res.status(201).json(ticket);
  } catch (err) { next(err); }
});

module.exports = router;
