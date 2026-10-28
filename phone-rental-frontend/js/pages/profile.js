// ============================================================
// DiaLux — pages/profile.js
// Account details, password, address book, rental history and the
// customer's support threads.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx } from '../core/page.js';
import {
  state, currentProfile, currentAddresses, saveAccount,
  addAddress, updateAddress, setDefaultAddress, removeAddress,
  cancelOrder, requestReturn, extendRental, payOrder, refreshOrders,
  TIMELINE_STEPS, STATUS_STAGE, REVIEWABLE_STATUSES,
} from '../core/state.js';
import { supportApi } from '../core/api.js';
import {
  peso, escapeHtml, formatDate, formatDateTime, toast, emptyState,
  statusClass, titleCase, catLabel, addressLine, paymentLabel,
} from '../core/ui.js';
import { requireAuth, changePassword, renderAcctButton } from '../core/auth.js';
import { openConsentPreferences } from '../core/consent.js';

const shortId = (id) => String(id).slice(-6).toUpperCase();

// Which address row is open in the editor. '' = none, 'new' = the add form.
let editingAddress = '';

let tickets = [];
let openTicket = '';

/* ---------------- account ---------------- */

function renderAccount() {
  const box = document.getElementById('accountContent');
  if (!box) return;

  // The sign-in prompt is a single centred block, so drop the 2-column
  // grid while it's showing.
  box.classList.toggle('account-grid', Boolean(state.user));
  if (!requireAuth(box, 'Sign in to manage your profile and see your rentals.')) return;

  const profile = currentProfile() || {};
  const u = state.user;
  // A Google-only account has no password yet, so there is nothing to verify
  // before setting one. The server applies the same rule.
  const hasPassword = Boolean(u.hasPassword);

  box.innerHTML = `
    <div class="account-card">
      <h3>Personal details</h3>
      <p>Your name and contact number, as they appear on deliveries.</p>
      <form id="accountForm">
        <div class="field">
          <label for="pf-name">Full name</label>
          <input type="text" id="pf-name" value="${escapeHtml(u.name || '')}" required maxlength="120">
        </div>
        <div class="field">
          <label for="pf-email">Email</label>
          <input type="email" id="pf-email" value="${escapeHtml(u.email || '')}" readonly>
          <small class="field-hint">Your email is your sign-in and cannot be changed here.</small>
        </div>
        <div class="field">
          <label for="pf-phone">Mobile number</label>
          <input type="tel" id="pf-phone" value="${escapeHtml(profile.phone || '')}" placeholder="09XX XXX XXXX">
        </div>
        <div class="field">
          <label for="pf-role">Account type</label>
          <input type="text" id="pf-role" value="${escapeHtml(titleCase(u.role || 'user'))}" readonly>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Save details</button>
      </form>
    </div>

    <div class="account-card">
      <h3>Password</h3>
      <p>${hasPassword
        ? 'Choose something you do not use elsewhere. Minimum six characters.'
        : 'Your account signs in with Google. Set a password to sign in either way.'}</p>
      <form id="passwordForm">
        <div class="field"${hasPassword ? '' : ' hidden'}>
          <label for="pw-current">Current password</label>
          <input type="password" id="pw-current" autocomplete="current-password">
        </div>
        <div class="field">
          <label for="pw-new">${hasPassword ? 'New password' : 'Choose a password'}</label>
          <input type="password" id="pw-new" autocomplete="new-password" minlength="6" required>
        </div>
        <div class="field">
          <label for="pw-confirm">Confirm ${hasPassword ? 'new ' : ''}password</label>
          <input type="password" id="pw-confirm" autocomplete="new-password" minlength="6" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">
          ${hasPassword ? 'Update password' : 'Set password'}
        </button>
      </form>
      <p class="summary-note" style="margin-top:12px;">
        Forgot it entirely? <a href="/index.html#forgot" style="color:var(--accent);">Use the reset link flow ›</a>
      </p>
    </div>

    <div class="account-card">
      <h3>Privacy & communications</h3>
      <p>
        Review the DiaLux Terms &amp; Privacy Policy and choose whether you want
        optional promotional emails about new devices and rental deals.
      </p>
      <button
        type="button"
        class="btn btn-ghost"
        id="consentPreferencesBtn"
        style="width:100%;justify-content:center;"
      >
        Manage communication preferences
      </button>
    </div>`;

  box.querySelector('#accountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { toast('Your name cannot be blank', 'error'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Saving…');
    const res = await saveAccount({
      name,
      phone: document.getElementById('pf-phone').value.trim(),
    });
    done();

    if (!res.ok) { toast(res.error, 'error'); return; }
    toast('Details saved');
    renderAccount();
    renderAcctButton();   // the header greeting uses the name we just changed
  });

  box.querySelector('#consentPreferencesBtn')?.addEventListener('click', async () => {
    try {
      await openConsentPreferences();
    } catch (err) {
      toast(err.message || 'Could not open communication preferences', 'error');
    }
  });

  box.querySelector('#passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = document.getElementById('pw-current')?.value || '';
    const next = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;

    if (next.length < 6) { toast('New password must be at least 6 characters', 'error'); return; }
    if (next !== confirm) { toast('The two new passwords do not match', 'error'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Updating…');
    try {
      await changePassword(current, next);
      done();
      e.target.reset();
      toast('Password updated');
    } catch (err) {
      done();
      toast(err.message || 'Could not change your password', 'error');
    }
  });
}

