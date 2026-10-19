const User = require('../models/User');

/**
 * Admin gate. Must run AFTER the auth middleware, which sets req.userId.
 *
 * The role is read from the database rather than the JWT on purpose: a
 * token issued before a role change would otherwise keep its old
 * privileges for the full 7-day expiry window.
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(req.userId).select('role email');
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    req.adminUser = user;
    next();
  } catch (err) {
    next(err);
  }
};
