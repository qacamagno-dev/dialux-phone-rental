// ============================================================
// DiaLux — pages/cart.js
// Cart review, quantity controls, a rental date range, optional damage
// protection, delivery-address selection, and checkout with simulated
// payment.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx } from '../core/page.js';
import {
  state, updateCartLine, removeCartLine, placeOrder, payOrder,
  setCartDates, setCartProtection, currentProfile, currentAddresses,
  defaultAddress, isoDate, addDays, daysBetween, productById,
  planLabelFor, bestValueHint,
} from '../core/state.js';
import {
  peso, escapeHtml, toast, updateCartBadge, emptyState, formatDate,
  catLabel, paymentOptions, addressLine,
} from '../core/ui.js';

/** Same display string as checkout.js's bestValueHintText() — see state.js's bestValueHint(). */
function bestValueHintText(p, days) {
  const hint = bestValueHint(p, days);
  return hint ? `Best value: ${hint.tierName} (saves ${peso(hint.savings)} vs. daily rate)` : '';
}

// The rental window prices the whole cart. Seeded from the cart once it has
// hydrated (falling back to a 7-day window), then owned by the date inputs.
let startDate = '';
let endDate = '';

// Which saved address this booking ships to. Empty means "the account default",
// which is what the server falls back to anyway.
let addressId = '';

function itemMarkup(line) {
  // The full product record (daily/weekly/monthly rates) isn't on the
  // priced cart line itself — looked up here only for the tier label and
  // the best-value hint, same ones checkout.js shows (Bug 1.1/1.4).
  const product = productById(line.productId);
  const hint = product ? bestValueHintText(product, line.days) : '';

  return `
  <div class="cart-item" data-id="${escapeHtml(line.productId)}" data-plan="${escapeHtml(line.plan)}">
    <div class="cart-thumb">
      <img src="${escapeHtml(line.image || '')}" alt="" data-cat="${escapeHtml(line.cat || 'phone')}"
           style="width:100%;height:100%;object-fit:cover;border-radius:9px;">
    </div>

    <div class="cart-info">
      <h4>${escapeHtml(line.name)}</h4>
      <span>${escapeHtml(catLabel(line.cat))} · ${escapeHtml(line.grade || '')} · deposit ${peso(line.deposit)}</span>
      <div style="margin-top:8px;font-size:.8rem;color:var(--ink-faint);">
        ${peso(line.rate)} total · ${line.days} day${line.days === 1 ? '' : 's'} ·
        <span class="plan-tier-tag">${escapeHtml(planLabelFor(line.days))}</span>
      </div>
      ${hint ? `<div class="best-value-hint">${escapeHtml(hint)}</div>` : ''}
    </div>

    <div class="qty-ctrl">
      <button type="button" data-role="dec" aria-label="Decrease quantity" ${line.qty <= 1 ? 'disabled' : ''}>−</button>
      <span>${line.qty}</span>
      <button type="button" data-role="inc" aria-label="Increase quantity" ${line.qty >= line.stock ? 'disabled' : ''}>+</button>
    </div>

    <div class="cart-price">${peso(line.rentSubtotal)}</div>

    <button class="remove-btn" type="button" data-role="remove" aria-label="Remove ${escapeHtml(line.name)}">
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>`;
}

/**
 * Delivery block: a picker when several addresses are saved, a plain line when
 * there is one, and a prompt to add one when there are none.
 */