/* ---------------- address book ---------------- */

function addressFormMarkup(a = null) {
  const v = (k, d = '') => escapeHtml(String(a?.[k] ?? d));
  return `
    <form class="address-form" id="addressForm" data-id="${escapeHtml(a?.id || '')}">
      <h4>${a ? 'Edit address' : 'Add an address'}</h4>
      <div class="field-row">
        <div class="field">
          <label for="ad-label">Label</label>
          <input type="text" id="ad-label" value="${v('label', 'Home')}" maxlength="40" placeholder="Home, Dorm, Office">
        </div>
        <div class="field">
          <label for="ad-phone">Mobile number</label>
          <input type="tel" id="ad-phone" value="${v('phone')}" placeholder="09XX XXX XXXX">
        </div>
      </div>
      <div class="field">
        <label for="ad-address">Street address</label>
        <input type="text" id="ad-address" value="${v('address')}" required
               placeholder="Unit / house no., street, barangay">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="ad-city">City</label>
          <input type="text" id="ad-city" value="${v('city')}" placeholder="Quezon City">
        </div>
        <div class="field">
          <label for="ad-zip">ZIP</label>
          <input type="text" id="ad-zip" value="${v('zip')}" placeholder="1100">
        </div>
      </div>
      <label class="protect-row" for="ad-default" style="margin:10px 0;">
        <input type="checkbox" id="ad-default" ${a?.isDefault ? 'checked disabled' : ''}>
        <span><b>Use as my default delivery address</b>
          <small>${a?.isDefault ? 'This is already your default.' : 'Checkout will preselect it.'}</small></span>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" type="submit">${a ? 'Save changes' : 'Add address'}</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="cancel-address">Cancel</button>
      </div>
    </form>`;
}

function addressRow(a) {
  return `
    <div class="address-card${a.isDefault ? ' is-default' : ''}" data-id="${escapeHtml(a.id)}">
      <div class="address-top">
        <b>${escapeHtml(a.label || 'Address')}</b>
        ${a.isDefault ? '<span class="status-pill status-approved">Default</span>' : ''}
      </div>
      <p>${escapeHtml(addressLine(a))}</p>
      ${a.phone ? `<p class="address-phone">${escapeHtml(a.phone)}</p>` : ''}
      <div class="row-actions">
        ${a.isDefault ? '' : `<button type="button" data-act="default-address" data-id="${escapeHtml(a.id)}">Make default</button>`}
        <button type="button" data-act="edit-address" data-id="${escapeHtml(a.id)}">Edit</button>
        <button type="button" class="del" data-act="delete-address" data-id="${escapeHtml(a.id)}">Remove</button>
      </div>
    </div>`;
}

