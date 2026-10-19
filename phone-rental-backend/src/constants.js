// ============================================================
// DiaLux — shared domain constants
// Kept in one place so routes, models and validation agree.
// ============================================================

// 'rider' and 'technician' added for Phase 2 (delivery) / Phase 3
// (inspection). models/User.js's schema enum MUST match this list.
const ROLES = ['user', 'admin', 'rider', 'technician'];

const CATEGORIES = ['phone', 'tablet', 'laptop', 'wifi'];

const GRADES = ['Like New', 'Good', 'Fair'];

const PLANS = ['Daily', 'Weekly', 'Monthly'];

const PLAN_KEY = { Daily: 'daily', Weekly: 'weekly', Monthly: 'monthly' };

const PLAN_DAYS = { Daily: 1, Weekly: 7, Monthly: 30 };

// Every status an order can hold, grouped by what part of the lifecycle
// they belong to (requested for Phase 2's rider/delivery system).
//
// 'shipped' and 'out-for-delivery' predate the rider system and stay
// generic/courier-agnostic; 'picked-up' / 'in-transit' / 'arriving' are the
// rider-driven equivalents for an order that has an assigned rider (see
// models/Delivery.js and routes/riders.js). Both sets are kept side by
// side rather than merged, as requested — an order without a rider still
// moves through the generic chain, one with a rider moves through the
// rider-specific one.
const ORDER_STATUSES = [
  // Fulfilment
  'pending',
  'payment-confirmed',
  'approved',
  'preparing',
  'ready-for-pickup',   // pickup-hub orders only — not in the original brief's
                         // explicit status list, but referenced by its admin
                         // rider-assignment rule and by Phase 4's config, so
                         // it has to exist somewhere for either to make sense.
  'shipped',
  'out-for-delivery',
  'picked-up',
  'in-transit',
  'arriving',
  'delivered',
  'received',            // customer confirmed receipt (Phase 3)
  'disputed',            // customer says the device is not as described / not received (Phase 3)

  // Rental active
  'active',

  // Return
  'return-requested',
  'return-scheduled',
  'return-in-transit',
  'returned',
  'inspection',
  'inspection-passed',
  'inspection-failed',

  // Terminal
  'refund-processing',
  'refund-partial',
  'refunded',
  'completed',
  'cancelled',
];

// Statuses in which the units are considered still out with a customer (or
// in the return pipeline but not yet signed off), so stock stays
// decremented. Only a fully financially-closed order releases its unit.
const OPEN_STATUSES = ORDER_STATUSES.filter(
  s => !['cancelled', 'completed', 'refunded', 'refund-processing', 'refund-partial'].includes(s)
);

// Statuses in which a customer has actually received the device, so they
// are allowed to review it. Anything before "delivered"/"received" hasn't
// reached them yet.
const QUALIFYING_REVIEW_STATUSES = [
  'delivered', 'received', 'active', 'return-requested', 'return-scheduled',
  'return-in-transit', 'returned', 'inspection', 'inspection-passed',
  'inspection-failed', 'refund-processing', 'refund-partial', 'completed',
];

// Payment methods offered at checkout. gcash/maya/card route through
// PayMongo (see routes/payments.js); cash and bank-transfer are handled
// entirely in-house (no gateway call).
const PAYMENT_METHODS = ['gcash', 'maya', 'card', 'cash', 'bank-transfer'];

// Which methods PayMongo's Checkout Sessions API actually settles online.
// cash and bank-transfer never reach PayMongo.
const GATEWAY_PAYMENT_METHODS = ['gcash', 'maya', 'card'];

// PayMongo's own payment_method_types values. Only 'maya' differs from our
// internal key (still called "paymaya" on PayMongo's side).
const PAYMONGO_METHOD_MAP = { gcash: 'gcash', maya: 'paymaya', card: 'card' };

// Lifecycle of the `payment` subdocument on an Order (models/Order.js).
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

// How the customer receives the device. Each has its own fee rule — see
// orderTypeFeeFor() below — and its own required fields, validated in
// routes/orders.js's resolveOrderType().
const ORDER_TYPES = ['delivery', 'pickup', 'meetup'];

