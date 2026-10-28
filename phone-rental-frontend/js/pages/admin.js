// ============================================================
// DiaLux — pages/admin.js
// Products, orders (with drill-in + refunds), inventory, users, support,
// CMS pages, platform settings, audit trail and reports.
//
// Every write here goes through an admin-guarded endpoint, so the
// server is the real gate. Hiding the UI from non-admins is just
// courtesy — a non-admin who forces their way in gets 403s.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage, refreshFx } from '../core/page.js';
import {
  state, loadProducts, loadSettings, productById,
  ORDER_STATUSES, INSPECTION_CHECKLIST, CATEGORIES, GRADES, SUPPORT_STATUSES,
} from '../core/state.js';
import {
  productsApi, ordersApi, usersApi, supportApi, pagesApi,
  settingsApi, auditApi, notificationsApi, ridersApi, paymentsApi,
} from '../core/api.js';
import {
  peso, escapeHtml, formatDate, formatDateTime, toast, statusClass,
  titleCase, catLabel, categoryIcon, gradeClass, emptyState, paymentLabel, PAYMENT_LABELS,
} from '../core/ui.js';
import { isAdmin } from '../core/auth.js';

const TABS = [
  { key: 'products',  label: 'Products' },
  { key: 'orders',    label: 'Orders' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'users',     label: 'Users' },
  { key: 'riders',    label: 'Riders' },
  { key: 'support',   label: 'Support' },
  { key: 'pages',     label: 'Pages' },
  { key: 'settings',  label: 'Settings' },
  { key: 'audit',     label: 'Audit trail' },
  { key: 'reports',   label: 'Reports' },
];

const TAB_KEYS = TABS.map(t => t.key);

let activeTab = 'products';
let editingId = null;
let showInactive = false;

let allOrders = [];
let openOrderId = '';
let orderStatusFilter = '';

let allUsers = [];

let allTickets = [];
let openTicketId = '';
let ticketStatusFilter = '';

let cmsPages = [];
let editingSlug = '';

let auditFilter = { action: '', actor: '', page: 1 };

let reportPeriod = 'month';   // Reports revenue-over-time granularity: week | month | year

const PRODUCT_CATS = CATEGORIES.filter(c => c.key !== 'all');
const shortId = (id) => String(id).slice(-6).toUpperCase();

/* ---------------- shell ---------------- */

function renderShell() {
  const wrap = document.getElementById('adminDashWrap');
  if (!wrap) return;

  if (!state.user) {
    wrap.innerHTML = emptyState(
      'Admin access required',
      'Sign in with an administrator account to manage the platform.',
      '<a class="btn btn-primary" href="/index.html#auth">Sign in</a>'
    );
    return;
  }

  if (!isAdmin()) {
    wrap.innerHTML = emptyState(
      'This page isn’t available',
      'Your account doesn’t have access to the management dashboard.',
      '<a class="btn btn-primary" href="/products.html">Back to catalog</a>'
    );
    return;
  }

  // Deep links: /admin.html#inventory, #support, #orders …
  const hash = location.hash.replace('#', '');
  if (TAB_KEYS.includes(hash)) activeTab = hash;

  wrap.innerHTML = `
    <div class="admin-shell">
      <nav class="admin-side" id="adminTabs">
        ${TABS.map(t => `
          <button type="button" data-tab="${t.key}"${t.key === activeTab ? ' class="active"' : ''}>${t.label}</button>
        `).join('')}
      </nav>
      <div class="admin-card" id="adminPanel"></div>
    </div>`;

  wrap.querySelector('#adminTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    editingId = null;
    openOrderId = '';
    openTicketId = '';
    editingSlug = '';
    history.replaceState(null, '', `#${activeTab}`);
    wrap.querySelectorAll('#adminTabs button').forEach(b => b.classList.toggle('active', b === btn));
    renderPanel();
  });

  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#', '');
    if (TAB_KEYS.includes(next) && next !== activeTab) {
      activeTab = next;
      renderShell();
    }
  });

  return renderPanel();
}

function loading(panel, label = 'Loading…') {
  panel.innerHTML = `<p style="color:var(--ink-muted);font-size:.9rem;padding:8px 0;">${label}</p>`;
}

const RENDERERS = {
  products: renderProducts,
  orders: renderOrders,
  inventory: renderInventory,
  users: renderUsers,
  riders: renderRiders,
  support: renderSupport,
  pages: renderPages,
  settings: renderSettings,
  audit: renderAudit,
  reports: renderReports,
};

async function renderPanel() {
  const panel = document.getElementById('adminPanel');
  if (!panel) return;

  try {
    await (RENDERERS[activeTab] || renderProducts)(panel);
  } catch (err) {
    panel.innerHTML = `<p style="color:var(--danger);font-size:.9rem;">${escapeHtml(err.message)}</p>`;
    return;
  }

  refreshFx();
}

/* ---------------- products ---------------- */

