const express = require('express');
const Settings = require('../models/Settings');
const auth = require('../middlewares/auth');
const admin = require('../middlewares/admin');
const { audit, diff } = require('../services/audit');
const { PAYMENT_METHODS } = require('../constants');

const router = express.Router();

// Every field an administrator may change, with its coercion. Anything not
// listed here is ignored, so a crafted body can't reach `key` or a timestamp.
const NUMERIC_FIELDS = [
  'deliveryFee', 'freeDeliveryThreshold', 'protectionFeePct',
  'lowStockThreshold', 'minRentalDays', 'maxRentalDays', 'meetupFee',
];
const STRING_FIELDS = ['brandName', 'currencyCode', 'currencySymbol', 'supportEmail'];

function pickSettingsFields(body) {
  const out = {};

  STRING_FIELDS.forEach(k => {
    if (body[k] !== undefined) out[k] = String(body[k]).trim().slice(0, 120);
  });

  NUMERIC_FIELDS.forEach(k => {
    if (body[k] === undefined) return;
    const n = Number(body[k]);
    if (Number.isFinite(n)) out[k] = Math.max(0, Math.round(n));
  });

  if (body.maintenanceMode !== undefined) out.maintenanceMode = Boolean(body.maintenanceMode);

  if (Array.isArray(body.paymentMethods)) {
    // Preserve the canonical order regardless of how the client sent them.
    out.paymentMethods = PAYMENT_METHODS.filter(m => body.paymentMethods.includes(m));
  }

  // Late-return penalty multiplier is fractional (1.5), so it skips the integer rounding above.
  if (body.overduePenaltyMultiplier !== undefined) {
    const m = Number(body.overduePenaltyMultiplier);
    if (Number.isFinite(m)) out.overduePenaltyMultiplier = Math.min(10, Math.max(0, Math.round(m * 100) / 100));
  }

  // Auto-progress controls (services/orderProgressor.js).
  const op = body.orderProgress;
  if (op && typeof op === 'object') {
    const next = {};
    if (op.enabled !== undefined) next.enabled = Boolean(op.enabled);
    if (['fast', 'real'].includes(op.speed)) next.speed = op.speed;
    for (const table of ['fastMinutes', 'realMinutes']) {
      if (!op[table] || typeof op[table] !== 'object') continue;
      next[table] = {};
      for (const k of ['preparing', 'readyForPickup']) {
        const n = Number(op[table][k]);
        if (Number.isFinite(n)) next[table][k] = Math.max(0, Math.round(n));
      }
    }
    if (Object.keys(next).length) out.orderProgress = next;
  }

  return out;
}

function validateSettings(fields) {
  const errors = [];

  if (fields.protectionFeePct !== undefined && fields.protectionFeePct > 100) {
    errors.push('protectionFeePct cannot exceed 100');
  }
  if (fields.minRentalDays !== undefined && fields.minRentalDays < 1) {
    errors.push('minRentalDays must be at least 1');
  }
  if (fields.maxRentalDays !== undefined && fields.maxRentalDays < 1) {
    errors.push('maxRentalDays must be at least 1');
  }
  if (
    fields.minRentalDays !== undefined && fields.maxRentalDays !== undefined &&
    fields.minRentalDays > fields.maxRentalDays
  ) {
    errors.push('minRentalDays cannot be greater than maxRentalDays');
  }
  if (fields.paymentMethods && !fields.paymentMethods.length) {
    errors.push('at least one payment method must stay enabled');
  }
  if (fields.currencySymbol !== undefined && !fields.currencySymbol) {
    errors.push('currencySymbol cannot be blank');
  }

  return errors;
}

/* ---------------- read ---------------- */

/**
 * GET /api/settings
 *
 * Public: the storefront needs the delivery fee, currency symbol, protection
 * rate and enabled payment methods to price a cart before anyone signs in.
 * Nothing here is a secret — credentials live in environment variables.
 */
router.get('/', async (req, res, next) => {
  try {
    const settings = await Settings.get();
    res.json(settings);
  } catch (err) { next(err); }
});

/* ---------------- write ---------------- */

router.put('/', auth, admin, async (req, res, next) => {
  try {
    const fields = pickSettingsFields(req.body);
    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const errors = validateSettings(fields);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    const current = await Settings.get({ fresh: true });
    const before = current.toJSON();

    // A partial orderProgress must merge into the stored one, not replace it.
    if (fields.orderProgress) {
      const cur = current.orderProgress?.toObject ? current.orderProgress.toObject() : (current.orderProgress || {});
      fields.orderProgress = {
        ...cur, ...fields.orderProgress,
        fastMinutes: { ...cur.fastMinutes, ...fields.orderProgress.fastMinutes },
        realMinutes: { ...cur.realMinutes, ...fields.orderProgress.realMinutes },
      };
    }

    Object.assign(current, fields, { updatedByEmail: req.adminUser?.email || '' });
    await current.save();

    // Pricing reads a 30-second cache; drop it so the next checkout is correct.
    Settings.bust();

    const after = current.toJSON();
    await audit(req, 'settings.update', {
      targetType: 'Settings',
      targetLabel: 'Platform settings',
      details: diff(
        Object.fromEntries(Object.keys(fields).map(k => [k, before[k]])),
        Object.fromEntries(Object.keys(fields).map(k => [k, after[k]]))
      ),
    });

    res.json(after);
  } catch (err) { next(err); }
});

module.exports = router;