function deliveryMarkup() {
  const addresses = currentAddresses();
  const profile = currentProfile();

  if (!addresses.length) {
    // Legacy accounts may still carry only the mirrored profile block.
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

function summaryMarkup(cart) {
  const profile = currentProfile();
  const hasAddress = Boolean(profile?.address) || currentAddresses().length > 0;
  const days = daysBetween(startDate, endDate);
  const canCheckout = state.user && hasAddress && !state.settings?.maintenanceMode;

  const minDays = Number(state.settings?.minRentalDays) || 1;
  const maxDays = Number(state.settings?.maxRentalDays) || 180;
  const endMax = addDays(startDate, maxDays - 1);
  const endMin = addDays(startDate, minDays - 1);

  const pct = cart.protectionPct ?? state.settings?.protectionFeePct ?? 0;
  const quote = cart.protectionQuote ?? 0;

  let gate = '';
  if (!state.user) {
    gate = `<div class="return-reminder">Sign in to complete your booking. Your cart will carry over.</div>
            <a class="btn btn-ghost" href="/index.html#auth" style="width:100%;justify-content:center;margin-top:4px;">Sign in</a>`;
  } else if (!hasAddress) {
    gate = `<div class="return-reminder">Add a delivery address to continue.</div>
            <a class="btn btn-ghost" href="/profile.html#addresses" style="width:100%;justify-content:center;margin-top:4px;">Add address</a>`;
  } else if (state.settings?.maintenanceMode) {
    gate = `<div class="return-reminder">DiaLux is in maintenance — new bookings are paused. Your cart is saved.</div>`;
  } else {
    gate = deliveryMarkup();
  }

  const payField = canCheckout ? `
    <div class="field" style="margin-top:14px;">
      <label for="payMethod">Payment method</label>
      <select id="payMethod" class="mini-select" style="width:100%;">
        ${paymentOptions('gcash')}
      </select>
    </div>` : '';

  // Protection is only offered when the platform actually charges for it.
  const protectionField = pct > 0 ? `
    <label class="protect-row" for="protectToggle">
      <input type="checkbox" id="protectToggle" ${cart.protection ? 'checked' : ''}>
      <span>
        <b>Add damage protection</b>
        <small>Covers accidental damage during the rental — ${pct}% of rent (${peso(quote)}).</small>
      </span>
    </label>` : '';

  return `
  <aside class="summary-card">
    <h3>Rental summary</h3>

    <div class="field" style="margin-bottom:12px;">
      <label for="startDate">Rental start</label>
      <input type="date" id="startDate" value="${startDate}" min="${isoDate()}">
    </div>
    <div class="field" style="margin-bottom:6px;">
      <label for="endDate">Return date</label>
      <input type="date" id="endDate" value="${endDate}" min="${endMin}" max="${endMax}">
    </div>
    <div class="field-hint" style="margin-bottom:18px;">${minDays}–${maxDays} day rental window.</div>

    <div class="summary-row"><span>Duration</span><span class="mono">${days} day${days === 1 ? '' : 's'} · ${escapeHtml(planLabelFor(days))}</span></div>
    <div class="summary-row"><span>Rental subtotal</span><span class="mono">${peso(cart.rent)}</span></div>
    <div class="summary-row"><span>Refundable deposit</span><span class="mono refundable">${peso(cart.deposit)}</span></div>
    <div class="summary-row"><span>Delivery</span><span class="mono">${cart.delivery ? peso(cart.delivery) : 'Free'}</span></div>
    ${cart.protectionFee ? `<div class="summary-row"><span>Damage protection</span><span class="mono">${peso(cart.protectionFee)}</span></div>` : ''}
    <div class="summary-row total"><span>Total due today</span><span class="mono">${peso(cart.total)}</span></div>

    ${protectionField}

    <div class="summary-note">
      Returns due ${formatDate(endDate)}.
      The deposit is refunded in full once the device passes return inspection.
    </div>

    ${payField}
    ${gate}

    <button class="btn btn-primary" id="checkoutBtn"
      style="width:100%;justify-content:center;margin-top:14px;"
      ${canCheckout ? '' : 'disabled'}>
      Confirm &amp; Pay
    </button>
  </aside>`;
}

function render() {
  const layout = document.getElementById('cartLayout');
  if (!layout) return;

  const cart = state.cart;

  if (!cart.lines.length) {
    layout.style.display = 'block';
    layout.innerHTML = emptyState(
      'Your cart is empty',
      'Browse the catalog and add a device to get started.',
      `<a class="btn btn-primary" href="/products.html">Browse devices</a>
       <a class="btn btn-ghost" href="/wishlist.html" style="margin-left:8px;">View wishlist</a>`
    );
    updateCartBadge();
    return;
  }

  // Seed the window from the cart the first time (or from saved dates), then
  // let the inputs own it. The default matches the cart's 7-day fallback.
  if (!startDate) startDate = cart.startDate || isoDate();
  if (!endDate)   endDate = cart.endDate || addDays(startDate, 7);
  if (!addressId) addressId = defaultAddress()?.id || '';

  layout.style.display = '';
  layout.innerHTML = `
    <div><div id="cartItems">${cart.lines.map(itemMarkup).join('')}</div></div>
    ${summaryMarkup(cart)}`;

  bindItemActions();
  bindCheckout();
  updateCartBadge();
  refreshFx();
}

function lineFrom(el) {
  const item = el.closest('.cart-item');
  return { productId: item.dataset.id, plan: item.dataset.plan };
}

function bindItemActions() {
  const box = document.getElementById('cartItems');
  if (!box) return;

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;

    const { productId, plan } = lineFrom(btn);
    const line = state.cart.lines.find(l => l.productId === productId && l.plan === plan);
    if (!line) return;

    btn.disabled = true;
    let res;
    if (btn.dataset.role === 'inc') res = await updateCartLine(productId, plan, { qty: line.qty + 1 });
    else if (btn.dataset.role === 'dec') res = await updateCartLine(productId, plan, { qty: line.qty - 1 });
    else if (btn.dataset.role === 'remove') {
      res = await removeCartLine(productId, plan);
      if (res.ok) toast('Removed from cart');
    }

    if (res && !res.ok) toast(res.error, 'error');
    render();
  });
}

