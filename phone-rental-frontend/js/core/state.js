// ============================================================
// DiaLux — core/state.js
// In-memory store, hydrated from the API.
//
// The cart has two backing stores:
//   • signed in  → the server's Cart collection (authoritative)
//   • signed out → localStorage, priced client-side
// Both are normalised to the same shape, so pages never branch on it.
// On sign-in the guest cart is merged into the server cart.
//
// The wishlist follows exactly the same two-store pattern, so saving a device
// works before signing in and survives the sign-up.
//
// Money-shaped values (delivery fee, protection rate, currency symbol) come
// from the server's Settings document, mirrored into state.settings. The
// constants below are only the fallback used before hydration finishes.
// ============================================================

import {
  productsApi, cartApi, ordersApi, usersApi, wishlistApi,
  notificationsApi, settingsApi, paymentsApi, ApiError,
} from './api.js';

const GUEST_CART_KEY = 'phonerent-guest-cart';
const GUEST_DATES_KEY = 'phonerent-guest-dates';
const GUEST_WISH_KEY = 'phonerent-guest-wishlist';
const GUEST_PROTECTION_KEY = 'phonerent-guest-protection';

export const CATEGORIES = [
  { key: 'all',    label: 'All devices' },
  { key: 'phone',  label: 'Smartphones' },
  { key: 'tablet', label: 'Tablets' },
  { key: 'laptop', label: 'Laptops' },
  { key: 'wifi',   label: 'Pocket Wi-Fi' },
];

export const GRADES = ['Like New', 'Good', 'Fair'];
export const PLANS = ['Daily', 'Weekly', 'Monthly'];
export const PLAN_KEY  = { Daily: 'daily', Weekly: 'weekly', Monthly: 'monthly' };
export const PLAN_DAYS = { Daily: 1, Weekly: 7, Monthly: 30 };

// Fallback only — state.settings.deliveryFee is the live figure.
export const DELIVERY_FEE = 150;
export const MEETUP_FEE = 50;

// MUST stay identical to PICKUP_HUBS in the backend's constants.js — the
// server is the source of truth and rejects any id not in its own list,
// this copy only drives the picker UI.
export const PICKUP_HUBS = [
  { id: 'katipunan', name: 'DiaLux Hub — Katipunan', address: 'Katipunan Ave, Quezon City' },
  { id: 'cubao', name: 'DiaLux Hub — Cubao', address: 'Araneta City, Cubao, Quezon City' },
  { id: 'fairview', name: 'DiaLux Hub — Fairview', address: 'Fairview Terraces, Quezon City' },
];

export const ORDER_TYPES = ['delivery', 'pickup', 'meetup'];

// The whole life of an order, as the vertical timeline on the booking page
// (pages/order.js) draws it. Each stage lists the order statuses that put
// it "current"; `skipFor` hides stages an order type never goes through
// (a hub pickup has no rider legs and is never "delivered" — the customer
// collects it, then confirms receipt). Mirrors ORDER_STATUSES in the
// backend's constants.js.
export const ORDER_STAGES = [
  { key: 'placed',    label: 'Order placed',       description: 'We have your booking and are waiting for payment.', statuses: ['pending'] },
  { key: 'paid',      label: 'Payment confirmed',  description: 'Your payment was received and your booking is confirmed.', statuses: ['payment-confirmed', 'approved'] },
  { key: 'preparing', label: 'Preparing',          description: 'We are checking and data-wiping your device.', statuses: ['preparing'] },
  { key: 'dispatch',  label: 'Ready to go',        description: 'Packed and waiting for the rider.', pickupLabel: 'Ready for pickup', pickupDescription: 'Your device is ready at your chosen hub.', statuses: ['ready-for-pickup', 'shipped', 'picked-up'] },
  { key: 'transit',   label: 'On the way',         description: 'Your rider is heading to you.', statuses: ['out-for-delivery', 'in-transit', 'arriving'], skipFor: ['pickup'] },
  { key: 'delivered', label: 'Delivered',          description: 'The device has arrived. Please confirm you received it.', statuses: ['delivered', 'disputed'], skipFor: ['pickup'] },
  { key: 'received',  label: 'Receipt confirmed',  description: 'You confirmed the device is as described.', statuses: ['received'] },
  { key: 'active',    label: 'Rental active',      description: 'Enjoy the device. Your rental clock is running.', statuses: ['active'] },
  { key: 'return-req',label: 'Return requested',   description: 'Waiting for us to arrange your return.', statuses: ['return-requested'] },
  { key: 'return-sch',label: 'Return scheduled',   description: 'Your return slot is confirmed.', statuses: ['return-scheduled'] },
  { key: 'return-trn',label: 'Return in transit',  description: 'The device is on its way back to us.', statuses: ['return-in-transit'], skipFor: ['pickup'] },
  { key: 'returned',  label: 'Returned',           description: 'The device is back with us.', statuses: ['returned'] },
  { key: 'inspect',   label: 'Inspection',         description: 'Our technician is checking the device.', statuses: ['inspection', 'inspection-passed', 'inspection-failed'] },
  { key: 'refund',    label: 'Deposit refund',     description: 'Your deposit is being settled.', statuses: ['refund-processing', 'refund-partial', 'refunded'] },
  { key: 'done',      label: 'Completed',          description: 'All done. Thank you for renting with DiaLux.', statuses: ['completed'] },
];