function renderAddresses() {
  const box = document.getElementById('addressBook');
  if (!box) return;
  if (!state.user) { box.innerHTML = ''; return; }

  const addresses = currentAddresses();

  const list = addresses.length
    ? `<div class="address-grid">${addresses.map(addressRow).join('')}</div>`
    : `<p class="summary-note">No saved addresses yet. Add one so checkout knows where to deliver.</p>`;

  const editor = editingAddress === 'new'
    ? addressFormMarkup(null)
    : editingAddress
      ? addressFormMarkup(addresses.find(a => a.id === editingAddress))
      : `<button class="btn btn-outline btn-sm" type="button" data-act="new-address">+ Add an address</button>`;

  box.innerHTML = `${list}<div class="address-editor">${editor}</div>`;

  bindAddressActions(box);
  refreshFx();
}

function bindAddressActions(box) {
  // Delegated once onto the stable #addressBook node — renderAddresses()
  // replaces its innerHTML, not the element, so one binding covers every
  // future render. The form below is a fresh node each time, so it is
  // re-bound on every call.
  if (!box.dataset.actionsBound) {
    box.dataset.actionsBound = '1';
    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const { act, id } = btn.dataset;

      if (act === 'new-address') { editingAddress = 'new'; renderAddresses(); return; }
      if (act === 'edit-address') { editingAddress = id; renderAddresses(); return; }
      if (act === 'cancel-address') { editingAddress = ''; renderAddresses(); return; }

      if (act === 'default-address') {
        const res = await setDefaultAddress(id);
        toast(res.ok ? 'Default address updated' : res.error, res.ok ? 'ok' : 'error');
        renderAddresses();
        return;
      }

      if (act === 'delete-address') {
        if (!confirm('Remove this delivery address?')) return;
        const res = await removeAddress(id);
        toast(res.ok ? 'Address removed' : res.error, res.ok ? 'ok' : 'error');
        if (editingAddress === id) editingAddress = '';
        renderAddresses();
      }
    });
  }

  box.querySelector('#addressForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = e.target.dataset.id;
    const payload = {
      label: document.getElementById('ad-label').value.trim() || 'Home',
      phone: document.getElementById('ad-phone').value.trim(),
      address: document.getElementById('ad-address').value.trim(),
      city: document.getElementById('ad-city').value.trim(),
      zip: document.getElementById('ad-zip').value.trim(),
      isDefault: document.getElementById('ad-default').checked,
    };

    if (!payload.address) { toast('Street address is required', 'error'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Saving…');
    const res = id ? await updateAddress(id, payload) : await addAddress(payload);
    done();

    if (!res.ok) { toast(res.error, 'error'); return; }
    toast(id ? 'Address updated' : 'Address added');
    editingAddress = '';
    renderAddresses();
  });
}

/* ---------------- orders ---------------- */

/**
 * The "how far along is it" strip under each rental row — a thin fill bar,
 * not the full step-by-step view (that's the vertical timeline on the
 * booking detail page, pages/order.js). Hidden for 'pending' (nothing to
 * show progress on until it's paid) and 'cancelled' (there is no progress).
 */
function progressMarkup(status) {
  const stage = STATUS_STAGE[status] ?? -1;
  if (stage === -1) return '';

  const total = TIMELINE_STEPS.length;
  const pct = Math.round(((stage + 1) / total) * 100);
  const label = TIMELINE_STEPS[stage]?.label || titleCase(status);

  return `
    <div class="progress-bar-mini-wrap">
      <div class="progress-bar-mini" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Booking progress"><div class="progress-bar-mini-fill${status === 'disputed' ? ' is-alert' : ''}" style="width:${pct}%"></div></div>
      <span class="progress-bar-mini-label">${escapeHtml(label)} · ${pct}%</span>
    </div>`;
}

function orderActions(o) {
  const buttons = [];
  if (o.status === 'pending' && !o.paid) {
    buttons.push(`<a class="btn btn-primary btn-sm" href="/order.html?id=${o.id}">Pay now</a>`);
    buttons.push(`<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${o.id}">Cancel booking</button>`);
  } else if (o.status === 'pending') {
    buttons.push(`<button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${o.id}">Cancel booking</button>`);
  }
  // Receipt, returns and problem reports all live on the booking page.
  if (['delivered', 'ready-for-pickup'].includes(o.status)) {
    buttons.push(`<a class="btn btn-primary btn-sm" href="/order.html?id=${o.id}">Confirm receipt</a>`);
  }
  if (['received', 'active'].includes(o.status)) {
    buttons.push(`<a class="btn btn-primary btn-sm" href="/order.html?id=${o.id}">Request return</a>`);
    buttons.push(`<button class="btn btn-ghost btn-sm" data-act="extend" data-id="${o.id}">Extend rental</button>`);
  }
  if (o.status === 'disputed') {
    buttons.push('<span class="summary-note">Problem reported — our team will contact you.</span>');
  }
  if (['return-requested', 'return-scheduled', 'return-in-transit'].includes(o.status)) {
    buttons.push('<span class="summary-note">Return in progress — see the booking page for the pickup details.</span>');
  }
  buttons.push(`<a class="btn btn-ghost btn-sm" href="/order.html?id=${o.id}">View details &amp; invoice</a>`);
  return `<div class="order-actions">${buttons.join('')}</div>`;
}

