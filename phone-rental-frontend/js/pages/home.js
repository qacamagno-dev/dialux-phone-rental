// ============================================================
// DiaLux — pages/home.js
// Landing page: featured devices + the sign-in / sign-up / password-reset
// panel. Also the chrome bootstrap for the static content pages, which
// have no page module of their own beyond static.js.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx, wishToggle } from '../core/page.js';
import { state, addToCart } from '../core/state.js';
import { peso, gradeClass, catLabel, toast, updateCartBadge, emptyState, escapeHtml, ROLE_NAV } from '../core/ui.js';
import { doLogin, doRegister, landingPath, mountGoogleButton, requestPasswordReset } from '../core/auth.js';

const CARD_FMT = { peso, gradeClass, catLabel };

/* Shared "view details" / "add to cart" / "wishlist" handlers. Both the hero
   slider and the featured grid render product tiles with the same
   data-action / data-id contract, so they wire to the same behaviour via
   fx.initCardActions. */
const cardActions = {
  onView: (id) => { location.href = `/products.html#device-${id}`; },
  onAdd: async (id, btn) => {
    const done = fx.setBtnLoading(btn, 'Adding…');
    const res = await addToCart(id, 'Weekly', 1);
    done();
    if (!res.ok) { toast(res.error, 'error'); return; }
    updateCartBadge();
    toast(`${res.product.name} added to cart`);
  },
  onOrder: (id) => { location.href = `/checkout.html?product=${id}&plan=Weekly`; },
  onWish: (id, btn) => wishToggle(id, btn),
};

/* ---------------- hero slider ---------------- */

/* "Best" rentals = highest average rating first, then most-reviewed. Ties
   keep catalog order (Array.sort is stable in V8), so a not-yet-reviewed
   catalog still yields a sensible top set — the same devices the featured
   grid leads with. avgRating / reviewCount come from the reviews feature;
   absent values fall back to 0. */
function bestRentals(limit = 5) {
  return [...state.products]
    .sort((a, b) =>
      (b.avgRating || 0) - (a.avgRating || 0) ||
      (b.reviewCount || 0) - (a.reviewCount || 0))
    .slice(0, limit);
}

function heroSlideMarkup(p, i, total) {
  const rating = Number(p.reviewCount) > 0
    ? `<span class="hero-rating" title="${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}">★ ${Number(p.avgRating).toFixed(1)}</span>`
    : '';
  const out = p.stock === 0;
  return `
    <article class="hero-slide${i === 0 ? ' active' : ''}" data-index="${i}"
             role="group" aria-roledescription="slide" aria-label="${i + 1} of ${total}" aria-hidden="${i === 0 ? 'false' : 'true'}">
      <div class="hero-slide-media">
        <img src="${escapeHtml(p.cardImage || p.image || '')}" alt="${escapeHtml(p.name)}" data-cat="${escapeHtml(p.cat || 'phone')}" loading="lazy">
      </div>
      <div class="hero-slide-info glass">
        <div class="hero-slide-tags">
          <span class="grade-tag ${gradeClass(p.grade)}">${escapeHtml(p.grade)}</span>
          ${rating}
        </div>
        <h3>${escapeHtml(p.name)}</h3>
        <div class="hero-slide-cat">${escapeHtml(catLabel(p.cat))} · ${escapeHtml(p.brand || '')}</div>
        <div class="hero-slide-price">${peso(p.weekly)} <span>/week</span></div>
        <div class="hero-slide-actions">
          <button class="btn btn-primary btn-sm" data-action="view" data-id="${p.id}">View details</button>
          <button class="btn btn-outline btn-sm" data-action="add" data-id="${p.id}"${out ? ' disabled' : ''}>${out ? 'Out of stock' : 'Add to cart'}</button>
          <button class="wish-btn inline" data-action="wish" data-id="${p.id}" type="button" aria-pressed="false" aria-label="Save to wishlist">
            <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.3-7-9.3A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7 2.9c0 5-7 9.3-7 9.3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </article>`;
}

function renderHeroSlider() {
  const slider = document.getElementById('heroSlider');
  if (!slider) return;

  const stage = document.getElementById('heroStage');
  const picks = bestRentals(5);

  // Empty catalog (unseeded or offline): drop the visual column and collapse
  // the grid so the hero copy spans the row instead of sitting beside a blank
  // half. The featured grid and offline banner below explain the empty state.
  if (!picks.length) {
    if (stage) stage.style.display = 'none';
    stage?.closest('.hero-grid')?.style.setProperty('grid-template-columns', '1fr');
    return;
  }
  if (stage) stage.style.display = '';

  const many = picks.length > 1;
  const slides = picks.map((p, i) => heroSlideMarkup(p, i, picks.length)).join('');
  const dots = picks.map((_, i) =>
    `<button class="hero-dot${i === 0 ? ' active' : ''}" type="button" data-go="${i}"
             role="tab" aria-label="Show device ${i + 1}" aria-selected="${i === 0 ? 'true' : 'false'}"></button>`
  ).join('');

  slider.innerHTML = `
    <div class="hero-track">${slides}</div>
    ${many ? `
      <div class="hero-controls">
        <button class="hero-arrow hero-prev" type="button" aria-label="Previous device">‹</button>
        <div class="hero-dots" role="tablist" aria-label="Choose a featured device">${dots}</div>
        <button class="hero-arrow hero-next" type="button" aria-label="Next device">›</button>
      </div>` : ''}`;

  // Tiles use the same data-action / data-id contract as the product cards.
  fx.initCardActions('#heroSlider', cardActions);
  if (many) initHeroCarousel(slider, picks.length);

  refreshFx();   // image fallbacks + button ripples on the freshly built nodes
}

