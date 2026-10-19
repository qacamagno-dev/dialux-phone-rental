const User = require('../models/User');

/**
 * Gate for customer-only actions (cart, wishlist, placing an order). Must
 * run AFTER the auth middleware, which sets req.userId.
 *
 * Staff accounts (admin, rider, technician) are confined to their own part
 * of the platform — they shouldn't be able to shop as a side effect of
 * having an account at all. This is the backend half of that: the
 * frontend already keeps these roles off the shopping pages entirely (see
 * core/page.js's bootPage(), which redirects them before a page like
 * products.html ever renders), but that's a UI convenience, not security —
 * this middleware is what actually stops the API calls if someone bypasses
 * the UI (a saved request, a browser console, etc).
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(req.userId).select('role');
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    if (user.role !== 'user') {
      return res.status(403).json({ error: 'This action is for customer accounts only' });
    }

    next();
  } catch (err) {
    next(err);
  }
};