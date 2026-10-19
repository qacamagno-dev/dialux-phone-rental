// ============================================================
// DiaLux — low-stock alerting
//
// The inventory screen has always *shown* low stock. This turns it into an
// actual alert: the moment a device crosses the threshold — whether from a
// booking or a manual adjustment — every administrator gets a notification.
//
// Only the crossing fires. A device sitting at 1 unit for a week does not
// re-notify on every page load, because `before` is compared against `after`.
// ============================================================

const User = require('../models/User');
const Settings = require('../models/Settings');
const { notifyMany } = require('./notify');

/**
 * Notify admins when `product` has just fallen to or below the low-stock
 * threshold (or hit zero). Safe to call on every stock change.
 *
 * @param {object} product  the product AFTER the change
 * @param {number} before   its stock BEFORE the change
 */
async function alertLowStock(product, before) {
  try {
    if (!product) return;

    const settings = await Settings.get();
    const threshold = Number(settings.lowStockThreshold) || 0;
    const after = Number(product.stock) || 0;
    const wasAbove = Number(before) > threshold;

    // Nothing to say unless this change is the crossing itself.
    if (!wasAbove || after > threshold) return;

    const admins = await User.find({ role: 'admin' }).select('_id');
    if (!admins.length) return;

    const outOfStock = after === 0;
    await notifyMany(admins.map(a => a._id), {
      type: 'system',
      title: outOfStock
        ? `Out of stock: ${product.name}`
        : `Low stock: ${product.name} (${after} left)`,
      message: outOfStock
        ? 'Every unit is now rented out. Restock or hide the device to stop new bookings.'
        : `Stock has fallen to ${after}, at or below the ${threshold}-unit alert threshold.`,
      link: '/admin.html#inventory',
    });
  } catch (err) {
    // An alert is a courtesy; never let it break the booking that caused it.
    console.warn('[DiaLux] low-stock alert skipped:', err.message);
  }
}

module.exports = { alertLowStock };
