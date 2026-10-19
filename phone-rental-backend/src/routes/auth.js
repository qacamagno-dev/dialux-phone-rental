const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middlewares/auth');
const { notify } = require('../services/notify');
const { passwordResetMail, welcomeMail, appUrl } = require('../services/mailer');
const { MIN_PASSWORD, RESET_TOKEN_TTL_MIN } = require('../constants');

// ---- Google OAuth Client ----
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const TOKEN_TTL = '7d';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reset links are handed back in the API response outside production, because
// the default install has no SMTP transport and the flow would otherwise be
// untestable. NEVER run a public deployment with NODE_ENV unset — see README.
const EXPOSE_RESET_LINK = process.env.NODE_ENV !== 'production';

function signToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/** Only the hash of a reset token is ever stored, so a DB leak isn't a takeover. */
function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// ============================================================
// 1. REGISTER – Create a new user account
// ============================================================
router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are all required' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'That email address looks invalid' });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    await notify(user._id, {
      type: 'account',
      title: `Welcome to DiaLux, ${name.split(/\s+/)[0]}`,
      message: 'Add a delivery address to your profile and you are ready to book your first device.',
      link: '/profile.html',
    });
    await welcomeMail({ to: user.email, name: user.name });

    res.status(201).json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

// ============================================================
// 2. LOGIN – Email and password authentication
// ============================================================
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

// ============================================================
// 3. GOOGLE LOGIN – OAuth 2.0 authentication
// ============================================================
router.post('/google', async (req, res, next) => {
  try {
    // Check if Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: 'Google sign-in is not configured on this server' });
    }

    const { token: googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ error: 'Missing Google credential' });

    // Verify the Google ID token
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: googleToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      console.error('Google token verification failed:', err.message);
      return res.status(401).json({ error: 'Google authentication failed' });
    }

    const { email, name, picture, sub: googleId, email_verified: emailVerified } = payload;

    if (!email) {
      return res.status(400).json({ error: 'That Google account has no email address' });
    }
    // Accounts are matched by email below, so an unverified address would let
    // anyone who can create it take over an existing local account.
    if (!emailVerified) {
      return res.status(403).json({ error: 'Verify your email with Google first, then try again' });
    }

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Create new user from Google data. No password field at all — a
      // Google-only account can never match in the email/password route.
      user = await User.create({
        name: name || email.split('@')[0],
        email,
        googleId,
        avatar: picture || undefined,
      });
      console.log(`✅ New user created via Google: ${email}`);

      await notify(user._id, {
        type: 'account',
        title: `Welcome to DiaLux, ${(user.name || '').split(/\s+/)[0]}`,
        message: 'Add a delivery address to your profile and you are ready to book your first device.',
        link: '/profile.html',
      });
      await welcomeMail({ to: user.email, name: user.name });
    } else if (!user.googleId) {
      // Link Google identity to existing local account
      user.googleId = googleId;
      if (picture && !user.avatar) user.avatar = picture;
      await user.save();
      console.log(`🔗 Google linked to existing user: ${email}`);
    }

    // Same shape as /login and /register: the full document, with toJSON
    // stripping the password hash and mapping _id → id. Returning a subset
    // here would drop `profile`, which checkout reads for the address.
    res.json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

// ============================================================
// 4. GET CURRENT USER – Protected route
// ============================================================
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    res.json(user);
  } catch (err) { next(err); }
});

// ============================================================
// 5. FORGOT PASSWORD – issue a single-use reset token
// ============================================================
/**
 * Always answers 200 with the same message whether or not the address is
 * registered: a different response for a known email turns this endpoint into
 * an account-enumeration oracle.
 *
 * A Google-only account is allowed through — completing the reset simply gives
 * that account a password as well, which is a legitimate way to add one.
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Enter the email address on your account' });
    }

    const generic = {
      ok: true,
      message: 'If that email is registered, a reset link is on its way.',
    };

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const raw = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = hashToken(raw);
    user.resetTokenExpires = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);
    await user.save();

    const resetUrl = `${appUrl()}/reset-password.html?token=${raw}`;
    const mail = await passwordResetMail({
      to: user.email,
      name: user.name,
      resetUrl,
      ttlMinutes: RESET_TOKEN_TTL_MIN,
    });

    res.json({
      ...generic,
      emailed: mail.delivered,
      transport: mail.transport,
      // Without SMTP the link is only in the server log, which a browser
      // cannot read. Outside production hand it back so the flow is testable.
      ...(!mail.delivered && EXPOSE_RESET_LINK ? { devResetUrl: resetUrl } : {}),
    });
  } catch (err) { next(err); }
});

// ============================================================
// 6. RESET PASSWORD – redeem the token
// ============================================================
router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');

    if (!token) return res.status(400).json({ error: 'This reset link is incomplete' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    // Expiry is part of the query, so an outdated token behaves exactly like
    // an invalid one and the stored fields never need to be read out.
    const user = await User.findOne({
      resetTokenHash: hashToken(token),
      resetTokenExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'That reset link is invalid or has expired — request a new one' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
    // Single use: burn the token whether or not the customer signs in next.
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    await user.save();

    await notify(user._id, {
      type: 'account',
      title: 'Your password was reset',
      message: 'You can now sign in with your new password. If this was not you, contact support immediately.',
      link: '/profile.html',
    });

    // Sign them straight in — they have just proven control of the inbox.
    res.json({ ok: true, token: signToken(user), user });
  } catch (err) { next(err); }
});

// ============================================================
// 7. CHANGE PASSWORD – from inside the profile
// ============================================================
/**
 * Requires the current password, except on an account created through Google
 * that has never had one: there is nothing to verify, and refusing would leave
 * that customer unable to add a password at all.
 */
router.patch('/password', auth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (newPassword.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });

    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Enter your current password' });
      }
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: 'Your current password is incorrect' });

      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'The new password must be different from the current one' });
      }
    }

    const hadPassword = Boolean(user.password);
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    await user.save();

    await notify(user._id, {
      type: 'account',
      title: hadPassword ? 'Your password was changed' : 'Password added to your account',
      message: hadPassword
        ? 'If this was not you, reset your password and contact support.'
        : 'You can now sign in with your email and password as well as Google.',
      link: '/profile.html',
    });

    // A fresh token keeps the session alive after the credential change.
    res.json({ ok: true, token: signToken(user), user });
  } catch (err) { next(err); }
});

module.exports = router;
