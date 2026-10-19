// ============================================================
// DiaLux — core/auth.js
// Session handling, the account button / dropdown wiring, and the
// password-reset entry points.
// ============================================================

import { authApi, setToken, getToken, ApiError } from './api.js';
import {
  state, mergeGuestCartIntoServer, clearGuestCart, clearGuestWishlist,
} from './state.js';
import { ROLE_NAV } from './ui.js';
import {
  escapeHtml, toast, updateCartBadge, updateWishBadge,
  refreshChrome, renderNotifications,
} from './ui.js';

/* ---------------- Google sign-in ---------------- */

// Published by index.html so the client id lives in exactly one place.
const GOOGLE_CLIENT_ID =
  document.querySelector('meta[name="google-client-id"]')?.content?.trim() || '';

let googleInitialised = false;

/** Wait for accounts.google.com/gsi/client, which loads async. */
function waitForGsi(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (window.google?.accounts?.id) { resolve(true); return; }

    const deadline = Date.now() + timeoutMs;
    const tick = setInterval(() => {
      if (window.google?.accounts?.id) { clearInterval(tick); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(tick); resolve(false); }
    }, 100);
  });
}

/** Called by GSI with the signed ID token once the user picks an account. */
async function onGoogleCredential(response) {
  const credential = response?.credential;
  if (!credential) {
    toast('Google did not return a credential', 'error');
    return;
  }

  try {
    const data = await authApi.googleLogin(credential);
    setSession(data.user, data.token);
    await mergeGuestCartIntoServer();
    updateCartBadge();
    updateWishBadge();
    toast('Signed in with Google');
    setTimeout(() => { location.href = landingPath(); }, 500);
  } catch (err) {
    console.error('[DiaLux] Google sign-in failed:', err);
    toast(err.message || 'Google sign-in failed', 'error');
  }
}

/**
 * Render the Google button into #googleBtn.
 *
 * Must be called while the container is visible: GSI renders into a
 * zero-size iframe if its parent is display:none, and never recovers when
 * the parent is later shown. The auth panel starts hidden, so home.js
 * calls this as the panel opens rather than on page load.
 */
export async function mountGoogleButton(containerId = 'googleBtn') {
  const box = document.getElementById(containerId);
  if (!box || box.dataset.rendered === 'true') return;

  if (!GOOGLE_CLIENT_ID) {
    console.warn('[DiaLux] no <meta name="google-client-id"> — skipping Google sign-in');
    return;
  }

  if (!(await waitForGsi())) {
    box.innerHTML = '<small style="color:#5E607A;">Google sign-in is unavailable right now.</small>';
    return;
  }

  // initialize() registers the callback globally; only ever call it once.
  if (!googleInitialised) {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onGoogleCredential,
      cancel_on_tap_outside: true,
    });
    googleInitialised = true;
  }

  google.accounts.id.renderButton(box, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: 320,
  });

  box.dataset.rendered = 'true';
}

/* ---------------- session ---------------- */

export function isSignedIn() { return Boolean(state.user); }
export function isAdmin()    { return state.user?.role === 'admin'; }
export function isRider()    { return state.user?.role === 'rider'; }

/** Where a signed-in user belongs: riders work from their own dashboard, everyone else browses. */
/**
 * Where a signed-in account belongs right after signing in, or whenever
 * something needs to send it "home". A staff account (admin/rider) goes
 * to its own dashboard — same ROLE_NAV mapping the header's "Dashboard" /
 * "Rider Dashboard" link uses, so the two can never disagree with each
 * other. This used to only special-case 'rider', silently sending admins
 * to the customer catalog instead of /admin.html.
 */
export function landingPath(user = state.user) {
  return ROLE_NAV[user?.role]?.href || '/products.html';
}

export function setSession(user, token) {
  state.user = user;
  if (token) setToken(token);
  renderAcctButton();
}

export function clearSession() {
  state.user = null;
  setToken(null);
  renderAcctButton();
}

/**
 * Validate the stored token against /api/auth/me.
 */
export async function restoreSession() {
  const token = getToken();
  if (!token) {
    state.user = null;
    renderAcctButton();
    return;
  }

  try {
    const user = await authApi.me();
    if (user?.email) setSession(user, token);
    else clearSession();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) clearSession();
    else { state.user = null; renderAcctButton(); }
  }
}

