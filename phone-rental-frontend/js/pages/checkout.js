// ============================================================
// DiaLux — pages/checkout.js
// Express checkout: books ONE device straight from the catalog,
// without it ever entering the cart.
//
// Reached from the "Order now" button on a product card or the
// detail view:  /checkout.html?product=<id>&plan=Weekly
//
// A three-step wizard:
//   1. How do you want to receive it?  (delivery / pickup / meet-up)
//   2. Rental dates                     (a small click-to-range calendar)
//   3. Payment method                   (gcash / maya / card / cash / bank transfer)
// ...then one "Confirm & Pay" places the booking and attaches the chosen
// payment method in the same action, same as the single-step flow before
// it. Mirrors the cart summary card's gates (sign-in, address) so the two
// checkout surfaces behave identically — the difference is that this one
// never reads or clears state.cart.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx } from '../core/page.js';
import { ordersApi, paymentsApi, ApiError } from '../core/api.js';
import {
  state, productById, orderNow, currentProfile, currentAddresses,
  defaultAddress, bestValue, daysBetween, isoDate, addDays,
  orderTypeFeeFor, protectionFeeFor, PICKUP_HUBS, ORDER_TYPES,
  planLabelFor, planFieldFor, bestValueHint, PLAN_DAYS,
} from '../core/state.js';
import {
  peso, escapeHtml, toast, emptyState, formatDate, catLabel,
  PAYMENT_LABELS, PAYMENT_BLURBS, paymentLabel,
} from '../core/ui.js';

/* ---------------- query ---------------- */

const params = new URLSearchParams(location.search);
const productId = params.get('product') || '';
const wantedQty = Math.max(1, Math.round(Number(params.get('qty')) || 1));

// The rental plan is chosen right here, on the dates step, from a drop-down:
// Daily → Weekly → Monthly → Custom dates. A preset fixes the length (1 / 7 /
// 30 days) and the customer only picks WHEN it starts; "Custom dates" lets
// them pick any start and return day. A `?plan=` query param (set by the
// "Order now" buttons) only pre-selects the drop-down — it can always be
// changed here, so nobody has to go back to the device page to switch plan.
//
// Nothing here can drift out of sync (the old bug 1.1): in a preset the dates
// are always derived from the plan, in Custom the plan label is always
// derived from the dates (planLabelFor). The server prices by the number of
// days, so the plan name is only ever a label.
const PLAN_CHOICES = ['Daily', 'Weekly', 'Monthly', 'Custom'];
const initialPlan = PLAN_CHOICES.includes(params.get('plan')) ? params.get('plan') : 'Weekly';

let qty = wantedQty;
let planMode = initialPlan;      // 'Daily' | 'Weekly' | 'Monthly' | 'Custom'
let awaitingEnd = false;         // Custom only: start picked, return day still to be clicked
let startDate = '';
let endDate = '';
let protection = false;
let addressId = '';

/* ---- wizard state ---- */
let step = 1;                    // 1 order type · 2 dates · 3 payment
let orderType = 'delivery';
let pickupHub = '';
let meetupLocation = '';
let timeSlot = '';
let paymentMethod = '';          // chosen on step 3
let proofDataUrl = '';           // bank-transfer proof, read client-side via FileReader
let bankPanelOrder = null;       // set once a bank-transfer order is placed, so the
                                  // proof-upload panel can stay up before redirecting
let availability = null;         // { windows: [...] } for the current product
let calView = null;              // { year, month } — the calendar's visible month

const backToCatalog = '<a class="btn btn-primary" href="/products.html">Browse devices</a>';