// Hardcoded for now, as requested — move to a Hub model/collection if these
// ever need to be managed from the admin dashboard instead of a deploy.
const PICKUP_HUBS = [
  { id: 'katipunan', name: 'DiaLux Hub — Katipunan', address: 'Katipunan Ave, Quezon City' },
  { id: 'cubao', name: 'DiaLux Hub — Cubao', address: 'Araneta City, Cubao, Quezon City' },
  { id: 'fairview', name: 'DiaLux Hub — Fairview', address: 'Fairview Terraces, Quezon City' },
];

// Flat delivery fee, in pesos. This is now only the *fallback*: the live
// value comes from the Settings document (models/Settings.js), which an
// administrator can edit. Anything pricing an order should read settings.
const DELIVERY_FEE = 150;

// Fallback meet-up convenience fee, pesos. Live value is settings.meetupFee.
const MEETUP_FEE = 50;

/* ---------------- rider deliveries (models/Delivery.js) ---------------- */

const DELIVERY_TYPES = ['delivery', 'pickup', 'return'];

const DELIVERY_STATUSES = [
  'unassigned', 'assigned', 'picked-up', 'in-transit',
  'arriving', 'delivered', 'failed',
];

/* ---------------- notifications ---------------- */

const NOTIFICATION_TYPES = [
  'order',     // booking placed / cancelled / extended
  'payment',   // payment confirmed
  'status',    // fulfilment status moved
  'return',    // return requested / inspection
  'refund',    // deposit refunded
  'account',   // role change, password change
  'support',   // a reply on a support ticket
  'promo',     // marketing broadcast
  'system',    // anything else
];

/* ---------------- support desk ---------------- */

const SUPPORT_STATUSES = ['open', 'in-progress', 'resolved', 'closed'];

const SUPPORT_CATEGORIES = ['booking', 'device', 'payment', 'return', 'account', 'other'];

/* ---------------- CMS ---------------- */

// The static pages an administrator may edit. A slug outside this list is
// rejected, so the CMS can never create an orphan page with no HTML shell.
const PAGE_SLUGS = ['about', 'team', 'contact', 'help', 'terms', 'privacy'];

/* ---------------- platform settings ---------------- */

// Shape and defaults for the single Settings document. Settings.get() seeds
// from this, so adding a key here makes it available everywhere.
const DEFAULT_SETTINGS = {
  brandName: 'DiaLux',
  currencyCode: 'PHP',
  currencySymbol: '₱',
  deliveryFee: DELIVERY_FEE,
  freeDeliveryThreshold: 0,      // 0 disables free delivery
  protectionFeePct: 8,           // optional damage cover, % of rent
  lowStockThreshold: 2,
  minRentalDays: 1,
  maxRentalDays: 180,
  paymentMethods: PAYMENT_METHODS,
  // Meet-up convenience fee, pesos. 0 disables it (free meet-ups).
  meetupFee: MEETUP_FEE,
  // Late-return penalty: daysOverdue × daily rate × this multiplier,
  // withheld from the deposit (Phase 3). 1 = plain daily rate.
  overduePenaltyMultiplier: 1.5,
  supportEmail: 'support@dialux.test',
  maintenanceMode: false,

  // "Compute-on-read" auto-progression of early fulfilment stages — see
  // services/orderProgressor.js. No cron job: every time an order is read
  // back (GET /api/orders/mine, GET /api/orders, GET /api/orders/:id) its
  // status catches up to wherever minutes-since-payment says it should be.
  //   preparing        every paid order
  //   readyForPickup   pickup-hub orders only (delivery/meetup orders wait
  //                    at "preparing" for an admin to assign a rider; from
  //                    then on the rider drives the status)
  // `speed: 'fast'` is for demos; 'real' for a believable pace; set
  // `enabled` to false for fully manual status changes.
  orderProgress: {
    enabled: true,
    speed: 'fast', // 'fast' | 'real'
    fastMinutes: { preparing: 1, readyForPickup: 2 },
    realMinutes: { preparing: 60, readyForPickup: 120 },
  },
};

/* ---------------- password reset ---------------- */

// How long a reset link stays valid, in minutes.
const RESET_TOKEN_TTL_MIN = 60;

const MIN_PASSWORD = 6;

/* ---------------- helpers ---------------- */

/**
 * Whole calendar days between two YYYY-MM-DD dates, minimum 1.
 * Sep 1 → Sep 8 = 7; the same day (or an invalid pair) = 1.
 */