function orderCard(o) {
  const reviewable = REVIEWABLE_STATUSES.includes(o.status);
  const paidBadge = o.paid
    ? `<span class="paid-pill">✓ Paid</span>`
    : '';
  const refundNote = o.refund
    ? `<div class="summary-note" style="margin-top:8px;">
         Deposit settled: ${peso(o.refund.amount)} refunded${o.refund.deducted ? `, ${peso(o.refund.deducted)} withheld` : ''}
         ${o.refund.note ? ` — ${escapeHtml(o.refund.note)}` : ''}
       </div>`
    : '';

  return `
  <div class="order-card">
    <div class="order-top">
      <b><a href="/order.html?id=${o.id}" style="color:inherit;">Booking #${shortId(o.id)}</a></b>
      <span style="display:inline-flex;align-items:center;gap:8px;">
        ${paidBadge}
        <span class="status-pill ${statusClass(o.status)}">${escapeHtml(titleCase(o.status))}</span>
      </span>
    </div>

    <div class="order-items">
      ${o.items.map(i => `
        <div>${i.qty} × ${escapeHtml(i.name)}
          <span style="color:var(--ink-faint);">(${escapeHtml(catLabel(i.cat))} · ${peso(i.rate)} each)</span>
          ${reviewable && i.product ? `<a class="review-link" href="/products.html#device-${escapeHtml(String(i.product))}">Leave a review ›</a>` : ''}
        </div>`).join('')}
    </div>

    <div class="order-meta-grid">
      <div class="order-meta">Ordered<b>${formatDate(o.createdAt)}</b></div>
      <div class="order-meta">Starts<b>${formatDate(o.startDate)}</b></div>
      <div class="order-meta">Due back<b>${formatDate(o.endDate)}</b></div>
      <div class="order-meta">${o.paid ? 'Total paid' : 'Total due'}<b>${peso(o.total)}</b></div>
    </div>

    ${progressMarkup(o.status)}

    <div class="order-foot">
      <span>Deposit held: <b class="refundable">${peso(o.deposit)}</b></span>
      <span>Delivering to: ${escapeHtml(o.address || '—')}</span>
    </div>
    ${refundNote}

    ${orderActions(o)}
  </div>`;
}

function renderOrders() {
  const list = document.getElementById('ordersList');
  if (!list) return;
  if (!state.user) { list.innerHTML = ''; return; }

  if (!state.orders.length) {
    list.innerHTML = emptyState(
      'No rentals yet',
      'Once you confirm a booking it will show up here with live status tracking.',
      '<a class="btn btn-primary" href="/products.html">Browse devices</a>'
    );
    return;
  }

  list.innerHTML = state.orders.map(orderCard).join('');
  bindOrderActions(list);
  refreshFx();
}

/* Delegated once onto the stable #ordersList element — renderOrders()
   replaces its innerHTML, not the node, so the binding survives. */
function bindOrderActions(list) {
  if (list.dataset.actionsBound) return;
  list.dataset.actionsBound = '1';

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'cancel' && !confirm('Cancel this booking?')) return;

    let note;
    if (act === 'return') {
      note = prompt('Anything we should know about the device before pickup? (optional)') || '';
    }

    const done = fx.setBtnLoading(btn, 'Working…');
    let res;
    if (act === 'pay') {
      res = await payOrder(id, 'gcash');
      if (res.ok) toast(`Payment confirmed for #${shortId(id)}`);
    } else if (act === 'cancel') {
      res = await cancelOrder(id);
      if (res.ok) toast(`Booking #${shortId(id)} cancelled`);
    } else if (act === 'return') {
      res = await requestReturn(id, note);
      if (res.ok) toast(`Return requested for #${shortId(id)}`);
    } else if (act === 'extend') {
      res = await extendRental(id);
      if (res.ok) toast(`Extended by ${res.days} day${res.days === 1 ? '' : 's'}`);
    }

    done();
    if (res && !res.ok) toast(res.error, 'error');
    await refreshOrders();
    renderOrders();
  });
}

