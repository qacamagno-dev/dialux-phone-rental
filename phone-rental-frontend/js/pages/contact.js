// ============================================================
// DiaLux — pages/contact.js
// The contact form, wired to the support desk. A submission becomes a
// SupportTicket an administrator can answer, and the reply comes back
// through the customer's notifications.
//
// Works signed out. When a session is present the ticket is linked to the
// account, which is what lets the reply reach them.
//
// Also hydrates the page copy from the CMS, the same way static.js does,
// since contact.html is one of the six editable pages.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage } from '../core/page.js';
import { state, SUPPORT_CATEGORIES } from '../core/state.js';
import { supportApi } from '../core/api.js';
import { escapeHtml, toast } from '../core/ui.js';
import { hydrateCmsContent } from '../core/cms.js';

/* ---------------- form ---------------- */

function renderForm() {
  const host = document.getElementById('contactFormCard');
  if (!host) return;

  const u = state.user;

  host.innerHTML = `
    <h3>Send us a message</h3>
    <p class="sub">We answer during Philippine business hours, usually within one working day.</p>

    <form id="contactForm" novalidate>
      <div class="field-row">
        <div class="field">
          <label for="ct-name">Your name</label>
          <input type="text" id="ct-name" value="${escapeHtml(u?.name || '')}" required maxlength="120">
        </div>
        <div class="field">
          <label for="ct-email">Email address</label>
          <input type="email" id="ct-email" value="${escapeHtml(u?.email || '')}" required autocomplete="email">
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="ct-phone">Mobile number <span class="opt">(optional)</span></label>
          <input type="tel" id="ct-phone" value="${escapeHtml(u?.profile?.phone || '')}" placeholder="09XX XXX XXXX">
        </div>
        <div class="field">
          <label for="ct-category">What is this about?</label>
          <select id="ct-category" class="mini-select">
            ${SUPPORT_CATEGORIES.map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="ct-subject">Subject</label>
        <input type="text" id="ct-subject" maxlength="160" placeholder="e.g. Return pickup for booking #A1B2C3">
      </div>

      <div class="field">
        <label for="ct-order">Booking reference <span class="opt">(optional)</span></label>
        <input type="text" id="ct-order" maxlength="40" placeholder="The 6-character code on your booking">
      </div>

      <div class="field">
        <label for="ct-message">Message</label>
        <textarea id="ct-message" rows="5" required maxlength="4000"
                  placeholder="Tell us what happened, and when it started."></textarea>
        <small class="field-hint">At least 10 characters, so we have something to work with.</small>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">Send message</button>

      <p class="summary-note" style="text-align:center;margin-top:12px;">
        ${u
          ? 'Replies appear in your notifications and under Support requests in your profile.'
          : 'Sending signed in lets you follow the thread in your profile — <a href="/index.html#auth" style="color:var(--accent);">sign in first</a>.'}
      </p>
    </form>

    <div id="contactResult"></div>`;

  bindForm();
}

function bindForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      name: document.getElementById('ct-name').value.trim(),
      email: document.getElementById('ct-email').value.trim(),
      phone: document.getElementById('ct-phone').value.trim(),
      category: document.getElementById('ct-category').value,
      subject: document.getElementById('ct-subject').value.trim(),
      orderRef: document.getElementById('ct-order').value.trim(),
      message: document.getElementById('ct-message').value.trim(),
    };

    // Mirror the server's rules so the common mistakes never cost a round trip.
    if (!payload.name || !payload.email || !payload.message) {
      toast('Name, email and message are required', 'error');
      return;
    }
    if (payload.message.length < 10) {
      toast('Please add a little more detail to your message', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Sending…');

    try {
      const res = await supportApi.create(payload);
      done();

      const out = document.getElementById('contactResult');
      if (out) {
        out.innerHTML = `
          <div class="info-highlight" style="margin-top:18px;">
            <p>✅ <b>Message received.</b> Your reference is
               <span class="mono">${escapeHtml(res.ref || '')}</span> — quote it if you follow up.</p>
            <p style="margin-top:8px;font-size:.85rem;">
              ${res.emailed
                ? 'A confirmation is on its way to your inbox.'
                : 'We logged it here — no mail server is configured on this install, so there is no confirmation email.'}
              ${state.user ? ' Track the thread under <a href="/profile.html#support" style="color:var(--accent);">Support requests</a>.' : ''}
            </p>
          </div>`;
        out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      form.reset();
      toast('Message sent to DiaLux support');
    } catch (err) {
      done();
      toast(err.message || 'Could not send your message', 'error');
    }
  });
}

/* ---------------- support email ---------------- */

/**
 * Point the address in the hand-written copy at whatever the platform
 * settings say. Skipped once the CMS has taken the page over, since the
 * administrator's own copy is then authoritative.
 */
function syncSupportEmail() {
  const el = document.getElementById('supportEmail');
  const email = state.settings?.supportEmail;
  if (el && email) el.textContent = email;
}

/* ---------------- boot ---------------- */

bootPage('static', async () => {
  // CMS copy first: when an administrator has saved an edit it replaces the
  // left-hand card entirely, so there is no point syncing the email into it.
  const overridden = await hydrateCmsContent('contact');
  if (!overridden) syncSupportEmail();
  renderForm();
});