/* ---------------- account button ---------------- */

export function renderAcctButton() {
  const btn = document.getElementById('acctBtn');
  if (!btn) return;

  if (state.user?.name) {
    const initial = state.user.name.trim().charAt(0).toUpperCase() || '?';
    const first = state.user.name.trim().split(/\s+/)[0];
    btn.innerHTML = `<span class="acct-avatar">${escapeHtml(initial)}</span> ${escapeHtml(first)}`;
    btn.setAttribute('aria-label', `Account menu for ${state.user.name}`);
  } else {
    btn.textContent = 'Sign in';
    btn.setAttribute('aria-label', 'Sign in');
  }

  refreshChrome();
}

function closeAcctMenu() {
  document.getElementById('acctMenu')?.classList.remove('open');
  document.getElementById('acctBtn')?.setAttribute('aria-expanded', 'false');
}

/**
 * Bind the header's account button and sign-out item.
 */
export function initAcctMenu({ authHref = '/index.html#auth' } = {}) {
  const btn = document.getElementById('acctBtn');
  const menu = document.getElementById('acctMenu');

  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.user) { location.href = authHref; return; }
    const open = menu?.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.getElementById('signOutBtn')?.addEventListener('click', doLogout);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.acct-wrap')) closeAcctMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAcctMenu();
  });
}

/* ---------------- actions ---------------- */

export async function doLogin(email, password) {
  const data = await authApi.login(email.trim().toLowerCase(), password);
  setSession(data.user, data.token);
  await mergeGuestCartIntoServer();
  updateCartBadge();
  updateWishBadge();
  return data.user;
}

export async function doRegister(name, email, password) {
  const data = await authApi.register(name.trim(), email.trim().toLowerCase(), password);
  setSession(data.user, data.token);
  await mergeGuestCartIntoServer();
  updateCartBadge();
  updateWishBadge();
  return data.user;
}

export function doLogout() {
  clearSession();
  clearGuestCart();
  clearGuestWishlist();
  state.cart = {
    lines: [], count: 0, rent: 0, deposit: 0, delivery: 0,
    protection: false, protectionFee: 0, protectionQuote: 0, total: 0,
  };
  state.orders = [];
  state.wishlist = [];
  state.wishlistIds = [];
  state.notifications = [];
  state.unread = 0;
  updateCartBadge();
  updateWishBadge();
  renderNotifications();
  closeAcctMenu();
  toast('Signed out');
  setTimeout(() => { location.href = '/'; }, 400);
}

/* ---------------- password reset ---------------- */

/**
 * Ask for a reset link.
 *
 * The server answers identically whether or not the address exists, so this
 * resolves with the generic message either way. When no mail transport is
 * configured it also carries `devResetUrl` (outside production) — the caller
 * surfaces that so the flow is usable on a laptop with no SMTP.
 */
export async function requestPasswordReset(email) {
  return authApi.forgotPassword(String(email).trim().toLowerCase());
}

/**
 * Redeem a reset token and sign the customer straight in — they have just
 * proven control of the inbox, so a second login step adds nothing.
 */
export async function submitPasswordReset(token, password) {
  const data = await authApi.resetPassword(token, password);
  if (data?.token && data?.user) {
    setSession(data.user, data.token);
    await mergeGuestCartIntoServer();
    updateCartBadge();
    updateWishBadge();
  }
  return data;
}

/**
 * Change the password from inside the profile. The server hands back a fresh
 * token so the current session survives the credential change.
 */
export async function changePassword(currentPassword, newPassword) {
  const data = await authApi.changePassword(currentPassword, newPassword);
  if (data?.token) setToken(data.token);
  if (data?.user) state.user = { ...state.user, ...data.user };
  return data;
}

/**
 * Guard a page that needs a signed-in user.
 */
export function requireAuth(mount, message = 'Sign in to continue.') {
  if (state.user) return true;
  if (mount) {
    mount.innerHTML = `
      <div class="empty-state">
        <h3 style="margin-bottom:8px;">You're not signed in</h3>
        <p style="max-width:400px;margin:0 auto 20px;">${escapeHtml(message)}</p>
        <a class="btn btn-primary" href="/index.html#auth">Sign in or create an account</a>
      </div>`;
  }
  return false;
}