// Kept under its old name so older callers (profile.js's progress strip)
// keep working; it is simply the full stage list now.
export const TIMELINE_STEPS = ORDER_STAGES;

// status → index into ORDER_STAGES. 'cancelled' sits outside the timeline (-1).
export const STATUS_STAGE = { cancelled: -1 };
ORDER_STAGES.forEach((stage, i) => stage.statuses.forEach(st => { STATUS_STAGE[st] = i; }));

// Statuses nothing will change on its own — used to stop polling the order page.
export const TERMINAL_OR_MANUAL_STATUSES = ['completed', 'cancelled'];

export const ORDER_STATUSES = [
  'pending', 'payment-confirmed', 'approved', 'preparing', 'ready-for-pickup',
  'shipped', 'out-for-delivery', 'picked-up', 'in-transit', 'arriving',
  'delivered', 'received', 'disputed', 'active',
  'return-requested', 'return-scheduled', 'return-in-transit', 'returned',
  'inspection', 'inspection-passed', 'inspection-failed',
  'refund-processing', 'refund-partial', 'refunded', 'completed', 'cancelled',
];

// Mirrors routes/orders.js's ADMIN_STATUS_BLOCKLIST — statuses an admin
// cannot set by hand through the generic "move fulfilment status" form,
// because each already has its own dedicated, more correct path (the
// auto-progressor, the assigned rider's own actions, or the inspection/
// refund routes, which actually compute a settlement). Used only to keep
// the dropdown from offering options the backend will reject anyway — the
// backend's own copy of this list is the real enforcement.
export const ADMIN_STATUS_BLOCKLIST = [
  'preparing', 'ready-for-pickup', 'shipped', 'out-for-delivery',
  'picked-up', 'in-transit', 'arriving', 'delivered',
  'return-in-transit', 'returned',
  'inspection', 'inspection-passed', 'inspection-failed',
  'refund-processing', 'refund-partial', 'completed', 'refunded',
];

// Late-return penalty copy and the slots a return can be booked into.
export const RETURN_SLOTS = ['Morning (9 AM - 12 PM)', 'Afternoon (1 - 5 PM)', 'Evening (5 - 8 PM)'];
export const INSPECTION_CHECKLIST = [
  { key: 'screen', label: 'Screen' }, { key: 'body', label: 'Body & frame' },
  { key: 'ports', label: 'Ports & buttons' }, { key: 'camera', label: 'Camera' }, { key: 'battery', label: 'Battery' },
];

export const SUPPORT_STATUSES = ['open', 'in-progress', 'resolved', 'closed'];

export const SUPPORT_CATEGORIES = [
  { key: 'booking', label: 'A booking or payment' },
  { key: 'device',  label: 'A device problem' },
  { key: 'payment', label: 'Billing' },
  { key: 'return',  label: 'A return or deposit' },
  { key: 'account', label: 'My account' },
  { key: 'other',   label: 'Something else' },
];

export const PAGE_SLUGS = ['about', 'team', 'contact', 'help', 'terms', 'privacy'];

// Statuses at which a device has reached the customer — the point from which
// they may review it. Mirrors QUALIFYING_REVIEW_STATUSES in the backend; the
// server re-checks this authoritatively, so this is just for showing the form.
export const REVIEWABLE_STATUSES = ['delivered', 'received', 'active', 'return-requested', 'return-scheduled', 'return-in-transit', 'returned', 'inspection', 'inspection-passed', 'inspection-failed', 'refund-processing', 'refund-partial', 'completed'];

