const User = require('../models/User');

/**
 * Staff gate (admin OR technician). Must run AFTER the auth middleware.
 *
 * Used by the return-inspection endpoints, which a technician may call
 * without holding full admin rights. Same reasoning as middlewares/admin.js:
 * the role is read from the database, not the JWT.
 *
 * Leaves the user on `req.staffUser` (audit.js picks that up as the actor)
 * and `req.staffRole` so a handler can still tell the two apart.
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Not authenticated' });

    const user = await User.findById(req.userId).select('role email name');
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    if (!['admin', 'technician'].includes(user.role)) {
      return res.status(403).json({ error: 'Technician or administrator access required' });
    }

    req.staffUser = user;
    req.staffRole = user.role;
    next();
  } catch (err) {
    next(err);
  }
};
