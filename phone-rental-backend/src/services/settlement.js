// ============================================================
// DiaLux — rental clock & deposit settlement (Phase 3)
//
// Pure functions, no database access, so the money rules can be unit-tested
// and every route computes them the same way.
//
//   dueAt         when the device is due back
//   overdueDays   whole days late (a partial day counts as a full one)
//   penalty       overdueDays × dailyRate × overduePenaltyMultiplier
//   refund        deposit − penalty − damage, never below zero
// ============================================================

const DAY_MS = 86400000;

/** Rent per day for the whole order: rent already covers every unit and day. */
function dailyRateOf(order) {
  const days = Math.max(1, Number(order.days) || 1);
  return Math.round((Number(order.rent) || 0) / days);
}

/**
 * When the device is due back. The rental clock starts when the customer
 * confirms receipt (`receivedAt`) and runs for `days`; before that it falls
 * back to the booked end date (end of day, Manila time).
 */
function dueAtOf(order) {
  if (order.receivedAt) {
    return new Date(new Date(order.receivedAt).getTime() + Math.max(1, Number(order.days) || 1) * DAY_MS);
  }
  return new Date(`${order.endDate}T23:59:59+08:00`);
}

/** Whole days past due at `at`; 0 when on time. */
function overdueDaysAt(order, at = new Date()) {
  const late = new Date(at).getTime() - dueAtOf(order).getTime();
  return late > 0 ? Math.ceil(late / DAY_MS) : 0;
}

/** The late-return penalty for `days` overdue. */
function penaltyFor(order, days, multiplier) {
  const m = Number.isFinite(Number(multiplier)) ? Number(multiplier) : 1.5;
  return Math.round(days * dailyRateOf(order) * m);
}

/**
 * Settle the deposit after an inspection.
 *
 * Late penalty is taken first, damage second; together they can never take
 * more than the deposit (any damage beyond that is reported as `shortfall`
 * rather than silently dropped).
 *
 * @returns {{full:boolean, status:'refund-processing'|'refund-partial', ...}}
 */
function settle(order, { passed, damageCharge = 0 }, settings, at = new Date()) {
  const deposit = Number(order.deposit) || 0;
  const overdueDays = overdueDaysAt(order, at);
  const rawPenalty = penaltyFor(order, overdueDays, settings?.overduePenaltyMultiplier);
  const overduePenalty = Math.min(deposit, rawPenalty);
  const wantedDamage = Math.max(0, Math.round(Number(damageCharge) || 0));
  const damage = Math.min(deposit - overduePenalty, wantedDamage);
  const shortfall = (rawPenalty - overduePenalty) + (wantedDamage - damage);
  const deducted = overduePenalty + damage;
  const refundAmount = Math.max(0, deposit - deducted);
  const full = Boolean(passed) && overdueDays === 0 && wantedDamage === 0;
  return {
    full,
    status: full ? 'refund-processing' : 'refund-partial',
    deposit, overdueDays, overduePenalty, damageCharge: damage, shortfall, deducted, refundAmount,
    dailyRate: dailyRateOf(order),
    multiplier: Number(settings?.overduePenaltyMultiplier ?? 1.5),
  };
}

/** What the order page shows while the rental is running. */
function rentalClock(order, settings, at = new Date()) {
  const dueAt = dueAtOf(order);
  const overdueDays = overdueDaysAt(order, at);
  const multiplier = Number(settings?.overduePenaltyMultiplier ?? 1.5);
  return {
    dueAt: dueAt.toISOString(),
    started: Boolean(order.receivedAt),
    msLeft: Math.max(0, dueAt.getTime() - new Date(at).getTime()),
    overdueDays,
    dailyRate: dailyRateOf(order),
    multiplier,
    accruedPenalty: Math.min(Number(order.deposit) || 0, penaltyFor(order, overdueDays, multiplier)),
  };
}

module.exports = { DAY_MS, dailyRateOf, dueAtOf, overdueDaysAt, penaltyFor, settle, rentalClock };
