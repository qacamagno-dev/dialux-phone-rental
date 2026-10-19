// ============================================================
// DIALUX — 3D / IMMERSIVE ENHANCEMENT MODULE
// Vanilla ES module. Import into app.js:
//   import * as fx from './3d-enhancements.js';
//   document.addEventListener('DOMContentLoaded', () => fx.initAll());
//
// Nothing in here touches state.cart / state.user / auth. It only
// reads the DOM after your existing render functions run, and
// exposes renderProductCard3D() as an optional drop-in replacement
// for card markup.
// ============================================================

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isCoarsePointer = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;

/* ---------------------------------------------------------
   0. Capability gate — flags <html> so CSS can show/hide
      progressive-enhancement-only elements.
--------------------------------------------------------- */
export function markSupport(){
  const supports = 'requestAnimationFrame' in window && CSS.supports('transform-style', 'preserve-3d');
  document.documentElement.classList.toggle('js-3d', supports);
  return supports;
}

/* ---------------------------------------------------------
   1. TILT — attach to any container matching selector.
   Expects: .tilt-card > .tilt-card-inner
--------------------------------------------------------- */
export function initTilt(selector = '.tilt-card', opts = {}) {
  if (reduceMotion() || isCoarsePointer()) return;
  const max = opts.max ?? 10; // degrees
  const scale = opts.scale ?? 1.02;

  document.querySelectorAll(selector).forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = '1';
    const inner = card.querySelector('.tilt-card-inner') || card;

    let raf = null;
    function onMove(e){
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0..1
      const py = (e.clientY - rect.top) / rect.height;    // 0..1
      const ry = (px - 0.5) * max * 2;
      const rx = -(py - 0.5) * max * 2;
      card.classList.add('tilting');
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        inner.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
        inner.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
        inner.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        inner.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        inner.style.transform = `rotateX(var(--rx)) rotateY(var(--ry)) scale(${scale}) translateZ(0)`;
      });
    }
    function onLeave(){
      card.classList.remove('tilting');
      inner.style.setProperty('--rx', '0deg');
      inner.style.setProperty('--ry', '0deg');
      inner.style.transform = '';
    }
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', onLeave);
  });
}

/* ---------------------------------------------------------
   2. FLIP CARDS — click a .flip-trigger (or the card itself
      if opts.flipOnCardClick) to toggle .flipped on the
      closest .flip-card. Keyboard-accessible (Enter/Space).
--------------------------------------------------------- */
export function initFlipCards(selector = '.flip-card', opts = {}) {
  document.querySelectorAll(selector).forEach(card => {
    if (card.dataset.flipBound) return;
    card.dataset.flipBound = '1';

    const trigger = card.querySelector('.flip-trigger') || (opts.flipOnCardClick ? card : null);
    if (!trigger) return;

    trigger.setAttribute('tabindex', trigger.getAttribute('tabindex') || '0');
    trigger.setAttribute('role', trigger.getAttribute('role') || 'button');
    trigger.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Flip card to see specs');

    const toggle = (e) => { e.stopPropagation(); card.classList.toggle('flipped'); };
    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
    });
  });
}

/* ---------------------------------------------------------
   3. RIPPLE — attach to buttons matching selector.
--------------------------------------------------------- */
export function initRipple(selector = '.btn') {
  document.querySelectorAll(selector).forEach(btn => {
    if (btn.dataset.rippleBound) return;
    btn.dataset.rippleBound = '1';
    btn.addEventListener('click', (e) => {
      if (reduceMotion()) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      btn.appendChild(span);
      span.addEventListener('animationend', () => span.remove());
    });
  });
}

/* Toggle a button into/out of a loading spinner state.
   Usage: const done = setBtnLoading(btn, 'Booking…'); ... done(); */
export function setBtnLoading(btn, label = 'Loading…') {
  const original = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.disabled = true;
  const dark = getComputedStyle(btn).color === 'rgb(255, 255, 255)' ? '' : ' spinner-dark';
  btn.innerHTML = `<span class="spinner${dark}"></span> ${label}`;
  return () => { btn.classList.remove('btn-loading'); btn.disabled = false; btn.innerHTML = original; };
}