/* ---------------- support threads ---------------- */

function ticketMarkup(t) {
  const isOpen = openTicket === t.id;
  return `
    <div class="ticket-card${isOpen ? ' open' : ''}" data-id="${escapeHtml(t.id)}">
      <div class="ticket-top">
        <button type="button" class="ticket-toggle" data-act="toggle-ticket" data-id="${escapeHtml(t.id)}">
          <b>${escapeHtml(t.ref || shortId(t.id))}</b>
          <span>${escapeHtml(t.subject)}</span>
        </button>
        <span class="status-pill ${statusClass(t.status)}">${escapeHtml(titleCase(t.status))}</span>
      </div>
      <div class="ticket-meta">
        Opened ${escapeHtml(formatDateTime(t.createdAt))}
        ${t.replies?.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''}
      </div>

      ${isOpen ? `
        <div class="ticket-thread">
          <div class="ticket-msg from-you">
            <span class="ticket-who">You</span>
            <p>${escapeHtml(t.message)}</p>
          </div>
          ${(t.replies || []).map(r => `
            <div class="ticket-msg ${r.fromStaff ? 'from-staff' : 'from-you'}">
              <span class="ticket-who">${escapeHtml(r.fromStaff ? `${r.byName || 'DiaLux'} · Support` : 'You')}
                <time>${escapeHtml(formatDateTime(r.at))}</time></span>
              <p>${escapeHtml(r.message)}</p>
            </div>`).join('')}
        </div>

        ${['resolved', 'closed'].includes(t.status)
          ? `<p class="summary-note">This ticket is ${escapeHtml(t.status)}. Replying reopens it.</p>`
          : ''}
        <form class="ticket-reply" data-id="${escapeHtml(t.id)}">
          <textarea class="mini-select" rows="2" placeholder="Add a reply…" required maxlength="4000"></textarea>
          <button class="btn btn-primary btn-sm" type="submit">Send reply</button>
        </form>` : ''}
    </div>`;
}

async function renderSupport() {
  const box = document.getElementById('supportList');
  if (!box) return;
  if (!state.user) { box.innerHTML = ''; return; }

  if (!tickets.length) {
    try {
      const data = await supportApi.mine();
      tickets = data.tickets || [];
    } catch (err) {
      box.innerHTML = `<p class="summary-note">Could not load your support requests: ${escapeHtml(err.message)}</p>`;
      return;
    }
  }

  if (!tickets.length) {
    box.innerHTML = emptyState(
      'No support requests',
      'Anything you send through the contact form appears here, along with our replies.',
      '<a class="btn btn-primary" href="/contact.html">Contact support</a>'
    );
    return;
  }

  box.innerHTML = `<div class="ticket-list">${tickets.map(ticketMarkup).join('')}</div>`;
  bindSupport(box);
}

function bindSupport(box) {
  box.querySelectorAll('[data-act="toggle-ticket"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openTicket = openTicket === btn.dataset.id ? '' : btn.dataset.id;
      renderSupport();
    });
  });

  box.querySelectorAll('.ticket-reply').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const textarea = form.querySelector('textarea');
      const message = textarea.value.trim();
      if (!message) return;

      const btn = form.querySelector('button[type="submit"]');
      const done = fx.setBtnLoading(btn, 'Sending…');
      try {
        const updated = await supportApi.reply(form.dataset.id, message);
        const i = tickets.findIndex(t => t.id === updated.id);
        if (i >= 0) tickets[i] = updated;
        toast('Reply sent');
        renderSupport();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------- boot ---------------- */

bootPage('profile', async () => {
  renderAccount();
  renderAddresses();
  renderOrders();
  await renderSupport();

  // Deep links from the header menu and from notifications.
  const target = { '#orders': 'ordersList', '#addresses': 'addressBook', '#support': 'supportList' }[location.hash];
  if (target) {
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});