/**
 * Persist a changed rental window, then re-price and re-render. Bug 1.4:
 * clamps to Settings' minRentalDays/maxRentalDays client-side before ever
 * calling the server, so a customer gets an immediate, specific toast
 * ("at least 3 days") instead of a generic rejection after a round trip —
 * the server (routes/cart.js) still enforces the same bounds independently,
 * since a client-side clamp is a courtesy, never the real guard.
 */
async function onDateChange() {
  const s = document.getElementById('startDate')?.value || isoDate();
  let e = document.getElementById('endDate')?.value || addDays(s, 7);
  if (e < s) e = s;   // never let the return date fall before the start

  const min = Number(state.settings?.minRentalDays) || 1;
  const max = Number(state.settings?.maxRentalDays) || 180;
  const days = daysBetween(s, e);

  if (days < min) { e = addDays(s, min - 1); toast(`Minimum rental is ${min} day${min === 1 ? '' : 's'}`, 'error'); }
  else if (days > max) { e = addDays(s, max - 1); toast(`Maximum rental is ${max} days`, 'error'); }

  startDate = s;
  endDate = e;
  const res = await setCartDates(startDate, endDate);
  if (!res.ok) toast(res.error, 'error');
  render();
}

function bindCheckout() {
  document.getElementById('startDate')?.addEventListener('change', onDateChange);
  document.getElementById('endDate')?.addEventListener('change', onDateChange);

  document.getElementById('addressPick')?.addEventListener('change', (e) => {
    addressId = e.target.value;
  });

  document.getElementById('protectToggle')?.addEventListener('change', async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    const res = await setCartProtection(on);
    if (!res.ok) toast(res.error, 'error');
    render();
  });

  const btn = document.getElementById('checkoutBtn');
  btn?.addEventListener('click', async () => {
    if (!state.user) { toast('Please sign in first', 'error'); return; }
    if (!currentProfile()?.address && !currentAddresses().length) {
      toast('Add a delivery address in your profile', 'error');
      return;
    }

    const method = document.getElementById('payMethod')?.value || 'gcash';
    const done = fx.setBtnLoading(btn, 'Processing payment…');

    const res = await placeOrder({
      startDate,
      endDate,
      addressId: addressId || undefined,
      protection: Boolean(state.cart.protection),
    });
    if (!res.ok) {
      done();
      toast(res.error, 'error');
      render();     // stock may have changed under us
      return;
    }

    // Simulated payment immediately after the booking is created.
    const pay = await payOrder(res.order.id, method);
    updateCartBadge();

    if (!pay.ok) {
      // The booking exists but is still pending — offer the profile recovery.
      toast('Booking placed, but payment failed. You can pay it from your profile.', 'error');
      setTimeout(() => { location.href = '/profile.html#orders'; }, 900);
      return;
    }

    toast(`Payment confirmed — booking #${String(res.order.id).slice(-6).toUpperCase()}`);
    setTimeout(() => { location.href = `/order.html?id=${res.order.id}`; }, 800);
  });
}

bootPage('cart', render);