const EMPTY_CART = {
  lines: [], count: 0, rent: 0, deposit: 0, delivery: 0,
  protection: false, protectionFee: 0, protectionQuote: 0, total: 0,
};

// Mirrors the server's DEFAULT_SETTINGS so pricing is sane before hydration.
const DEFAULT_SETTINGS = {
  brandName: 'DiaLux',
  currencyCode: 'PHP',
  currencySymbol: '₱',
  deliveryFee: DELIVERY_FEE,
  freeDeliveryThreshold: 0,
  protectionFeePct: 8,
  lowStockThreshold: 2,
  minRentalDays: 1,
  maxRentalDays: 180,
  paymentMethods: ['gcash', 'maya', 'card', 'cash', 'bank-transfer'],
  meetupFee: MEETUP_FEE,
  supportEmail: 'support@dialux.test',
  maintenanceMode: false,
};

export const state = {
  products: [],
  cart: { ...EMPTY_CART },
  orders: [],
  wishlist: [],          // product objects
  wishlistIds: [],       // string ids, for O(1)-ish membership checks
  notifications: [],
  unread: 0,
  settings: { ...DEFAULT_SETTINGS },
  user: null,
  ready: false,
  offline: false,   // true when the API could not be reached
};

/* ---------------- guest cart persistence ---------------- */

function readGuestCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(i => i && i.productId) : [];
  } catch { return []; }
}

function writeGuestCart(items) {
  try { localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

export function clearGuestCart() {
  writeGuestCart([]);
  try {
    localStorage.removeItem(GUEST_DATES_KEY);
    localStorage.removeItem(GUEST_PROTECTION_KEY);
  } catch { /* ignore */ }
}

/* ---------------- guest rental dates ---------------- */

function readGuestDates() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_DATES_KEY) || '{}');
    return {
      startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
      endDate:   typeof raw.endDate === 'string' ? raw.endDate : '',
    };
  } catch { return { startDate: '', endDate: '' }; }
}

function writeGuestDates(startDate, endDate) {
  try {
    localStorage.setItem(GUEST_DATES_KEY, JSON.stringify({ startDate, endDate }));
  } catch { /* ignore */ }
}

function readGuestProtection() {
  try { return localStorage.getItem(GUEST_PROTECTION_KEY) === '1'; } catch { return false; }
}