/** Product.specs (a plain object) → "Key: Value" lines for the textarea. */
function specsToText(specs) {
  return Object.entries(specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** "Key: Value" lines → a plain object. Blank and colon-less lines are skipped. */
function parseSpecs(text) {
  const out = {};
  String(text || '').split('\n').forEach(line => {
    const i = line.indexOf(':');
    if (i < 0) return;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key && val) out[key] = val;
  });
  return out;
}

/** Newline- or comma-separated text → a trimmed array of non-empty strings. */
function parseList(text) {
  return String(text || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean);
}

function productFormMarkup() {
  const p = editingId ? (productById(editingId) || allProductsCache.find(x => x.id === editingId)) : null;
  const v = (key, fallback = '') => escapeHtml(String(p?.[key] ?? fallback));

  // One URL per line — the first is the primary photo shown on cards.
  const galleryText = (p?.images?.length ? p.images : (p?.image ? [p.image] : [])).join('\n');

  return `
  <form class="pf-form" id="productForm">
    <h4 style="margin-bottom:14px;">${p ? `Edit “${escapeHtml(p.name)}”` : 'Add a new device'}</h4>

    <div class="pf-grid">
      <input class="mini-select" name="name" placeholder="Device name" value="${v('name')}" required>
      <input class="mini-select" name="brand" placeholder="Brand" value="${v('brand')}" required>
      <select class="mini-select" name="cat">
        ${PRODUCT_CATS.map(c => `<option value="${c.key}"${p?.cat === c.key ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
    </div>

    <div class="pf-grid">
      <select class="mini-select" name="grade">
        ${GRADES.map(g => `<option value="${g}"${p?.grade === g ? ' selected' : ''}>${g}</option>`).join('')}
      </select>
      <input class="mini-select" name="stock" type="number" min="0" placeholder="Stock" value="${v('stock', 1)}" required>
      <input class="mini-select" name="deposit" type="number" min="0" placeholder="Deposit ₱" value="${v('deposit', 0)}" required>
    </div>

    <div class="pf-grid">
      <input class="mini-select" name="daily" type="number" min="0" placeholder="Daily ₱" value="${v('daily', 0)}" required>
      <input class="mini-select" name="weekly" type="number" min="0" placeholder="Weekly ₱" value="${v('weekly', 0)}" required>
      <input class="mini-select" name="monthly" type="number" min="0" placeholder="Monthly ₱" value="${v('monthly', 0)}" required>
    </div>

    <div class="pf-grid wide">
      <textarea class="mini-select" name="desc" rows="2" placeholder="Short description">${v('desc')}</textarea>
    </div>

    <div class="pf-grid wide">
      <label class="pf-label" for="pf-images">Photo gallery — one URL per line, first one is the cover</label>
      <textarea class="mini-select" name="images" id="pf-images" rows="4"
        placeholder="https://example.com/device-front.jpg&#10;https://example.com/device-back.jpg&#10;(blank uses the category icon)">${escapeHtml(galleryText)}</textarea>
      <small class="pf-hint">
        Up to 8 images, hotlinked by URL — http(s) or a path under /assets. Shown 1:1 on the
        detail page, so square photos crop best. There is no file upload in this build, so drop
        files into <span class="mono">assets/products/</span> and reference them as
        <span class="mono">/assets/products/name.jpg</span>.
      </small>
    </div>

    <div class="pf-grid wide">
      <label class="pf-label" for="pf-card-image">Wide card photo — optional</label>
      <input class="mini-select" name="cardImage" id="pf-card-image"
        placeholder="/assets/hero-slider/name.jpg" value="${v('cardImage')}">
      <small class="pf-hint">
        The landscape shot used on catalog cards, where the frame is roughly 16:9. Leave blank
        and the card falls back to the cover photo above, cropped top and bottom. Wide files
        live in <span class="mono">assets/hero-slider/</span>.
      </small>
    </div>

    <div class="pf-grid wide">
      <textarea class="mini-select" name="specs" rows="4" placeholder="Specifications — one “Key: Value” per line&#10;Display: 6.1-inch OLED&#10;Chip: A16 Bionic&#10;Storage: 128GB">${escapeHtml(specsToText(p?.specs))}</textarea>
    </div>

    <div class="pf-grid wide">
      <textarea class="mini-select" name="included" rows="3" placeholder="What's included — one per line&#10;Original charger&#10;USB-C cable&#10;Protective case">${escapeHtml((p?.included || []).join('\n'))}</textarea>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" type="submit">${p ? 'Save changes' : 'Add device'}</button>
      ${p ? '<button class="btn btn-ghost btn-sm" type="button" id="cancelEdit">Cancel</button>' : ''}
    </div>
  </form>`;
}

// Retired devices are not in state.products (which only holds active ones),
// so the table keeps its own copy when "show retired" is on.
let allProductsCache = [];

async function renderProducts(panel) {
  loading(panel, 'Loading catalog…');

  let rows = state.products;
  if (showInactive) {
    const data = await productsApi.allIncludingInactive();
    allProductsCache = data.products || [];
    rows = allProductsCache;
  } else {
    allProductsCache = state.products;
  }

  panel.innerHTML = `
    <div class="admin-top">
      <h3>Products</h3>
      <div class="admin-top-actions">
        <label class="mini-check">
          <input type="checkbox" id="toggleInactive" ${showInactive ? 'checked' : ''}>
          Show retired
        </label>
        <span style="font-size:.8rem;color:var(--ink-faint);">${rows.length} listed</span>
      </div>
    </div>

    ${productFormMarkup()}

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Device</th><th>Category</th><th>Grade</th><th>Weekly</th><th>Deposit</th><th>Stock</th><th>Photos</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${rows.map(p => `
            <tr${p.active === false ? ' class="row-retired"' : ''}>
              <td>
                <span class="mini-thumb">${categoryIcon(p.cat)}</span>
                ${escapeHtml(p.name)}
                ${p.active === false ? '<span class="status-pill status-cancelled">Retired</span>' : ''}
                <div style="font-size:.72rem;color:var(--ink-faint);">${escapeHtml(p.brand)}</div>
              </td>
              <td>${escapeHtml(catLabel(p.cat))}</td>
              <td><span class="grade-tag ${gradeClass(p.grade)}">${escapeHtml(p.grade)}</span></td>
              <td>${peso(p.weekly)}</td>
              <td>${peso(p.deposit)}</td>
              <td>${p.stock}</td>
              <td>${(p.images?.length || (p.image ? 1 : 0))}</td>
              <td>
                <div class="row-actions">
                  <button type="button" data-act="edit" data-id="${p.id}">Edit</button>
                  ${p.active === false
                    ? `<button type="button" data-act="restore" data-id="${p.id}">Restore</button>`
                    : `<button type="button" class="del" data-act="delete" data-id="${p.id}">Retire</button>`}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  panel.querySelector('#toggleInactive').addEventListener('change', (e) => {
    showInactive = e.target.checked;
    renderPanel();
  });

  panel.querySelector('#productForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const num = (k) => Number(fd.get(k)) || 0;

    const images = parseList(fd.get('images'));

    const payload = {
      name: String(fd.get('name')).trim(),
      brand: String(fd.get('brand')).trim(),
      cat: String(fd.get('cat')),
      grade: String(fd.get('grade')),
      stock: num('stock'),
      deposit: num('deposit'),
      daily: num('daily'),
      weekly: num('weekly'),
      monthly: num('monthly'),
      desc: String(fd.get('desc')).trim(),
      images,
      // The first gallery entry is the 1:1 detail cover.
      image: images[0] || '',
      // Sent even when blank, so clearing the box clears the wide shot.
      cardImage: String(fd.get('cardImage') || '').trim(),
      specs: parseSpecs(fd.get('specs')),
      included: parseList(fd.get('included')),
    };

    if (!payload.name || !payload.brand) {
      toast('Name and brand are required', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const done = fx.setBtnLoading(btn, 'Saving…');

    try {
      if (editingId) {
        await productsApi.update(editingId, payload);
        toast(`${payload.name} updated`);
        editingId = null;
      } else {
        await productsApi.create(payload);
        toast(`${payload.name} added`);
      }

      await loadProducts();
      await renderPanel();
    } catch (err) {
      done();
      toast(err.message, 'error');
    }
  });

  panel.querySelector('#cancelEdit')?.addEventListener('click', () => {
    editingId = null;
    renderPanel();
  });

  panel.querySelector('tbody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;

    const id = btn.dataset.id;
    const act = btn.dataset.act;

    if (act === 'edit') {
      editingId = id;
      await renderPanel();

      document.getElementById('productForm')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      return;
    }

    if (act === 'restore') {
      const done = fx.setBtnLoading(btn, '…');

      try {
        const p = await productsApi.restore(id);
        toast(`${p.name} is back in the catalog`);
        await loadProducts();
        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }

      return;
    }

    if (act === 'delete') {
      const p =
        allProductsCache.find(x => x.id === id) ||
        productById(id);

      if (!p) return;

      if (!confirm(
        `Retire “${p.name}” from the catalog?\n\nExisting orders keep their history, and you can restore it later.`
      )) {
        return;
      }

      const done = fx.setBtnLoading(btn, '…');

      try {
        await productsApi.remove(id);
        toast(`${p.name} retired`);

        if (editingId === id) {
          editingId = null;
        }

        await loadProducts();
        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    }
  });
}

/* ---------------- orders ---------------- */

// Admin is now a monitor / exception handler, not the delivery operator.
// Gateway payments confirm automatically; bank transfer is the only normal
// payment action an admin performs. Rider assignment and delivery movement
// belong to the dispatcher + rider workflow.
const AUTO_ADVANCING_STATUSES = ['payment-confirmed', 'approved', 'preparing'];
const CLOSED_ORDER_STATUSES = ['cancelled', 'completed', 'refunded'];

function isAutoAdvancing(o) {
  return o.payment?.status === 'paid' && AUTO_ADVANCING_STATUSES.includes(o.status);
}

function autoBadge(o) {
  return isAutoAdvancing(o)
    ? '<span class="auto-badge" title="DiaLux is handling this stage automatically">Auto</span>'
    : '';
}

function riderForOrder(o, riders) {
  const id = typeof o.rider === 'object' ? o.rider?.id : o.rider;

  return (
    riders.find(r => r.id === id) ||
    (typeof o.rider === 'object' ? o.rider : null)
  );
}

function riderCellMarkup(o, riders) {
  if (o.orderType === 'pickup') {
    return '<span class="field-hint">Hub pickup — no rider</span>';
  }

  const rider = riderForOrder(o, riders);

  if (rider) {
    const hub = rider.riderDispatch?.homeHub
      ? ` · ${titleCase(rider.riderDispatch.homeHub)}`
      : '';

    return `
      <span style="font-size:.82rem;">
        <b>${escapeHtml(rider.name || rider.email || 'Assigned')}</b>
        ${escapeHtml(hub)}
      </span>`;
  }

  const canDispatch =
    o.payment?.method === 'cash'
      ? ['approved', 'payment-confirmed', 'preparing'].includes(o.status)
      : Boolean(o.paid || o.payment?.status === 'paid');

  return canDispatch && !CLOSED_ORDER_STATUSES.includes(o.status)
    ? '<span class="field-hint">⚠ Waiting for auto-dispatch</span>'
    : '<span class="field-hint">—</span>';
}

function paymentAdminMarkup(o) {
  const method = o.payment?.method || '';
  const status = o.payment?.status || (o.paid ? 'paid' : 'pending');

  if (!method) {
    return `
      <div class="odp-form">
        <h5>Payment</h5>
        <p style="font-size:.84rem;color:var(--ink-muted);">
          Waiting for the customer to choose a payment method.
        </p>
      </div>`;
  }

  if (method === 'bank-transfer' && status !== 'paid') {
    return `
      <div class="odp-form">
        <h5>Payment verification</h5>

        <p style="font-size:.84rem;">
          <b>Bank transfer · ${escapeHtml(titleCase(status))}</b>
        </p>

        ${o.payment?.proofUrl
          ? `
              <a
                class="btn btn-outline btn-sm"
                href="${escapeHtml(o.payment.proofUrl)}"
                target="_blank"
                rel="noopener"
              >
                View payment proof ↗
              </a>

              <button
                class="btn btn-primary btn-sm"
                type="button"
                data-oact="verify-payment"
                data-id="${o.id}"
              >
                Verify payment
              </button>
            `
          : `
              <small class="pf-hint">
                The customer has not uploaded payment proof yet.
              </small>
            `}

        <small class="pf-hint">
          After verification, DiaLux automatically starts rider dispatch.
          You do not choose the rider.
        </small>
      </div>`;
  }

  if (method === 'cash' && status !== 'paid') {
    return `
      <div class="odp-form">
        <h5>Payment</h5>

        <p style="font-size:.84rem;">
          <b>Cash on delivery · Due at handover</b>
        </p>

        <small class="pf-hint">
          The assigned rider records the cash collection when the device is delivered.
        </small>
      </div>`;
  }

  return `
    <div class="odp-form">
      <h5>Payment</h5>

      <p style="font-size:.84rem;">
        <b>
          ✓ ${escapeHtml(paymentLabel(method))}
          ·
          ${escapeHtml(titleCase(status))}
        </b>
      </p>

      ${o.payment?.referenceNo
        ? `
            <span class="mono" style="font-size:.75rem;">
              ${escapeHtml(o.payment.referenceNo)}
            </span>
          `
        : ''}

      <small class="pf-hint">
        Gateway payments confirm automatically.
        No admin action is required.
      </small>
    </div>`;
}

function dispatchAdminMarkup(o, riders) {
  if (o.orderType === 'pickup') {
    return `
      <div class="odp-form">
        <h5>Dispatch</h5>

        <p style="font-size:.84rem;">
          <b>Hub pickup</b>
        </p>

        <small class="pf-hint">
          No outbound rider is needed because the customer collects the device at the selected hub.
        </small>
      </div>`;
  }

  const rider = riderForOrder(o, riders);

  const canRetry =
    o.payment?.method === 'cash'
      ? ['approved', 'payment-confirmed', 'preparing'].includes(o.status)
      : Boolean(o.paid || o.payment?.status === 'paid');

  const returnNeedsRider =
    ['return-requested', 'return-scheduled'].includes(o.status) &&
    o.returnPlan?.method === 'rider';

  return `
    <div class="odp-form">

      <h5>
        ${returnNeedsRider ? 'Return dispatch' : 'Outbound dispatch'}
      </h5>

      ${rider && !returnNeedsRider
        ? `
            <p style="font-size:.84rem;">
              <b>
                ✓ Auto-assigned to
                ${escapeHtml(rider.name || rider.email || 'rider')}
              </b>
            </p>

            ${rider.riderDispatch?.homeHub
              ? `
                  <small class="pf-hint">
                    Home hub:
                    ${escapeHtml(titleCase(rider.riderDispatch.homeHub))}
                  </small>
                `
              : ''}
          `
        : `
            <p style="font-size:.84rem;color:var(--ink-muted);">
              ${returnNeedsRider
                ? 'Return pickup uses automatic hub dispatch.'
                : 'No outbound rider is currently shown on this order.'}
            </p>
          `}

      ${(canRetry || returnNeedsRider) &&
        !CLOSED_ORDER_STATUSES.includes(o.status)
        ? `
            <button
              class="btn btn-outline btn-sm"
              type="button"
              data-oact="retry-dispatch"
              data-leg="${returnNeedsRider ? 'return' : 'outbound'}"
              data-id="${o.id}"
            >
              Retry auto-dispatch
            </button>
          `
        : ''}

      <small class="pf-hint">
        DiaLux chooses an on-duty rider from the service hub.
        If several riders are available, the least-loaded rider is preferred.
      </small>

    </div>`;
}

function trackingAdminMarkup(o, riders) {
  const rider = riderForOrder(o, riders);

  return `
    <div class="odp-form">

      <h5>
        Delivery tracking
      </h5>

      <p style="font-size:.84rem;">
        <span class="status-pill ${statusClass(o.status)}">
          ${escapeHtml(titleCase(o.status))}
        </span>
      </p>

      ${rider
        ? `
            <p style="font-size:.8rem;">
              Rider:
              ${escapeHtml(rider.name || rider.email || 'Assigned')}
            </p>
          `
        : ''}

      <small class="pf-hint">
        Read-only for admin.
        The rider dashboard controls pickup, transit, arrival and delivery confirmation.
      </small>

    </div>`;
}

function orderDetailMarkup(o, riders) {
  const canRefund =
    o.paid &&
    !o.refund &&
    o.status !== 'cancelled';

  const canEmergencyCancel =
    !CLOSED_ORDER_STATUSES.includes(o.status) &&
    ![
      'delivered',
      'active',
      'returned',
      'inspection',
      'inspection-passed',
      'inspection-failed',
    ].includes(o.status);

  return `
    <div class="order-detail-panel">

      <div class="odp-head">

        <div>

          <b>
            ${escapeHtml(
              o.invoiceNo ||
              `DLX-${shortId(o.id)}`
            )}
          </b>

          <span class="status-pill ${statusClass(o.status)}">
            ${escapeHtml(titleCase(o.status))}
          </span>

          ${autoBadge(o)}

          ${o.paid
            ? '<span class="paid-pill">✓ Paid</span>'
            : ''}

        </div>

        <button
          type="button"
          class="odp-close"
          data-oact="close"
          aria-label="Close"
        >
          ×
        </button>

      </div>

      <div class="odp-grid">

        <div>
          <h5>Customer</h5>
          <p>${escapeHtml(o.userName || '—')}</p>

          <p class="mono" style="font-size:.78rem;">
            ${escapeHtml(o.userEmail)}
          </p>

          ${o.phone
            ? `
                <p style="font-size:.8rem;">
                  ${escapeHtml(o.phone)}
                </p>
              `
            : ''}
        </div>

        <div>
          <h5>Deliver to</h5>
          <p style="font-size:.82rem;">
            ${escapeHtml(o.address || '—')}
          </p>
        </div>

        <div>
          <h5>Window</h5>

          <p style="font-size:.82rem;">
            ${escapeHtml(formatDate(o.startDate))}
            →
            ${escapeHtml(formatDate(o.endDate))}
          </p>

          <p style="font-size:.78rem;color:var(--ink-faint);">
            ${o.days}
            day${o.days === 1 ? '' : 's'}
          </p>
        </div>

        <div>
          <h5>Payment</h5>

          ${o.payment?.method
            ? `
                <p style="font-size:.82rem;">
                  ${escapeHtml(paymentLabel(o.payment.method))}
                  ·
                  ${escapeHtml(titleCase(o.payment.status || 'pending'))}
                </p>

                <p class="mono" style="font-size:.75rem;">
                  ${escapeHtml(o.payment.referenceNo || '—')}
                </p>
              `
            : `
                <p style="font-size:.82rem;color:var(--ink-faint);">
                  Unpaid
                </p>
              `}
        </div>

      </div>

      <div class="table-wrap" style="margin:14px 0;">

        <table>

          <thead>
            <tr>
              <th>Device</th>
              <th>Plan</th>
              <th class="num">Qty</th>
              <th class="num">Rate</th>
              <th class="num">Deposit</th>
            </tr>
          </thead>

          <tbody>
            ${o.items.map(i => `
              <tr>
                <td>${escapeHtml(i.name)}</td>
                <td>${escapeHtml(i.plan)}</td>
                <td class="num">${i.qty}</td>
                <td class="num">${peso(i.rate)}</td>
                <td class="num">${peso(i.deposit * i.qty)}</td>
              </tr>
            `).join('')}
          </tbody>

        </table>

      </div>

      <div class="odp-totals">
        <span>Rent ${peso(o.rent)}</span>
        <span>Delivery ${peso(o.delivery)}</span>
        ${o.protectionFee
          ? `<span>Protection ${peso(o.protectionFee)}</span>`
          : ''}
        <span>Deposit ${peso(o.deposit)}</span>
        <b>Total ${peso(o.total)}</b>
      </div>

      ${o.returnNote
        ? `
            <p class="summary-note">
              <b>Customer note:</b>
              ${escapeHtml(o.returnNote)}
            </p>
          `
        : ''}

      ${o.inspectionNote
        ? `
            <p class="summary-note">
              <b>Inspection:</b>
              ${escapeHtml(o.inspectionNote)}
            </p>
          `
        : ''}

      ${o.refund
        ? `
            <div class="odp-settled">
              Deposit settled
              ${escapeHtml(formatDateTime(o.refund.at))}
              —
              ${peso(o.refund.amount)}
              refunded
              ${o.refund.deducted
                ? `, ${peso(o.refund.deducted)} withheld`
                : ''}

              <span class="mono">
                ${escapeHtml(o.refund.ref || '')}
              </span>

              ${o.refund.note
                ? `
                    <br>
                    <small>
                      ${escapeHtml(o.refund.note)}
                    </small>
                  `
                : ''}

              ${o.refund.byEmail
                ? `
                    <br>
                    <small>
                      by
                      ${escapeHtml(o.refund.byEmail)}
                    </small>
                  `
                : ''}
            </div>
          `
        : ''}

      <div class="odp-forms">

        ${paymentAdminMarkup(o)}
        ${dispatchAdminMarkup(o, riders)}
        ${trackingAdminMarkup(o, riders)}

        ${o.status === 'return-scheduled' &&
          o.returnPlan?.method === 'hub'
          ? `
              <form
                class="odp-form"
                data-oform="hub"
                data-id="${o.id}"
              >

                <h5>
                  Hub return counter
                </h5>

                <small class="pf-hint">
                  ${escapeHtml(o.returnPlan.date)}
                  ·
                  ${escapeHtml(o.returnPlan.slot)}
                </small>

                <button
                  class="btn btn-primary btn-sm"
                  type="submit"
                >
                  Confirm device received at hub
                </button>

              </form>
            `
          : ''}

        ${['returned', 'inspection'].includes(o.status) &&
          o.paid &&
          !o.refund
          ? `
              <form
                class="odp-form inspect-form"
                data-oform="inspect"
                data-id="${o.id}"
              >

                <h5>
                  Return inspection / settlement
                </h5>

                <div class="check-grid">
                  ${INSPECTION_CHECKLIST.map(c => `
                    <label>
                      <input
                        type="checkbox"
                        name="chk-${c.key}"
                        checked
                      >
                      ${escapeHtml(c.label)}
                      OK
                    </label>
                  `).join('')}
                </div>

                <input
                  class="mini-select"
                  name="damageCharge"
                  type="number"
                  min="0"
                  value="0"
                  placeholder="Damage charge ₱"
                >

                <textarea
                  class="mini-select"
                  name="notes"
                  rows="2"
                  maxlength="2000"
                  placeholder="Inspection notes (required if it fails)"
                ></textarea>

                <label>
                  <input
                    type="checkbox"
                    name="passed"
                    checked
                  >
                  Passed inspection
                </label>

                <small class="pf-hint">
                  This is a return / settlement operation,
                  not a delivery-status override.
                </small>

                <button
                  class="btn btn-primary btn-sm"
                  type="submit"
                >
                  Save inspection &amp; settle
                </button>

              </form>
            `
          : ''}

        ${canRefund &&
          !['returned', 'inspection'].includes(o.status)
          ? `
              <form
                class="odp-form"
                data-oform="refund"
                data-id="${o.id}"
              >

                <h5>
                  Settlement exception
                </h5>

                <div class="pf-grid">

                  <input
                    class="mini-select"
                    name="deducted"
                    type="number"
                    min="0"
                    max="${o.deposit}"
                    value="0"
                    placeholder="Withhold ₱"
                  >

                  <input
                    class="mini-select"
                    name="refund"
                    type="number"
                    min="0"
                    max="${o.deposit}"
                    value="${o.deposit}"
                    placeholder="Refund ₱"
                  >

                </div>

                <input
                  class="mini-select"
                  name="note"
                  placeholder="Reason, if withholding anything"
                  maxlength="200"
                >

                <button
                  class="btn btn-outline btn-sm"
                  type="submit"
                >
                  Record settlement
                </button>

                <small class="pf-hint">
                  Use only for refund / dispute exceptions.
                  Normal fulfilment is automatic.
                </small>

              </form>
            `
          : ''}

        ${canEmergencyCancel
          ? `
              <form
                class="odp-form"
                data-oform="cancel"
                data-id="${o.id}"
              >

                <h5>
                  Exception cancellation
                </h5>

                <input
                  class="mini-select"
                  name="note"
                  placeholder="Reason for cancellation"
                  maxlength="200"
                >

                <button
                  class="btn btn-outline btn-sm"
                  type="submit"
                >
                  Cancel booking
                </button>

                <small class="pf-hint">
                  Emergency exception only.
                  Admin cannot manually move the booking through normal fulfilment stages.
                </small>

              </form>
            `
          : ''}

      </div>

      <div class="row-actions" style="margin-top:12px;">
        <a
          href="/order.html?id=${o.id}"
          target="_blank"
          rel="noopener"
        >
          Open printable invoice ↗
        </a>
      </div>

    </div>`;
}

async function renderOrders(panel) {
  loading(panel, 'Loading orders…');

  const [data, riderData] = await Promise.all([
    ordersApi.all(orderStatusFilter || undefined),
    ridersApi.all().catch(() => ({ riders: [] })),
  ]);

  allOrders = data.orders || [];

  const riders = riderData.riders || [];

  const open =
    openOrderId
      ? allOrders.find(o => o.id === openOrderId)
      : null;

  panel.innerHTML = `
    <div class="admin-top">

      <div>
        <h3>Orders</h3>

        <p class="field-hint" style="margin-top:4px;">
          Monitor payments, automatic rider dispatch and delivery progress.
          Rider statuses are read-only here.
        </p>
      </div>

      <div class="admin-top-actions">

        <select
          class="mini-select"
          id="orderFilter"
        >
          <option value="">
            All statuses
          </option>

          ${ORDER_STATUSES.map(s => `
            <option
              value="${s}"
              ${s === orderStatusFilter ? 'selected' : ''}
            >
              ${escapeHtml(titleCase(s))}
            </option>
          `).join('')}
        </select>

        <span style="font-size:.8rem;color:var(--ink-faint);">
          ${allOrders.length}
          shown
        </span>

      </div>

    </div>

    ${open
      ? orderDetailMarkup(open, riders)
      : ''}

    ${!allOrders.length
      ? `
          <p style="color:var(--ink-muted);font-size:.9rem;">
            ${orderStatusFilter
              ? 'No bookings with that status.'
              : 'No bookings yet. Confirm one from the cart to see it here.'}
          </p>
        `
      : `
          <div class="table-wrap">

            <table>

              <thead>
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Devices</th>
                  <th>Dates</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Dispatch</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>

                ${allOrders.map(o => `
                  <tr
                    ${o.id === openOrderId ? 'class="row-open"' : ''}
                  >

                    <td>
                      <b>${shortId(o.id)}</b>
                      ${o.refund
                        ? '<div class="mini-flag">settled</div>'
                        : ''}
                    </td>

                    <td>
                      ${escapeHtml(o.userName || '—')}

                      <div style="font-size:.72rem;color:var(--ink-faint);">
                        ${escapeHtml(o.userEmail)}
                      </div>
                    </td>

                    <td>
                      ${o.items.map(i => `${i.qty} × ${escapeHtml(i.name)}`).join('<br>')}
                    </td>

                    <td>
                      ${formatDate(o.startDate)}

                      <div style="font-size:.72rem;color:var(--ink-faint);">
                        to
                        ${formatDate(o.endDate)}
                      </div>
                    </td>

                    <td>
                      ${peso(o.total)}
                    </td>

                    <td>
                      <span class="status-pill ${statusClass(o.status)}">
                        ${escapeHtml(titleCase(o.status))}
                      </span>

                      ${autoBadge(o)}
                    </td>

                    <td>
                      ${riderCellMarkup(o, riders)}
                    </td>

                    <td>
                      <div class="row-actions">
                        <button
                          type="button"
                          data-oact="open"
                          data-id="${o.id}"
                        >
                          ${o.id === openOrderId ? 'Hide' : 'View'}
                        </button>
                      </div>
                    </td>

                  </tr>
                `).join('')}

              </tbody>

            </table>

          </div>
        `}
  `;

  panel.querySelector('#orderFilter').addEventListener('change', (e) => {
    orderStatusFilter = e.target.value;
    openOrderId = '';
    renderPanel();
  });

  if (!panel.dataset.orderActionsBound) {
    panel.dataset.orderActionsBound = '1';

    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-oact]');
      if (!btn) return;

      if (btn.dataset.oact === 'close') {
        openOrderId = '';
        renderPanel();
        return;
      }

      if (btn.dataset.oact === 'open') {
        openOrderId =
          openOrderId === btn.dataset.id
            ? ''
            : btn.dataset.id;

        renderPanel();
        return;
      }

      if (btn.dataset.oact === 'verify-payment') {
        if (!confirm(
          'Verify this bank transfer as paid? Automatic rider dispatch will start immediately afterward.'
        )) {
          return;
        }

        const done = fx.setBtnLoading(
          btn,
          'Verifying…'
        );

        try {
          const result =
            await paymentsApi.verify(
              btn.dataset.id
            );

          toast(
            result.dispatch?.assigned
              ? 'Payment verified — rider auto-assigned'
              : 'Payment verified — waiting for an available rider'
          );

          await renderPanel();
        } catch (err) {
          done();
          toast(err.message, 'error');
        }

        return;
      }

      if (btn.dataset.oact === 'retry-dispatch') {
        const done = fx.setBtnLoading(
          btn,
          'Dispatching…'
        );

        try {
          const result =
            await ordersApi.dispatch(
              btn.dataset.id,
              btn.dataset.leg || 'outbound'
            );

          toast(
            result.dispatch?.assigned
              ? `Auto-assigned to ${result.dispatch.rider?.name || 'rider'}`
              : 'No on-duty rider is available for that hub yet',
            result.dispatch?.assigned
              ? 'ok'
              : 'error'
          );

          await renderPanel();
        } catch (err) {
          done();
          toast(err.message, 'error');
        }
      }
    });
  }

  panel.querySelector('[data-oform="cancel"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const id =
        e.target.dataset.id;

      const note =
        e.target.note.value.trim();

      if (!confirm(
        'Cancel this booking as an admin exception?'
      )) {
        return;
      }

      const btn =
        e.target.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Cancelling…'
        );

      try {
        await ordersApi.setStatus(
          id,
          'cancelled',
          note
        );

        toast(
          `Booking #${shortId(id)} cancelled`
        );

        await loadProducts();
        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('[data-oform="hub"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn =
        e.target.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Saving…'
        );

      try {
        await ordersApi.hubReceived(
          e.target.dataset.id
        );

        toast(
          'Marked as received at the hub'
        );

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('[data-oform="inspect"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const f =
        e.target;

      const checklist = {};

      INSPECTION_CHECKLIST.forEach(c => {
        checklist[c.key] =
          f[`chk-${c.key}`].checked;
      });

      const passed =
        f.passed.checked;

      const notes =
        f.notes.value.trim();

      if (!passed && !notes) {
        toast(
          'Add a note explaining why it failed',
          'error'
        );
        return;
      }

      if (
        passed &&
        Object.values(checklist).some(v => !v)
      ) {
        toast(
          'A failed checklist item cannot pass',
          'error'
        );
        return;
      }

      const btn =
        f.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Saving…'
        );

      try {
        const {
          settlement,
        } =
          await ordersApi.inspect(
            f.dataset.id,
            {
              passed,
              notes,
              checklist,

              damageCharge:
                Number(f.damageCharge.value) ||
                0,
            }
          );

        toast(
          `Settled: ${peso(settlement.refundAmount)} refunded${settlement.deducted ? `, ${peso(settlement.deducted)} withheld` : ''}`
        );

        await loadProducts();
        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('[data-oform="refund"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const id =
        e.target.dataset.id;

      const deducted =
        Number(e.target.deducted.value) ||
        0;

      const amount =
        Number(e.target.refund.value) ||
        0;

      const note =
        e.target.note.value.trim();

      if (
        deducted > 0 &&
        !note
      ) {
        toast(
          'Add a reason when withholding part of the deposit',
          'error'
        );
        return;
      }

      if (!confirm(
        `Refund ${peso(amount)}${deducted ? ` and withhold ${peso(deducted)}` : ''}?`
      )) {
        return;
      }

      const btn =
        e.target.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Recording…'
        );

      try {
        await ordersApi.refund(
          id,
          {
            amount,
            deducted,
            note,
          }
        );

        toast(
          `Deposit settled for #${shortId(id)}`
        );

        await loadProducts();
        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });
}

/* ---------------- inventory ---------------- */

async function renderInventory(panel) {
  loading(panel, 'Loading inventory…');

  const rep =
    await ordersApi.reports();

  const data =
    await ordersApi.all();

  const rented = {};

  (data.orders || [])
    .filter(
      o =>
        ![
          'cancelled',
          'completed',
          'refunded',
        ].includes(o.status)
    )
    .forEach(
      o =>
        o.items.forEach(i => {
          rented[i.product] =
            (rented[i.product] || 0) +
            i.qty;
        })
    );

  const lowAt =
    rep.lowStockAt ??
    2;

  panel.innerHTML = `
    <div class="admin-top">

      <h3>
        Inventory
      </h3>

      <span style="font-size:.8rem;color:var(--ink-faint);">
        Low-stock alert at
        ${lowAt}
        unit${lowAt === 1 ? '' : 's'}
      </span>

    </div>

    <div class="stat-grid">

      <div class="stat-card">
        <span>Units on shelf</span>
        <b>${rep.unitsOnShelf}</b>
      </div>

      <div class="stat-card">
        <span>Units rented out</span>
        <b>${rep.unitsRentedOut}</b>
      </div>

      <div class="stat-card${rep.lowStock ? ' warn' : ''}">
        <span>Low stock</span>
        <b>${rep.lowStock}</b>
      </div>

      <div class="stat-card${rep.outOfStock ? ' danger' : ''}">
        <span>Out of stock</span>
        <b>${rep.outOfStock}</b>
      </div>

    </div>

    <p class="summary-note" style="margin-bottom:14px;">
      Crossing the threshold notifies every administrator through the bell — see
      <span class="mono">services/stockAlert.js</span>.
      Change the threshold under Settings.
    </p>

    <div class="table-wrap">

      <table>

        <thead>
          <tr>
            <th>Device</th>
            <th>On shelf</th>
            <th>Rented out</th>
            <th>Status</th>
            <th>Adjust</th>
          </tr>
        </thead>

        <tbody>

          ${state.products.map(p => {
            const status =
              p.stock === 0
                ? '<span class="wipe-pending">Out of stock</span>'
                : p.stock <= lowAt
                  ? '<span class="wipe-pending">Low</span>'
                  : '<span class="wipe-ok">Healthy</span>';

            return `
              <tr>

                <td>
                  <span class="mini-thumb">
                    ${categoryIcon(p.cat)}
                  </span>
                  ${escapeHtml(p.name)}
                </td>

                <td>
                  <b>${p.stock}</b>
                </td>

                <td>
                  ${rented[p.id] || 0}
                </td>

                <td>
                  ${status}
                </td>

                <td>
                  <div class="row-actions">

                    <button
                      type="button"
                      data-delta="-1"
                      data-id="${p.id}"
                      ${p.stock === 0 ? 'disabled' : ''}
                    >
                      −1
                    </button>

                    <button
                      type="button"
                      data-delta="1"
                      data-id="${p.id}"
                    >
                      +1
                    </button>

                    <button
                      type="button"
                      data-delta="5"
                      data-id="${p.id}"
                    >
                      +5
                    </button>

                  </div>
                </td>

              </tr>`;
          }).join('')}

        </tbody>

      </table>

    </div>`;

  panel.querySelector('tbody').addEventListener('click', async (e) => {
    const btn =
      e.target.closest('[data-delta]');

    if (!btn) return;

    btn.disabled = true;

    try {
      await productsApi.adjustStock(
        btn.dataset.id,
        Number(btn.dataset.delta)
      );

      await loadProducts();
      await renderPanel();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });
}

/* ---------------- users ---------------- */

async function renderUsers(panel) {
  loading(panel, 'Loading users…');

  const data =
    await usersApi.all();

  allUsers =
    data.users ||
    [];

  if (!allUsers.length) {
    panel.innerHTML = `
      <div class="admin-top">
        <h3>User management</h3>
      </div>

      <p style="color:var(--ink-muted);font-size:.9rem;">
        No users found.
      </p>`;

    return;
  }

  // The API maps _id → id, so `id` is the only identifier that exists here.
  const meId =
    state.user?.id;

  const adminCount =
    allUsers.filter(
      u =>
        u.role === 'admin'
    ).length;

  panel.innerHTML = `
    <div class="admin-top">

      <h3>
        User management
      </h3>

      <span style="font-size:.8rem;color:var(--ink-faint);">
        ${allUsers.length}
        account${allUsers.length === 1 ? '' : 's'}
        ·
        ${adminCount}
        admin${adminCount === 1 ? '' : 's'}
      </span>

    </div>

    <div class="table-wrap">

      <table>

        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Bookings</th>
            <th>Spend</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody id="adminUserRows">

          ${allUsers.map(u => {
            const isMe =
              u.id === meId;

            const admin =
              u.role === 'admin';

            return `
              <tr>

                <td>

                  <strong>
                    ${escapeHtml(u.name || 'Unnamed')}
                  </strong>

                  ${isMe
                    ? '<span class="mini-flag">you</span>'
                    : ''}

                  ${u.googleId
                    ? `
                        <div style="font-size:.7rem;color:var(--ink-faint);">
                          Google account
                        </div>
                      `
                    : ''}

                </td>

                <td
                  class="mono"
                  style="font-size:.78rem;"
                >
                  ${escapeHtml(u.email)}
                </td>

                <td>

                  <span
                    class="status-pill ${
                      admin
                        ? 'status-approved'
                        : u.role === 'rider' ||
                          u.role === 'technician'
                          ? 'status-in-transit'
                          : 'status-pending'
                    }"
                  >
                    ${admin
                      ? 'Admin'
                      : titleCase(u.role || 'user')}
                  </span>

                </td>

                <td>
                  ${u.orderCount || 0}
                </td>

                <td>
                  ${peso(u.totalSpend || 0)}
                </td>

                <td>
                  ${formatDate(u.createdAt)}
                </td>

                <td>

                  <div class="row-actions">

                    ${admin
                      ? `
                          <button
                            type="button"
                            data-action="demote"
                            data-id="${escapeHtml(u.id)}"
                            ${isMe && adminCount <= 1
                              ? 'disabled title="You are the only administrator"'
                              : ''}
                          >
                            Demote
                          </button>
                        `
                      : `
                          <button
                            type="button"
                            data-action="promote"
                            data-id="${escapeHtml(u.id)}"
                          >
                            Make admin
                          </button>

                          ${u.role === 'rider'
                            ? `
                                <button
                                  type="button"
                                  data-action="unrider"
                                  data-id="${escapeHtml(u.id)}"
                                >
                                  Remove rider
                                </button>
                              `
                            : `
                                <button
                                  type="button"
                                  data-action="rider"
                                  data-id="${escapeHtml(u.id)}"
                                >
                                  Make rider
                                </button>
                              `}
                        `}

                    ${isMe
                      ? ''
                      : `
                          <button
                            type="button"
                            class="del"
                            data-action="delete"
                            data-id="${escapeHtml(u.id)}"
                          >
                            Delete
                          </button>
                        `}

                  </div>

                </td>

              </tr>`;
          }).join('')}

        </tbody>

      </table>

    </div>

    <p class="summary-note" style="margin-top:12px;">
      Deleting an account removes its cart and notifications but keeps its bookings,
      so revenue reports and the audit trail stay intact.
      An account with open rentals cannot be deleted.
    </p>`;

  panel.querySelector('#adminUserRows')
    .addEventListener('click', async (e) => {
      const btn =
        e.target.closest('[data-action]');

      if (
        !btn ||
        btn.disabled
      ) {
        return;
      }

      const userId =
        btn.dataset.id;

      const action =
        btn.dataset.action;

      const who =
        allUsers.find(
          u =>
            u.id === userId
        );

      const prompts = {
        promote:
          `Make ${who?.email || 'this user'} an administrator?`,

        rider:
          `Make ${who?.email || 'this user'} a rider? They will get the Rider Dashboard.`,

        unrider:
          `Remove rider access from ${who?.email || 'this user'}?`,

        demote:
          `Remove administrator access from ${who?.email || 'this user'}?`,

        delete:
          `Delete ${who?.email || 'this account'}?\n\nTheir bookings are kept for the records. This cannot be undone.`,
      };

      if (!confirm(
        prompts[action]
      )) {
        return;
      }

      const done =
        fx.setBtnLoading(
          btn,
          '…'
        );

      try {
        if (action === 'promote') {
          await usersApi.updateRole(
            userId,
            'admin'
          );

          toast(
            'User promoted to administrator'
          );
        } else if (action === 'rider') {
          await usersApi.updateRole(
            userId,
            'rider'
          );

          toast(
            'User is now a rider'
          );
        } else if (action === 'unrider') {
          await usersApi.updateRole(
            userId,
            'user'
          );

          toast(
            'Rider access removed'
          );
        } else if (action === 'demote') {
          await usersApi.updateRole(
            userId,
            'user'
          );

          toast(
            'Administrator access removed'
          );
        } else if (action === 'delete') {
          const res =
            await usersApi.delete(
              userId
            );

          toast(
            `${res.email} deleted${res.ordersKept ? ` — ${res.ordersKept} booking(s) kept` : ''}`
          );
        }

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });
}

/* ---------------- riders ---------------- */

/** Rider roster + automatic-dispatch configuration. */
async function renderRiders(panel) {
  loading(panel, 'Loading riders…');

  const data =
    await ridersApi.all();

  const riders =
    data.riders ||
    [];

  const hubs =
    data.hubs?.length
      ? data.hubs
      : [
          {
            id: 'katipunan',
            name: 'Katipunan Hub',
          },
          {
            id: 'cubao',
            name: 'Cubao Hub',
          },
          {
            id: 'fairview',
            name: 'Fairview Hub',
          },
        ];

  panel.innerHTML = `
    <div class="admin-top">

      <div>

        <h3>
          Rider dispatch
        </h3>

        <p class="field-hint" style="margin-top:4px;">
          Configure each rider's home hub and duty status.
          Orders are assigned automatically.
        </p>

      </div>

      <span style="font-size:.8rem;color:var(--ink-faint);">
        ${riders.length}
        rider${riders.length === 1 ? '' : 's'}
      </span>

    </div>

    <div
      class="pf-grid"
      style="margin-bottom:18px;max-width:520px;"
    >

      <div
        class="field"
        style="grid-column:1/-1;"
      >

        <label for="riderEmailInput">
          Add a rider account
        </label>

        <div style="display:flex;gap:8px;">

          <input
            type="email"
            id="riderEmailInput"
            placeholder="existing DiaLux account email"
            style="flex:1;"
          >

          <button
            type="button"
            class="btn btn-outline btn-sm"
            id="makeRiderBtn"
          >
            Make rider
          </button>

        </div>

        <span class="field-hint">
          After promotion, choose their hub and switch them
          On Duty before they receive automatic jobs.
        </span>

      </div>

    </div>

    ${riders.length
      ? `
          <div class="table-wrap">

            <table>

              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Phone</th>
                  <th>Home hub</th>
                  <th>Duty</th>
                  <th>Active jobs</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody id="adminRiderRows">

                ${riders.map(r => {
                  const dispatch =
                    r.riderDispatch ||
                    {};

                  const homeHub =
                    dispatch.homeHub ||
                    'cubao';

                  const onDuty =
                    Boolean(
                      dispatch.onDuty
                    );

                  return `
                    <tr
                      data-rider-row="${escapeHtml(r.id)}"
                    >

                      <td>

                        <strong>
                          ${escapeHtml(r.name || 'Unnamed')}
                        </strong>

                        <div
                          class="mono"
                          style="font-size:.72rem;color:var(--ink-faint);"
                        >
                          ${escapeHtml(r.email)}
                        </div>

                      </td>

                      <td>
                        ${escapeHtml(r.profile?.phone || '—')}
                      </td>

                      <td>

                        <select
                          class="mini-select"
                          data-rider-hub="${escapeHtml(r.id)}"
                          style="min-width:150px;"
                        >
                          ${hubs.map(h => `
                            <option
                              value="${escapeHtml(h.id)}"
                              ${h.id === homeHub ? 'selected' : ''}
                            >
                              ${escapeHtml(h.name || titleCase(h.id))}
                            </option>
                          `).join('')}
                        </select>

                      </td>

                      <td>

                        <label
                          style="
                            display:inline-flex;
                            align-items:center;
                            gap:7px;
                            white-space:nowrap;
                          "
                        >

                          <input
                            type="checkbox"
                            data-rider-duty="${escapeHtml(r.id)}"
                            ${onDuty ? 'checked' : ''}
                          >

                          <span
                            class="status-pill ${
                              onDuty
                                ? 'status-approved'
                                : 'status-pending'
                            }"
                          >
                            ${onDuty
                              ? 'On duty'
                              : 'Off duty'}
                          </span>

                        </label>

                      </td>

                      <td>
                        <b>
                          ${Number(r.activeJobs || 0)}
                        </b>
                      </td>

                      <td>

                        <div class="row-actions">

                          <button
                            type="button"
                            data-action="save-dispatch"
                            data-id="${escapeHtml(r.id)}"
                          >
                            Save
                          </button>

                          <button
                            type="button"
                            class="del"
                            data-action="demote-rider"
                            data-id="${escapeHtml(r.id)}"
                          >
                            Remove rider role
                          </button>

                        </div>

                      </td>

                    </tr>`;
                }).join('')}

              </tbody>

            </table>

          </div>

          <p class="summary-note" style="margin-top:12px;">
            Automatic dispatch maps the customer's delivery area
            to Katipunan, Cubao or Fairview.
            Only riders marked
            <b>On Duty</b>
            at that hub are eligible.
            When several riders qualify, DiaLux prefers the rider
            with fewer active jobs.
          </p>
        `
      : `
          <p style="color:var(--ink-muted);font-size:.9rem;">
            No riders yet.
            Promote an existing account above.
          </p>
        `}
  `;

  panel.querySelector('#makeRiderBtn')
    ?.addEventListener('click', async (e) => {
      const input =
        document.getElementById('riderEmailInput');

      const email =
        input.value
          .trim()
          .toLowerCase();

      if (!email) {
        toast(
          'Enter an email address',
          'error'
        );
        return;
      }

      const done =
        fx.setBtnLoading(
          e.currentTarget,
          '…'
        );

      try {
        const allUsersData =
          await usersApi.all();

        const target =
          (allUsersData.users || [])
            .find(
              u =>
                u.email?.toLowerCase() === email
            );

        if (!target) {
          done();

          toast(
            'No account found with that email',
            'error'
          );

          return;
        }

        if (target.role === 'admin') {
          done();

          toast(
            'That account is an administrator — demote it from the Users tab first',
            'error'
          );

          return;
        }

        await usersApi.updateRole(
          target.id,
          'rider'
        );

        toast(
          `${target.email} is now a rider — configure their hub and duty state`
        );

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('#adminRiderRows')
    ?.addEventListener('click', async (e) => {
      const btn =
        e.target.closest('[data-action]');

      if (!btn) return;

      const riderId =
        btn.dataset.id;

      if (btn.dataset.action === 'save-dispatch') {
        const row =
          panel.querySelector(
            `[data-rider-row="${riderId}"]`
          );

        const homeHub =
          row?.querySelector(
            `[data-rider-hub="${riderId}"]`
          )?.value;

        const onDuty =
          Boolean(
            row?.querySelector(
              `[data-rider-duty="${riderId}"]`
            )?.checked
          );

        if (!homeHub) {
          toast(
            'Choose a home hub first',
            'error'
          );
          return;
        }

        const done =
          fx.setBtnLoading(
            btn,
            'Saving…'
          );

        try {
          await ridersApi.updateDispatchProfile(
            riderId,
            {
              homeHub,
              onDuty,
            }
          );

          toast(
            `Rider dispatch updated — ${titleCase(homeHub)}, ${onDuty ? 'On duty' : 'Off duty'}`
          );

          await renderPanel();
        } catch (err) {
          done();
          toast(err.message, 'error');
        }

        return;
      }

      if (btn.dataset.action === 'demote-rider') {
        if (!confirm(
          'Remove rider access from this account? They will become a regular customer and receive no new delivery jobs.'
        )) {
          return;
        }

        const done =
          fx.setBtnLoading(
            btn,
            '…'
          );

        try {
          await usersApi.updateRole(
            riderId,
            'user'
          );

          toast(
            'Rider role removed'
          );

          await renderPanel();
        } catch (err) {
          done();
          toast(err.message, 'error');
        }
      }
    });
}

/* ---------------- support desk ---------------- */

function ticketDetailMarkup(t) {
  return `
    <div class="order-detail-panel">

      <div class="odp-head">

        <div>

          <b>
            ${escapeHtml(t.ref || shortId(t.id))}
          </b>

          <span class="status-pill ${statusClass(t.status)}">
            ${escapeHtml(titleCase(t.status))}
          </span>

        </div>

        <button
          type="button"
          class="odp-close"
          data-tact="close"
          aria-label="Close"
        >
          ×
        </button>

      </div>

      <div class="odp-grid">

        <div>

          <h5>
            From
          </h5>

          <p>
            ${escapeHtml(t.name)}
          </p>

          <p class="mono" style="font-size:.78rem;">
            ${escapeHtml(t.email)}
          </p>

          ${t.phone
            ? `
                <p style="font-size:.8rem;">
                  ${escapeHtml(t.phone)}
                </p>
              `
            : ''}

          ${t.user
            ? `
                <p style="font-size:.72rem;color:var(--signal);">
                  Registered customer
                </p>
              `
            : `
                <p style="font-size:.72rem;color:var(--ink-faint);">
                  Guest — replies go by email only
                </p>
              `}

        </div>

        <div>

          <h5>
            About
          </h5>

          <p style="font-size:.82rem;">
            ${escapeHtml(titleCase(t.category))}
          </p>

          ${t.orderRef
            ? `
                <p class="mono" style="font-size:.78rem;">
                  Booking
                  ${escapeHtml(t.orderRef)}
                </p>
              `
            : ''}

        </div>

        <div>

          <h5>
            Opened
          </h5>

          <p style="font-size:.82rem;">
            ${escapeHtml(formatDateTime(t.createdAt))}
          </p>

          ${t.firstReplyAt
            ? `
                <p style="font-size:.75rem;color:var(--ink-faint);">
                  First reply
                  ${escapeHtml(formatDateTime(t.firstReplyAt))}
                </p>
              `
            : ''}

        </div>

      </div>

      <h5 style="margin:14px 0 8px;">
        ${escapeHtml(t.subject)}
      </h5>

      <div class="ticket-thread">

        <div class="ticket-msg from-you">

          <span class="ticket-who">
            ${escapeHtml(t.name)}

            <time>
              ${escapeHtml(formatDateTime(t.createdAt))}
            </time>
          </span>

          <p>
            ${escapeHtml(t.message)}
          </p>

        </div>

        ${(t.replies || []).map(r => `
          <div
            class="ticket-msg ${r.fromStaff ? 'from-staff' : 'from-you'}"
          >

            <span class="ticket-who">

              ${escapeHtml(
                r.fromStaff
                  ? `${r.byName || 'Support'} · staff`
                  : t.name
              )}

              <time>
                ${escapeHtml(formatDateTime(r.at))}
              </time>

            </span>

            <p>
              ${escapeHtml(r.message)}
            </p>

          </div>
        `).join('')}

      </div>

      <div class="odp-forms">

        <form
          class="odp-form"
          data-tform="reply"
          data-id="${t.id}"
        >

          <h5>
            Reply
          </h5>

          <textarea
            class="mini-select"
            name="message"
            rows="4"
            required
            maxlength="4000"
            placeholder="Your answer to the customer…"
          ></textarea>

          <button
            class="btn btn-primary btn-sm"
            type="submit"
          >
            Send reply
          </button>

          <small class="pf-hint">
            A registered customer also gets this in their notifications.
            Replying moves an open ticket to “in progress”.
          </small>

        </form>

        <form
          class="odp-form"
          data-tform="status"
          data-id="${t.id}"
        >

          <h5>
            Set status
          </h5>

          <select
            class="mini-select"
            name="status"
          >
            ${SUPPORT_STATUSES.map(s => `
              <option
                value="${s}"
                ${s === t.status ? 'selected' : ''}
              >
                ${escapeHtml(titleCase(s))}
              </option>
            `).join('')}
          </select>

          <button
            class="btn btn-outline btn-sm"
            type="submit"
          >
            Update status
          </button>

        </form>

      </div>

    </div>`;
}

async function renderSupport(panel) {
  loading(
    panel,
    'Loading support tickets…'
  );

  const data =
    await supportApi.all(
      ticketStatusFilter ||
      undefined
    );

  allTickets =
    data.tickets ||
    [];

  const open =
    openTicketId
      ? allTickets.find(
          t =>
            t.id === openTicketId
        )
      : null;

  const counts =
    data.byStatus ||
    {};

  panel.innerHTML = `
    <div class="admin-top">

      <h3>
        Support desk
      </h3>

      <div class="admin-top-actions">

        <select
          class="mini-select"
          id="ticketFilter"
        >

          <option value="">
            All tickets
          </option>

          ${SUPPORT_STATUSES.map(s => `
            <option
              value="${s}"
              ${s === ticketStatusFilter ? 'selected' : ''}
            >
              ${escapeHtml(titleCase(s))}
              (${counts[s] || 0})
            </option>
          `).join('')}

        </select>

        <span style="font-size:.8rem;color:var(--ink-faint);">
          ${data.total || 0}
          total
        </span>

      </div>

    </div>

    <div class="stat-grid">

      ${SUPPORT_STATUSES.map(s => `
        <div class="stat-card${s === 'open' && counts.open ? ' warn' : ''}">
          <span>${escapeHtml(titleCase(s))}</span>
          <b>${counts[s] || 0}</b>
        </div>
      `).join('')}

    </div>

    ${open
      ? ticketDetailMarkup(open)
      : ''}

    ${!allTickets.length
      ? `
          <p style="color:var(--ink-muted);font-size:.9rem;">
            ${ticketStatusFilter
              ? 'No tickets with that status.'
              : 'No support tickets yet. Messages from the contact form land here.'}
          </p>
        `
      : `
          <div class="table-wrap">

            <table>

              <thead>
                <tr>
                  <th>Ref</th>
                  <th>From</th>
                  <th>Subject</th>
                  <th>About</th>
                  <th>Opened</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>

                ${allTickets.map(t => `
                  <tr
                    ${t.id === openTicketId ? 'class="row-open"' : ''}
                  >

                    <td>
                      <b>${escapeHtml(t.ref || shortId(t.id))}</b>
                    </td>

                    <td>
                      ${escapeHtml(t.name)}

                      <div style="font-size:.72rem;color:var(--ink-faint);">
                        ${escapeHtml(t.email)}
                      </div>
                    </td>

                    <td>
                      ${escapeHtml(t.subject)}

                      ${t.replies?.length
                        ? `
                            <div class="mini-flag">
                              ${t.replies.length}
                              repl${t.replies.length === 1 ? 'y' : 'ies'}
                            </div>
                          `
                        : ''}
                    </td>

                    <td>
                      ${escapeHtml(titleCase(t.category))}
                    </td>

                    <td>
                      ${formatDate(t.createdAt)}
                    </td>

                    <td>
                      <span class="status-pill ${statusClass(t.status)}">
                        ${escapeHtml(titleCase(t.status))}
                      </span>
                    </td>

                    <td>
                      <div class="row-actions">
                        <button
                          type="button"
                          data-tact="open"
                          data-id="${t.id}"
                        >
                          ${t.id === openTicketId ? 'Hide' : 'Open'}
                        </button>
                      </div>
                    </td>

                  </tr>
                `).join('')}

              </tbody>

            </table>

          </div>
        `}
  `;

  panel.querySelector('#ticketFilter')
    .addEventListener('change', (e) => {
      ticketStatusFilter =
        e.target.value;

      openTicketId = '';

      renderPanel();
    });

  // Bound once for the same reason as the order drawer above.
  if (!panel.dataset.ticketActionsBound) {
    panel.dataset.ticketActionsBound = '1';

    panel.addEventListener('click', (e) => {
      const btn =
        e.target.closest('[data-tact]');

      if (!btn) return;

      if (btn.dataset.tact === 'close') {
        openTicketId = '';
        renderPanel();
        return;
      }

      if (btn.dataset.tact === 'open') {
        openTicketId =
          openTicketId === btn.dataset.id
            ? ''
            : btn.dataset.id;

        renderPanel();
      }
    });
  }

  panel.querySelector('[data-tform="reply"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const message =
        e.target.message.value.trim();

      if (!message) return;

      const btn =
        e.target.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Sending…'
        );

      try {
        await supportApi.reply(
          e.target.dataset.id,
          message
        );

        toast(
          'Reply sent to the customer'
        );

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('[data-tform="status"]')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const btn =
        e.target.querySelector('button[type="submit"]');

      const done =
        fx.setBtnLoading(
          btn,
          'Saving…'
        );

      try {
        await supportApi.setStatus(
          e.target.dataset.id,
          e.target.status.value
        );

        toast(
          'Ticket updated'
        );

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });
}

/* ---------------- CMS pages ---------------- */

function pageEditorMarkup(page) {
  return `
    <form
      class="pf-form"
      id="pageForm"
      data-slug="${escapeHtml(page.slug)}"
    >

      <h4 style="margin-bottom:6px;">
        Editing /${escapeHtml(page.slug)}.html
      </h4>

      <p class="pf-hint" style="margin-bottom:14px;">
        ${page.saved
          ? `Saved version, last updated ${escapeHtml(formatDateTime(page.updatedAt))}${page.updatedByEmail ? ` by ${escapeHtml(page.updatedByEmail)}` : ''}.`
          : 'This page has never been edited — the fields below are pre-filled with the built-in copy. Saving takes over the page.'}
      </p>

      <div class="pf-grid wide">

        <label
          class="pf-label"
          for="pg-title"
        >
          Page title
        </label>

        <input
          class="mini-select"
          id="pg-title"
          name="title"
          value="${escapeHtml(page.title || '')}"
          required
          maxlength="160"
        >

      </div>

      <div class="pf-grid wide">

        <label
          class="pf-label"
          for="pg-intro"
        >
          Intro line
        </label>

        <textarea
          class="mini-select"
          id="pg-intro"
          name="intro"
          rows="2"
          maxlength="1000"
        >${escapeHtml(page.intro || '')}</textarea>

      </div>

      <div id="pageSections">
        ${(page.sections || []).map(
          (s, i) =>
            sectionRowMarkup(s, i)
        ).join('')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px;">

        <button
          class="btn btn-outline btn-sm"
          type="button"
          id="addSection"
        >
          + Add a section
        </button>

      </div>

      <label class="mini-check" style="margin-bottom:14px;">

        <input
          type="checkbox"
          name="published"
          ${page.published !== false ? 'checked' : ''}
        >

        Published — unpublish to fall back to the built-in copy
        without deleting your edits

      </label>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">

        <button
          class="btn btn-primary btn-sm"
          type="submit"
        >
          Save page
        </button>

        <a
          class="btn btn-ghost btn-sm"
          href="/${escapeHtml(page.slug)}.html"
          target="_blank"
          rel="noopener"
        >
          Preview ↗
        </a>

        ${page.saved
          ? `
              <button
                class="btn btn-ghost btn-sm"
                type="button"
                id="revertPage"
              >
                Revert to built-in copy
              </button>
            `
          : ''}

        <button
          class="btn btn-ghost btn-sm"
          type="button"
          id="cancelPage"
        >
          Close
        </button>

      </div>

    </form>`;
}

function sectionRowMarkup(s = {}, i = 0) {
  return `
    <div
      class="cms-section"
      data-index="${i}"
    >

      <div class="cms-section-top">

        <input
          class="mini-select"
          data-field="heading"
          placeholder="Section heading"
          value="${escapeHtml(s.heading || '')}"
          maxlength="160"
        >

        <button
          type="button"
          class="del"
          data-act="remove-section"
          aria-label="Remove section"
        >
          Remove
        </button>

      </div>

      <textarea
        class="mini-select"
        data-field="body"
        rows="4"
        placeholder="Body copy. Blank lines start a new paragraph."
      >${escapeHtml(s.body || '')}</textarea>

    </div>`;
}

async function renderPages(panel) {
  loading(
    panel,
    'Loading page content…'
  );

  const data =
    await pagesApi.all();

  cmsPages =
    data.pages ||
    [];

  const editing =
    editingSlug
      ? cmsPages.find(
          p =>
            p.slug === editingSlug
        )
      : null;

  panel.innerHTML = `
    <div class="admin-top">

      <h3>
        Content pages
      </h3>

      <span style="font-size:.8rem;color:var(--ink-faint);">
        ${cmsPages.filter(p => p.saved).length}
        of
        ${cmsPages.length}
        customised
      </span>

    </div>

    <p class="summary-note" style="margin-bottom:14px;">
      These edit the copy on the public pages.
      Until a page is saved here it shows the copy that ships with the site,
      so nothing can ever end up blank.
    </p>

    ${editing
      ? pageEditorMarkup(editing)
      : ''}

    <div class="table-wrap">

      <table>

        <thead>
          <tr>
            <th>Page</th>
            <th>Title</th>
            <th>Sections</th>
            <th>Source</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>

          ${cmsPages.map(p => `
            <tr
              ${p.slug === editingSlug ? 'class="row-open"' : ''}
            >

              <td class="mono">
                /${escapeHtml(p.slug)}.html
              </td>

              <td>
                ${escapeHtml(p.title)}
              </td>

              <td>
                ${p.sections?.length || 0}
              </td>

              <td>

                ${p.saved
                  ? `
                      <span
                        class="status-pill ${
                          p.published === false
                            ? 'status-pending'
                            : 'status-approved'
                        }"
                      >
                        ${p.published === false
                          ? 'Draft'
                          : 'Custom'}
                      </span>
                    `
                  : `
                      <span class="status-pill status-pending">
                        Built-in
                      </span>
                    `}

              </td>

              <td>
                ${p.updatedAt
                  ? formatDate(p.updatedAt)
                  : '—'}
              </td>

              <td>

                <div class="row-actions">

                  <button
                    type="button"
                    data-act="edit-page"
                    data-slug="${escapeHtml(p.slug)}"
                  >
                    ${p.slug === editingSlug
                      ? 'Close'
                      : 'Edit'}
                  </button>

                  <a
                    href="/${escapeHtml(p.slug)}.html"
                    target="_blank"
                    rel="noopener"
                  >
                    View ↗
                  </a>

                </div>

              </td>

            </tr>
          `).join('')}

        </tbody>

      </table>

    </div>`;

  panel.querySelector('tbody')
    .addEventListener('click', (e) => {
      const btn =
        e.target.closest(
          '[data-act="edit-page"]'
        );

      if (!btn) return;

      editingSlug =
        editingSlug === btn.dataset.slug
          ? ''
          : btn.dataset.slug;

      renderPanel();
    });

  if (!editing) return;

  const form =
    panel.querySelector('#pageForm');

  const sections =
    panel.querySelector('#pageSections');

  panel.querySelector('#addSection')
    .addEventListener('click', () => {
      sections.insertAdjacentHTML(
        'beforeend',
        sectionRowMarkup(
          {},
          sections.children.length
        )
      );
    });

  sections.addEventListener('click', (e) => {
    const btn =
      e.target.closest(
        '[data-act="remove-section"]'
      );

    if (!btn) return;

    btn.closest('.cms-section')
      ?.remove();
  });

  panel.querySelector('#cancelPage')
    .addEventListener('click', () => {
      editingSlug = '';
      renderPanel();
    });

  panel.querySelector('#revertPage')
    ?.addEventListener('click', async (e) => {
      if (!confirm(
        `Discard your edits to /${editing.slug}.html and go back to the built-in copy?`
      )) {
        return;
      }

      const done =
        fx.setBtnLoading(
          e.currentTarget,
          'Reverting…'
        );

      try {
        await pagesApi.revert(
          editing.slug
        );

        toast(
          'Page reverted to the built-in copy'
        );

        editingSlug = '';

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // NOT form.title — HTMLFormElement already owns a `title` property, so the
    // named-control lookup is shadowed and would hand back the title attribute.
    const titleInput =
      form.querySelector(
        '[name="title"]'
      );

    const payload = {
      title:
        titleInput.value.trim(),

      intro:
        form.querySelector(
          '[name="intro"]'
        ).value.trim(),

      published:
        form.querySelector(
          '[name="published"]'
        ).checked,

      sections:
        [...sections.querySelectorAll('.cms-section')]
          .map(row => ({
            heading:
              row.querySelector(
                '[data-field="heading"]'
              ).value.trim(),

            body:
              row.querySelector(
                '[data-field="body"]'
              ).value.trim(),
          }))
          .filter(
            s =>
              s.heading ||
              s.body
          ),
    };

    if (!payload.title) {
      toast(
        'A page title is required',
        'error'
      );
      return;
    }

    if (!payload.sections.length) {
      toast(
        'Add at least one section',
        'error'
      );
      return;
    }

    const btn =
      form.querySelector(
        'button[type="submit"]'
      );

    const done =
      fx.setBtnLoading(
        btn,
        'Saving…'
      );

    try {
      await pagesApi.save(
        form.dataset.slug,
        payload
      );

      toast(
        `/${form.dataset.slug}.html saved`
      );

      await renderPanel();
    } catch (err) {
      done();
      toast(err.message, 'error');
    }
  });
}

/* ---------------- platform settings ---------------- */

async function renderSettings(panel) {
  loading(
    panel,
    'Loading settings…'
  );

  const s =
    await settingsApi.get();

  panel.innerHTML = `
    <div class="admin-top">
      <h3>
        Platform settings
      </h3>
    </div>

    <form
      class="pf-form"
      id="settingsForm"
    >

      <h4>
        Storefront
      </h4>

      <div class="pf-grid">

        <div>
          <label class="pf-label" for="st-brand">
            Brand name
          </label>

          <input
            class="mini-select"
            id="st-brand"
            name="brandName"
            value="${escapeHtml(s.brandName || '')}"
            maxlength="60"
          >
        </div>

        <div>
          <label class="pf-label" for="st-code">
            Currency code
          </label>

          <input
            class="mini-select"
            id="st-code"
            name="currencyCode"
            value="${escapeHtml(s.currencyCode || '')}"
            maxlength="6"
          >
        </div>

        <div>
          <label class="pf-label" for="st-symbol">
            Currency symbol
          </label>

          <input
            class="mini-select"
            id="st-symbol"
            name="currencySymbol"
            value="${escapeHtml(s.currencySymbol || '')}"
            maxlength="4"
            required
          >
        </div>

      </div>

      <h4 style="margin-top:18px;">
        Fees
      </h4>

      <div class="pf-grid">

        <div>
          <label class="pf-label" for="st-delivery">
            Delivery fee
          </label>

          <input
            class="mini-select"
            id="st-delivery"
            name="deliveryFee"
            type="number"
            min="0"
            value="${Number(s.deliveryFee) || 0}"
          >
        </div>

        <div>
          <label class="pf-label" for="st-free">
            Free delivery over (0 = off)
          </label>

          <input
            class="mini-select"
            id="st-free"
            name="freeDeliveryThreshold"
            type="number"
            min="0"
            value="${Number(s.freeDeliveryThreshold) || 0}"
          >
        </div>

        <div>
          <label class="pf-label" for="st-protect">
            Damage protection (% of rent)
          </label>

          <input
            class="mini-select"
            id="st-protect"
            name="protectionFeePct"
            type="number"
            min="0"
            max="100"
            value="${Number(s.protectionFeePct) || 0}"
          >
        </div>

      </div>

      <small class="pf-hint">
        These price every new booking immediately.
        Existing orders keep the figures snapshotted when they were placed.
      </small>

      <h4 style="margin-top:18px;">
        Rentals &amp; stock
      </h4>

      <div class="pf-grid">

        <div>
          <label class="pf-label" for="st-min">
            Minimum rental days
          </label>

          <input
            class="mini-select"
            id="st-min"
            name="minRentalDays"
            type="number"
            min="1"
            value="${Number(s.minRentalDays) || 1}"
          >
        </div>

        <div>
          <label class="pf-label" for="st-max">
            Maximum rental days
          </label>

          <input
            class="mini-select"
            id="st-max"
            name="maxRentalDays"
            type="number"
            min="1"
            value="${Number(s.maxRentalDays) || 180}"
          >
        </div>

        <div>
          <label class="pf-label" for="st-low">
            Low-stock alert at
          </label>

          <input
            class="mini-select"
            id="st-low"
            name="lowStockThreshold"
            type="number"
            min="0"
            value="${Number(s.lowStockThreshold) || 0}"
          >
        </div>

      </div>

      <h4 style="margin-top:18px;">
        Payment methods offered
      </h4>

      <div class="pf-checks">

        ${Object.keys(PAYMENT_LABELS).map(m => `
          <label class="mini-check">

            <input
              type="checkbox"
              name="pay"
              value="${m}"
              ${s.paymentMethods?.includes(m) ? 'checked' : ''}
            >

            ${escapeHtml(paymentLabel(m))}

          </label>
        `).join('')}

      </div>

      <small class="pf-hint">
        Simulated gateways — at least one must stay enabled.
      </small>

      <h4 style="margin-top:18px;">
        Support &amp; availability
      </h4>

      <div class="pf-grid">

        <div>
          <label class="pf-label" for="st-email">
            Support email
          </label>

          <input
            class="mini-select"
            id="st-email"
            name="supportEmail"
            type="email"
            value="${escapeHtml(s.supportEmail || '')}"
          >
        </div>

      </div>

      <label
        class="mini-check"
        style="margin-top:10px;"
      >

        <input
          type="checkbox"
          name="maintenanceMode"
          ${s.maintenanceMode ? 'checked' : ''}
        >

        Maintenance mode — pause new bookings site-wide

      </label>

      <small class="pf-hint">
        Browsing and sign-in stay open; every other write is refused for non-admins.
        You keep full access so you can switch it back off.
      </small>

      <div style="margin-top:16px;">
        <button
          class="btn btn-primary btn-sm"
          type="submit"
        >
          Save settings
        </button>
      </div>

    </form>

    <form
      class="pf-form"
      id="broadcastForm"
      style="margin-top:26px;"
    >

      <h4>
        Send an announcement
      </h4>

      <p class="pf-hint" style="margin-bottom:12px;">
        Pushes a notification to every customer's bell.
        Use it for promotions, maintenance windows or policy changes.
      </p>

      <div class="pf-grid wide">

        <input
          class="mini-select"
          name="title"
          placeholder="Headline — e.g. 20% off weekly rentals this month"
          required
          maxlength="120"
        >

      </div>

      <div class="pf-grid wide">

        <textarea
          class="mini-select"
          name="message"
          rows="3"
          maxlength="500"
          placeholder="A sentence or two of detail (optional)"
        ></textarea>

      </div>

      <div class="pf-grid">

        <select
          class="mini-select"
          name="type"
        >
          <option value="promo">
            Promotion
          </option>

          <option value="system">
            System notice
          </option>

          <option value="account">
            Account notice
          </option>
        </select>

        <select
          class="mini-select"
          name="audience"
        >
          <option value="all">
            Every customer
          </option>

          <option value="admins">
            Administrators only
          </option>
        </select>

        <input
          class="mini-select"
          name="link"
          placeholder="Link (optional) — /products.html"
        >

      </div>

      <label
        class="protect-row"
        style="margin-top:14px;"
      >
        <input
          type="checkbox"
          name="emailPromotion"
        >

        <span>
          <b>Also email customers who opted in</b>
          <small>
            Available for Promotion announcements. Transactional emails are unaffected.
          </small>
        </span>
      </label>

      <div style="margin-top:14px;">
        <button
          class="btn btn-primary btn-sm"
          type="submit"
        >
          Send announcement
        </button>
      </div>

    </form>

    <div
      class="report-panel"
      style="margin-top:26px;"
    >

      <h4>
        Automated email
      </h4>

      <p style="font-size:.85rem;color:var(--ink-muted);">
        Order confirmations, password-reset links and support receipts are generated by
        <span class="mono">services/mailer.js</span>.
        With no <span class="mono">SMTP_URL</span>
        in the environment they are written to the server log instead of being sent,
        and the API reports <span class="mono">emailed: false</span>
        rather than pretending otherwise.
        To switch on real delivery:
        <span class="mono">npm i nodemailer</span>,
        then set <span class="mono">SMTP_URL</span>
        and <span class="mono">MAIL_FROM</span>.
        In-app notifications work either way.
      </p>

    </div>`;

  panel.querySelector('#settingsForm')
    .addEventListener('submit', async (e) => {
      e.preventDefault();

      const form =
        e.target;

      const payload = {
        brandName:
          form.brandName.value.trim(),

        currencyCode:
          form.currencyCode.value.trim(),

        currencySymbol:
          form.currencySymbol.value.trim(),

        deliveryFee:
          Number(form.deliveryFee.value),

        freeDeliveryThreshold:
          Number(form.freeDeliveryThreshold.value),

        protectionFeePct:
          Number(form.protectionFeePct.value),

        minRentalDays:
          Number(form.minRentalDays.value),

        maxRentalDays:
          Number(form.maxRentalDays.value),

        lowStockThreshold:
          Number(form.lowStockThreshold.value),

        supportEmail:
          form.supportEmail.value.trim(),

        maintenanceMode:
          form.maintenanceMode.checked,

        paymentMethods:
          [
            ...form.querySelectorAll(
              'input[name="pay"]:checked'
            ),
          ].map(
            i =>
              i.value
          ),
      };

      if (!payload.paymentMethods.length) {
        toast(
          'Keep at least one payment method enabled',
          'error'
        );

        return;
      }

      if (
        payload.minRentalDays >
        payload.maxRentalDays
      ) {
        toast(
          'Minimum rental days cannot exceed the maximum',
          'error'
        );

        return;
      }

      if (
        payload.maintenanceMode &&
        !confirm(
          'Turn on maintenance mode? Customers will not be able to book.'
        )
      ) {
        return;
      }

      const btn =
        form.querySelector(
          'button[type="submit"]'
        );

      const done =
        fx.setBtnLoading(
          btn,
          'Saving…'
        );

      try {
        await settingsApi.save(
          payload
        );

        // Repaint every price on the page with the new currency and fees.
        await loadSettings();

        toast(
          'Settings saved'
        );

        await renderPanel();
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });

  panel.querySelector('#broadcastForm')
    .addEventListener('submit', async (e) => {
      e.preventDefault();

      const form =
        e.target;

      const title =
        form.title.value.trim();

      if (!title) {
        toast(
          'An announcement needs a headline',
          'error'
        );

        return;
      }

      const audience =
        form.audience.value;

      if (!confirm(
        `Send "${title}" to ${audience === 'admins' ? 'all administrators' : 'every customer'}?`
      )) {
        return;
      }

      const btn =
        form.querySelector(
          'button[type="submit"]'
        );

      const done =
        fx.setBtnLoading(
          btn,
          'Sending…'
        );

      try {
        const res =
          await notificationsApi.broadcast({
            title,

            message:
              form.message.value.trim(),

            type:
              form.type.value,

            link:
              form.link.value.trim(),

            audience,

            emailPromotion:
              Boolean(
                form.emailPromotion
                  ?.checked
              ),
          });

        done();

        form.reset();

        const emailCopy =
          res.emailPromotion
            ? ` · promo email delivered to ${res.emailDelivered}/${res.emailRequested} opted-in customer${res.emailRequested === 1 ? '' : 's'}`
            : '';

        toast(
          `Announcement sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}${emailCopy}`
        );
      } catch (err) {
        done();
        toast(err.message, 'error');
      }
    });
}

/* ---------------- audit trail ---------------- */

const ACTION_LABEL = {
  'product.create': 'Device added',
  'product.update': 'Device edited',
  'product.stock': 'Stock adjusted',
  'product.delete': 'Device retired',
  'product.restore': 'Device restored',
  'order.status': 'Order status changed',
  'order.refund': 'Deposit refunded',
  'user.role': 'Role changed',
  'user.delete': 'Account deleted',
  'settings.update': 'Settings changed',
  'page.update': 'Page edited',
  'page.revert': 'Page reverted',
  'support.status': 'Ticket status changed',
  'support.reply': 'Ticket replied',
  'notification.broadcast': 'Announcement sent',
};

/** Render a details object as compact "field: from → to" lines. */
function detailsMarkup(details) {
  if (
    !details ||
    typeof details !== 'object'
  ) {
    return '';
  }

  const entries =
    Object.entries(details);

  if (!entries.length) {
    return '';
  }

  return `
    <div class="audit-details">

      ${entries.map(
        ([k, v]) => {
          if (
            v &&
            typeof v === 'object' &&
            'from' in v &&
            'to' in v
          ) {
            return `
              <span>
                <b>${escapeHtml(k)}</b>
                ${escapeHtml(String(v.from ?? '—'))}
                →
                ${escapeHtml(String(v.to ?? '—'))}
              </span>`;
          }

          const flat =
            typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);

          return `
            <span>
              <b>${escapeHtml(k)}</b>
              ${escapeHtml(flat.slice(0, 120))}
            </span>`;
        }
      ).join('')}

    </div>`;
}

async function renderAudit(panel) {
  loading(
    panel,
    'Loading audit trail…'
  );

  const data =
    await auditApi.list({
      action:
        auditFilter.action ||
        undefined,

      actor:
        auditFilter.actor ||
        undefined,

      page:
        auditFilter.page,

      limit:
        50,
    });

  panel.innerHTML = `
    <div class="admin-top">

      <h3>
        Audit trail
      </h3>

      <span style="font-size:.8rem;color:var(--ink-faint);">
        ${data.total}
        entr${data.total === 1 ? 'y' : 'ies'}
        ·
        page
        ${data.page}
        of
        ${data.pages}
      </span>

    </div>

    <div
      class="filter-panel"
      style="margin-bottom:16px;"
    >

      <div>
        <label for="auAction">
          Action
        </label>

        <select id="auAction">

          <option value="">
            All actions
          </option>

          ${data.actions.map(a => `
            <option
              value="${escapeHtml(a)}"
              ${a === auditFilter.action ? 'selected' : ''}
            >
              ${escapeHtml(ACTION_LABEL[a] || a)}
            </option>
          `).join('')}

        </select>
      </div>

      <div>
        <label for="auActor">
          Administrator
        </label>

        <select id="auActor">

          <option value="">
            Anyone
          </option>

          ${data.actors.map(a => `
            <option
              value="${escapeHtml(a)}"
              ${a === auditFilter.actor ? 'selected' : ''}
            >
              ${escapeHtml(a)}
            </option>
          `).join('')}

        </select>
      </div>

      <button
        class="clear-filter"
        id="auClear"
        type="button"
      >
        Clear
      </button>

    </div>

    ${!data.logs.length
      ? `
          <p style="color:var(--ink-muted);font-size:.9rem;">
            Nothing recorded yet.
            Every privileged write — a price edit, a status change,
            a role change, a settings save — is appended here as it happens.
          </p>
        `
      : `
          <div class="table-wrap">

            <table>

              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>

              <tbody>

                ${data.logs.map(l => `
                  <tr>

                    <td style="white-space:nowrap;">
                      ${escapeHtml(formatDateTime(l.createdAt))}
                    </td>

                    <td>
                      ${escapeHtml(l.userName || '—')}

                      <div
                        class="mono"
                        style="font-size:.7rem;color:var(--ink-faint);"
                      >
                        ${escapeHtml(l.userEmail || '')}
                      </div>
                    </td>

                    <td>
                      <span class="audit-action">
                        ${escapeHtml(ACTION_LABEL[l.action] || l.action)}
                      </span>

                      <div
                        class="mono"
                        style="font-size:.68rem;color:var(--ink-faint);"
                      >
                        ${escapeHtml(l.action)}
                      </div>
                    </td>

                    <td>
                      ${escapeHtml(l.targetLabel || '—')}

                      ${l.targetType
                        ? `
                            <div style="font-size:.7rem;color:var(--ink-faint);">
                              ${escapeHtml(l.targetType)}
                            </div>
                          `
                        : ''}
                    </td>

                    <td>
                      ${detailsMarkup(l.details)}
                    </td>

                  </tr>
                `).join('')}

              </tbody>

            </table>

          </div>

          ${data.pages > 1
            ? `
                <div class="pager">

                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    id="auPrev"
                    ${data.page <= 1 ? 'disabled' : ''}
                  >
                    ‹ Newer
                  </button>

                  <span>
                    Page
                    ${data.page}
                    of
                    ${data.pages}
                  </span>

                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    id="auNext"
                    ${data.page >= data.pages ? 'disabled' : ''}
                  >
                    Older ›
                  </button>

                </div>
              `
            : ''}
        `}

    <p class="summary-note" style="margin-top:14px;">
      Read-only by design —
      there is no endpoint that edits or deletes an entry.
    </p>`;

  panel.querySelector('#auAction')
    .addEventListener('change', (e) => {
      auditFilter = {
        ...auditFilter,
        action: e.target.value,
        page: 1,
      };

      renderPanel();
    });

  panel.querySelector('#auActor')
    .addEventListener('change', (e) => {
      auditFilter = {
        ...auditFilter,
        actor: e.target.value,
        page: 1,
      };

      renderPanel();
    });

  panel.querySelector('#auClear')
    .addEventListener('click', () => {
      auditFilter = {
        action: '',
        actor: '',
        page: 1,
      };

      renderPanel();
    });

  panel.querySelector('#auPrev')
    ?.addEventListener('click', () => {
      auditFilter = {
        ...auditFilter,

        page:
          Math.max(
            1,
            auditFilter.page -
            1
          ),
      };

      renderPanel();
    });

  panel.querySelector('#auNext')
    ?.addEventListener('click', () => {
      auditFilter = {
        ...auditFilter,
        page:
          auditFilter.page +
          1,
      };

      renderPanel();
    });
}

/* ---------------- reports ---------------- */

function barChart(rows, format = peso) {
  if (!rows.length) {
    return `
      <p style="font-size:.82rem;color:var(--ink-muted);">
        Not enough data yet.
      </p>`;
  }

  const max =
    Math.max(
      ...rows.map(r => r.value)
    ) ||
    1;

  return `
    <div class="bar-chart">

      ${rows.map(r => `
        <div class="chart-row">

          <label title="${escapeHtml(r.label)}">
            ${escapeHtml(r.label)}
          </label>

          <div class="chart-track">
            <div
              class="chart-fill"
              style="width:${Math.round((r.value / max) * 100)}%;"
            ></div>
          </div>

          <span class="chart-value">
            ${format(r.value)}
          </span>

        </div>
      `).join('')}

    </div>`;
}

const toRows =
  (
    obj,
    labeller = k => k
  ) =>
    Object.entries(obj || {})
      .map(
        ([k, value]) => ({
          label:
            labeller(k),

          value,
        })
      )
      .sort(
        (a, b) =>
          b.value -
          a.value
      );

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function periodSource(
  rep,
  period = reportPeriod
) {
  if (period === 'week') {
    return rep.byWeek;
  }

  if (period === 'year') {
    return rep.byYear;
  }

  return rep.byMonth;
}

function periodLabel(
  period,
  key
) {
  if (period === 'month') {
    const [
      y,
      m,
    ] =
      String(key).split('-');

    return `${MONTH_ABBR[Number(m) - 1] || m} ${y}`;
  }

  if (period === 'week') {
    return String(key).replace(
      '-W',
      ' W'
    );
  }

  return String(key);
}

const toTimeRows =
  (
    obj,
    period
  ) =>
    Object.entries(obj || {})
      .sort(
        ([a], [b]) =>
          a < b
            ? -1
            : a > b
              ? 1
              : 0
      )
      .slice(-12)
      .map(
        ([k, value]) => ({
          label:
            periodLabel(
              period,
              k
            ),

          value,
        })
      );

async function renderReports(panel) {
  loading(
    panel,
    'Building reports…'
  );

  const rep =
    await ordersApi.reports();

  panel.innerHTML = `
    <div class="admin-top">
      <h3>
        Reports
      </h3>
    </div>

    <div class="stat-grid">

      <div class="stat-card">
        <span>Rental revenue</span>
        <b>${peso(rep.revenue)}</b>
      </div>

      <div class="stat-card">
        <span>Bookings</span>
        <b>${rep.orderCount}</b>
      </div>

      <div class="stat-card">
        <span>Active rentals</span>
        <b>${rep.activeRentals}</b>
      </div>

      <div class="stat-card">
        <span>Deposits held</span>
        <b>${peso(rep.depositsHeld)}</b>
      </div>

    </div>

    <div class="stat-grid">

      <div class="stat-card">
        <span>Customers</span>
        <b>${rep.customers}</b>
      </div>

      <div class="stat-card">
        <span>Average booking</span>
        <b>${peso(rep.avgOrderValue)}</b>
      </div>

      <div class="stat-card">
        <span>Protection income</span>
        <b>${peso(rep.protectionRevenue)}</b>
      </div>

      <div class="stat-card">
        <span>Deposits refunded</span>
        <b>${peso(rep.depositsRefunded)}</b>
      </div>

    </div>

    <p class="summary-note" style="margin-bottom:18px;">
      Revenue counts rent, delivery and protection.
      Deposits are held on the customer's behalf,
      so they are reported separately and never as income
      ${rep.depositsWithheld
        ? `— ${peso(rep.depositsWithheld)} has been withheld for damage across all returns.`
        : '.'}
    </p>

    <div
      class="report-panel"
      style="margin-bottom:18px;"
    >

      <div
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
          flex-wrap:wrap;
          margin-bottom:16px;
        "
      >

        <h4 style="margin:0;">
          Revenue over time
        </h4>

        <div
          class="period-toggle"
          id="periodToggle"
        >

          ${[
            'week',
            'month',
            'year',
          ].map(pd => `
            <button
              type="button"
              data-period="${pd}"
              ${pd === reportPeriod ? 'class="active"' : ''}
            >
              ${titleCase(pd)}
            </button>
          `).join('')}

        </div>

      </div>

      <div id="periodChart">
        ${barChart(
          toTimeRows(
            periodSource(rep),
            reportPeriod
          )
        )}
      </div>

    </div>

    <div class="report-grid">

      <div class="report-panel">
        <h4>
          Top devices by revenue
        </h4>

        ${barChart(
          toRows(rep.byDevice)
            .slice(
              0,
              6
            )
        )}
      </div>

      <div class="report-panel">
        <h4>
          Revenue by category
        </h4>

        ${barChart(
          toRows(
            rep.byCategory,
            catLabel
          )
        )}
      </div>

      <div class="report-panel">
        <h4>
          Top customers by spend
        </h4>

        ${barChart(
          toRows(rep.byCustomer)
            .slice(
              0,
              6
            )
        )}
      </div>

      <div class="report-panel">
        <h4>
          Bookings by status
        </h4>

        ${barChart(
          toRows(
            rep.byStatus,
            titleCase
          ),
          n =>
            String(n)
        )}
      </div>

      <div class="report-panel">
        <h4>
          Catalog by condition
        </h4>

        ${barChart(
          toRows(rep.byGrade),
          n =>
            `${n} device${n === 1 ? '' : 's'}`
        )}
      </div>

      <div class="report-panel">
        <h4>
          Fleet
        </h4>

        ${barChart(
          [
            {
              label: 'On shelf',
              value: rep.unitsOnShelf,
            },

            {
              label: 'Rented out',
              value: rep.unitsRentedOut,
            },

            {
              label: 'Low stock',
              value: rep.lowStock,
            },

            {
              label: 'Out of stock',
              value: rep.outOfStock,
            },
          ],
          n =>
            `${n} unit${n === 1 ? '' : 's'}`
        )}
      </div>

    </div>`;

  panel.querySelector('#periodToggle')
    .addEventListener('click', (e) => {
      const btn =
        e.target.closest('[data-period]');

      if (!btn) return;

      reportPeriod =
        btn.dataset.period;

      panel.querySelectorAll('#periodToggle button')
        .forEach(
          b =>
            b.classList.toggle(
              'active',
              b === btn
            )
        );

      panel.querySelector('#periodChart')
        .innerHTML =
          barChart(
            toTimeRows(
              periodSource(rep),
              reportPeriod
            )
          );
    });
}

bootPage('admin', renderShell);