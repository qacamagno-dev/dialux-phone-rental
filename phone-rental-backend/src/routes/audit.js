const express = require('express');
const AuditLog = require('../models/AuditLog');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');

const router = express.Router();
router.use(auth, admin);   // the trail is administrators-only, end to end

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/audit?action=product.update&actor=me@x.com&page=1&limit=50
 *
 * Newest first, paged. `actions` and `actors` come back with every response so
 * the dashboard can build its filter dropdowns from what actually exists
 * rather than a hardcoded list that drifts.
 *
 * There is deliberately no POST, PATCH or DELETE here: entries are written
 * only by services/audit.js, from inside the action being recorded. An audit
 * trail with an edit endpoint is not evidence of anything.
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(req.query.limit) || DEFAULT_LIMIT)));
    const page = Math.max(1, Math.round(Number(req.query.page) || 1));

    const filter = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.actor) filter.userEmail = String(req.query.actor).toLowerCase().trim();
    if (req.query.targetId) filter.targetId = String(req.query.targetId);

    // Free-text across the readable columns.
    if (req.query.q) {
      const safe = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ targetLabel: rx }, { userEmail: rx }, { action: rx }];
    }

    const [logs, total, actions, actors] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('action'),
      AuditLog.distinct('userEmail'),
    ]);

    res.json({
      logs,
      count: logs.length,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      actions: actions.sort(),
      actors: actors.filter(Boolean).sort(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