function writeGuestProtection(on) {
  try { localStorage.setItem(GUEST_PROTECTION_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

/* ---------------- guest wishlist ---------------- */

function readGuestWishlist() {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_WISH_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(id => typeof id === 'string') : [];
  } catch { return []; }
}

function writeGuestWishlist(ids) {
  try { localStorage.setItem(GUEST_WISH_KEY, JSON.stringify([...new Set(ids)])); } catch { /* ignore */ }
}

export function clearGuestWishlist() {
  writeGuestWishlist([]);
}

/* ---------------- pricing ---------------- */

export function productById(id) {
  return state.products.find(p => p.id === String(id));
}

export function rateFor(p, plan) {
  return p?.[PLAN_KEY[plan] || 'weekly'] || 0;
}

/** The live currency symbol, falling back to the peso. */
export function currencySymbol() {
  return state.settings?.currencySymbol || '₱';
}

/**
 * Whole calendar days between two YYYY-MM-DD dates, minimum 1.
 * Sep 1 → Sep 8 = 7; same day (or invalid) = 1.
 */
export function daysBetween(startDate, endDate) {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

/**
 * Cheapest rent for `days` across the daily/weekly/monthly tiers, overshoot
 * allowed. MUST stay identical to bestValue() in the backend's constants.js
 * so the cart total equals the amount charged at checkout.
 */
export function bestValue(p, days) {
  const n = Math.max(1, Math.ceil(Number(days) || 1));
  const tiers = [
    [1, Number(p.daily) || 0],
    [7, Number(p.weekly) || 0],
    [30, Number(p.monthly) || 0],
  ].filter(t => t[1] > 0);
  if (!tiers.length) return 0;

  const dp = new Array(n + 1).fill(Infinity);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (const [len, rate] of tiers) {
      dp[i] = Math.min(dp[i], dp[Math.max(0, i - len)] + rate);
    }
  }
  return dp[n];
}

/**
 * Daily/Weekly/Monthly if a rental's length is exactly that many days,
 * else Custom. Shared by checkout.js and cart.js (Bug 1.1 / Bug 1.4) so
 * the two pages can't drift into labelling the same range differently.
 */
export function planLabelFor(days) {
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days === 30) return 'Monthly';
  return 'Custom';
}

/**
 * What actually gets sent to the backend's `plan` field, which only
 * accepts Daily/Weekly/Monthly (constants.js's PLANS) — it's a record
 * label, not what sets the price (bestValue() on the server recomputes
 * the real, possibly mixed-tier total independently of it). A
 * custom-length rental is filed under whichever bracket it's closest to,
 * purely for that record.
 */
export function planFieldFor(days) {
  if (days <= 1) return 'Daily';
  if (days < 30) return 'Weekly';
  return 'Monthly';
}

/**
 * The data behind the "Best value: Weekly (saves ₱X)" hint — compares
 * bestValue()'s already-optimal, possibly mixed-tier total against what
 * the daily rate alone would have cost for the same range, and names
 * whichever single tier has the lowest per-day rate as the one worth
 * knowing about. Returns null when there's no daily rate to compare
 * against, or nothing is actually saved. Pure data, not a formatted
 * string — currency formatting (peso()) lives in core/ui.js, which this
 * module doesn't depend on, so the caller formats `savings` itself; see
 * bestValueHintText() in pages/checkout.js and pages/cart.js.
 */
export function bestValueHint(p, days) {
  const daily = Number(p.daily) || 0;
  if (!daily) return null;

  const optimalTotal = bestValue(p, days);
  const dailyOnlyTotal = daily * days;
  const savings = dailyOnlyTotal - optimalTotal;
  if (savings <= 0) return null;

  const tiers = [
    ['Daily', daily, 1],
    ['Weekly', Number(p.weekly) || 0, 7],
    ['Monthly', Number(p.monthly) || 0, 30],
  ].filter(t => t[1] > 0);
  let best = tiers[0];
  for (const t of tiers) { if (t[1] / t[2] < best[1] / best[2]) best = t; }

  return { tierName: best[0], savings };
}

/** Delivery charge for a rent subtotal. Mirrors deliveryFeeFor() server-side. */
export function deliveryFeeFor(rent) {
  const s = state.settings || DEFAULT_SETTINGS;
  const fee = Number(s.deliveryFee ?? DELIVERY_FEE) || 0;
  const threshold = Number(s.freeDeliveryThreshold) || 0;
  if (threshold > 0 && Number(rent) >= threshold) return 0;
  return fee;
}

/**
 * Fulfilment fee for the chosen order type — delivery/pickup/meet-up.
 * Mirrors orderTypeFeeFor() in the backend's constants.js. This is a
 * *preview* for the checkout UI; the server recomputes it from its own
 * Settings before charging anyone, so a stale client value here can
 * never under- or over-charge a booking.
 */
export function orderTypeFeeFor(orderType, rent) {
  if (orderType === 'pickup') return 0;
  if (orderType === 'meetup') {
    const s = state.settings || DEFAULT_SETTINGS;
    return Math.max(0, Number(s.meetupFee ?? MEETUP_FEE) || 0);
  }
  return deliveryFeeFor(rent); // 'delivery', and the historical default
}

/** Optional damage cover. Mirrors protectionFeeFor() server-side. */
export function protectionFeeFor(rent) {
  const pct = Number(state.settings?.protectionFeePct) || 0;
  if (pct <= 0) return 0;
  return Math.round((Number(rent) || 0) * (pct / 100));
}

export function brands() {
  return [...new Set(state.products.map(p => p.brand))].sort();
}

/** Price a guest cart from the loaded catalog, matching the server shape. */
function priceGuestCart(items) {
  const { startDate, endDate } = readGuestDates();
  const days = (startDate && endDate) ? daysBetween(startDate, endDate) : 7;
  const protection = readGuestProtection();

  const lines = items.map(i => {
    const p = productById(i.productId);
    if (!p) return null;
    const rate = bestValue(p, days);
    const qty = Math.max(1, Math.min(Number(i.qty) || 1, p.stock || 1));
    return {
      productId: p.id,
      name: p.name,
      cat: p.cat,
      brand: p.brand,
      grade: p.grade,
      image: p.image,
      stock: p.stock,
      plan: i.plan,
      qty,
      rate,
      deposit: p.deposit,
      days,
      rentSubtotal: rate * qty,
      depositSubtotal: p.deposit * qty,
    };
  }).filter(Boolean);

  const rent = lines.reduce((s, l) => s + l.rentSubtotal, 0);
  const deposit = lines.reduce((s, l) => s + l.depositSubtotal, 0);
  const delivery = lines.length ? deliveryFeeFor(rent) : 0;
  const protectionQuote = lines.length ? protectionFeeFor(rent) : 0;
  const protectionFee = protection ? protectionQuote : 0;

  return {
    lines,
    count: lines.reduce((s, l) => s + l.qty, 0),
    startDate, endDate, days,
    rent, deposit, delivery,
    protection, protectionFee, protectionQuote,
    protectionPct: Number(state.settings?.protectionFeePct) || 0,
    total: rent + deposit + delivery + protectionFee,
  };
}

function refreshGuestCart() {
  const items = readGuestCart();
  state.cart = priceGuestCart(items);
  // Drop lines whose product vanished from the catalog.
  if (state.cart.lines.length !== items.length) {
    writeGuestCart(state.cart.lines.map(l => ({ productId: l.productId, plan: l.plan, qty: l.qty })));
  }
  return state.cart;
}

/** Rebuild the guest wishlist from the loaded catalog. */
function refreshGuestWishlist() {
  const ids = readGuestWishlist();
  const products = ids.map(id => productById(id)).filter(Boolean);
  state.wishlist = products;
  state.wishlistIds = products.map(p => p.id);
  // Prune ids for devices that left the catalog.
  if (products.length !== ids.length) writeGuestWishlist(state.wishlistIds);
  return state.wishlist;
}

export function cartCount() {
  return state.cart.count || 0;
}

export function wishlistCount() {
  return state.wishlistIds.length;
}

export function isWishlisted(productId) {
  return state.wishlistIds.includes(String(productId));
}

/* ---------------- hydration ---------------- */

export async function loadProducts(params) {
  const data = await productsApi.list(params);
  state.products = data.products || [];
  return state.products;
}

export async function loadSettings() {
  try {
    const s = await settingsApi.get();
    if (s) state.settings = { ...DEFAULT_SETTINGS, ...s };
  } catch {
    // Keep the defaults — the storefront still prices correctly enough to browse.
  }
  return state.settings;
}

/**
 * Load everything the current page might need. Settings and products always;
 * cart, orders, wishlist and notifications only when signed in. Never throws —
 * sets state.offline instead, so a dead backend degrades rather than blanking
 * the page.
 */
export async function hydrate() {
  // Settings first: guest cart pricing depends on the delivery fee.
  await loadSettings();

  try {
    await loadProducts();
    state.offline = false;
  } catch (err) {
    state.offline = true;
    state.products = [];
    console.error('[DiaLux] could not load catalog:', err.message);
  }

  if (state.user) {
    const [cart, orders, wishlist, notifications] = await Promise.all([
      cartApi.get().catch(() => ({ ...EMPTY_CART })),
      ordersApi.mine().catch(() => ({ orders: [] })),
      wishlistApi.get().catch(() => ({ products: [], ids: [] })),
      notificationsApi.list({ limit: 20 }).catch(() => ({ notifications: [], unread: 0 })),
    ]);

    state.cart = cart || { ...EMPTY_CART };
    state.orders = orders.orders || [];
    state.wishlist = wishlist.products || [];
    state.wishlistIds = wishlist.ids || state.wishlist.map(p => p.id);
    state.notifications = notifications.notifications || [];
    state.unread = notifications.unread || 0;
  } else {
    refreshGuestCart();
    refreshGuestWishlist();
    state.orders = [];
    state.notifications = [];
    state.unread = 0;
  }

  state.ready = true;
  return state;
}

/* ---------------- cart mutations ----------------
   All return { ok, error } and never throw, so callers can render an
   error toast without a try/catch at every call site.
--------------------------------------------------------- */

function fail(err) {
  const message = err instanceof ApiError ? err.message : (err?.message || 'Something went wrong');
  return { ok: false, error: message };
}

export async function addToCart(productId, plan = 'Weekly', qty = 1) {
  const product = productById(productId);
  if (!product) return { ok: false, error: 'Device not found' };
  if (product.stock === 0) return { ok: false, error: `${product.name} is out of stock` };

  if (state.user) {
    try {
      state.cart = await cartApi.addItem(productId, plan, qty);
      return { ok: true, product };
    } catch (err) { return fail(err); }
  }

  const items = readGuestCart();
  const line = items.find(i => i.productId === productId && i.plan === plan);
  const already = line ? line.qty : 0;
  if (already + qty > product.stock) {
    return {
      ok: false,
      error: `Only ${product.stock} unit${product.stock === 1 ? '' : 's'} of ${product.name} available`,
    };
  }

  if (line) line.qty = already + qty;
  else items.push({ productId, plan, qty });

  writeGuestCart(items);
  refreshGuestCart();
  return { ok: true, product };
}

export async function updateCartLine(productId, plan, patch) {
  if (state.user) {
    try {
      state.cart = await cartApi.updateItem(productId, plan, patch);
      return { ok: true };
    } catch (err) { return fail(err); }
  }

  const items = readGuestCart();
  const line = items.find(i => i.productId === productId && i.plan === plan);
  if (!line) return { ok: false, error: 'Item not in cart' };

  const product = productById(productId);

  if (patch.newPlan && patch.newPlan !== plan) {
    const existing = items.find(i => i.productId === productId && i.plan === patch.newPlan);
    if (existing) {
      existing.qty += line.qty;
      items.splice(items.indexOf(line), 1);
    } else {
      line.plan = patch.newPlan;
    }
  }

  if (patch.qty !== undefined) {
    const target = items.find(i => i.productId === productId && i.plan === (patch.newPlan || plan));
    const wanted = Math.round(Number(patch.qty));
    if (!Number.isFinite(wanted) || wanted < 1) return { ok: false, error: 'Quantity must be 1 or more' };
    if (product && wanted > product.stock) {
      return { ok: false, error: `Only ${product.stock} unit${product.stock === 1 ? '' : 's'} available` };
    }
    if (target) target.qty = wanted;
  }

  writeGuestCart(items);
  refreshGuestCart();
  return { ok: true };
}

export async function removeCartLine(productId, plan) {
  if (state.user) {
    try {
      state.cart = await cartApi.removeItem(productId, plan);
      return { ok: true };
    } catch (err) { return fail(err); }
  }

  const items = readGuestCart().filter(i => !(i.productId === productId && i.plan === plan));
  writeGuestCart(items);
  refreshGuestCart();
  return { ok: true };
}

export async function emptyCart() {
  if (state.user) {
    try {
      state.cart = await cartApi.clear();
      return { ok: true };
    } catch (err) { return fail(err); }
  }
  clearGuestCart();
  refreshGuestCart();
  return { ok: true };
}

/**
 * Set the rental window that prices the whole cart. Signed-in carts persist
 * the dates server-side; guest carts keep them in localStorage. Both re-price
 * with the same bestValue day-count logic, so the total stays consistent.
 */
export async function setCartDates(startDate, endDate) {
  if (state.user) {
    try {
      state.cart = await cartApi.setDates(startDate, endDate);
      return { ok: true };
    } catch (err) { return fail(err); }
  }
  writeGuestDates(startDate, endDate);
  refreshGuestCart();
  return { ok: true };
}

/** Turn optional damage protection on or off for the cart. */
export async function setCartProtection(on) {
  if (state.user) {
    try {
      state.cart = await cartApi.setProtection(Boolean(on));
      return { ok: true };
    } catch (err) { return fail(err); }
  }
  writeGuestProtection(Boolean(on));
  refreshGuestCart();
  return { ok: true };
}

/** Fold a guest cart into the server cart. Called right after sign-in. */
export async function mergeGuestCartIntoServer() {
  const items = readGuestCart();
  const dates = readGuestDates();

  if (!items.length) {
    try { state.cart = await cartApi.get(); } catch { /* leave as-is */ }
  } else {
    try {
      state.cart = await cartApi.merge(items, dates);
      clearGuestCart();
    } catch (err) {
      console.error('[DiaLux] cart merge failed:', err.message);
    }
  }

  await mergeGuestWishlistIntoServer();
}

/**
 * Fold a guest wishlist into the account. There is no bulk endpoint — the
 * list is small and POST /wishlist/:id is idempotent, so a handful of parallel
 * calls is simpler than a dedicated merge route.
 */
export async function mergeGuestWishlistIntoServer() {
  const ids = readGuestWishlist();
  try {
    if (ids.length) {
      await Promise.allSettled(ids.map(id => wishlistApi.add(id)));
      clearGuestWishlist();
    }
    const data = await wishlistApi.get();
    state.wishlist = data.products || [];
    state.wishlistIds = data.ids || state.wishlist.map(p => p.id);
  } catch (err) {
    console.error('[DiaLux] wishlist merge failed:', err.message);
  }
}

/* ---------------- wishlist mutations ---------------- */

export async function addToWishlist(productId) {
  const product = productById(productId);
  const id = String(productId);

  if (state.user) {
    try {
      const data = await wishlistApi.add(id);
      state.wishlist = data.products || [];
      state.wishlistIds = data.ids || state.wishlist.map(p => p.id);
      return { ok: true, product, saved: true };
    } catch (err) { return fail(err); }
  }

  const ids = readGuestWishlist();
  if (!ids.includes(id)) ids.push(id);
  writeGuestWishlist(ids);
  refreshGuestWishlist();
  return { ok: true, product, saved: true };
}

export async function removeFromWishlist(productId) {
  const product = productById(productId) || state.wishlist.find(p => p.id === String(productId));
  const id = String(productId);

  if (state.user) {
    try {
      const data = await wishlistApi.remove(id);
      state.wishlist = data.products || [];
      state.wishlistIds = data.ids || state.wishlist.map(p => p.id);
      return { ok: true, product, saved: false };
    } catch (err) { return fail(err); }
  }

  writeGuestWishlist(readGuestWishlist().filter(x => x !== id));
  refreshGuestWishlist();
  return { ok: true, product, saved: false };
}

/** Heart-button behaviour: on when it wasn't, off when it was. */
export async function toggleWishlist(productId) {
  return isWishlisted(productId)
    ? removeFromWishlist(productId)
    : addToWishlist(productId);
}

export async function emptyWishlist() {
  if (state.user) {
    try {
      await wishlistApi.clear();
      state.wishlist = [];
      state.wishlistIds = [];
      return { ok: true };
    } catch (err) { return fail(err); }
  }
  clearGuestWishlist();
  refreshGuestWishlist();
  return { ok: true };
}

/** Move a saved device into the cart, dropping it from the wishlist. */
export async function moveWishlistToCart(productId, plan = 'Weekly') {
  const res = await addToCart(productId, plan, 1);
  if (!res.ok) return res;
  await removeFromWishlist(productId);
  return res;
}

/* ---------------- notifications ---------------- */

export async function refreshNotifications() {
  if (!state.user) {
    state.notifications = [];
    state.unread = 0;
    return state.notifications;
  }
  try {
    const data = await notificationsApi.list({ limit: 20 });
    state.notifications = data.notifications || [];
    state.unread = data.unread || 0;
  } catch { /* keep what we have */ }
  return state.notifications;
}

export async function markNotificationRead(id) {
  try {
    const data = await notificationsApi.markRead(id);
    const i = state.notifications.findIndex(n => n.id === id);
    if (i >= 0 && data.notification) state.notifications[i] = data.notification;
    state.unread = data.unread ?? Math.max(0, state.unread - 1);
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function markAllNotificationsRead() {
  try {
    await notificationsApi.markAllRead();
    state.notifications = state.notifications.map(n => ({ ...n, read: true }));
    state.unread = 0;
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function dismissNotification(id) {
  try {
    const data = await notificationsApi.remove(id);
    state.notifications = state.notifications.filter(n => n.id !== id);
    state.unread = data.unread ?? state.unread;
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function clearNotifications() {
  try {
    await notificationsApi.clear();
    state.notifications = [];
    state.unread = 0;
    return { ok: true };
  } catch (err) { return fail(err); }
}

/* ---------------- orders ---------------- */

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr || isoDate()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function placeOrder({ address, addressId, startDate, endDate, protection } = {}) {
  if (!state.user) return { ok: false, error: 'Please sign in first' };
  try {
    const order = await ordersApi.create({ address, addressId, startDate, endDate, protection });
    state.orders.unshift(order);
    state.cart = { ...EMPTY_CART };
    await loadProducts().catch(() => {});   // stock changed
    return { ok: true, order };
  } catch (err) { return fail(err); }
}

/**
 * "Order now" — book one device directly, skipping the cart entirely.
 *
 * Unlike placeOrder(), this deliberately leaves state.cart alone: the
 * customer's existing cart survives an express checkout untouched.
 */
export async function orderNow({
  productId, plan = 'Weekly', qty = 1, address, addressId, startDate, endDate, protection,
  orderType, pickupHub, meetupLocation, timeSlot,
} = {}) {
  if (!state.user) return { ok: false, error: 'Please sign in first' };
  try {
    const order = await ordersApi.createDirect({
      productId, plan, qty, address, addressId, startDate, endDate, protection,
      orderType, pickupHub, meetupLocation, timeSlot,
    });
    state.orders.unshift(order);
    await loadProducts().catch(() => {});   // stock changed
    return { ok: true, order };
  } catch (err) { return fail(err); }
}

export async function refreshOrders() {
  if (!state.user) { state.orders = []; return state.orders; }
  try {
    const data = await ordersApi.mine();
    state.orders = data.orders || [];
  } catch { /* keep what we have */ }
  return state.orders;
}

/**
 * True when the signed-in user has an order for this product that has reached
 * a reviewable status. Used to decide whether to show the review form; the
 * POST endpoint enforces the same rule server-side.
 */
export function hasReviewableOrder(productId) {
  const pid = String(productId);
  return state.orders.some(o =>
    REVIEWABLE_STATUSES.includes(o.status) &&
    (o.items || []).some(i => String(i.product) === pid)
  );
}

function replaceOrder(order) {
  const i = state.orders.findIndex(o => o.id === order.id);
  if (i >= 0) state.orders[i] = order;
  else state.orders.unshift(order);
}

export async function cancelOrder(id) {
  try {
    replaceOrder(await ordersApi.cancel(id));
    await loadProducts().catch(() => {});
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function requestReturn(id, plan) {
  try {
    replaceOrder(await ordersApi.requestReturn(id, plan));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function confirmReceipt(id) {
  try {
    replaceOrder(await ordersApi.confirmReceipt(id));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function reportIssue(id, report) {
  try {
    replaceOrder(await ordersApi.reportIssue(id, report));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function extendRental(id) {
  try {
    const { order, days } = await ordersApi.extend(id);
    replaceOrder(order);
    return { ok: true, days };
  } catch (err) { return fail(err); }
}

/**
 * Pay (or re-pay) a pending order through the PayMongo flow. Resolves to
 * { ok, redirect } — the caller sends the browser to `redirect` (PayMongo's
 * hosted page, or back to the order page when payments are simulated).
 */
export async function payOrder(id, method = 'gcash') {
  try {
    await paymentsApi.intent(id);
    const r = await paymentsApi.method(id, method);
    return { ok: true, redirect: r.checkoutUrl || r.redirectUrl || `/order.html?id=${id}` };
  } catch (err) { return fail(err); }
}

/* ---------------- profile ---------------- */

export function currentProfile() {
  return state.user?.profile || null;
}

export function currentAddresses() {
  return state.user?.addresses || [];
}

export function defaultAddress() {
  const list = currentAddresses();
  return list.find(a => a.isDefault) || list[0] || null;
}

/** Replace the cached user after any account write. */
function setUser(user) {
  if (user) state.user = { ...state.user, ...user };
  return state.user;
}

export async function saveProfile(patch) {
  if (!state.user) return { ok: false, error: 'Please sign in first' };
  try {
    setUser(await usersApi.saveProfile(patch));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function saveAccount(patch) {
  if (!state.user) return { ok: false, error: 'Please sign in first' };
  try {
    setUser(await usersApi.updateMe(patch));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function addAddress(payload) {
  if (!state.user) return { ok: false, error: 'Please sign in first' };
  try {
    setUser(await usersApi.addAddress(payload));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function updateAddress(addressId, payload) {
  try {
    setUser(await usersApi.updateAddress(addressId, payload));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function setDefaultAddress(addressId) {
  try {
    setUser(await usersApi.setDefaultAddress(addressId));
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function removeAddress(addressId) {
  try {
    setUser(await usersApi.removeAddress(addressId));
    return { ok: true };
  } catch (err) { return fail(err); }
}