/* ---------------- small date/calendar helpers ---------------- */

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Every date (YYYY-MM-DD) that falls inside at least one existing open booking window. */
function blockedDateSet() {
  const set = new Set();
  (availability?.windows || []).forEach(w => {
    let cur = new Date(`${w.startDate}T00:00:00Z`);
    const end = new Date(`${w.endDate}T00:00:00Z`);
    while (cur <= end) {
      set.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  });
  return set;
}

/**
 * A compact single-month click-to-range calendar. Click a start day, then
 * an end day (dragging a real native range across days is a lot of extra
 * plumbing for the same outcome — two clicks is just as fast and a lot
 * more accessible). Days already covered by another booking are shown
 * with a dot — they're still clickable: see the availability note in the
 * backend's routes/orders.js for why this is informational rather than a
 * hard block.
 */
function calendarMarkup(minDateStr) {
  const today = calView || { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() };
  const { year, month } = today;
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const blocked = blockedDateSet();
  const minDate = minDateStr || isoDate();
  // Mid-way through a custom range the return day isn't chosen yet; the 1-day
  // placeholder shouldn't look like a selection.
  const shownEnd = awaitingEnd ? '' : endDate;

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-cell cal-empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = ymd(year, month, d);
    const isPast = dateStr < minDate;
    const inRange = startDate && shownEnd && dateStr >= startDate && dateStr <= shownEnd;
    const isStart = dateStr === startDate;
    const isEnd = dateStr === shownEnd;
    const isBlocked = blocked.has(dateStr);
    const cls = [
      'cal-cell', 'cal-day',
      isPast ? 'cal-past' : '',
      inRange ? 'cal-in-range' : '',
      (isStart || isEnd) ? 'cal-selected' : '',
      isBlocked ? 'cal-has-booking' : '',
    ].filter(Boolean).join(' ');
    cells.push(
      `<button type="button" class="${cls}" data-date="${dateStr}" ${isPast ? 'disabled' : ''}>${d}</button>`
    );
  }

  return `
  <div class="rp-calendar">
    <div class="rp-cal-head">
      <button type="button" class="icon-btn" id="calPrev" aria-label="Previous month">‹</button>
      <b>${MONTH_NAMES[month]} ${year}</b>
      <button type="button" class="icon-btn" id="calNext" aria-label="Next month">›</button>
    </div>
    <div class="rp-cal-dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="rp-cal-grid">${cells.join('')}</div>
    <div class="rp-cal-legend">
      <span><i class="rp-dot rp-dot-sel"></i> Selected</span>
      <span><i class="rp-dot rp-dot-booked"></i> Has a booking</span>
    </div>
  </div>`;
}

/* ---------------- step 1 — order type ---------------- */

function orderTypeCard(type, rent) {
  const fee = orderTypeFeeFor(type, rent);
  const feeLabel = fee > 0 ? peso(fee) : 'Free';
  const copy = {
    delivery: 'Courier drops off and picks up at your saved address.',
    pickup: 'Collect from a DiaLux hub whenever suits you.',
    meetup: 'Schedule a handover at a public place inside Quezon City.',
  }[type];
  const title = { delivery: 'Delivery', pickup: 'Pickup', meetup: 'Meet-up' }[type];

  return `
    <label class="ot-card${orderType === type ? ' ot-card-active' : ''}">
      <input type="radio" name="orderType" value="${type}" ${orderType === type ? 'checked' : ''}>
      <div class="ot-card-body">
        <div class="ot-card-top"><b>${title}</b><span class="ot-card-fee">${feeLabel}</span></div>
        <p>${copy}</p>
      </div>
    </label>`;
}

function step1Markup(rent) {
  const hubField = orderType === 'pickup' ? `
    <div class="field" style="margin-top:14px;">
      <label for="pickupHubSelect">Pickup hub</label>
      <select id="pickupHubSelect" class="mini-select" style="width:100%;">
        <option value="">Choose a hub…</option>
        ${PICKUP_HUBS.map(h => `<option value="${h.id}"${h.id === pickupHub ? ' selected' : ''}>${escapeHtml(h.name)}</option>`).join('')}
      </select>
    </div>` : '';

  const meetupField = orderType === 'meetup' ? `
    <div class="field" style="margin-top:14px;">
      <label for="meetupLocationInput">Meeting place (inside Quezon City)</label>
      <input type="text" id="meetupLocationInput" placeholder="e.g. UP Town Center, Quezon City" value="${escapeHtml(meetupLocation)}">
      <span class="field-hint">Mention "Quezon City" or "QC" somewhere in the location.</span>
    </div>` : '';

  const slotField = (orderType === 'pickup' || orderType === 'meetup') ? `
    <div class="field" style="margin-top:14px;">
      <label for="timeSlotInput">Preferred time</label>
      <input type="text" id="timeSlotInput" placeholder="e.g. Weekday afternoons, 2–5 PM" value="${escapeHtml(timeSlot)}">
    </div>` : '';

  const deliveryNote = orderType === 'delivery' ? deliveryMarkup() : '';

  return `
    <h3>How would you like to receive it?</h3>
    <div class="ot-grid">
      ${ORDER_TYPES.map(t => orderTypeCard(t, rent)).join('')}
    </div>
    ${hubField}${meetupField}${slotField}${deliveryNote}`;
}