/* Crossfade carousel. Auto-advances unless the visitor prefers reduced
   motion; pauses on hover and while the tab is backgrounded. */
function initHeroCarousel(slider, total) {
  const slides = [...slider.querySelectorAll('.hero-slide')];
  const dots = [...slider.querySelectorAll('.hero-dot')];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let idx = 0;
  let timer = null;

  function show(n) {
    idx = (n + total) % total;
    slides.forEach((s, i) => {
      const on = i === idx;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    dots.forEach((d, i) => {
      const on = i === idx;
      d.classList.toggle('active', on);
      d.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function start() { if (reduce) return; stop(); timer = window.setInterval(() => show(idx + 1), 5200); }

  slider.querySelector('.hero-next')?.addEventListener('click', () => { show(idx + 1); start(); });
  slider.querySelector('.hero-prev')?.addEventListener('click', () => { show(idx - 1); start(); });
  dots.forEach(d => d.addEventListener('click', () => { show(Number(d.dataset.go)); start(); }));

  slider.addEventListener('mouseenter', stop);
  slider.addEventListener('mouseleave', start);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  start();
}

/* ---------------- featured grid ---------------- */

function renderFeatured() {
  const grid = document.getElementById('featuredGrid');
  if (!grid) return;

  const featured = state.products.slice(0, 4);
  if (!featured.length) {
    grid.classList.remove('stagger');
    grid.innerHTML = state.offline
      ? ''    // the offline banner already explains it
      : emptyState('No devices in the catalog yet',
          'Seed the database with "npm run seed" in phone-rental-backend.');
    return;
  }

  grid.classList.add('stagger');
  grid.innerHTML = featured.map(p => fx.renderProductCard3D(p, CARD_FMT)).join('');

  fx.initCardActions('#featuredGrid', cardActions);

  refreshFx();
}

/* ---------------- auth panel ---------------- */

const MARKETING_SELECTOR = '[data-home-section]';

const AUTH_COPY = {
  login:    { title: 'Welcome back',        sub: 'Sign in to book devices and track your rentals.' },
  register: { title: 'Create your account', sub: 'Sign up to start renting devices.' },
  forgot:   { title: 'Reset your password', sub: "Enter your email and we'll send you a reset link." },
};

function showAuth(mode) {
  const panel = document.getElementById('authPanel');
  if (!panel) return;

  document.querySelectorAll(MARKETING_SELECTOR).forEach(s => s.classList.add('hidden'));
  panel.classList.remove('hidden');

  // Now that the panel is on screen, GSI can measure its container.
  if (mode !== 'forgot') mountGoogleButton();

  document.getElementById('loginForm')?.classList.toggle('hidden', mode !== 'login');
  document.getElementById('registerForm')?.classList.toggle('hidden', mode !== 'register');
  document.getElementById('forgotForm')?.classList.toggle('hidden', mode !== 'forgot');

  // Google sign-in is irrelevant on the reset screen.
  document.getElementById('googleBlock')?.classList.toggle('hidden', mode === 'forgot');

  const copy = AUTH_COPY[mode] || AUTH_COPY.login;
  const title = document.getElementById('authTitle');
  const sub = document.getElementById('authSub');
  if (title) title.textContent = copy.title;
  if (sub) sub.textContent = copy.sub;

  const toggle = document.getElementById('authToggle');
  const prompt = document.getElementById('authPrompt');
  if (toggle && prompt) {
    if (mode === 'register') {
      prompt.textContent = 'Already have an account? ';
      toggle.textContent = 'Sign in';
      toggle.dataset.target = 'login';
    } else if (mode === 'forgot') {
      prompt.textContent = 'Remembered it? ';
      toggle.textContent = 'Back to sign in';
      toggle.dataset.target = 'login';
    } else {
      prompt.textContent = "Don't have an account? ";
      toggle.textContent = 'Sign up';
      toggle.dataset.target = 'register';
    }
  }

  // Clear any previous reset result when re-entering the screen.
  const out = document.getElementById('forgotResult');
  if (out && mode !== 'forgot') out.innerHTML = '';

  window.scrollTo({ top: 0, behavior: 'auto' });
  const focusId = mode === 'register' ? 'rg-name' : mode === 'forgot' ? 'fp-email' : 'li-email';
  document.getElementById(focusId)?.focus();
}

function hideAuth() {
  document.querySelectorAll(MARKETING_SELECTOR).forEach(s => s.classList.remove('hidden'));
  document.getElementById('authPanel')?.classList.add('hidden');
}

const HASH_MODE = { '#auth': 'login', '#signup': 'register', '#forgot': 'forgot' };

function syncFromHash() {
  const mode = HASH_MODE[location.hash];
  if (mode) showAuth(mode);
  else hideAuth();
}

function initAuthPanel() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const forgotForm = document.getElementById('forgotForm');
  const toggle = document.getElementById('authToggle');

  toggle?.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = toggle.dataset.target === 'register' ? '#signup' : '#auth';
  });

  document.getElementById('forgotLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '#forgot';
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('li-email').value.trim();
    const password = document.getElementById('li-password').value;
    if (!email || !password) { toast('Please fill in all fields', 'error'); return; }

    const btn = loginForm.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Signing in…');
    try {
      await doLogin(email, password);
      toast('Signed in successfully');
      setTimeout(() => { location.href = landingPath(); }, 500);
    } catch (err) {
      done();
      toast(err.message || 'Login failed', 'error');
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('rg-name').value.trim();
    const email = document.getElementById('rg-email').value.trim();
    const password = document.getElementById('rg-password').value;
    if (!name || !email || !password) { toast('All fields are required', 'error'); return; }
    if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

    const btn = registerForm.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Creating…');
    try {
      await doRegister(name, email, password);
      toast('Account created — signed in');
      setTimeout(() => { location.href = landingPath(); }, 500);
    } catch (err) {
      done();
      toast(err.message || 'Registration failed', 'error');
    }
  });

  /**
   * Forgot password. The server always answers the same way, so the UI shows
   * the same confirmation whether or not the address is registered.
   *
   * With no SMTP transport configured the response carries devResetUrl (dev
   * builds only) — surface it as a link rather than leaving the developer to
   * dig the URL out of the server log.
   */
  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('fp-email').value.trim();
    if (!email) { toast('Enter the email on your account', 'error'); return; }

    const btn = forgotForm.querySelector('button[type="submit"]');
    const out = document.getElementById('forgotResult');
    const done = fx.setBtnLoading(btn, 'Sending…');

    try {
      const res = await requestPasswordReset(email);
      done();
      toast('Reset link requested');

      if (out) {
        out.innerHTML = `
          <div class="info-highlight" style="margin-top:16px;">
            <p>${escapeHtml(res.message || 'If that email is registered, a reset link is on its way.')}</p>
            ${res.devResetUrl ? `
              <p style="margin-top:10px;font-size:.82rem;">
                No mail server is configured on this install, so here is the link directly:<br>
                <a href="${escapeHtml(res.devResetUrl)}" class="mono" style="color:var(--accent);word-break:break-all;">
                  ${escapeHtml(res.devResetUrl)}
                </a>
              </p>` : ''}
          </div>`;
      }
    } catch (err) {
      done();
      toast(err.message || 'Could not start the reset', 'error');
    }
  });

  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
}

