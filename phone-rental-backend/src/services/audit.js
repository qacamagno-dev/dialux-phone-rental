// ============================================================
// DiaLux — audit service
//
// Every privileged write funnels through here so the trail is uniform and no
// route has to remember the document shape.
//
// Like the notification service this never throws: a failed audit write must
// not roll back the action it was describing. It logs loudly instead, because
// a silently missing audit entry is worse than a noisy one.
// ============================================================

const AuditLog = require('../models/AuditLog');

/** First hop of x-forwarded-for, else the socket address. */
function clientIp(req) {
  const fwd = req.header?.('x-forwarded-for');
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

/**
 * Record one privileged action.
 *
 * @param {object} req      the Express request (for actor + IP)
 * @param {string} action   dotted verb, e.g. "product.update"
 * @param {object} [info]   { targetType, targetId, targetLabel, details }
 */
async function audit(req, action, info = {}) {
  try {
    // middlewares/admin.js and middlewares/rider.js each leave their
    // freshly-read user on the request under their own name; the JWT
    // payload is the fallback for self-service actions.
    const actor = req.adminUser || req.staffUser || req.riderUser || req.user || {};
    await AuditLog.create({
      user: req.userId || undefined,
      userEmail: actor.email || '',
      userName: actor.name || '',
      action,
      targetType: info.targetType || '',
      targetId: info.targetId ? String(info.targetId) : '',
      targetLabel: info.targetLabel || '',
      details: info.details || {},
      ip: clientIp(req),
    });
  } catch (err) {
    console.warn(`[DiaLux] audit entry for "${action}" not written:`, err.message);
  }
}

/**
 * Shallow diff of two objects, keyed by field, as { from, to }. Handy for
 * "what did this edit actually change" without storing whole documents.
 */
function diff(before = {}, after = {}) {
  const out = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach(k => {
    const a = before?.[k];
    const b = after?.[k];
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (!same) out[k] = { from: a ?? null, to: b ?? null };
  });
  return out;
}

module.exports = { audit, diff };