/* ---------------- step 2 — rental dates ---------------- */

/** Allowed rental length, from Settings (the server enforces the same limits). */
function dayLimits() {
  return {
    min: Math.max(1, Number(state.settings?.minRentalDays) || 1),
    max: Math.max(1, Number(state.settings?.maxRentalDays) || 180),
  };
}

/** Can this preset plan be booked under the current min / max rental length? */
function presetAllowed(plan) {
  const { min, max } = dayLimits();
  const n = PLAN_DAYS[plan];
  return n >= min && n <= max;
}

/** Keep planMode on something selectable (settings may rule out a preset). */
function normalizePlanMode() {
  if (planMode === 'Custom' || presetAllowed(planMode)) return;
  planMode = PLAN_CHOICES.find(pl => pl !== 'Custom' && presetAllowed(pl)) || 'Custom';
}

/** Move the start day; a preset plan carries its own length with it. */
function applyStart(dateStr) {
  startDate = dateStr;
  if (planMode !== 'Custom') {
    endDate = addDays(startDate, PLAN_DAYS[planMode]);
    awaitingEnd = false;
  }
}

/**
 * A calendar day was clicked. In a preset plan that chooses the start (the
 * plan supplies the length); in Custom it is a two-click range — start, then
 * return.
 */
function pickDay(d) {
  if (planMode !== 'Custom') { applyStart(d); return; }

  if (!awaitingEnd || d < startDate) {
    // First click (or one before the current start): a fresh start day. Hold
    // a 1-day placeholder so pricing stays valid until the return day is clicked.
    startDate = d;
    endDate = addDays(d, 1);
    awaitingEnd = true;
  } else {
    // Second click: the return day. Same day as the start = a 1-day rental.
    endDate = d === startDate ? addDays(d, 1) : d;
    awaitingEnd = false;
  }
}

function planOptionLabel(p, plan) {
  if (plan === 'Custom') return 'Custom dates — pick your own';
  const n = PLAN_DAYS[plan];
  const price = bestValue(p, n);
  return `${plan} — ${n} day${n === 1 ? '' : 's'}${price ? ` · ${peso(price)}` : ''}`;
}

function planHint(days) {
  const { min, max } = dayLimits();
  if (planMode === 'Custom') {
    return awaitingEnd
      ? 'Now pick your return day on the calendar (or type it below).'
      : `Pick a start day, then a return day — anywhere from ${min} to ${max} days. Currently ${days} day${days === 1 ? '' : 's'}.`;
  }
  return `Pick the day you want to start — your ${planMode.toLowerCase()} rental runs ${PLAN_DAYS[planMode]} day${PLAN_DAYS[planMode] === 1 ? '' : 's'} from it. Need a different length? Choose “Custom dates”.`;
}

function step2Markup(p, days) {
  const today = isoDate();
  const custom = planMode === 'Custom';

  const options = PLAN_CHOICES.map(plan => {
    const disabled = plan !== 'Custom' && !presetAllowed(plan);
    return `<option value="${plan}"${plan === planMode ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(planOptionLabel(p, plan))}${disabled ? ' (not available)' : ''}</option>`;
  }).join('');

  const customInputs = custom ? `
    <div class="rp-custom-dates">
      <div class="field">
        <label for="startInput">Start date</label>
        <input type="date" id="startInput" min="${today}" value="${escapeHtml(startDate)}">
      </div>
      <div class="field">
        <label for="endInput">Return date</label>
        <input type="date" id="endInput" min="${addDays(startDate, 1)}" value="${escapeHtml(endDate)}">
      </div>
    </div>` : '';

  return `
    <h3>Rental dates</h3>

    <div class="field">
      <label for="planSelect">Rental plan</label>
      <select id="planSelect" class="mini-select" style="width:100%;">${options}</select>
      <span class="field-hint" id="planHint">${escapeHtml(planHint(days))}</span>
    </div>

    <div class="rp-range-labels">
      <div><span class="field-hint">Start</span><b>${startDate ? formatDate(startDate) : '—'}</b></div>
      <div><span class="field-hint">Return</span><b>${endDate && !awaitingEnd ? formatDate(endDate) : '—'}</b></div>
      <div><span class="field-hint">Duration</span><b>${days} day${days === 1 ? '' : 's'}</b></div>
    </div>

    ${customInputs}
    ${calendarMarkup(today)}
    <p class="field-hint" style="margin-top:8px;">Days with a dot already have another booking — you can still pick them, we'll confirm availability when you place the order.</p>`;
}