function daysBetween(startDate, endDate) {
  const a = Date.parse(`${startDate}T00:00:00Z`);
  const b = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

/**
 * Cheapest rent for `days` using any mix of the daily/weekly/monthly tiers,
 * overshoot allowed (7 days on a weekly rate beats 7 daily charges). A tiny
 * unbounded-knapsack DP; tiers priced at 0 are treated as unavailable.
 *
 * MUST stay identical to bestValue() in the frontend's core/state.js so the
 * price shown in the cart equals the price charged at checkout.
 */
function bestValue(product, days) {
  const n = Math.max(1, Math.ceil(Number(days) || 1));
  const tiers = [
    [1, Number(product.daily) || 0],
    [7, Number(product.weekly) || 0],
    [30, Number(product.monthly) || 0],
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
 * Optional damage-protection fee for a given rent subtotal, rounded to whole
 * pesos. Shared by the cart preview and the two checkout routes so the quote
 * always equals the charge.
 */
function protectionFeeFor(rent, pct) {
  const rate = Number(pct) || 0;
  if (rate <= 0) return 0;
  return Math.round((Number(rent) || 0) * (rate / 100));
}

/**
 * Delivery charge for a rent subtotal, honouring a free-delivery threshold
 * of 0 (disabled) or above. Only meaningful for orderType 'delivery' —
 * pickup and meet-up price through orderTypeFeeFor() instead.
 */
function deliveryFeeFor(rent, settings) {
  const fee = Number(settings?.deliveryFee ?? DELIVERY_FEE) || 0;
  const threshold = Number(settings?.freeDeliveryThreshold) || 0;
  if (threshold > 0 && Number(rent) >= threshold) return 0;
  return fee;
}

/**
 * Fulfilment-fee dispatcher for the three order types: delivery pays the
 * usual delivery fee (and still honours the free-delivery threshold),
 * pickup is always free (the customer is doing the travelling), and
 * meet-up carries its own small, separately-configurable convenience fee.
 */
function orderTypeFeeFor(orderType, rent, settings) {
  if (orderType === 'pickup') return 0;
  if (orderType === 'meetup') return Math.max(0, Number(settings?.meetupFee ?? MEETUP_FEE) || 0);
  return deliveryFeeFor(rent, settings); // 'delivery', and the historical default
}

/**
 * Soft, text-only check that a meet-up location reads like it's inside
 * Quezon City. This is NOT geocoding — just a guard against an obviously
 * wrong city being typed in, since there is no mapping/geocoding dependency
 * in this project. A human (admin) still confirms the actual meeting point
 * when the booking is approved.
 */
function looksLikeQC(text) {
  return /\bq(?:uezon)?\s*c(?:ity)?\b/i.test(String(text || ''));
}

// Phase 3: what a technician ticks off when a returned device is inspected.
const INSPECTION_CHECKLIST = ['screen', 'body', 'ports', 'camera', 'battery'];

// Time windows a customer can pick for a return pickup / hub drop-off.
const RETURN_SLOTS = ['Morning (9 AM - 12 PM)', 'Afternoon (1 - 5 PM)', 'Evening (5 - 8 PM)'];

module.exports = {
  ROLES,
  CATEGORIES, GRADES, PLANS, PLAN_KEY, PLAN_DAYS,
  ORDER_STATUSES, OPEN_STATUSES, QUALIFYING_REVIEW_STATUSES,
  PAYMENT_METHODS, GATEWAY_PAYMENT_METHODS, PAYMONGO_METHOD_MAP, PAYMENT_STATUSES,
  INSPECTION_CHECKLIST, RETURN_SLOTS,
  ORDER_TYPES, PICKUP_HUBS, DELIVERY_FEE, MEETUP_FEE,
  DELIVERY_TYPES, DELIVERY_STATUSES,
  NOTIFICATION_TYPES, SUPPORT_STATUSES, SUPPORT_CATEGORIES,
  PAGE_SLUGS, DEFAULT_SETTINGS, RESET_TOKEN_TTL_MIN, MIN_PASSWORD,
  daysBetween, bestValue, protectionFeeFor, deliveryFeeFor, orderTypeFeeFor, looksLikeQC,
};