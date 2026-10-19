// ============================================================
// DiaLux — pages/order.js
// One booking in full: the live tracking timeline, the cards for whatever
// the customer can do next (confirm receipt, report a problem, schedule a
// return), the rental countdown / overdue warning, a printable invoice
// and the deposit settlement.
//
// Entered as /order.html?id=<orderId>. The endpoint behind it allows the
// owner, an administrator or a technician, so this doubles as the staff
// drill-in view.
//
// Everything shown here is derived from what the backend returns on read
// (order.rentalClock, order.legs, order.statusHistory) — nothing is guessed.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx } from '../core/page.js';
import {
  state, cancelOrder, requestReturn, extendRental, payOrder,
  confirmReceipt, reportIssue,
  ORDER_STAGES, STATUS_STAGE, TERMINAL_OR_MANUAL_STATUSES, REVIEWABLE_STATUSES,
  RETURN_SLOTS, INSPECTION_CHECKLIST,
} from '../core/state.js';
import { ordersApi, paymentsApi } from '../core/api.js';
import {
  peso, escapeHtml, formatDate, formatDateTime, toast, emptyState,
  statusClass, titleCase, catLabel, paymentLabel,
} from '../core/ui.js';

const params = new URLSearchParams(location.search);
const orderId = params.get('id') || '';
const paymentReturn = params.get('payment');   // 'success' | 'cancelled' — set by PayMongo's redirect

let order = null;
let pollHandle = null;

// Which inline form is open ('issue' | 'return' | null). While one is open,
// the 30s poll refreshes the data but does not redraw, so typing is never lost.
let panel = null;
let issuePhotos = [];

const shortId = (id) => String(id).slice(-6).toUpperCase();
const MAX_PHOTO_BYTES = 450 * 1024;

const LIVE_LEG_STATUSES = ['shipped', 'out-for-delivery', 'picked-up', 'in-transit', 'arriving'];
const RETURN_LEG_STATUSES = ['return-requested', 'return-scheduled', 'return-in-transit'];
const CLOCK_STATUSES = ['active', 'received', 'return-requested', 'return-scheduled', 'return-in-transit'];
const ISSUE_REASONS = ['I have not received the device', 'Wrong device', 'Damaged on arrival', 'Not working', 'Something is missing', 'Other'];

/* ---------------- timeline icons ---------------- */
const ico = (d) => `<svg viewBox="0 0 24 24" fill="none">${d}</svg>`;
const S = 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const STAGE_ICONS = {
  placed:     ico(`<path d="M6 3h9l3 3v15H6z" ${S}/><path d="M9 9h6M9 13h6M9 17h4" ${S}/>`),
  paid:       ico(`<rect x="3" y="6" width="18" height="13" rx="2" ${S}/><path d="M3 10h18" ${S}/>`),
  preparing:  ico(`<path d="M3 8l9-4 9 4-9 4-9-4Z" ${S}/><path d="M3 8v8l9 4 9-4V8M12 12v8" ${S}/>`),
  dispatch:   ico(`<rect x="2" y="7" width="12" height="9" rx="1.2" ${S}/><path d="M14 10h4l3 3v3h-7v-6Z" ${S}/><circle cx="7" cy="18" r="1.6" ${S}/><circle cx="17" cy="18" r="1.6" ${S}/>`),
  transit:    ico(`<path d="M12 21s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12Z" ${S}/><circle cx="12" cy="9" r="2.4" ${S}/>`),
  delivered:  ico(`<path d="M4 11l8-7 8 7" ${S}/><path d="M6 10v10h12V10" ${S}/><path d="M10 20v-5h4v5" ${S}/>`),
  received:   ico(`<circle cx="12" cy="12" r="9" ${S}/><path d="M8 12.5l3 3 5-6" ${S}/>`),
  active:     ico(`<rect x="7" y="2" width="10" height="20" rx="2.5" ${S}/><circle cx="12" cy="18.4" r="1" ${S}/>`),
  'return-req': ico(`<path d="M9 14l-5-5 5-5" ${S}/><path d="M4 9h10a6 6 0 0 1 0 12h-3" ${S}/>`),
  'return-sch': ico(`<rect x="3" y="5" width="18" height="16" rx="2" ${S}/><path d="M3 10h18M8 3v4M16 3v4" ${S}/>`),
  'return-trn': ico(`<rect x="2" y="7" width="12" height="9" rx="1.2" ${S}/><path d="M14 10h4l3 3v3h-7v-6Z" ${S}/><circle cx="7" cy="18" r="1.6" ${S}/><circle cx="17" cy="18" r="1.6" ${S}/>`),
  returned:   ico(`<path d="M3 8l9-4 9 4-9 4-9-4Z" ${S}/><path d="M3 8v8l9 4 9-4V8" ${S}/><path d="M9 15l2 2 4-4" ${S}/>`),
  inspect:    ico(`<circle cx="11" cy="11" r="6.5" ${S}/><path d="M16 16l5 5" ${S}/>`),
  refund:     ico(`<circle cx="12" cy="12" r="9" ${S}/><path d="M14.5 9.2c-.4-.8-1.3-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.2 5 3.8 0 1.2-1.1 2-2.5 2-1.2 0-2.2-.5-2.6-1.4M12 6.5V8m0 8v1.5" ${S}/>`),
  done:       ico(`<path d="M5 12.5l4.5 4.5L19 7" ${S}/>`),
};

