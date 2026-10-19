// ============================================================
// DiaLux — order status auto-progressor (compute-on-read)
//
// There are no cron jobs or workers (the free hosting tier has none), so
// nothing advances an order on a timer. Instead every GET route that hands
// an order back (routes/orders.js: /mine, / and /:id) runs it through
// progressOrder() first. If enough time has passed since payment, the
// status — and a correctly backdated statusHistory trail — catches up
// right before the response goes out. A customer who never opens the app
// still sees the right status next time they do.
//
// Who drives each part of the lifecycle:
//
//   payment-confirmed → preparing          time-driven  (this module)
//   preparing → ready-for-pickup           time-driven, PICKUP orders only
//   preparing … delivered                  rider-driven once a rider is
//                                          assigned; delivery/meetup orders
//                                          wait at "preparing" for dispatch
//   delivered → received → active          customer confirms receipt
//   active                                 time-driven only for the return
//                                          reminders below
//   return … completed                     customer / rider / staff driven
//
// Delivery orders deliberately stop at "preparing": the next step
// (picked-up) is something a rider physically does, so it is never set here.
//
// With settings.orderProgress.enabled = false this module does nothing and
// every status is moved by hand, exactly as before.
// ============================================================

const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const { notify, notifyOrderStatus } = require('./notify');
const { rentalClock } = require('./settlement');

const DAY_MS = 86400000;

/** Timeline positions this module may move an order between. */
const STAGES = ['payment-confirmed', 'preparing', 'ready-for-pickup'];

/** 'approved' is an admin-set status as early on the timeline as payment-confirmed. */
const stageIndex = (status) => (status === 'approved' ? 0 : STAGES.indexOf(status));

/** Furthest stage this order type may reach on its own. */
const lastAutoStage = (order) => (order.orderType === 'pickup' ? 2 : 1);

/**
 * Stage index that `elapsedMinutes` since payment has reached, capped by
 * what this order type may auto-reach.
 */
function targetStageIndex(elapsedMinutes, minutes, cap) {
  let idx = 0;
  if (elapsedMinutes >= (minutes?.preparing ?? Infinity)) idx = 1;
  if (elapsedMinutes >= (minutes?.readyForPickup ?? Infinity)) idx = 2;
  return Math.min(idx, cap);
}

/** The minute table to use for the configured speed. */
const minutesFor = (cfg) => (cfg.speed === 'real' ? cfg.realMinutes : cfg.fastMinutes);

/**
 * Advance one order if it is due. Mutates and (if it moved) saves the
 * order; always returns it, so callers can `order = await progressOrder(order)`.
 *
 * Idempotent: it recomputes "what stage should this be at right now" from
 * payment.paidAt and compares with the stored status, so reading an order
 * once, twice, or from three routes can't double-advance it or send a
 * duplicate notification.
 *
 * @param {import('mongoose').Document} order  a real Mongoose Order (not lean)
 */
async function progressOrder(order) {
  if (!order) return order;

  const settings = await Settings.get(); // 30s read-through cache
  const cfg = settings.orderProgress;
  if (!cfg?.enabled) return order;

  await remindAboutReturn(order, settings);

  if (order.payment?.status !== 'paid' || !order.payment?.paidAt) return order;
  if (order.rider || order.deliveryJob) return order;            // a rider owns it now
  const currentIdx = stageIndex(order.status);
  if (currentIdx === -1) return order;                           // not a stage we own

  const minutes = minutesFor(cfg);
  const paidAtMs = new Date(order.payment.paidAt).getTime();
  const elapsedMinutes = (Date.now() - paidAtMs) / 60000;
  const targetIdx = targetStageIndex(elapsedMinutes, minutes, lastAutoStage(order));
  if (targetIdx <= currentIdx) return order;

  // Walk one stage at a time so each crossed stage gets its own backdated
  // statusHistory entry (paidAt + that stage's own offset).
  const from = order.status;
  const crossed = [];
  for (let i = currentIdx + 1; i <= targetIdx; i++) {
    const stage = STAGES[i];
    const offset = stage === 'preparing' ? minutes.preparing : minutes.readyForPickup;
    order.status = stage;
    order.statusHistory.push({
      status: stage, at: new Date(paidAtMs + (offset || 0) * 60000), note: 'Auto-advanced', byEmail: 'system',
    });
    crossed.push(stage);
  }
  await order.save();

  for (const stage of crossed) await notifyOrderStatus(order, stage);

  // A system actor, not a request, so write directly rather than via audit().
  await AuditLog.create({
    userEmail: 'system',
    action: 'order.status',
    targetType: 'Order',
    targetId: order.id,
    targetLabel: order.invoiceNo,
    details: { from, to: order.status, auto: true, stagesCrossed: crossed },
  }).catch(err => console.warn('[DiaLux] auto-progress audit entry not written:', err.message));

  return order;
}

/**
 * Return reminders for a running rental: one notification within 24 hours
 * of the due time, one when it goes overdue. Each is sent once (flagged on
 * the order), so repeated reads never re-send them.
 */
async function remindAboutReturn(order, settings) {
  if (order.status !== 'active' || !order.receivedAt) return;
  const clock = rentalClock(order, settings);
  const link = `/order.html?id=${order.id}`;
  const dirty = [];

  if (clock.overdueDays > 0 && !order.overdueNotifiedAt) {
    order.overdueNotifiedAt = new Date();
    dirty.push(notify(order.user, {
      type: 'return',
      title: `Return overdue — ${order.invoiceNo}`,
      message: `A late fee of ${settings.currencySymbol || '₱'}${clock.dailyRate * clock.multiplier} per day now applies. Please return the device soon.`,
      link,
    }));
  } else if (clock.overdueDays === 0 && clock.msLeft <= DAY_MS && !order.returnReminderAt) {
    order.returnReminderAt = new Date();
    dirty.push(notify(order.user, {
      type: 'return',
      title: `Return due soon — ${order.invoiceNo}`,
      message: 'Your rental is due back within 24 hours. Request a return, or extend it, from your booking page.',
      link,
    }));
  }
  if (dirty.length) {
    await order.save();
    await Promise.all(dirty);
  }
}

/** Progress a batch of orders — for the two list routes. */
async function progressOrders(orders = []) {
  return Promise.all(orders.map(progressOrder));
}

module.exports = { progressOrder, progressOrders, STAGES };
