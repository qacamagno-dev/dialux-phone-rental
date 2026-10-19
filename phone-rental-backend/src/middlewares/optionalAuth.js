const jwt = require('jsonwebtoken');

/**
 * Attach the caller's identity when a valid token is present, and carry on
 * regardless when it is not.
 *
 * For endpoints that serve both visitors and customers — the contact form is
 * the one that matters: a signed-out visitor must be able to send a message,
 * but when a session *is* present we want the ticket linked to the account so
 * the reply can reach their notifications.
 *
 * Never sends 401. Use middlewares/auth.js when a session is required.
 */
module.exports = (req, _res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.user = decoded;
  } catch {
    // An expired or forged token is treated exactly like no token at all.
  }
  next();
};