/* ---------------- step 3 — payment ---------------- */

// Plain line-art icons, same stroke style as order.js's timeline icons —
// one per payment method, for the "icon + label + description" card grid.
const PAYMENT_ICONS = {
  gcash: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="2" width="16" height="20" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M9 6h6M9 18h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.6"/></svg>',
  maya: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M8 9l4 3 4-3M8 15l4-3 4 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.7"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="6" width="19" height="12" rx="1.6" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 9v0M18.5 15v0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  'bank-transfer': '<svg viewBox="0 0 24 24" fill="none"><path d="M3 10l9-6 9 6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 10h16v9H4v-9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 13v4M12 13v4M16 13v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

function paymentCard(method) {
  return `
    <label class="pm-card${paymentMethod === method ? ' pm-card-active' : ''}">
      <input type="radio" name="paymentMethod" value="${method}" ${paymentMethod === method ? 'checked' : ''}>
      <div class="pm-card-icon">${PAYMENT_ICONS[method] || ''}</div>
      <div class="pm-card-body">
        <b>${escapeHtml(paymentLabel(method))}</b>
        <p>${escapeHtml(PAYMENT_BLURBS[method] || '')}</p>
      </div>
    </label>`;
}

function step3Markup() {
  const allowed = state.settings?.paymentMethods?.length
    ? state.settings.paymentMethods
    : Object.keys(PAYMENT_LABELS);

  if (!paymentMethod || !allowed.includes(paymentMethod)) paymentMethod = allowed[0];

  const bankNote = paymentMethod === 'bank-transfer' ? `
    <div class="summary-note" style="margin-top:10px;">
      Bank details are shown after you place the booking, together with a place to upload your proof of payment.
    </div>` : '';

  return `
    <h3>Payment method</h3>
    <div class="pm-grid">${allowed.map(paymentCard).join('')}</div>
    ${bankNote}`;
}

/* ---------------- shared bits ---------------- */

/** Turns bestValueHint()'s data into the display string, formatting currency here. */
function bestValueHintText(p, days) {
  const hint = bestValueHint(p, days);
  return hint ? `Best value: ${hint.tierName} (saves ${peso(hint.savings)} vs. daily rate)` : '';
}

function itemMarkup(p, days) {
  const rate = bestValue(p, days);
  const hint = bestValueHintText(p, days);
  return `
  <div class="cart-item">
    <div class="cart-thumb">
      <img src="${escapeHtml(p.image || '')}" alt="" data-cat="${escapeHtml(p.cat || 'phone')}"
           style="width:100%;height:100%;object-fit:cover;border-radius:9px;">
    </div>

    <div class="cart-info">
      <h4>${escapeHtml(p.name)}</h4>
      <span>${escapeHtml(catLabel(p.cat))} · ${escapeHtml(p.grade || '')} · deposit ${peso(depositForDays(days))}</span>
      <div style="margin-top:8px;font-size:.8rem;color:var(--ink-faint);">
        ${peso(rate)} total · ${days} day${days === 1 ? '' : 's'} ·
        <span class="plan-tier-tag">${escapeHtml(planLabelFor(days))}</span>
      </div>
      ${hint ? `<div class="best-value-hint">${escapeHtml(hint)}</div>` : ''}
    </div>

    <div class="qty-ctrl">
      <button type="button" data-role="dec" aria-label="Decrease quantity" ${qty <= 1 ? 'disabled' : ''}>−</button>
      <span>${qty}</span>
      <button type="button" data-role="inc" aria-label="Increase quantity" ${qty >= p.stock ? 'disabled' : ''}>+</button>
    </div>

    <div class="cart-price">${peso(rate * qty)}</div>
  </div>`;
}

function deliveryMarkup() {
  const addresses = currentAddresses();
  const profile = currentProfile();

  if (!addresses.length) {
    if (profile?.address) {
      return `<div class="summary-note" style="margin-top:10px;">Delivering to: ${escapeHtml(addressLine(profile))}</div>`;
    }
    return '';
  }

  if (addresses.length === 1) {
    return `<div class="summary-note" style="margin-top:10px;">Delivering to: ${escapeHtml(addressLine(addresses[0]))}</div>`;
  }

  const chosen = addressId || (defaultAddress()?.id || '');
  return `
    <div class="field" style="margin-top:14px;">
      <label for="addressPick">Deliver to</label>
      <select id="addressPick" class="mini-select" style="width:100%;">
        ${addresses.map(a => `
          <option value="${escapeHtml(a.id)}"${a.id === chosen ? ' selected' : ''}>
            ${escapeHtml(a.label || 'Address')} — ${escapeHtml(addressLine(a))}
          </option>`).join('')}
      </select>
      <a href="/profile.html#addresses" class="summary-note" style="display:inline-block;margin-top:6px;">Manage addresses ›</a>
    </div>`;
}

function addressLine(a) {
  if (!a) return '';
  return [a.address, a.city, a.zip].filter(Boolean).join(', ');
}

function stepIndicator() {
  const labels = ['Receive', 'Dates', 'Payment'];
  return `
    <div class="rp-steps">
      ${labels.map((l, i) => {
        const n = i + 1;
        const cls = n === step ? 'rp-step-active' : (n < step ? 'rp-step-done' : '');
        return `<div class="rp-step ${cls}"><span class="rp-step-num">${n}</span>${l}</div>`;
      }).join('<div class="rp-step-line"></div>')}
    </div>`;
}


function depositForDays(days) {
  const rentalDays = Math.max(
    1,
    Number(days) || 1
  );

  if (rentalDays >= 28) return 5000;
  if (rentalDays >= 7) return 2500;

  return 500;
}

function summaryMarkup(p, days) {
  const profile = currentProfile();
  const hasAddress = Boolean(profile?.address) || currentAddresses().length > 0;
  const canCheckout = state.user && !state.settings?.maintenanceMode
    && (orderType !== 'delivery' || hasAddress);

  const rate = bestValue(p, days);
  const rent = rate * qty;
  const deposit = depositForDays(days) * qty;
  const fulfilmentFee = orderTypeFeeFor(orderType, rent);
  const pct = Number(state.settings?.protectionFeePct) || 0;
  const protectionQuote = protectionFeeFor(rent);
  const protectionFee = protection ? protectionQuote : 0;
  const total = rent + deposit + fulfilmentFee + protectionFee;

  let gate = '';
  if (!state.user) {
    gate = `<div class="return-reminder">Sign in to complete your booking.</div>
            <a class="btn btn-ghost" href="/index.html#auth" style="width:100%;justify-content:center;margin-top:4px;">Sign in</a>`;
  } else if (orderType === 'delivery' && !hasAddress) {
    gate = `<div class="return-reminder">Add a delivery address to continue.</div>
            <a class="btn btn-ghost" href="/profile.html#addresses" style="width:100%;justify-content:center;margin-top:4px;">Add address</a>`;
  } else if (state.settings?.maintenanceMode) {
    gate = `<div class="return-reminder">DiaLux is in maintenance — new bookings are paused.</div>`;
  }

  const protectionField = pct > 0 ? `
    <label class="protect-row" for="protectToggle">
      <input type="checkbox" id="protectToggle" ${protection ? 'checked' : ''}>
      <span>
        <b>Add damage protection</b>
        <small>Covers accidental damage during the rental — ${pct}% of rent (${peso(protectionQuote)}).</small>
      </span>
    </label>` : '';

  const stepContent = step === 1 ? step1Markup(rent) : step === 2 ? step2Markup(p, days) : step3Markup();

  const backBtn = step > 1 ? `<button type="button" class="btn btn-ghost" id="backBtn">Back</button>` : '';
  const nextBtn = step < 3
    ? `<button type="button" class="btn btn-primary" id="nextBtn" style="flex:1;justify-content:center;">Continue</button>`
    : `<button type="button" class="btn btn-primary" id="confirmBtn" style="flex:1;justify-content:center;" ${canCheckout ? '' : 'disabled'}>Confirm &amp; Pay</button>`;

  return `
  <aside class="summary-card">
    ${stepIndicator()}
    ${stepContent}

    <div class="summary-row" style="margin-top:16px;"><span>Duration</span><span class="mono">${days} day${days === 1 ? '' : 's'}</span></div>
    <div class="summary-row"><span>Rental subtotal</span><span class="mono">${peso(rent)}</span></div>
    <div class="summary-row"><span>Refundable deposit</span><span class="mono refundable">${peso(deposit)}</span></div>
    <div class="summary-row"><span>${orderType === 'pickup' ? 'Pickup' : orderType === 'meetup' ? 'Meet-up fee' : 'Delivery'}</span><span class="mono">${fulfilmentFee ? peso(fulfilmentFee) : 'Free'}</span></div>
    ${protectionFee ? `<div class="summary-row"><span>Damage protection</span><span class="mono">${peso(protectionFee)}</span></div>` : ''}
    <div class="summary-row total"><span>Total due</span><span class="mono">${peso(total)}</span></div>

    ${step === 2 ? protectionField : ''}

    <div class="summary-note">
      Returns due ${formatDate(endDate)}.
      The deposit is refunded in full once the device passes return inspection.
    </div>

    ${gate}

    <div style="display:flex;gap:10px;margin-top:14px;">
      ${backBtn}
      ${nextBtn}
    </div>

    <a class="btn btn-ghost" href="/products.html"
       style="width:100%;justify-content:center;margin-top:8px;">Keep browsing</a>
  </aside>`;
}

/* ---------------- render ---------------- */

function render() {
  const layout = document.getElementById('checkoutLayout');
  if (!layout) return;

  if (!state.products.length) {
    layout.style.display = 'block';
    layout.innerHTML = state.offline
      ? ''
      : emptyState('Catalog unavailable', 'Could not load the device catalog.', backToCatalog);
    return;
  }

  const p = productById(productId);

  if (!productId || !p) {
    layout.style.display = 'block';
    layout.innerHTML = emptyState(
      'Device not found',
      'That device may have been removed from the catalog. Pick another one to continue.',
      backToCatalog
    );
    return;
  }

  if (p.stock === 0) {
    layout.style.display = 'block';
    layout.innerHTML = emptyState(
      `${p.name} is out of stock`,
      'Every unit is currently rented out. Try another device, or check back once one is returned.',
      backToCatalog
    );
    return;
  }

  qty = Math.min(Math.max(1, qty), p.stock);

  normalizePlanMode();
  if (!startDate) startDate = isoDate();
  if (!endDate) endDate = addDays(startDate, planMode === 'Custom' ? 7 : PLAN_DAYS[planMode]);
  if (!addressId) addressId = defaultAddress()?.id || '';
  if (!calView) {
    const d = new Date(`${startDate}T00:00:00Z`);
    calView = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  }

  const days = daysBetween(startDate, endDate);

  layout.style.display = '';
  layout.innerHTML = bankPanelOrder
    ? `<div>${itemMarkup(p, days)}</div>${bankTransferPanelMarkup(bankPanelOrder)}`
    : `<div>${itemMarkup(p, days)}</div>${summaryMarkup(p, days)}`;

  bindControls(p);
  refreshFx();

  if (step === 2 && !availability) loadAvailability(p.id);
}

/* ---------------- post-booking bank-transfer panel ---------------- */

function bankTransferPanelMarkup(order) {
  const b = order.__bankDetails || {};
  return `
  <aside class="summary-card">
    <h3>Pay by bank transfer</h3>
    <p class="field-hint">Booking <b>${escapeHtml(order.invoiceNo || order.id)}</b> is placed and pending payment.</p>
    <div class="summary-row"><span>Bank</span><span class="mono">${escapeHtml(b.bank || '')}</span></div>
    <div class="summary-row"><span>Account name</span><span class="mono">${escapeHtml(b.accountName || '')}</span></div>
    <div class="summary-row"><span>Account number</span><span class="mono">${escapeHtml(b.accountNumber || '')}</span></div>
    <div class="summary-note">${escapeHtml(b.note || '')}</div>

    <div class="field" style="margin-top:14px;">
      <label for="proofFile">Upload proof of payment</label>
      <input type="file" id="proofFile" accept="image/*,application/pdf">
      <span class="field-hint">A screenshot or photo of your receipt is fine.</span>
    </div>

    <button class="btn btn-primary" id="submitProofBtn" style="width:100%;justify-content:center;margin-top:14px;" disabled>
      Submit proof
    </button>
    <a class="btn btn-ghost" href="/order.html?id=${order.id}" style="width:100%;justify-content:center;margin-top:8px;">
      I'll upload this later — view my booking
    </a>
  </aside>`;
}

/* ---------------- availability ---------------- */

async function loadAvailability(pid) {
  try {
    availability = await ordersApi.availability(pid);
  } catch {
    availability = { windows: [] };
  }
  render();
}

/* ---------------- validation per step ---------------- */

function validateStep1() {
  if (orderType === 'pickup' && !pickupHub) { toast('Choose a pickup hub', 'error'); return false; }
  if (orderType === 'pickup' && !timeSlot.trim()) { toast('Add a preferred pickup time', 'error'); return false; }
  if (orderType === 'meetup' && !meetupLocation.trim()) { toast('Add a meet-up location', 'error'); return false; }
  if (orderType === 'meetup' && !/\bq(?:uezon)?\s*c(?:ity)?\b/i.test(meetupLocation)) {
    toast('Meet-ups are only available inside Quezon City — mention QC or Quezon City', 'error');
    return false;
  }
  if (orderType === 'meetup' && !timeSlot.trim()) { toast('Add a preferred meet-up time', 'error'); return false; }
  if (orderType === 'delivery' && state.user && !currentProfile()?.address && !currentAddresses().length) {
    toast('Add a delivery address in your profile first', 'error');
    return false;
  }
  return true;
}

function validateStep2() {
  if (!startDate || !endDate) { toast('Pick your rental dates', 'error'); return false; }
  if (startDate < isoDate()) { toast('The start date can’t be in the past', 'error'); return false; }
  if (awaitingEnd) { toast('Pick your return day on the calendar', 'error'); return false; }

  const days = daysBetween(startDate, endDate);
  const { min, max } = dayLimits();
  if (endDate <= startDate) { toast('The return date must be after the start date', 'error'); return false; }
  if (days < min || days > max) {
    toast(`Rentals run from ${min} to ${max} days — yours is ${days}`, 'error');
    return false;
  }
  return true;
}

/* ---------------- behaviour ---------------- */

function bindControls(p) {
  const layout = document.getElementById('checkoutLayout');

  layout.querySelector('[data-role="inc"]')?.addEventListener('click', () => {
    if (qty < p.stock) { qty += 1; render(); }
  });
  layout.querySelector('[data-role="dec"]')?.addEventListener('click', () => {
    if (qty > 1) { qty -= 1; render(); }
  });

  /* ---- step 1 ---- */
  layout.querySelectorAll('input[name="orderType"]').forEach(r => {
    r.addEventListener('change', (e) => { orderType = e.target.value; render(); });
  });
  layout.querySelector('#pickupHubSelect')?.addEventListener('change', (e) => { pickupHub = e.target.value; });
  layout.querySelector('#meetupLocationInput')?.addEventListener('input', (e) => { meetupLocation = e.target.value; });
  layout.querySelector('#timeSlotInput')?.addEventListener('input', (e) => { timeSlot = e.target.value; });
  layout.querySelector('#addressPick')?.addEventListener('change', (e) => { addressId = e.target.value; });

  /* ---- step 2: calendar ---- */
  layout.querySelector('#calPrev')?.addEventListener('click', () => {
    calView.month -= 1;
    if (calView.month < 0) { calView.month = 11; calView.year -= 1; }
    render();
  });
  layout.querySelector('#calNext')?.addEventListener('click', () => {
    calView.month += 1;
    if (calView.month > 11) { calView.month = 0; calView.year += 1; }
    render();
  });
  layout.querySelectorAll('.cal-day:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => { pickDay(btn.dataset.date); render(); });
  });

  layout.querySelector('#planSelect')?.addEventListener('change', (e) => {
    planMode = e.target.value;
    awaitingEnd = false;
    if (planMode !== 'Custom') applyStart(startDate || isoDate());   // snap to the plan's length
    render();
  });

  // Custom only: typed dates. Changing the start keeps the length, unless the
  // return date would end up on or before it.
  layout.querySelector('#startInput')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const keep = daysBetween(startDate, endDate);
    startDate = e.target.value < isoDate() ? isoDate() : e.target.value;
    if (!endDate || endDate <= startDate) endDate = addDays(startDate, keep);
    awaitingEnd = false;
    const d = new Date(`${startDate}T00:00:00Z`);
    calView = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    render();
  });
  layout.querySelector('#endInput')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    endDate = e.target.value <= startDate ? addDays(startDate, 1) : e.target.value;
    awaitingEnd = false;
    render();
  });

  layout.querySelector('#protectToggle')?.addEventListener('change', (e) => {
    protection = e.target.checked;
    render();
  });

  /* ---- step 3 ---- */
  layout.querySelectorAll('input[name="paymentMethod"]').forEach(r => {
    r.addEventListener('change', (e) => { paymentMethod = e.target.value; render(); });
  });

  /* ---- bank-transfer proof panel ---- */
  const proofInput = layout.querySelector('#proofFile');
  const submitProofBtn = layout.querySelector('#submitProofBtn');
  proofInput?.addEventListener('change', () => {
    const file = proofInput.files?.[0];
    if (!file) { submitProofBtn.disabled = true; return; }
    if (file.size > 500 * 1024) {
      toast('Please choose an image under 500KB', 'error');
      proofInput.value = '';
      submitProofBtn.disabled = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { proofDataUrl = reader.result; submitProofBtn.disabled = false; };
    reader.readAsDataURL(file);
  });
  submitProofBtn?.addEventListener('click', async () => {
    const done = fx.setBtnLoading(submitProofBtn, 'Uploading…');
    try {
      await paymentsApi.submitProof(bankPanelOrder.id, proofDataUrl);
      toast('Proof submitted — we will verify it shortly.');
      setTimeout(() => { location.href = `/order.html?id=${bankPanelOrder.id}`; }, 800);
    } catch (err) {
      done();
      toast(err instanceof ApiError ? err.message : 'Could not submit your proof', 'error');
    }
  });

  /* ---- navigation ---- */
  layout.querySelector('#backBtn')?.addEventListener('click', () => { step -= 1; render(); });

  layout.querySelector('#nextBtn')?.addEventListener('click', () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    step += 1;
    render();
  });

  layout.querySelector('#confirmBtn')?.addEventListener('click', (e) => handleConfirm(e, p));
}

