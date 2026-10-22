// ============================================================
// DiaLux — pages/products.js
// Catalog with filters, plus a device detail view routed by the
// #device-<id> hash.
//
// Filtering happens client-side over the already-loaded catalog: the
// API supports the same filters as query params, but for a catalog this
// size a local pass is instant and avoids a request per keystroke.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx, wishToggle, syncWishButtons } from '../core/page.js';
import {
  state, addToCart, productById, brands, rateFor, hasReviewableOrder,
  isWishlisted, PLANS, CATEGORIES, GRADES,
} from '../core/state.js';
import { reviewsApi } from '../core/api.js';
import {
  peso, gradeClass, catLabel, escapeHtml, toast, updateCartBadge,
  emptyState, stockLine, formatDate,
} from '../core/ui.js';

const CARD_FMT = { peso, gradeClass, catLabel };

const filters = {
  cat: 'all', search: '', brand: 'all', grade: 'all', maxPrice: 'all', sort: 'featured',
};

let detailPlan = 'Weekly';

/* ---------------- filtering ---------------- */

function visibleProducts() {
  const q = filters.search.trim().toLowerCase();

  let list = state.products.filter(p => {
    if (filters.cat !== 'all' && p.cat !== filters.cat) return false;
    if (filters.brand !== 'all' && p.brand !== filters.brand) return false;
    if (filters.grade !== 'all' && p.grade !== filters.grade) return false;
    if (filters.maxPrice !== 'all' && p.weekly > Number(filters.maxPrice)) return false;
    if (filters.wishOnly && !isWishlisted(p.id)) return false;
    if (q && !`${p.name} ${p.brand} ${p.desc}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const sorters = {
    'price-asc':  (a, b) => a.weekly - b.weekly,
    'price-desc': (a, b) => b.weekly - a.weekly,
    'name':       (a, b) => a.name.localeCompare(b.name),
    'stock':      (a, b) => b.stock - a.stock,
    'rating':     (a, b) => (b.avgRating || 0) - (a.avgRating || 0) || (b.reviewCount || 0) - (a.reviewCount || 0),
  };
  if (sorters[filters.sort]) list = [...list].sort(sorters[filters.sort]);

  return list;
}

/* ---------------- controls ---------------- */

function renderControls() {
  const tabs = document.getElementById('catTabs');
  if (tabs && !tabs.dataset.built) {
    tabs.dataset.built = '1';
    tabs.innerHTML = `
      <div class="cat-group">
        ${CATEGORIES.map(c => `
          <button class="cat-tab${c.key === filters.cat ? ' active' : ''}" data-cat="${c.key}">${escapeHtml(c.label)}</button>
        `).join('')}
      </div>
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="search" id="searchInput" placeholder="Search devices…" aria-label="Search devices">
      </div>`;

    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-tab');
      if (!btn) return;
      filters.cat = btn.dataset.cat;
      tabs.querySelectorAll('.cat-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderGrid();
    });

    let debounce;
    tabs.querySelector('#searchInput').addEventListener('input', (e) => {
      clearTimeout(debounce);
      const v = e.target.value;
      debounce = setTimeout(() => { filters.search = v; renderGrid(); }, 180);
    });
  }

  const panel = document.getElementById('filterPanel');
  if (panel && !panel.dataset.built) {
    panel.dataset.built = '1';
    panel.innerHTML = `
      <div>
        <label for="fBrand">Brand</label>
        <select id="fBrand">
          <option value="all">All brands</option>
          ${brands().map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="fGrade">Condition</label>
        <select id="fGrade">
          <option value="all">Any grade</option>
          ${GRADES.map(g => `<option value="${g}">${g}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="fPrice">Max weekly rate</label>
        <select id="fPrice">
          <option value="all">No limit</option>
          <option value="1000">Under ₱1,000</option>
          <option value="2500">Under ₱2,500</option>
          <option value="4000">Under ₱4,000</option>
        </select>
      </div>
      <div>
        <label for="fSort">Sort by</label>
        <select id="fSort">
          <option value="featured">Featured</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="name">Name A–Z</option>
          <option value="stock">Most available</option>
          <option value="rating">Top rated</option>
        </select>
      </div>
      <button class="clear-filter" id="clearFilters" type="button">Clear</button>`;

    const bind = (id, key) => {
      panel.querySelector(id).addEventListener('change', (e) => {
        filters[key] = e.target.value;
        renderGrid();
      });
    };
    bind('#fBrand', 'brand');
    bind('#fGrade', 'grade');
    bind('#fPrice', 'maxPrice');
    bind('#fSort', 'sort');

    panel.querySelector('#clearFilters').addEventListener('click', () => {
      Object.assign(filters, { cat: 'all', search: '', brand: 'all', grade: 'all', maxPrice: 'all', sort: 'featured', wishOnly: false });
      ['#fBrand', '#fGrade', '#fPrice'].forEach(s => { panel.querySelector(s).value = 'all'; });
      panel.querySelector('#fSort').value = 'featured';
      const search = document.getElementById('searchInput');
      if (search) search.value = '';
      document.querySelectorAll('.cat-tab').forEach(b => b.classList.toggle('active', b.dataset.cat === 'all'));
      renderGrid();
    });
  }
}

/* ---------------- grid ---------------- */

const gridCardActions = {
  onView: (id) => { location.hash = `#device-${id}`; },
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

function renderGrid() {
  const grid = document.getElementById('deviceGrid');
  const meta = document.getElementById('catalogMeta');
  if (!grid) return;

  const list = visibleProducts();

  if (meta) {
    meta.innerHTML = state.products.length
      ? `<span>${list.length} of ${state.products.length} device${state.products.length === 1 ? '' : 's'}</span>
         <span>Rates shown per week · deposit refundable on return</span>`
      : '';
  }

  if (!state.products.length) {
    grid.classList.remove('stagger');
    grid.innerHTML = state.offline
      ? ''
      : emptyState('The catalog is empty',
          'Seed the database by running "npm run seed" in phone-rental-backend.');
    return;
  }

  if (!list.length) {
    grid.classList.remove('stagger');
    grid.innerHTML = emptyState(
      'No devices match those filters',
      'Try widening the price range or clearing the search.',
      '<button class="btn btn-ghost" id="emptyClear" type="button">Clear filters</button>'
    );
    grid.querySelector('#emptyClear')?.addEventListener('click', () => {
      document.getElementById('clearFilters')?.click();
    });
    return;
  }

  grid.className = 'device-grid stagger';
  grid.innerHTML = list.map(p => fx.renderProductCard3D(p, CARD_FMT)).join('');

  fx.initCardActions('#deviceGrid', gridCardActions);

  refreshFx();
}

/* ---------------- detail ---------------- */

/**
 * Gallery markup: a main frame plus a thumbnail strip.
 *
 * `images` is guaranteed non-empty by the Product model's toJSON whenever the
 * device has any photo at all, so a single-image product still renders here —
 * it just gets no strip.
 */
function galleryMarkup(p) {
  const shots = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);

  if (!shots.length) {
    // No photo at all — the <img> error handler swaps in the category icon.
    return `
      <div class="product-gallery">
        <div class="gallery-main">
          <img id="galleryMain" src="" alt="${escapeHtml(p.name)}" data-cat="${escapeHtml(p.cat)}">
        </div>
      </div>`;
  }

  const thumbs = shots.length > 1
    ? `<div class="gallery-strip" id="galleryStrip" role="tablist" aria-label="${escapeHtml(p.name)} photos">
         ${shots.map((src, i) => `
           <button type="button" class="gallery-thumb${i === 0 ? ' active' : ''}" data-shot="${i}"
                   role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="Photo ${i + 1}">
             <img src="${escapeHtml(src)}" alt="" data-cat="${escapeHtml(p.cat)}" loading="lazy">
           </button>`).join('')}
       </div>`
    : '';

  return `
    <div class="product-gallery">
      <div class="gallery-main">
        <img id="galleryMain" src="${escapeHtml(shots[0])}" alt="${escapeHtml(p.name)}" data-cat="${escapeHtml(p.cat)}">
        ${shots.length > 1 ? `<span class="gallery-count" id="galleryCount">1 / ${shots.length}</span>` : ''}
      </div>
      ${thumbs}
    </div>`;
}

function bindGallery(wrap, p) {
  const strip = wrap.querySelector('#galleryStrip');
  if (!strip) return;

  const main = wrap.querySelector('#galleryMain');
  const count = wrap.querySelector('#galleryCount');
  const shots = (p.images && p.images.length) ? p.images : [p.image];

  strip.addEventListener('click', (e) => {
    const btn = e.target.closest('.gallery-thumb');
    if (!btn || !main) return;
    const i = Number(btn.dataset.shot);
    if (!shots[i]) return;

    main.src = shots[i];
    if (count) count.textContent = `${i + 1} / ${shots.length}`;
    strip.querySelectorAll('.gallery-thumb').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  });
}

function renderDetail(id) {
  const wrap = document.getElementById('detailView');
  if (!wrap) return;
  const p = productById(id);

  if (!p) {
    wrap.innerHTML = `<div class="container">${emptyState(
      'Device not found',
      'That device may have been removed from the catalog.',
      '<a class="btn btn-primary" href="/products.html">Back to catalog</a>'
    )}</div>`;
    return;
  }

  const specRows = Object.entries(p.specs || {}).map(([k, v]) => `
    <div class="spec-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(String(v))}</span></div>
  `).join('') || '<p>No spec sheet yet.</p>';

  const includedRows = (p.included || []).map(i => `<span>${escapeHtml(i)}</span>`).join('')
    || '<span>Device only</span>';

  const ratingChip = Number(p.reviewCount) > 0
    ? `<a class="detail-chip rating" href="#reviewsBox" title="${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}">★ ${Number(p.avgRating).toFixed(1)} · ${p.reviewCount} review${p.reviewCount === 1 ? '' : 's'}</a>`
    : '<span class="detail-chip">No reviews yet</span>';

  wrap.innerHTML = `
  <div class="container">
    <div class="product-detail-wrap">
      <button class="back-link" id="backToCatalog" type="button">
        <svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px;"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Back to catalog
      </button>

      <div class="product-detail-grid">
        ${galleryMarkup(p)}

        <div class="product-detail-panel">
          <div class="product-brand">${escapeHtml(p.brand)} · ${escapeHtml(catLabel(p.cat))}</div>
          <h1>${escapeHtml(p.name)}</h1>
          <p class="detail-desc">${escapeHtml(p.desc || '')}</p>

          <div class="detail-tags">
            <span class="grade-tag ${gradeClass(p.grade)}">${escapeHtml(p.grade)}</span>
            ${ratingChip}
            <span class="detail-chip">Data wiped &amp; verified</span>
            <span class="detail-chip">Insured</span>
          </div>

          ${stockLine(p.stock)}

          <div class="rate-selector" id="rateSelector">
            ${PLANS.map(plan => `
              <button class="rate-option${plan === detailPlan ? ' active' : ''}" data-plan="${plan}" type="button">
                <span>${plan}</span>
                <b>${peso(rateFor(p, plan))}</b>
              </button>`).join('')}
          </div>

          <div class="detail-summary">
            <div>Refundable deposit<b id="depositLabel">${peso(
    detailPlan === 'Daily'
      ? 500
      : detailPlan === 'Weekly'
        ? 2500
        : 5000
  )}</b></div>
            <div>Condition grade<b>${escapeHtml(p.grade)}</b></div>
            <div>Units available<b>${p.stock}</b></div>
            <div>Selected plan<b id="planLabel">${escapeHtml(detailPlan)} · ${peso(rateFor(p, detailPlan))}</b></div>
          </div>

          <div class="detail-actions">
            <button class="btn btn-primary" id="detailOrder" ${p.stock === 0 ? 'disabled' : ''}>
              ${p.stock === 0 ? 'Out of stock' : 'Order now'}
            </button>
            <button class="btn btn-outline" id="detailAdd" ${p.stock === 0 ? 'disabled' : ''}>
              Add to cart
            </button>
            <button class="btn btn-ghost wish-toggle" id="detailWish" type="button"
                    data-action="wish" data-id="${p.id}" aria-pressed="${isWishlisted(p.id) ? 'true' : 'false'}">
              <svg viewBox="0 0 24 24" style="width:17px;height:17px;"><path d="M12 20s-7-4.3-7-9.3A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7 2.9c0 5-7 9.3-7 9.3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <span id="detailWishLabel">${isWishlisted(p.id) ? 'Saved' : 'Save'}</span>
            </button>
            <a class="btn btn-ghost" href="/cart.html">Go to cart</a>
          </div>
        </div>
      </div>

      <div class="detail-sections">
        <div class="detail-box">
          <h3>Specifications</h3>
          <div class="spec-list">${specRows}</div>
        </div>
        <div class="detail-box">
          <h3>What's included</h3>
          <div class="check-list">${includedRows}</div>
        </div>
      </div>

      <div class="reviews-box" id="reviewsBox">
        <h3>Reviews</h3>
        <p class="review-empty">Loading reviews…</p>
      </div>
    </div>
  </div>`;


  wrap.querySelector('#rateSelector')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-plan]');
    if (!button) return;

    const plan = button.dataset.plan;

    const deposit =
      plan === 'Daily'
        ? 500
        : plan === 'Weekly'
          ? 2500
          : 5000;

    const depositLabel =
      wrap.querySelector('#depositLabel');

    if (depositLabel) {
      depositLabel.textContent = peso(deposit);
    }
  });

  wrap.querySelector('#backToCatalog').addEventListener('click', () => {
    history.pushState('', '', location.pathname);
    syncFromHash();
  });

  bindGallery(wrap, p);

  const selector = wrap.querySelector('#rateSelector');
  selector.addEventListener('click', (e) => {
    const btn = e.target.closest('.rate-option');
    if (!btn) return;
    detailPlan = btn.dataset.plan;
    selector.querySelectorAll('.rate-option').forEach(b => b.classList.toggle('active', b === btn));
    wrap.querySelector('#planLabel').textContent = `${detailPlan} · ${peso(rateFor(p, detailPlan))}`;
  });

  wrap.querySelector('#detailAdd').addEventListener('click', async (e) => {
    const done = fx.setBtnLoading(e.currentTarget, 'Adding…');
    const res = await addToCart(p.id, detailPlan, 1);
    done();
    if (!res.ok) { toast(res.error, 'error'); return; }
    updateCartBadge();
    toast(`${p.name} (${detailPlan}) added to cart`);
  });

  // Straight to express checkout, carrying whichever plan is selected here.
  wrap.querySelector('#detailOrder').addEventListener('click', () => {
    location.href = `/checkout.html?product=${p.id}&plan=${encodeURIComponent(detailPlan)}`;
  });

  wrap.querySelector('#detailWish').addEventListener('click', async (e) => {
    await wishToggle(p.id, e.currentTarget);
    const label = wrap.querySelector('#detailWishLabel');
    if (label) label.textContent = isWishlisted(p.id) ? 'Saved' : 'Save';
  });

  renderReviews(p);   // async; fills #reviewsBox once loaded
  refreshFx();
}

/* ---------------- reviews ---------------- */

/** Five stars, the first `n` filled. */
function starsMarkup(n) {
  const full = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="${i <= full ? 'on' : ''}">★</span>`;
  return `<span class="stars" role="img" aria-label="${full} out of 5 stars">${out}</span>`;
}

/** 5→1 star histogram, as proportional bars. */
function distributionMarkup(distribution, total) {
  if (!total) return '';
  return `
    <div class="rating-bars">
      ${[5, 4, 3, 2, 1].map(star => {
        const n = distribution?.[star] || 0;
        const pct = Math.round((n / total) * 100);
        return `
          <div class="rating-bar-row">
            <span class="rating-bar-label">${star}★</span>
            <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${pct}%;"></div></div>
            <span class="rating-bar-count">${n}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function reviewItemMarkup(r) {
  return `
    <div class="review-item">
      <div class="rv-top">
        <span class="rv-name">${escapeHtml(r.userName || 'DiaLux renter')}</span>
        <span class="rv-date">${escapeHtml(r.createdAt ? formatDate(r.createdAt) : '')}</span>
      </div>
      ${starsMarkup(r.rating)}
      ${r.comment ? `<p style="margin-top:8px;">${escapeHtml(r.comment)}</p>` : ''}
    </div>`;
}

/** The review form (verified renters), or a short prompt explaining why not. */
function reviewFormMarkup(mine) {
  const rating = mine?.rating || 5;
  const comment = mine?.comment || '';
  return `
    <form class="review-form" id="reviewForm">
      <h4>${mine ? 'Update your review' : 'Write a review'}</h4>
      <div class="star-input" id="starInput" data-value="${rating}">
        ${[1, 2, 3, 4, 5].map(i =>
          `<button type="button" data-star="${i}" class="${i <= rating ? 'on' : ''}" aria-label="${i} star${i === 1 ? '' : 's'}">★</button>`
        ).join('')}
      </div>
      <div class="field">
        <textarea class="mini-select" id="reviewComment" rows="3" maxlength="1000"
          placeholder="How was the device and the rental experience?">${escapeHtml(comment)}</textarea>
      </div>
      <button class="btn btn-primary btn-sm" type="submit" style="margin-top:10px;">
        ${mine ? 'Save changes' : 'Submit review'}
      </button>
    </form>`;
}

async function renderReviews(p) {
  const box = document.getElementById('reviewsBox');
  if (!box) return;

  let data;
  try {
    data = await reviewsApi.list(p.id);
  } catch {
    box.innerHTML = `<h3>Reviews</h3><p class="review-empty">Couldn't load reviews right now.</p>`;
    return;
  }
  // A slow request may resolve after the user has navigated elsewhere.
  if (!document.body.contains(box)) return;

  const reviews = data.reviews || [];
  const count = data.count ?? reviews.length;
  const avg = Number(data.avgRating) || 0;
  const mine = state.user ? reviews.find(r => String(r.user) === state.user.id) : null;

  const summary = count ? `
    <div class="reviews-summary">
      <div class="reviews-avg">${avg.toFixed(1)}<small>out of 5</small></div>
      <div>
        ${starsMarkup(avg)}
        <div class="reviews-count">${count} review${count === 1 ? '' : 's'} from verified renters</div>
      </div>
      ${distributionMarkup(data.distribution, reviews.length)}
    </div>` : '';

  const list = reviews.length
    ? `<div class="review-list">${reviews.map(reviewItemMarkup).join('')}</div>`
    : `<p class="review-empty">No reviews yet — verified renters can be the first.</p>`;

  let footer;
  if (!state.user) {
    footer = `<div class="review-note">Sign in and rent this device to leave a review.</div>`;
  } else if (hasReviewableOrder(p.id)) {
    footer = reviewFormMarkup(mine);
  } else {
    footer = `<div class="review-note">Only customers who have rented this device can review it. Once your rental is delivered, your review option appears here.</div>`;
  }

  box.innerHTML = `<h3>Reviews</h3>${summary}${list}${footer}`;
  bindReviewForm(p);
}

function bindReviewForm(p) {
  const form = document.getElementById('reviewForm');
  if (!form) return;

  const starBox = form.querySelector('#starInput');
  starBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-star]');
    if (!btn) return;
    const val = Number(btn.dataset.star);
    starBox.dataset.value = String(val);
    starBox.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= val));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rating = Number(starBox.dataset.value) || 0;
    const comment = form.querySelector('#reviewComment').value.trim();
    if (rating < 1 || rating > 5) { toast('Pick a star rating from 1 to 5', 'error'); return; }

    const btn = form.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Submitting…');
    try {
      const res = await reviewsApi.create(p.id, { rating, comment });

      // Reflect the new average on the in-memory product so the card, the
      // detail chip and the hero ordering all agree without a reload.
      const fresh = productById(p.id);
      if (fresh) {
        fresh.avgRating = res.avgRating ?? fresh.avgRating;
        fresh.reviewCount = res.reviewCount ?? fresh.reviewCount;
      }

      toast('Thanks for your review!');
      await renderReviews(fresh || p);
    } catch (err) {
      done();
      toast(err.message, 'error');
    }
  });
}

/* ---------------- routing ---------------- */

// Product ids are 24-character MongoDB ObjectIds.
const DEVICE_HASH = /^#device-([a-f\d]{24})$/i;

function syncFromHash() {
  const catalog = document.getElementById('catalogView');
  const detail = document.getElementById('detailView');
  const match = DEVICE_HASH.exec(location.hash);

  if (match) {
    catalog?.classList.add('hidden');
    detail?.classList.remove('hidden');
    renderDetail(match[1]);
  } else {
    if (detail) { detail.classList.add('hidden'); detail.innerHTML = ''; }
    catalog?.classList.remove('hidden');
    renderControls();
    renderGrid();
  }
  syncWishButtons();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

bootPage('products', () => {
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
});