/* ---------------------------------------------------------
   4. PAGE TRANSITIONS for a multi-page (non-SPA) site.
   Intercepts same-origin <a> clicks, fades the body out,
   then navigates. Fades in on load. Skips modified clicks
   (ctrl/cmd/middle-click), external links, #anchors, and
   anything with [data-no-transition].
--------------------------------------------------------- */
export function initPageTransitions() {
  if (reduceMotion()) return;

  // fade in on arrival
  document.body.classList.add('page-enter');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('page-enter-active');
      document.body.classList.remove('page-enter');
    });
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('data-no-transition')) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.hash) return; // in-page anchor

    e.preventDefault();
    document.body.classList.add('page-leave');
    setTimeout(() => { location.href = a.href; }, 220);
  });
}

/* ---------------------------------------------------------
   5. HERO 3D PHONE RIG — subtle mouse-follow tilt on top of
      the ambient float animation. Falls back to the CSS
      default rotation on touch devices.
   Structure (place in index.html hero):
   <div class="hero-3d-stage" id="heroStage">
     <div class="hero-particles"><span class="blob blob-a"></span>...</div>
     <div class="phone-rig" id="phoneRig">
       <div class="layer layer-edge"></div>
       <div class="layer layer-body"></div>
       <div class="layer layer-screen">...</div>
       <div class="layer layer-glare"></div>
     </div>
   </div>
--------------------------------------------------------- */
export function initHeroRig(stageSelector = '#heroStage', rigSelector = '#phoneRig') {
  const stage = document.querySelector(stageSelector);
  const rig = document.querySelector(rigSelector);
  if (!stage || !rig || reduceMotion() || isCoarsePointer()) return;

  stage.addEventListener('mousemove', (e) => {
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    rig.style.setProperty('--ry', `${(-18 + px * 20).toFixed(1)}deg`);
    rig.style.setProperty('--rx', `${(6 - py * 14).toFixed(1)}deg`);
  });
  stage.addEventListener('mouseleave', () => {
    rig.style.setProperty('--ry', '-18deg');
    rig.style.setProperty('--rx', '6deg');
  });
}

/* ---------------------------------------------------------
   6. STAGGERED REVEAL — set --i on children for CSS delay.
--------------------------------------------------------- */
export function initStagger(selector = '.stagger') {
  document.querySelectorAll(selector).forEach(group => {
    [...group.children].forEach((child, i) => child.style.setProperty('--i', i));
  });
}