async function handleConfirm(e, p) {
  if (!state.user) { toast('Please sign in first', 'error'); return; }
  if (orderType === 'delivery' && !currentProfile()?.address && !currentAddresses().length) {
    toast('Add a delivery address in your profile', 'error');
    return;
  }

  const btn = e.currentTarget;
  const done = fx.setBtnLoading(btn, 'Placing booking…');

  const res = await orderNow({
    productId: p.id,
    plan: planFieldFor(daysBetween(startDate, endDate)),
    qty,
    startDate,
    endDate,
    protection,
    addressId: addressId || undefined,
    orderType,
    pickupHub: orderType === 'pickup' ? pickupHub : undefined,
    meetupLocation: orderType === 'meetup' ? meetupLocation : undefined,
    timeSlot: (orderType === 'pickup' || orderType === 'meetup') ? timeSlot : undefined,
  });

  if (!res.ok) {
    done();
    toast(res.error, 'error');
    render();   // stock or availability may have changed under us
    return;
  }

  try {
    const r = await paymentsApi.method(res.order.id, paymentMethod, undefined);

    if (r.checkoutUrl) {
      toast(`Redirecting to ${paymentLabel(paymentMethod)}…`);
      location.href = r.checkoutUrl;
      return;
    }
    if (r.simulated) {
      toast(`Payment confirmed — booking ${res.order.invoiceNo || ''}`);
      setTimeout(() => { location.href = r.redirectUrl || `/order.html?id=${res.order.id}`; }, 800);
      return;
    }
    if (r.bankDetails) {
      bankPanelOrder = { ...res.order, __bankDetails: r.bankDetails };
      toast('Booking placed — see the bank details below.');
      render();
      return;
    }
    // cash on delivery
    toast(`Booking placed — pay ${peso(res.order.total)} on delivery.`);
    setTimeout(() => { location.href = `/order.html?id=${res.order.id}`; }, 900);
  } catch (err) {
    done();
    toast('Booking placed, but we could not set the payment method. You can try again from your profile.', 'error');
    setTimeout(() => { location.href = '/profile.html#orders'; }, 1200);
  }
}

bootPage('checkout', render);