/**
 * Bug 1.3: the bottom "Your next device is a booking away / Get started"
 * banner makes no sense to someone already signed in — there's no account
 * left to create. The markup itself lives in index.html (it's static,
 * not JS-rendered), so this rewrites it in place by selector rather than
 * needing new ids or any HTML change.
 */
function syncFinalCta() {
  const box = document.querySelector('.cta-box');
  if (!box) return;

  const heading = box.querySelector('h2');
  const copy = box.querySelector('p');
  const button = box.querySelector('a.btn-primary');
  if (!heading || !copy || !button) return;

  if (state.user) {
    heading.textContent = 'Ready for your next device?';
    copy.textContent = 'Browse the catalog and pick a grade you trust — delivery, pickup, or a meet-up, your call.';
    const rider = state.user.role === 'rider';
    if (rider) {
      heading.textContent = 'Your deliveries are waiting.';
      copy.textContent = 'Open your rider dashboard to see today\'s pickups, deliveries and returns.';
    }
    button.textContent = rider ? 'Rider dashboard →' : 'Browse devices →';
    button.href = rider ? '/rider.html' : '/products.html';
  } else {
    heading.textContent = 'Your next device is a booking away.';
    copy.textContent = 'Create an account, pick a grade you trust, and have it delivered as soon as today.';
    button.textContent = 'Get started';
    button.href = '#auth';
  }
}

/* ---------------- boot ---------------- */

bootPage('home', () => {
  // Already signed in and landing on the auth panel? Go to the catalog —
  // or, for a staff account, their own dashboard instead (landingPath()
  // from core/auth.js, which is role-aware).
  if (state.user && HASH_MODE[location.hash] && location.hash !== '#forgot') {
    location.replace(landingPath());
    return;
  }
  // A staff account landing on the plain homepage (no auth hash) belongs
  // on its own dashboard too, not the customer landing page.
  if (state.user && ROLE_NAV[state.user.role]?.href) {
    location.replace(landingPath());
    return;
  }
  renderHeroSlider();
  renderFeatured();
  initAuthPanel();
  syncFinalCta();
});