/* ---------------- small helpers ---------------- */

const isStaffView = () => ['admin', 'technician'].includes(state.user?.role) && String(order?.user) !== String(state.user?.id);
const isOwner = (o) => state.user && String(o.user) === String(state.user.id);

/** "3 days 4 hours" / "5 hours 12 min" / "under a minute" */
function durationText(ms) {
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d} day${d === 1 ? '' : 's'} ${h} hour${h === 1 ? '' : 's'}`;
  if (h > 0) return `${h} hour${h === 1 ? '' : 's'} ${m} min`;
  return mins > 0 ? `${m} min` : 'under a minute';
}

const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that image'));
    r.readAsDataURL(file);
  });
}

/* ---------------- timeline ---------------- */

/** The stages this order actually passes through (pickup orders skip the rider legs). */
function stagesFor(o) {
  return ORDER_STAGES
    .map((stage, idx) => ({ ...stage, idx }))
    .filter(s => !(s.skipFor || []).includes(o.orderType));
}

/**
 * The Shopee-style vertical timeline: one row per stage, coloured by
 * whether it has happened, is happening now (pulsing) or is still ahead.
 * Timestamps are the real statusHistory entries.
 */
function timelineMarkup(o) {
  const cancelled = o.status === 'cancelled';
  const cur = STATUS_STAGE[o.status] ?? -1;
  const finished = o.status === 'completed';
  const disputed = o.status === 'disputed';
  const pickup = o.orderType === 'pickup';

  const stampFor = (idx) => {
    const entry = [...(o.statusHistory || [])].reverse().find(h => (STATUS_STAGE[h.status] ?? -1) === idx);
    return entry ? formatDateTime(entry.at) : '';
  };

  const rows = stagesFor(o).map(stage => {
    const done = !cancelled && (finished || stage.idx < cur);
    const current = !cancelled && !finished && stage.idx === cur;
    const cls = done ? 'done' : current ? `current${disputed ? ' alert' : ''}` : 'future';
    const stamp = stampFor(stage.idx);
    const label = pickup && stage.pickupLabel ? stage.pickupLabel : stage.label;
    const desc = pickup && stage.pickupDescription ? stage.pickupDescription : stage.description;
    return `
      <div class="timeline-entry ${cls}">
        <div class="timeline-icon">${STAGE_ICONS[stage.key] || ''}</div>
        <div class="timeline-content">
          <b>${escapeHtml(disputed && current ? 'Problem reported' : label)}</b>
          <p>${escapeHtml(disputed && current ? 'We are looking into your report.' : desc)}</p>
          ${stamp ? `<time class="timeline-time">${escapeHtml(stamp)}</time>` : (cls === 'future' ? '<time class="timeline-time">—</time>' : '')}
        </div>
      </div>`;
  }).join('');

  const tracking = !TERMINAL_OR_MANUAL_STATUSES.includes(o.status) && state.settings?.orderProgress?.enabled !== false || (!TERMINAL_OR_MANUAL_STATUSES.includes(o.status));

  return `
    <div class="order-timeline-vertical">${rows}</div>
    ${o.status === 'pending' && !o.paid ? '<p class="return-reminder" style="margin-top:12px;">Complete payment to start tracking this booking.</p>' : ''}
    ${cancelled ? '<p class="return-reminder" style="margin-top:12px;">This booking was cancelled. Nothing was charged.</p>' : ''}
    ${tracking && !cancelled ? `
      <div class="timeline-live-hint no-print">
        <span class="live-dot"></span> Updates automatically
        <button type="button" class="btn btn-ghost btn-sm" data-act="refresh">Refresh</button>
      </div>` : ''}`;
}

/* ---------------- cards ---------------- */

function countdownCard(o) {
  const c = o.rentalClock;
  if (!c || !c.started || !CLOCK_STATUSES.includes(o.status)) return '';
  const msLeft = Math.max(0, new Date(c.dueAt).getTime() - Date.now());
  const late = c.overdueDays > 0;

  if (late) {
    return `
      <div class="order-card overdue-banner" role="alert">
        <div class="oc-icon">!</div>
        <div>
          <b>Overdue by ${c.overdueDays} day${c.overdueDays === 1 ? '' : 's'}</b>
          <p>Late fee so far: <b>${peso(c.accruedPenalty)}</b>
          (${c.overdueDays} day${c.overdueDays === 1 ? '' : 's'} × ${peso(c.dailyRate)} × ${c.multiplier}).
          It is deducted from your ${peso(o.deposit)} deposit. Return the device as soon as you can to stop it growing.</p>
        </div>
      </div>`;
  }
  return `
    <div class="order-card countdown-card">
      <span class="oc-label">Return due ${escapeHtml(formatDateTime(c.dueAt))}</span>
      <b class="countdown" id="rentalCountdown" data-due="${escapeHtml(c.dueAt)}">Return in ${escapeHtml(durationText(msLeft))}</b>
      <p>Late returns cost ${peso(c.dailyRate)} × ${c.multiplier} per day, taken from your deposit.</p>
    </div>`;
}

/** "3:15 PM and 3:45 PM" — a 30-minute window centred on the estimate. */
function etaWindow(eta) {
  const mid = new Date(eta).getTime();
  const t = (ms) => new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  return `${t(mid - 15 * 60000)} and ${t(mid + 15 * 60000)}`;
}

function legCard(o) {
  const showOut = LIVE_LEG_STATUSES.includes(o.status) && o.legs?.delivery;
  const showRet = RETURN_LEG_STATUSES.includes(o.status) && o.orderType !== 'pickup';
  const leg = showOut ? o.legs.delivery : showRet ? o.legs?.return : null;
  const title = showOut ? 'Your delivery' : 'Your return pickup';
  if (!showOut && !showRet) return '';

  if (!leg || !leg.riderName) {
    return `
      <div class="order-card">
        <span class="oc-label">${title}</span>
        <b>Waiting for a rider</b>
        <p>We will assign a rider shortly and let you know here.</p>
      </div>`;
  }
  return `
    <div class="order-card rider-card">
      <span class="oc-label">${title}</span>
      <div class="rider-row">
        <div class="rider-avatar">${escapeHtml(leg.riderName.slice(0, 1).toUpperCase())}</div>
        <div>
          <b>${escapeHtml(leg.riderName)}</b>
          ${leg.riderPhone ? `<a class="rider-phone" href="tel:${escapeHtml(leg.riderPhone)}">${escapeHtml(leg.riderPhone)}</a>` : ''}
        </div>
        <span class="status-pill ${statusClass(leg.status)}">${escapeHtml(titleCase(leg.status))}</span>
      </div>
      ${leg.eta ? `
        <div class="eta-box">
          <span>${showOut ? 'Rider will arrive between' : 'Rider will collect between'}</span>
          <b>${escapeHtml(etaWindow(leg.eta))}</b>
        </div>` : ''}
    </div>`;
}

function returnPlanCard(o) {
  const p = o.returnPlan;
  if (!p || !['return-requested', 'return-scheduled', 'return-in-transit'].includes(o.status)) return '';
  const hub = p.method === 'hub';
  return `
    <div class="order-card">
      <span class="oc-label">${hub ? 'Hub drop-off' : 'Return pickup'}</span>
      <b>${escapeHtml(formatDate(p.date))} · ${escapeHtml(p.slot)}</b>
      <p>${hub
        ? `Bring the device and its accessories to the ${escapeHtml(o.pickupHub ? titleCase(o.pickupHub) : '')} hub counter. We confirm it as soon as it is handed in.`
        : `A rider collects it from ${escapeHtml(o.address || 'your address')}. Please have it ready, powered off and signed out of your accounts.`}</p>
    </div>`;
}

function receiptCard(o) {
  if (!isOwner(o) || !['delivered', 'ready-for-pickup'].includes(o.status)) return '';
  const pickup = o.status === 'ready-for-pickup';
  return `
    <div class="order-card action-card">
      <b>${pickup ? 'Collected your device?' : 'Did you receive your device?'}</b>
      <p>${pickup
        ? 'Once you have it in hand and it looks right, confirm below. Your rental clock starts then.'
        : 'Check it matches your booking. Confirming starts your rental clock.'}</p>
      <div class="oc-buttons">
        <button class="btn btn-primary btn-sm" data-act="receipt-yes">Yes, I received it</button>
        <button class="btn btn-outline btn-sm" data-act="receipt-no">No, there is a problem</button>
      </div>
      ${panel === 'issue' ? issueForm() : ''}
    </div>`;
}

function issueForm() {
  return `
    <form class="oc-form" id="issueForm" novalidate>
      <label>What went wrong?
        <select name="reason">${ISSUE_REASONS.map(r => `<option>${escapeHtml(r)}</option>`).join('')}</select>
      </label>
      <label>Tell us more
        <textarea name="details" rows="3" maxlength="2000" placeholder="Describe what you see"></textarea>
      </label>
      <label>Photos (optional, up to 3)
        <input type="file" name="photos" accept="image/*" multiple />
      </label>
      <small id="issuePhotoNote">${issuePhotos.length ? `${issuePhotos.length} photo(s) attached` : ''}</small>
      <div class="oc-buttons">
        <button class="btn btn-primary btn-sm" type="submit">Send report</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="close-panel">Cancel</button>
      </div>
    </form>`;
}

function disputeCard(o) {
  if (o.status !== 'disputed' || !o.dispute) return '';
  return `
    <div class="order-card overdue-banner">
      <div class="oc-icon">!</div>
      <div>
        <b>Problem reported: ${escapeHtml(o.dispute.reason)}</b>
        ${o.dispute.details ? `<p>${escapeHtml(o.dispute.details)}</p>` : ''}
        <p>Reported ${escapeHtml(formatDateTime(o.dispute.at))}. Our team will contact you to fix this.</p>
      </div>
    </div>`;
}

function returnCard(o) {
  if (!isOwner(o) || !['received', 'active'].includes(o.status)) return '';
  const pickup = o.orderType === 'pickup';
  return `
    <div class="order-card">
      <span class="oc-label">Finished with the device?</span>
      <b>Return it</b>
      <p>${pickup ? 'Pick a day and time to drop it off at your hub.' : 'Pick a day and time and a rider will collect it.'}</p>
      ${panel === 'return' ? `
        <form class="oc-form" id="returnForm" novalidate>
          <label>Date <input type="date" name="date" min="${todayIso()}" value="${todayIso()}" required /></label>
          <label>Time slot
            <select name="slot">${RETURN_SLOTS.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select>
          </label>
          <label>Notes for us (optional)
            <textarea name="note" rows="2" maxlength="1000" placeholder="Anything we should know about the device?"></textarea>
          </label>
          <div class="oc-buttons">
            <button class="btn btn-primary btn-sm" type="submit">${pickup ? 'Schedule drop-off' : 'Request pickup'}</button>
            <button class="btn btn-ghost btn-sm" type="button" data-act="close-panel">Cancel</button>
          </div>
        </form>` : `
        <div class="oc-buttons">
          <button class="btn btn-primary btn-sm" data-act="return">Request return</button>
          <button class="btn btn-ghost btn-sm" data-act="extend">Extend rental</button>
        </div>`}
    </div>`;
}

function inspectionCard(o) {
  const i = o.inspection;
  if (!i) return '';
  return `
    <div class="order-card">
      <span class="oc-label">Inspection result</span>
      <b>${i.passed ? 'Passed' : 'Did not pass'}</b>
      <ul class="check-list">
        ${INSPECTION_CHECKLIST.map(c => `<li class="${i.checklist?.[c.key] === false ? 'bad' : 'good'}">${i.checklist?.[c.key] === false ? '✗' : '✓'} ${escapeHtml(c.label)}</li>`).join('')}
      </ul>
      ${i.notes ? `<p>${escapeHtml(i.notes)}</p>` : ''}
    </div>`;
}

function historyMarkup(o) {
  if (!o.statusHistory?.length) return '';
  return `
    <div class="detail-box">
      <h3>Activity</h3>
      <ol class="history-list">
        ${[...o.statusHistory].reverse().map(h => `
          <li>
            <span class="status-pill ${statusClass(h.status)}">${escapeHtml(titleCase(h.status))}</span>
            <time>${escapeHtml(formatDateTime(h.at))}</time>
            ${h.note ? `<p>${escapeHtml(h.note)}</p>` : ''}
            ${h.byEmail ? `<small>by ${escapeHtml(h.byEmail)}</small>` : ''}
          </li>`).join('')}
      </ol>
    </div>`;
}

/* ---------------- invoice ---------------- */

function refundMarkup(o) {
  const r = o.refund;
  if (!r) {
    return `<div class="inv-note">The ${peso(o.deposit)} deposit is held, not spent, and is refunded once the device passes return inspection.</div>`;
  }
  const lines = [
    `<div class="summary-row"><span>Deposit held</span><span class="mono">${peso(r.deposit ?? o.deposit)}</span></div>`,
    r.overduePenalty ? `<div class="summary-row"><span>Late fee (${r.overdueDays} day${r.overdueDays === 1 ? '' : 's'})</span><span class="mono deduct">− ${peso(r.overduePenalty)}</span></div>` : '',
    r.damageCharge ? `<div class="summary-row"><span>Damage charge</span><span class="mono deduct">− ${peso(r.damageCharge)}</span></div>` : '',
    `<div class="summary-row total"><span>Refunded</span><span class="mono">${peso(r.amount)}</span></div>`,
  ].join('');
  return `
    <div class="inv-note settled">
      Deposit settled ${escapeHtml(formatDateTime(r.at))}${r.ref ? ` · <span class="mono">${escapeHtml(r.ref)}</span>` : ''}
      <div class="inv-totals" style="margin-top:10px;">${lines}</div>
      ${r.shortfall ? `<p class="return-reminder">Charges exceeded the deposit by ${peso(r.shortfall)}. Our team will be in touch.</p>` : ''}
    </div>`;
}

function invoiceMarkup(o) {
  const reviewable = REVIEWABLE_STATUSES.includes(o.status);

  const rows = o.items.map(i => `
    <tr>
      <td>
        ${escapeHtml(i.name)}
        <div class="inv-sub">${escapeHtml(catLabel(i.cat))} · ${escapeHtml(i.plan)} plan</div>
        ${reviewable && i.product
          ? `<a class="review-link no-print" href="/products.html#device-${escapeHtml(String(i.product))}">Leave a review ›</a>`
          : ''}
      </td>
      <td class="num">${i.qty}</td>
      <td class="num">${peso(i.rate)}</td>
      <td class="num">${peso(i.deposit)}</td>
      <td class="num">${peso(i.rate * i.qty)}</td>
    </tr>`).join('');

  return `
    <div class="invoice" id="invoice">
      <div class="inv-head">
        <div class="inv-brand">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26"><rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18.4" r="1.2" fill="currentColor"/></svg>
          <div>
            <b>DiaLux</b>
            <small>On-demand device rentals · Quezon City</small>
          </div>
        </div>
        <div class="inv-meta">
          <div><span>Invoice</span><b class="mono">${escapeHtml(o.invoiceNo || `DLX-${shortId(o.id)}`)}</b></div>
          <div><span>Issued</span><b>${escapeHtml(formatDate(o.createdAt))}</b></div>
          <div><span>Status</span><b>${escapeHtml(titleCase(o.status))}</b></div>
        </div>
      </div>

      <div class="inv-parties">
        <div>
          <h5>Billed to</h5>
          <p><b>${escapeHtml(o.userName || '—')}</b></p>
          <p>${escapeHtml(o.userEmail || '')}</p>
          ${o.phone ? `<p>${escapeHtml(o.phone)}</p>` : ''}
        </div>
        <div>
          <h5>${o.orderType === 'pickup' ? 'Pickup at' : o.orderType === 'meetup' ? 'Meet-up at' : 'Delivering to'}</h5>
          <p>${escapeHtml(o.address || '—')}</p>
          ${o.timeSlot ? `<p>${escapeHtml(o.timeSlot)}</p>` : ''}
        </div>
        <div>
          <h5>Rental window</h5>
          <p>${escapeHtml(formatDate(o.startDate))} → ${escapeHtml(formatDate(o.endDate))}</p>
          <p>${o.days} day${o.days === 1 ? '' : 's'}</p>
        </div>
      </div>

      <div class="table-wrap">
        <table class="inv-table">
          <thead>
            <tr>
              <th>Device</th>
              <th class="num">Qty</th>
              <th class="num">Rate</th>
              <th class="num">Deposit ea.</th>
              <th class="num">Rent</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="inv-totals">
        <div class="summary-row"><span>Rental subtotal</span><span class="mono">${peso(o.rent)}</span></div>
        <div class="summary-row"><span>${o.orderType === 'meetup' ? 'Meet-up fee' : 'Delivery'}</span><span class="mono">${o.delivery ? peso(o.delivery) : 'Free'}</span></div>
        ${o.protectionFee ? `<div class="summary-row"><span>Damage protection</span><span class="mono">${peso(o.protectionFee)}</span></div>` : ''}
        <div class="summary-row"><span>Refundable deposit</span><span class="mono refundable">${peso(o.deposit)}</span></div>
        <div class="summary-row total"><span>${o.paid ? 'Total paid' : 'Total due'}</span><span class="mono">${peso(o.total)}</span></div>
      </div>

      ${o.payment?.method ? `
        <div class="inv-note">
          ${o.paid ? 'Paid' : 'Payment method:'} ${escapeHtml(paymentLabel(o.payment.method))}
          ${o.payment.referenceNo ? ` · reference <span class="mono">${escapeHtml(o.payment.referenceNo)}</span>` : ''}
          ${o.paidAt ? ` · ${escapeHtml(formatDateTime(o.paidAt))}` : ''}
          ${!o.paid ? ` · ${escapeHtml(titleCase(o.payment.status || 'pending'))}` : ''}
        </div>` : `
        <div class="inv-note">Awaiting payment. The deposit and rent are only collected once you confirm.</div>`}

      ${refundMarkup(o)}

      <div class="inv-foot">
        Questions? <span class="mono">${escapeHtml(state.settings?.supportEmail || 'support@dialux.test')}</span>
      </div>
    </div>`;
}

function actionsMarkup(o) {
  const buttons = [];

  if (isOwner(o)) {
    if (o.status === 'pending' && !o.paid && !['cash', 'bank-transfer'].includes(o.payment?.method)) {
      buttons.push('<button class="btn btn-primary btn-sm" data-act="pay">Pay now</button>');
    }
    if (o.status === 'pending') {
      buttons.push('<button class="btn btn-ghost btn-sm" data-act="cancel">Cancel booking</button>');
    }
  }

  buttons.push('<button class="btn btn-outline btn-sm" data-act="print">Print / save PDF</button>');
  buttons.push('<a class="btn btn-ghost btn-sm" href="/profile.html#orders">All my rentals</a>');

  return `<div class="order-actions no-print">${buttons.join('')}</div>`;
}

/* ---------------- render ---------------- */

const LIVE_PILL = !0;
function pillMarkup(status) {
  const live = !['completed', 'cancelled', 'refunded'].includes(status) && LIVE_PILL;
  return `<span class="status-pill ${statusClass(status)}${live ? ' is-live' : ''}">${escapeHtml(titleCase(status))}</span>`;
}

function render() {
  const wrap = document.getElementById('orderWrap');
  if (!wrap || !order) return;

  const staff = isStaffView();

  wrap.innerHTML = `
    <div class="order-detail-head no-print">
      <div>
        <h1>Booking #${shortId(order.id)}</h1>
        <p>
          ${pillMarkup(order.status)}
          ${order.paid ? '<span class="paid-pill">✓ Paid</span>' : ''}
          ${staff ? `<span class="status-pill status-approved">${escapeHtml(titleCase(state.user.role))} view · ${escapeHtml(order.userEmail)}</span>` : ''}
        </p>
      </div>
      <a class="back-link" href="/profile.html#orders">
        <svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px;"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Back to my rentals
      </a>
    </div>

    <div class="order-cards no-print">
      ${countdownCard(order)}
      ${disputeCard(order)}
      ${receiptCard(order)}
      ${legCard(order)}
      ${returnPlanCard(order)}
      ${returnCard(order)}
      ${inspectionCard(order)}
    </div>

    <div class="no-print" style="margin-bottom:22px;">${timelineMarkup(order)}</div>

    ${invoiceMarkup(order)}

    ${actionsMarkup(order)}

    <div class="detail-sections no-print">
      ${historyMarkup(order)}
      ${order.returnNote || order.inspectionNote ? `
        <div class="detail-box">
          <h3>Return notes</h3>
          ${order.returnNote ? `<p><b>From you:</b> ${escapeHtml(order.returnNote)}</p>` : ''}
          ${order.inspectionNote ? `<p><b>Inspection:</b> ${escapeHtml(order.inspectionNote)}</p>` : ''}
        </div>` : ''}
    </div>`;

  refreshFx();
}

/* ---------------- actions (delegated once on the stable wrapper) ---------------- */

async function afterAction(res, okMessage, btn, done) {
  if (!res.ok) {
    done?.();
    toast(res.error, 'error');
    return false;
  }
  toast(okMessage);
  panel = null;
  issuePhotos = [];
  await load();
  return true;
}

function bindOnce() {
  const wrap = document.getElementById('orderWrap');
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = '1';

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !order) return;
    const act = btn.dataset.act;

    if (act === 'print') { window.print(); return; }
    if (act === 'refresh') { const done = fx.setBtnLoading(btn, ''); await load(); done?.(); return; }
    if (act === 'close-panel') { panel = null; issuePhotos = []; render(); return; }
    if (act === 'receipt-no') { panel = 'issue'; render(); wrap.querySelector('#issueForm select')?.focus(); return; }
    if (act === 'return') { panel = 'return'; render(); wrap.querySelector('#returnForm input')?.focus(); return; }
    if (act === 'cancel' && !confirm('Cancel this booking?')) return;

    const done = fx.setBtnLoading(btn, 'Working…');
    if (act === 'receipt-yes') {
      await afterAction(await confirmReceipt(order.id), 'Thanks! Your rental clock has started.', btn, done);
    } else if (act === 'pay') {
      const method = ['gcash', 'maya', 'card'].includes(order.payment?.method) ? order.payment.method : 'gcash';
      const res = await payOrder(order.id, method);
      if (!res.ok) { done?.(); toast(res.error, 'error'); return; }
      location.href = res.redirect;
    } else if (act === 'cancel') {
      await afterAction(await cancelOrder(order.id), 'Booking cancelled', btn, done);
    } else if (act === 'extend') {
      const res = await extendRental(order.id);
      await afterAction(res, `Extended by ${res.days} day${res.days === 1 ? '' : 's'}`, btn, done);
    } else {
      done?.();
    }
  });

  wrap.addEventListener('change', async (e) => {
    if (e.target.name !== 'photos') return;
    const files = [...e.target.files].slice(0, 3);
    issuePhotos = [];
    for (const f of files) {
      if (f.size > MAX_PHOTO_BYTES) { toast(`${f.name} is over 450 KB — pick a smaller photo`, 'error'); continue; }
      try { issuePhotos.push(await fileToDataUrl(f)); } catch { /* skip unreadable file */ }
    }
    const note = wrap.querySelector('#issuePhotoNote');
    if (note) note.textContent = issuePhotos.length ? `${issuePhotos.length} photo(s) attached` : '';
  });

  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submit = form.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    const done = fx.setBtnLoading(submit, 'Sending…');

    if (form.id === 'issueForm') {
      await afterAction(
        await reportIssue(order.id, { reason: data.reason, details: data.details, photos: issuePhotos }),
        'Report sent. Our team will be in touch.', submit, done
      );
    } else if (form.id === 'returnForm') {
      if (!data.date) { done?.(); toast('Pick a return date', 'error'); return; }
      await afterAction(
        await requestReturn(order.id, { date: data.date, slot: data.slot, note: data.note }),
        order.orderType === 'pickup' ? 'Hub drop-off scheduled' : 'Return requested', submit, done
      );
    }
  });
}

/* ---------------- load & poll ---------------- */

async function handlePaymentReturn() {
  if (!paymentReturn) return;
  history.replaceState(null, '', `${location.pathname}?id=${encodeURIComponent(orderId)}`);
  if (paymentReturn === 'cancelled') {
    toast('Payment cancelled. You can pay again from this page.', 'error');
    return;
  }
  // PayMongo's redirect can beat its webhook; ask the server once and let
  // the regular poll pick up the rest.
  try {
    const s = await paymentsApi.status(orderId);
    toast(s.status === 'paid' ? 'Payment received. Thank you!' : 'Payment received. Confirming with your bank or wallet…');
  } catch { /* the poll below will catch up */ }
}

async function load() {
  const wrap = document.getElementById('orderWrap');
  if (!wrap) return;
  bindOnce();

  if (!orderId) {
    wrap.innerHTML = emptyState(
      'No booking selected',
      'Open a booking from your rentals list to see its invoice.',
      '<a class="btn btn-primary" href="/profile.html#orders">My rentals</a>'
    );
    return;
  }

  if (!state.user) {
    wrap.innerHTML = emptyState(
      "You're not signed in",
      'Sign in to view this booking and its invoice.',
      '<a class="btn btn-primary" href="/index.html#auth">Sign in</a>'
    );
    return;
  }

  try {
    order = await ordersApi.one(orderId);
    render();
    schedulePoll();
  } catch (err) {
    order = null;
    stopPolling();
    wrap.innerHTML = emptyState(
      err.status === 403 ? 'Not your booking' : 'Booking not found',
      err.status === 403
        ? 'This booking belongs to another account.'
        : err.message || 'We could not load that booking.',
      '<a class="btn btn-primary" href="/profile.html#orders">My rentals</a>'
    );
  }
}

/* Re-fetch every 30s until the booking is finished, so rider updates, the
   rental countdown and the overdue banner stay current without a refresh.
   The countdown text also ticks every minute locally. */

function stopPolling() {
  if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
}

function schedulePoll() {
  stopPolling();
  if (!order || TERMINAL_OR_MANUAL_STATUSES.includes(order.status)) return;

  pollHandle = setInterval(async () => {
    try {
      order = await ordersApi.one(orderId);
      if (panel) return;                 // someone is typing — keep the form intact
      render();
      if (TERMINAL_OR_MANUAL_STATUSES.includes(order.status)) stopPolling();
    } catch {
      // A transient failure on a page nobody may be watching: try again next tick.
    }
  }, 30_000);
}

window.addEventListener('beforeunload', stopPolling);

bootPage('order', async () => {
  await handlePaymentReturn();
  await load();
});
