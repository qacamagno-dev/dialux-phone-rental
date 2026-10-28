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
    beginFreshIdleSession();
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

/* ---------------- 5-minute web inactivity logout ---------------- */

// Web-session inactivity timeout requested for DiaLux. This is deliberately
// client-side only: the API token stays in localStorage, while this timestamp
// lets every browser tab agree on when the account was last active.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_ACTIVITY_KEY = 'dialux:lastWebActivityAt';
const IDLE_WRITE_THROTTLE_MS = 1000;

let idleTimer = null;
let idleListenersBound = false;
let lastIdleWrite = 0;

function readLastActivity() {
  const value = Number(localStorage.getItem(IDLE_ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function writeLastActivity(time = Date.now(), { force = false } = {}) {
  if (!state.user) return;

  if (!force && time - lastIdleWrite < IDLE_WRITE_THROTTLE_MS) {
    return;
  }

  lastIdleWrite = time;
  localStorage.setItem(IDLE_ACTIVITY_KEY, String(time));
}

function clearIdleTimer() {
  if (idleTimer) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleCheck() {
  clearIdleTimer();

  if (!state.user) return;

  const lastActivity = readLastActivity() || Date.now();
  const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivity);

  if (remaining <= 0) {
    logoutForInactivity();
    return;
  }

  idleTimer = window.setTimeout(checkIdleTimeout, remaining + 100);
}

function checkIdleTimeout() {
  if (!state.user) {
    clearIdleTimer();
    return;
  }

  const lastActivity = readLastActivity();

  // Existing sessions created before this feature do not yet have a
  // timestamp. Give them a fresh five-minute window instead of kicking
  // them out immediately on deployment.
  if (!lastActivity) {
    writeLastActivity(Date.now(), { force: true });
    scheduleIdleCheck();
    return;
  }

  if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
    logoutForInactivity();
    return;
  }

  scheduleIdleCheck();
}

function noteUserActivity() {
  if (!state.user) return;

  const now = Date.now();
  writeLastActivity(now);

  // Always reset the in-memory timer immediately. The localStorage write is
  // throttled to avoid hammering storage during pointer movement/scrolling.
  clearIdleTimer();
  idleTimer = window.setTimeout(checkIdleTimeout, IDLE_TIMEOUT_MS + 100);
}

function bindIdleListeners() {
  if (idleListenersBound) return;
  idleListenersBound = true;

  const passive = { passive: true };

  document.addEventListener('pointerdown', noteUserActivity, passive);
  document.addEventListener('pointermove', noteUserActivity, passive);
  document.addEventListener('touchstart', noteUserActivity, passive);
  document.addEventListener('scroll', noteUserActivity, passive);
  document.addEventListener('keydown', noteUserActivity);

  // Background tabs may have timers throttled by the browser. Re-check as
  // soon as the user returns to the tab so five minutes cannot be bypassed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) {
      checkIdleTimeout();
    }
  });

  // Activity in one DiaLux tab keeps the same signed-in browser session alive
  // in the other tabs. Logging out in one tab also logs out the others.
  window.addEventListener('storage', (event) => {
    if (event.key === IDLE_ACTIVITY_KEY && event.newValue && state.user) {
      scheduleIdleCheck();
      return;
    }

    if (event.key === 'authToken' && !event.newValue && state.user) {
      finishLogout('Signed out in another tab');
    }
  });
}

function beginFreshIdleSession() {
  if (!state.user) return;
  writeLastActivity(Date.now(), { force: true });
  scheduleIdleCheck();
}

/**
 * Start the five-minute inactivity policy after restoreSession().
 * Returns false when the restored session was already idle for five minutes
 * and logout/redirect has begun, allowing bootPage() to stop rendering.
 */
export function initIdleLogout() {
  bindIdleListeners();

  if (!state.user) {
    clearIdleTimer();
    return true;
  }

  const lastActivity = readLastActivity();

  if (lastActivity && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
    logoutForInactivity();
    return false;
  }

  if (!lastActivity) {
    writeLastActivity(Date.now(), { force: true });
  }

  scheduleIdleCheck();
  return true;
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
  localStorage.removeItem(IDLE_ACTIVITY_KEY);
  clearIdleTimer();
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
  beginFreshIdleSession();
  await mergeGuestCartIntoServer();
  updateCartBadge();
  updateWishBadge();
  return data.user;
}

export async function doRegister(name, email, password) {
  const data = await authApi.register(name.trim(), email.trim().toLowerCase(), password);
  setSession(data.user, data.token);
  beginFreshIdleSession();
  await mergeGuestCartIntoServer();
  updateCartBadge();
  updateWishBadge();
  return data.user;
}

function finishLogout(message) {
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
  toast(message);
  setTimeout(() => { location.href = '/'; }, 400);
}

function logoutForInactivity() {
  finishLogout('Signed out after 5 minutes of inactivity');
}

export function doLogout() {
  finishLogout('Signed out');
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