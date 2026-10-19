require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const wishlistRoutes = require('./routes/wishlist');
const notificationRoutes = require('./routes/notifications');
const supportRoutes = require('./routes/support');
const pageRoutes = require('./routes/pages');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');
const paymentRoutes = require('./routes/payments');
const riderRoutes = require('./routes/riders');
const chatRoutes = require('./routes/chat');

const Settings = require('./models/Settings');
const User = require('./models/User');
const mailer = require('./services/mailer');

/* ---------------- environment ---------------- */

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variable(s): ${missing.join(', ')}`);
  console.error('   Copy phone-rental-backend/.env.example to .env and fill in the values.');
  process.exit(1);
}
if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn('⚠️  GOOGLE_CLIENT_ID is not set — "Sign in with Google" will fail, other auth is fine.');
}
if (!process.env.PAYMONGO_SECRET_KEY) {
  console.warn('⚠️  PAYMONGO_SECRET_KEY is not set — gcash/maya/card checkout will use the simulated');
  console.warn('   instant-success fallback instead of a real PayMongo charge. See PAYMENTS.md.');
}
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY is not set — the chatbot will not be able to respond.');
}
if (process.env.NODE_ENV !== 'production') {
  console.warn('⚠️  NODE_ENV is not "production" — password-reset links are returned in the API response');
  console.warn('   so the flow is testable without SMTP. Set NODE_ENV=production before deploying.');
}

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_DIR = path.join(__dirname, '../../phone-rental-frontend');

const app = express();
app.use(cors());
// `verify` stashes the exact raw bytes of every request body onto
// req.rawBody alongside the normal parsed req.body. Needed by
// routes/payments.js's webhook handler: PayMongo's signature is an HMAC
// over the raw payload, and re-serializing the parsed JSON would not
// reproduce the same bytes. Harmless/unused for every other route.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Behind a reverse proxy (Render, Railway, nginx) this makes req.ip the real
// client address, which the audit trail records.
app.set('trust proxy', 1);

// Express 5 leaves req.body as undefined when a request carries no body
// (Express 4 defaulted it to {}). Normalise it once here so no route has
// to guard every property read.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

/* ---------------- database ---------------- */

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected');
    // Materialise the settings document on boot so the first checkout of the
    // day isn't the thing that creates it.
    try {
      const s = await Settings.get({ fresh: true });
      console.log(`⚙️  Settings loaded — delivery ${s.currencySymbol}${s.deliveryFee}, protection ${s.protectionFeePct}%`);
    } catch (err) {
      console.warn('⚠️  Could not load settings:', err.message);
    }
  })
  .catch(err => console.error('❌ MongoDB error:', err.message));

/* ---------------- maintenance mode ----------------
   When an administrator switches maintenance on, the storefront stops
   accepting writes. Reads stay open so the catalog is still browsable, and
   /api/auth plus /api/settings stay open so an admin can sign in and switch
   it back off. The role lookup only runs while the flag is set.
--------------------------------------------------------- */

// The PayMongo webhook must always get through, maintenance or not — a
// dropped payment.paid event means a customer paid and the order never
// finds out. PayMongo retries on a non-2xx, but there's no reason to make
// it, and a long maintenance window could outlast its retry schedule.
const SAFE_DURING_MAINTENANCE = ['/api/auth', '/api/settings', '/api/payments/webhook'];

app.use('/api', async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (SAFE_DURING_MAINTENANCE.some(p => req.originalUrl.startsWith(p))) return next();

  try {
    const settings = await Settings.get();
    if (!settings.maintenanceMode) return next();

    // Admins keep working during maintenance — that is the point of it.
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      try {
        const { userId } = jwt.verify(token, process.env.JWT_SECRET);
        const me = await User.findById(userId).select('role');
        if (me?.role === 'admin') return next();
      } catch {
        // fall through to the 503
      }
    }

    return res.status(503).json({
      error: 'DiaLux is in maintenance right now — bookings are paused. Please try again shortly.',
    });
  } catch {
    // Never let the maintenance check itself take the API down.
    return next();
  }
});

/* ---------------- API ---------------- */

app.get('/api/health', (req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    ok: true,
    db: states[mongoose.connection.readyState] || 'unknown',
    mail: mailer.currentTransport(),
    env: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/chat', chatRoutes);

// Unmatched API path — answer in JSON, never with the HTML shell.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

/* ---------------- static frontend ---------------- */

// Serves index.html at "/" plus products.html, cart.html, css/, js/, assets/.
app.use(express.static(FRONTEND_DIR));

// Soft fallback: an unknown non-API path lands on the homepage rather
// than a bare error page.
app.use((req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

/* ---------------- errors ---------------- */

// Four arguments: this is Express's error handler, not a route.
app.use((err, req, res, _next) => {
  if (err?.name === 'ValidationError') {
    const detail = Object.values(err.errors || {}).map(e => e.message).join('; ');
    return res.status(400).json({ error: detail || 'Validation failed' });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({ error: `Invalid value for ${err.path}` });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'That record already exists' });
  }

  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 DiaLux server running on http://localhost:${PORT}`);
});