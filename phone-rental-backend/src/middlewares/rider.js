const User = require('../models/User');

/**
 * Rider gate. Must run AFTER auth middleware.
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: 'Not authenticated',
      });
    }

    const user = await User.findById(req.userId)
      .select('role email name riderDispatch');

    if (!user) {
      return res.status(401).json({
        error: 'Account no longer exists',
      });
    }

    if (user.role !== 'rider') {
      return res.status(403).json({
        error: 'Rider access required',
      });
    }

    req.riderUser = user;
    next();
  } catch (err) {
    next(err);
  }
};