/* ---------------------------------------------------------
   7. PRODUCT CARD RENDERER (optional drop-in)
   Renders a tilt + flip 3D card for one product. Independent
   of your internal helpers — pass formatters if you want your
   exact currency/grade formatting, otherwise sane defaults
   are used. Does NOT bind add-to-cart logic itself; pass
   `onAddToCart` and the button's onclick is wired for you via
   a data-id attribute + event delegation (see initCardActions).
--------------------------------------------------------- */
export function renderProductCard3D(p, fmt = {}) {
  const peso = fmt.peso || (n => `₱${Math.round(n).toLocaleString('en-PH')}`);
  const gradeClass = fmt.gradeClass || (g => g === 'Like New' ? 'tag-a' : g === 'Good' ? 'tag-b' : 'tag-c');
  const catLabel = fmt.catLabel || (c => ({phone:'Smartphone',tablet:'Tablet',laptop:'Laptop',wifi:'Portable Wi-Fi'}[c] || c));
  const specs = p.specs || {};
  const specRows = Object.entries(specs).map(([k, v]) => `
    <div class="card-specs-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>
  `).join('');

  // Rating pill, only once at least one verified renter has scored it.
  const rating = Number(p.reviewCount) > 0
    ? `<span class="card-rating" title="${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}">★ ${Number(p.avgRating).toFixed(1)}</span>`
    : '';

  // The gallery count hints that the detail view has more photos.
  const shots = Array.isArray(p.images) ? p.images.length : 0;
  const galleryHint = shots > 1
    ? `<span class="card-shots" title="${shots} photos">⧉ ${shots}</span>`
    : '';

  // The card frame is landscape, so it prefers the wide `cardImage` and only
  // falls back to the square `image` for devices that have no wide shot.
  return `
  <div class="tilt-card flip-card device-card-3d" data-id="${p.id}">
    <div class="tilt-card-inner flip-card-inner device-card">
      <span class="tilt-glare"></span>
      <button class="flip-hint" aria-label="View specs" title="View specs">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="wish-btn" data-action="wish" data-id="${p.id}" type="button"
              aria-pressed="false" aria-label="Save to wishlist" title="Save to wishlist">
        <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.3-7-9.3A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7 2.9c0 5-7 9.3-7 9.3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="flip-face flip-front">
        <div class="device-thumb image-thumb pop-layer">
          <img src="${escapeHtml(p.cardImage || p.image || '')}" alt="${escapeHtml(p.name)}" data-cat="${escapeHtml(p.cat || 'phone')}" loading="lazy">
          ${galleryHint}
        </div>
        <div class="card-tag-row">
          <span class="grade-tag ${gradeClass(p.grade)}">${escapeHtml(p.grade)}</span>
          ${rating}
        </div>
        <h4>${escapeHtml(p.name)}</h4>
        <div class="device-cat">${catLabel(p.cat)} · ${escapeHtml(p.brand)}</div>
        <div class="device-desc">${escapeHtml(p.desc || '')}</div>
        <div class="device-foot pop-layer">
          <div class="device-price">${peso(p.weekly)} <span>/week</span></div>
        </div>
        <div class="card-actions">
          <button class="view-details-btn" data-action="view" data-id="${p.id}">Details</button>
          <button class="add-cart-btn" data-action="add" data-id="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
            ${p.stock === 0 ? 'Out of stock' : 'Add to cart'}
          </button>
          <button class="order-now-btn" data-action="order" data-id="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
            Order now
          </button>
        </div>
      </div>
      <div class="flip-face flip-back">
        <h4>${escapeHtml(p.name)} — specs</h4>
        <div class="spec-list">${specRows || '<p>No spec sheet yet.</p>'}</div>
        <button class="add-cart-btn" data-action="add" data-id="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
          ${p.stock === 0 ? 'Out of stock' : 'Add to cart'}
        </button>
      </div>
    </div>
  </div>`;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

/* Event delegation for cards rendered by renderProductCard3D.
   Call once per container; safe to call multiple times. */
export function initCardActions(containerSelector, { onView, onAdd, onOrder, onWish }) {
  const box = document.querySelector(containerSelector);
  if (!box || box.dataset.actionsBound) return;
  box.dataset.actionsBound = '1';
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    // Kept as a string — product ids are MongoDB ObjectIds, not numbers.
    const id = btn.dataset.id;
    if (btn.dataset.action === 'view' && onView) onView(id, btn);
    if (btn.dataset.action === 'add' && onAdd) onAdd(id, btn);
    if (btn.dataset.action === 'order' && onOrder) onOrder(id, btn);
    if (btn.dataset.action === 'wish' && onWish) {
      // The heart sits on top of a flip card; don't flip it as well.
      e.preventDefault();
      e.stopPropagation();
      onWish(id, btn);
    }
  });
}

/* ---------------------------------------------------------
   8. Bootstrap everything that's safe to call on every page.
   Call this once after your existing DOM is rendered (e.g. at
   the end of your init(), and again after switchView() renders
   new cards — tilt/flip/ripple binding is idempotent via the
   data-*-bound guards above).
--------------------------------------------------------- */
export function initAll() {
  markSupport();
  initTilt('.tilt-card');
  initFlipCards('.flip-card');
  initRipple('.btn, .add-cart-btn, .view-details-btn, .order-now-btn');
  initPageTransitions();
  initStagger('.stagger');
  initHeroRig();
}
