// ============================================================
// DiaLux — pages/reset-password.js
// The other half of the forgot-password flow: redeem the emailed token
// and choose a new password.
//
// Entered as /reset-password.html?token=<raw token>. The server stores only
// a SHA-256 hash of that token with a one-hour expiry, so this link is
// single-use and cannot be replayed from a database dump.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage } from '../core/page.js';
import { state } from '../core/state.js';
import { toast, escapeHtml } from '../core/ui.js';
import { submitPasswordReset } from '../core/auth.js';

const token = new URLSearchParams(location.search).get('token') || '';

const MIN_PASSWORD = 6;

/** Cheap strength read-out — length and variety, nothing cryptographic. */
function strengthOf(pw) {
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;

  if (score <= 2) return { label: 'Weak', cls: 'weak', pct: 33 };
  if (score === 3) return { label: 'Fair', cls: 'fair', pct: 66 };
  return { label: 'Strong', cls: 'strong', pct: 100 };
}

function renderMissingToken(wrap) {
  wrap.innerHTML = `
    <div class="form-card">
      <h2>This link is incomplete</h2>
      <p class="sub">
        The reset link needs the token that was emailed to you. Request a fresh
        one and open the newest link — each link can only be used once.
      </p>
      <a class="btn btn-primary" href="/index.html#forgot"
         style="width:100%;justify-content:center;">Request a new link</a>
      <p class="form-switch"><a href="/index.html#auth" style="color:var(--accent);">Back to sign in</a></p>
    </div>`;
}

function renderForm(wrap) {
  wrap.innerHTML = `
    <div class="form-card">
      <h2>Choose a new password</h2>
      <p class="sub">Pick something you do not use anywhere else. Minimum ${MIN_PASSWORD} characters.</p>

      <form id="resetForm" novalidate>
        <div class="field">
          <label for="rs-password">New password</label>
          <input type="password" id="rs-password" autocomplete="new-password"
                 minlength="${MIN_PASSWORD}" required>
          <div class="pw-strength" id="pwStrength" hidden>
            <div class="pw-strength-track"><div class="pw-strength-fill" id="pwFill"></div></div>
            <span id="pwLabel"></span>
          </div>
        </div>

        <div class="field">
          <label for="rs-confirm">Confirm new password</label>
          <input type="password" id="rs-confirm" autocomplete="new-password"
                 minlength="${MIN_PASSWORD}" required>
        </div>

        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;">
          Set password &amp; sign in
        </button>
      </form>

      <p class="form-switch">
        Remembered it after all?
        <a href="/index.html#auth" style="color:var(--accent);">Back to sign in</a>
      </p>
    </div>`;

  bindForm(wrap);
}

function bindForm(wrap) {
  const form = wrap.querySelector('#resetForm');
  const pw = wrap.querySelector('#rs-password');

  pw?.addEventListener('input', () => {
    const box = wrap.querySelector('#pwStrength');
    const fill = wrap.querySelector('#pwFill');
    const label = wrap.querySelector('#pwLabel');
    if (!box || !fill || !label) return;

    if (!pw.value) { box.hidden = true; return; }
    const s = strengthOf(pw.value);
    box.hidden = false;
    fill.className = `pw-strength-fill ${s.cls}`;
    fill.style.width = `${s.pct}%`;
    label.textContent = s.label;
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = pw.value;
    const confirm = wrap.querySelector('#rs-confirm').value;

    if (password.length < MIN_PASSWORD) {
      toast(`Password must be at least ${MIN_PASSWORD} characters`, 'error');
      return;
    }
    if (password !== confirm) {
      toast('The two passwords do not match', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Saving…');

    try {
      await submitPasswordReset(token, password);
      toast('Password updated — you are signed in');
      // Straight to the catalog: they have a live session now.
      setTimeout(() => { location.href = '/products.html'; }, 700);
    } catch (err) {
      done();
      toast(err.message || 'Could not reset your password', 'error');

      // An expired or already-used token is the common failure. Say so once,
      // with the way out, rather than leaving them retrying the same link.
      if (err.status === 400) {
        wrap.querySelector('.form-card')?.insertAdjacentHTML('beforeend', `
          <div class="return-reminder" style="margin-top:16px;">
            ${escapeHtml(err.message)}
            <a href="/index.html#forgot" style="color:var(--accent);display:block;margin-top:6px;">
              Request a new reset link ›
            </a>
          </div>`);
      }
    }
  });
}

bootPage('static', () => {
  const wrap = document.getElementById('resetWrap');
  if (!wrap) return;

  // Already signed in and clearly not resetting anything — nothing to do here.
  if (state.user && !token) {
    location.replace('/profile.html');
    return;
  }

  if (!token) renderMissingToken(wrap);
  else renderForm(wrap);
});
