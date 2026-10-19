// ============================================================
// DiaLux — core/ui.js
// Formatters, toasts, shared header/footer, the notification bell,
// and the scroll-reveal observer. Every page imports from here so the
// chrome is defined once instead of being copy-pasted into each HTML file.
// ============================================================

import {
  state, cartCount, wishlistCount, currencySymbol,
  markNotificationRead, markAllNotificationsRead,
  dismissNotification, clearNotifications, refreshNotifications,
} from './state.js';
import {
  browserNotificationState, enableBrowserNotifications, disableBrowserNotifications,
} from './browser-notifications.js';

/* ---------------- formatters ---------------- */

/**
 * Money. The symbol comes from platform settings, so switching currency in
 * the admin dashboard reprices every label on the site.
 */
export function peso(n) {
  return `${currencySymbol()}${Math.round(Number(n) || 0).toLocaleString('en-PH')}`;
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>'"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]
  ));
}

export function formatDate(v) {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';

  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "3 minutes ago" — used by the notification list. */
export function timeAgo(v) {
  const then = new Date(v).getTime();
  if (Number.isNaN(then)) return '';

  const secs = Math.round((Date.now() - then) / 1000);

  if (secs < 60) return 'just now';

  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatDate(v);
}

export function titleCase(s = '') {
  return String(s)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* Human labels for the simulated payment methods. Which of these are offered
   is a platform setting, so both checkout screens read the list from
   state.settings.paymentMethods and label them through here. */

export const PAYMENT_LABELS = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Credit / debit card',
  cash: 'Cash on delivery',
  'bank-transfer': 'Bank transfer',
};

/** One-line blurb per method, used by the checkout payment-method cards. */
export const PAYMENT_BLURBS = {
  gcash: 'Pay with your GCash balance — redirects to GCash to confirm.',
  maya: 'Pay with your Maya wallet — redirects to Maya to confirm.',
  card: 'Visa, Mastercard, or JCB — secured by PayMongo, no card details touch our servers.',
  cash: 'Pay the courier when your device arrives. Booking stays pending until then.',
  'bank-transfer': 'Transfer manually, then upload your proof. An admin verifies it by hand.',
};

export function paymentLabel(m) {
  return PAYMENT_LABELS[m] || titleCase(m || '');
}

/** <option> list for the enabled payment methods. */
export function paymentOptions(selected) {
  const methods = state.settings?.paymentMethods?.length
    ? state.settings.paymentMethods
    : Object.keys(PAYMENT_LABELS);

  return methods
    .map(m =>
      `<option value="${m}"${m === selected ? ' selected' : ''}>${escapeHtml(paymentLabel(m))}</option>`
    )
    .join('');
}

/** One-line rendering of a saved address. */
export function addressLine(a) {
  if (!a) return '';
  return [a.address, a.city, a.zip]
    .filter(Boolean)
    .join(', ');
}

/** Turn newline-separated CMS copy into paragraphs, escaped. */
export function paragraphs(text = '') {
  return String(text)
    .split(/\n+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => `<p>${escapeHtml(t)}</p>`)
    .join('');
}

/* ---------------- device iconography ---------------- */

export const icons = {
  phone:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="18.4" r="1" fill="currentColor"/></svg>',

  tablet:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2.5" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="18" r="0.8" fill="currentColor"/></svg>',

  laptop:
    '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="11" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M2 19h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',

  wifi:
    '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9a13 13 0 0 1 16 0M7 12.5a8.5 8.5 0 0 1 10 0M10 16a4 4 0 0 1 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/></svg>',
};

export const catLabels = {
  phone: 'Smartphone',
  tablet: 'Tablet',
  laptop: 'Laptop',
  wifi: 'Portable Wi-Fi',
};

export function catLabel(c) {
  return catLabels[c] || c;
}

export function categoryIcon(cat) {
  return icons[cat] || icons.phone;
}

export function gradeClass(g) {
  return g === 'Like New'
    ? 'tag-a'
    : g === 'Good'
      ? 'tag-b'
      : 'tag-c';
}

export function statusClass(status) {
  return `status-${String(status || 'pending').toLowerCase()}`;
}

export function stockLine(stock) {
  const low =
    Number(
      state.settings?.lowStockThreshold ??
      2
    );

  if (stock === 0) {
    return '<div class="stock-line out">Out of stock</div>';
  }

  if (stock <= low) {
    return `<div class="stock-line low">Only ${stock} left</div>`;
  }

  return `<div class="stock-line">${stock} available</div>`;
}

/* ---------------- toast ---------------- */

export function toast(msg, kind = 'ok') {
  const box =
    document.getElementById('toast');

  if (!box) {
    console.log('[toast]', msg);
    return;
  }

  const el =
    document.createElement('div');

  el.className =
    'toast-item';

  el.setAttribute(
    'role',
    'status'
  );

  const mark =
    kind === 'error'
      ? '<path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/>'
      : '<path d="M5 12l4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

  el.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" style="${kind === 'error' ? 'color:#D14343' : ''}">${mark}</svg>${escapeHtml(msg)}`;

  box.appendChild(el);

  setTimeout(() => {
    el.style.transition =
      'all .25s';

    el.style.opacity =
      '0';

    el.style.transform =
      'translateX(20px)';

    setTimeout(
      () => el.remove(),
      250
    );
  }, 2600);
}

/* ---------------- empty state ---------------- */

export function emptyState(
  title,
  body = '',
  action = ''
) {
  return `
    <div class="empty-state">

      <svg viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="6"
          width="18"
          height="13"
          rx="2"
          stroke="currentColor"
          stroke-width="1.5"
        />

        <path
          d="M3 10h18M8 3v4"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>

      <h3 style="margin-bottom:8px;">
        ${escapeHtml(title)}
      </h3>

      ${
        body
          ? `
            <p style="max-width:420px;margin:0 auto 18px;">
              ${escapeHtml(body)}
            </p>
          `
          : ''
      }

      ${action}

    </div>
  `;
}

/* ---------------- product image fallback ----------------
   A product's photo may be missing or its host may be unreachable.
   Rather than show a broken-image glyph, swap in the category icon.
--------------------------------------------------------- */

export function bindImageFallbacks(
  root = document
) {
  root
    .querySelectorAll(
      'img[data-cat]:not([data-fallback-bound])'
    )
    .forEach(img => {
      img.dataset.fallbackBound =
        '1';

      img.addEventListener(
        'error',
        () => {
          const holder =
            img.parentElement;

          if (!holder) {
            return;
          }

          holder.classList.add(
            'thumb-fallback'
          );

          holder.innerHTML =
            categoryIcon(
              img.dataset.cat
            );
        },
        {
          once: true,
        }
      );
    });
}

/* ---------------- scroll reveal ----------------
   styles.css defines .reveal { opacity:0 } and .reveal.in
   { opacity:1 } but nothing ever added .in — so every element
   marked .reveal stayed permanently invisible. This supplies
   the missing observer.
--------------------------------------------------------- */

const prefersReducedMotion =
  () =>
    window
      .matchMedia(
        '(prefers-reduced-motion: reduce)'
      )
      .matches;

export function initReveal(
  selector = '.reveal'
) {
  const els =
    [
      ...document
        .querySelectorAll(
          selector
        ),
    ].filter(
      el =>
        !el.dataset.revealBound
    );

  if (!els.length) {
    return;
  }

  if (
    prefersReducedMotion() ||
    !(
      'IntersectionObserver' in
      window
    )
  ) {
    els.forEach(el => {
      el.dataset.revealBound =
        '1';

      el.classList.add(
        'in'
      );
    });

    return;
  }

  const io =
    new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) {
            return;
          }

          e.target.classList.add(
            'in'
          );

          io.unobserve(
            e.target
          );
        });
      },
      {
        threshold: 0.08,
        rootMargin:
          '0px 0px -8% 0px',
      }
    );

  els.forEach(el => {
    el.dataset.revealBound =
      '1';

    io.observe(el);
  });
}

/* ---------------- shared chrome ----------------
   Injected into #siteHeader / #siteFooter on every page. Keeps
   the nav, account menu, wishlist, notification bell and cart badge
   identical everywhere and guarantees #acctBtn exists — its absence used
   to throw a TypeError and abort init on admin.html and profile.html.

   The dashboard link is added dynamically once the session settles,
   so only admins ever see it — non-admin users get a clean nav with
   no hint that an admin area exists.
--------------------------------------------------------- */

/*
 * Workspace information for each staff account.
 *
 * Customer accounts do not use this map.
 */
export const ROLE_NAV = {
  admin: {
    href: '/admin.html',
    nav: 'Dashboard',
    menu: 'Admin dashboard',
    badge: 'Admin',
    page: 'admin',
  },

  rider: {
    href: '/rider.html',
    nav: 'Rider Dashboard',
    menu: 'Rider dashboard',
    badge: 'Rider',
    page: 'rider',
  },

  technician: {
    href: '/technician.html',
    nav: 'Technician Dashboard',
    menu: 'Technician dashboard',
    badge: 'Technician',
    page: 'technician',
  },
};

/**
 * Role-aware chrome.
 *
 * Customer:
 * Home / Devices / Wishlist / Cart / Profile
 *
 * Admin:
 * Admin workspace navigation
 *
 * Rider:
 * Rider dashboard only
 *
 * Technician:
 * Technician dashboard only
 */
function syncAdminNav() {
  const role =
    state.user?.role;

  const cfg =
    ROLE_NAV[role];

  const staffAccount =
    Boolean(role) &&
    role !== 'user';

  /*
   * Once the session is known, replace the customer storefront
   * navigation with the correct staff workspace navigation.
   */
  const staffNav = {
    admin: [
      {
        href:
          '/admin.html',
        label:
          'Dashboard',
      },

      {
        href:
          '/admin.html#orders',
        label:
          'Orders',
      },

      {
        href:
          '/admin.html#inventory',
        label:
          'Inventory',
      },

      {
        href:
          '/admin.html#users',
        label:
          'Users',
      },

      {
        href:
          '/admin.html#riders',
        label:
          'Riders',
      },

      {
        href:
          '/admin.html#reports',
        label:
          'Reports',
      },
    ],

    rider: [
      {
        href:
          '/rider.html',
        label:
          'My Deliveries',
      },
    ],

    technician: [
      {
        href:
          '/technician.html',
        label:
          'Technician Dashboard',
      },
    ],
  };

  const links =
    staffNav[role] ||
    NAV;

  document
    .querySelectorAll(
      '.nav-links'
    )
    .forEach(list => {
      list.innerHTML =
        links
          .map(item => {
            const [
              path,
              hash = '',
            ] =
              item.href.split(
                '#'
              );

            const samePath =
              location.pathname ===
                path ||
              (
                path === '/' &&
                location.pathname ===
                  '/index.html'
              );

            const active =
              samePath &&
              (
                !hash ||
                location.hash ===
                  `#${hash}`
              );

            return `
              <li>
                <a
                  href="${item.href}"
                  ${
                    active
                      ? 'class="active"'
                      : ''
                  }
                >
                  ${item.label}
                </a>
              </li>
            `;
          })
          .join('');
    });

  /*
   * Staff logo always returns to its own dashboard.
   */
  document
    .querySelectorAll(
      'header a.logo[href]'
    )
    .forEach(logo => {
      logo.href =
        cfg?.href ||
        '/';

      logo.setAttribute(
        'aria-label',
        cfg?.badge
          ? `${cfg.badge} dashboard`
          : 'DiaLux home'
      );
    });

  /*
   * Remove customer shopping buttons from staff accounts.
   *
   * Keep:
   * - notifications
   * - account control
   *
   * Hide:
   * - wishlist
   * - cart
   */
  document
    .querySelectorAll(
      '.nav-right a[href="/wishlist.html"], ' +
      '.nav-right a[href="/cart.html"]'
    )
    .forEach(el => {
      el.style.display =
        staffAccount
          ? 'none'
          : '';
    });

  /*
   * Account dropdown.
   */
  const menu =
    document.getElementById(
      'acctMenu'
    );

  if (menu) {
    menu
      .querySelector(
        '.menu-admin'
      )
      ?.remove();

    menu
      .querySelector(
        '.role-badge'
      )
      ?.remove();

    /*
     * Remove customer account shortcuts from staff accounts.
     */
    menu
      .querySelectorAll(
        'a[href="/profile.html"], ' +
        'a[href="/profile.html#orders"], ' +
        'a[href="/wishlist.html"], ' +
        'a[href="/profile.html#support"]'
      )
      .forEach(el => {
        el.style.display =
          staffAccount
            ? 'none'
            : '';
      });

    /*
     * Staff role badge.
     */
    if (
      cfg?.badge
    ) {
      const badge =
        document.createElement(
          'div'
        );

      badge.className =
        `role-badge role-${role}`;

      badge.textContent =
        cfg.badge;

      menu.insertBefore(
        badge,
        menu.firstChild
      );
    }

    /*
     * Dashboard shortcut inside account dropdown.
     */
    if (
      cfg?.href
    ) {
      const a =
        document.createElement(
          'a'
        );

      a.className =
        'menu-admin';

      a.href =
        cfg.href;

      a.textContent =
        cfg.menu;

      menu.insertBefore(
        a,
        menu.querySelector(
          '#signOutBtn'
        )
      );
    }
  }

  /*
   * Do not let the footer re-introduce customer shopping
   * shortcuts for staff accounts.
   */
  document
    .querySelectorAll(
      'footer a[href="/products.html"], ' +
      'footer a[href="/wishlist.html"], ' +
      'footer a[href="/cart.html"], ' +
      'footer a[href="/profile.html"]'
    )
    .forEach(el => {
      el.style.display =
        staffAccount
          ? 'none'
          : '';
    });
}

/*
 * Customer-facing navigation.
 *
 * Staff navigation is swapped in after the session loads.
 */
const NAV = [
  {
    href: '/',
    page: 'home',
    label: 'Home',
  },

  {
    href: '/products.html',
    page: 'products',
    label: 'Devices',
  },

  {
    href: '/wishlist.html',
    page: 'wishlist',
    label: 'Wishlist',
  },

  {
    href: '/cart.html',
    page: 'cart',
    label: 'Cart',
  },

  {
    href: '/profile.html',
    page: 'profile',
    label: 'Profile',
  },
];

const LOGO_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="18.4" r="1.2" fill="currentColor"/></svg>';

const BELL_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M18 8.4a6 6 0 1 0-12 0c0 5.2-2 6.6-2 6.6h16s-2-1.4-2-6.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.7 19a2 2 0 0 1-3.4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const HEART_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M12 20s-7-4.3-7-9.3A4.2 4.2 0 0 1 12 7.8a4.2 4.2 0 0 1 7 2.9c0 5-7 9.3-7 9.3Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CART_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.3L21 8H6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="20" r="1.3" fill="currentColor"/><circle cx="17" cy="20" r="1.3" fill="currentColor"/></svg>';

const MENU_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function headerMarkup(active) {
  const links =
    NAV
      .map(
        n => `
          <li>
            <a
              href="${n.href}"
              ${
                n.page === active
                  ? 'class="active"'
                  : ''
              }
            >
              ${n.label}
            </a>
          </li>
        `
      )
      .join('');

  return `
    <header class="glass-nav">

      <nav class="container">

        <button
          type="button"
          class="icon-btn nav-toggle"
          id="navToggle"
          aria-label="Open menu"
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls="mobileDrawer"
        >
          ${MENU_SVG}
        </button>

        <a
          class="logo"
          href="/"
          aria-label="DiaLux home"
        >
          <img
            class="logo-img"
            src="/assets/dialux-logo.png"
            alt="DiaLux — Phone Rental"
          >
        </a>

        <ul class="nav-links">
          ${links}
        </ul>

        <div class="nav-right">

          <a
            class="icon-btn"
            href="/wishlist.html"
            aria-label="Wishlist"
            title="Wishlist"
          >
            ${HEART_SVG}

            <span
              class="badge"
              id="wishBadge"
            >
              0
            </span>
          </a>

          <div class="notif-wrap">

            <button
              type="button"
              class="icon-btn"
              id="notifBtn"
              aria-label="Notifications"
              aria-haspopup="true"
              aria-expanded="false"
              title="Notifications"
            >
              ${BELL_SVG}

              <span
                class="badge"
                id="notifBadge"
              >
                0
              </span>
            </button>

            <div
              class="notif-menu"
              id="notifMenu"
              role="menu"
              aria-label="Notifications"
            >

              <div class="notif-head">

                <b>
                  Notifications
                </b>

                <div class="notif-head-actions">

                  <button
                    type="button"
                    id="notifBrowserAlerts"
                  >
                    Browser alerts
                  </button>

                  <button
                    type="button"
                    id="notifReadAll"
                  >
                    Mark all read
                  </button>

                  <button
                    type="button"
                    id="notifClear"
                  >
                    Clear
                  </button>

                </div>

              </div>

              <div
                class="notif-list"
                id="notifList"
              ></div>

            </div>

          </div>

          <a
            class="icon-btn"
            href="/cart.html"
            aria-label="Cart"
            title="Cart"
          >
            ${CART_SVG}

            <span
              class="badge"
              id="cartBadge"
            >
              0
            </span>
          </a>

          <div class="acct-wrap">

            <button
              id="acctBtn"
              class="acct-btn"
              aria-haspopup="true"
              aria-expanded="false"
            >
              Sign in
            </button>

            <div
              id="acctMenu"
              class="acct-menu"
            >

              <a href="/profile.html">
                My account
              </a>

              <a href="/profile.html#orders">
                My rentals
              </a>

              <a href="/wishlist.html">
                My wishlist
              </a>

              <a href="/profile.html#support">
                Support requests
              </a>

              <button
                type="button"
                id="signOutBtn"
              >
                Sign out
              </button>

            </div>

          </div>

        </div>

      </nav>

    </header>

    <div
      class="drawer-scrim"
      id="drawerScrim"
    ></div>

    <aside
      class="mobile-drawer"
      id="mobileDrawer"
      aria-hidden="true"
    >

      <div class="drawer-head">

        <img
          class="logo-img"
          src="/assets/dialux-logo.png"
          alt="DiaLux — Phone Rental"
        >

        <button
          type="button"
          class="icon-btn"
          id="drawerClose"
          aria-label="Close menu"
        >
          ${CLOSE_SVG}
        </button>

      </div>

      <ul class="nav-links drawer-links">
        ${links}
      </ul>

    </aside>
  `;
}

function footerMarkup() {
  const year =
    new Date()
      .getFullYear();

  return `
    <footer>

      <div class="container footer-grid">

        <div class="footer-brand">

          <div class="logo">
            <img
              class="logo-img"
              src="/assets/dialux-logo.png"
              alt="DiaLux — Phone Rental"
            >
          </div>

          <p>
            On-demand tech rentals — smartphones, tablets,
            laptops &amp; pocket Wi-Fi.
          </p>

        </div>

        <div class="footer-col">

          <h5>
            Platform
          </h5>

          <a href="/products.html">
            Devices
          </a>

          <a href="/wishlist.html">
            Wishlist
          </a>

          <a href="/cart.html">
            Cart
          </a>

          <a href="/profile.html">
            My account
          </a>

        </div>

        <div class="footer-col">

          <h5>
            Company
          </h5>

          <a href="/about.html">
            About
          </a>

          <a href="/team.html">
            Team
          </a>

          <a href="/contact.html">
            Contact
          </a>

        </div>

        <div class="footer-col">

          <h5>
            Support
          </h5>

          <a href="/help.html">
            Help center
          </a>

          <a href="/terms.html">
            Terms
          </a>

          <a href="/privacy.html">
            Privacy
          </a>

        </div>

      </div>

      <div class="footer-bottom">

        <span>
          © ${year} DiaLux · A student project for IT 009 · TIP QC
        </span>

      </div>

    </footer>
  `;
}

/** Render header + footer into their mount points. */
export function mountChrome(active) {
  const h =
    document.getElementById(
      'siteHeader'
    );

  const f =
    document.getElementById(
      'siteFooter'
    );

  if (h) {
    h.innerHTML =
      headerMarkup(active);
  }

  if (f) {
    f.innerHTML =
      footerMarkup();
  }

  initNotificationMenu();
  initMobileDrawer();

  updateCartBadge();
  updateWishBadge();

  renderMaintenanceNotice();
}

/**
 * Reflect the signed-in role in the nav — call after the session
 * settles (restoreSession) and again after login/logout, since the
 * header is already mounted by then.
 */
export function refreshChrome() {
  syncAdminNav();

  updateCartBadge();
  updateWishBadge();

  renderNotifications();
}

/* ---------------- badges ---------------- */

function setBadge(id, n) {
  const badge =
    document.getElementById(
      id
    );

  if (!badge) {
    return;
  }

  badge.textContent =
    n > 99
      ? '99+'
      : String(n);

  badge.style.display =
    n
      ? ''
      : 'none';
}

export function updateCartBadge() {
  setBadge(
    'cartBadge',
    cartCount()
  );
}

export function updateWishBadge() {
  setBadge(
    'wishBadge',
    wishlistCount()
  );
}

/* ---------------- notification bell ---------------- */

const NOTIF_ICON = {
  order: '📦',
  payment: '💳',
  status: '🚚',
  return: '↩️',
  refund: '💰',
  account: '👤',
  support: '💬',
  promo: '✨',
  system: '🔔',
};

function notificationRow(n) {
  return `
    <div
      class="notif-item${n.read ? '' : ' unread'}"
      data-id="${escapeHtml(n.id)}"
    >

      <span
        class="notif-icon"
        aria-hidden="true"
      >
        ${NOTIF_ICON[n.type] || NOTIF_ICON.system}
      </span>

      <div class="notif-body">

        ${
          n.link
            ? `
              <a
                class="notif-title"
                href="${escapeHtml(n.link)}"
                data-act="open"
              >
                ${escapeHtml(n.title)}
              </a>
            `
            : `
              <span class="notif-title">
                ${escapeHtml(n.title)}
              </span>
            `
        }

        ${
          n.message
            ? `
              <p>
                ${escapeHtml(n.message)}
              </p>
            `
            : ''
        }

        <time>
          ${escapeHtml(timeAgo(n.createdAt))}
        </time>

      </div>

      <button
        type="button"
        class="notif-x"
        data-act="dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>

    </div>
  `;
}

/** Paint the bell badge and the dropdown list from state. */
export function renderNotifications() {
  setBadge(
    'notifBadge',
    state.unread ||
    0
  );

  const list =
    document.getElementById(
      'notifList'
    );

  if (!list) {
    return;
  }

  const alertBtn =
    document.getElementById(
      'notifBrowserAlerts'
    );

  if (alertBtn) {
    const alertState =
      browserNotificationState();

    alertBtn.textContent =
      alertState === 'enabled'
        ? 'Alerts on'
        : alertState === 'denied'
          ? 'Alerts blocked'
          : alertState === 'unsupported'
            ? 'Alerts unavailable'
            : 'Enable alerts';

    alertBtn.disabled =
      alertState ===
      'unsupported';
  }

  if (!state.user) {
    list.innerHTML = `
      <div class="notif-empty">

        <p>
          Sign in to see updates about your bookings.
        </p>

        <a
          class="btn btn-primary btn-sm"
          href="/index.html#auth"
        >
          Sign in
        </a>

      </div>
    `;

    return;
  }

  if (!state.notifications.length) {
    list.innerHTML = `
      <div class="notif-empty">
        <p>
          Nothing here yet. Booking updates will appear here.
        </p>
      </div>
    `;

    return;
  }

  list.innerHTML =
    state.notifications
      .map(notificationRow)
      .join('');
}

function closeNotifMenu() {
  document
    .getElementById(
      'notifMenu'
    )
    ?.classList.remove(
      'open'
    );

  document
    .getElementById(
      'notifBtn'
    )
    ?.setAttribute(
      'aria-expanded',
      'false'
    );
}

/* ---------------- mobile drawer nav ---------------- */

function initMobileDrawer() {
  const toggle =
    document.getElementById(
      'navToggle'
    );

  const drawer =
    document.getElementById(
      'mobileDrawer'
    );

  const scrim =
    document.getElementById(
      'drawerScrim'
    );

  const closeBtn =
    document.getElementById(
      'drawerClose'
    );

  if (
    !toggle ||
    !drawer ||
    !scrim ||
    toggle.dataset.bound
  ) {
    return;
  }

  toggle.dataset.bound =
    '1';

  const setOpen =
    open => {
      drawer.classList.toggle(
        'open',
        open
      );

      scrim.classList.toggle(
        'open',
        open
      );

      drawer.setAttribute(
        'aria-hidden',
        open
          ? 'false'
          : 'true'
      );

      toggle.setAttribute(
        'aria-expanded',
        open
          ? 'true'
          : 'false'
      );

      document.body.classList.toggle(
        'drawer-locked',
        open
      );
    };

  toggle.addEventListener(
    'click',
    () =>
      setOpen(
        !drawer.classList.contains(
          'open'
        )
      )
  );

  closeBtn
    ?.addEventListener(
      'click',
      () =>
        setOpen(false)
    );

  scrim.addEventListener(
    'click',
    () =>
      setOpen(false)
  );

  drawer.addEventListener(
    'click',
    e => {
      if (
        e.target.closest(
          'a'
        )
      ) {
        setOpen(false);
      }
    }
  );

  document.addEventListener(
    'keydown',
    e => {
      if (
        e.key ===
          'Escape' &&
        drawer.classList.contains(
          'open'
        )
      ) {
        setOpen(false);
      }
    }
  );

  window.addEventListener(
    'resize',
    () => {
      if (
        window.innerWidth >
          900 &&
        drawer.classList.contains(
          'open'
        )
      ) {
        setOpen(false);
      }
    }
  );
}

function initNotificationMenu() {
  const btn =
    document.getElementById(
      'notifBtn'
    );

  const menu =
    document.getElementById(
      'notifMenu'
    );

  if (
    !btn ||
    !menu ||
    btn.dataset.bound
  ) {
    return;
  }

  btn.dataset.bound =
    '1';

  btn.addEventListener(
    'click',
    async e => {
      e.stopPropagation();

      const open =
        menu.classList.toggle(
          'open'
        );

      btn.setAttribute(
        'aria-expanded',
        open
          ? 'true'
          : 'false'
      );

      if (
        open &&
        state.user
      ) {
        await refreshNotifications();

        renderNotifications();
      }
    }
  );

  menu.addEventListener(
    'click',
    async e => {
      const row =
        e.target.closest(
          '.notif-item'
        );

      const act =
        e.target
          .closest(
            '[data-act]'
          )
          ?.dataset.act;

      if (
        !row ||
        !act
      ) {
        return;
      }

      const id =
        row.dataset.id;

      if (
        act ===
        'dismiss'
      ) {
        e.preventDefault();
        e.stopPropagation();

        await dismissNotification(
          id
        );

        renderNotifications();

        return;
      }

      if (
        act ===
        'open'
      ) {
        if (
          row.classList.contains(
            'unread'
          )
        ) {
          await markNotificationRead(
            id
          );
        }
      }
    }
  );

  document
    .getElementById(
      'notifBrowserAlerts'
    )
    ?.addEventListener(
      'click',
      async e => {
        e.stopPropagation();

        if (!state.user) {
          toast(
            'Sign in first to enable booking alerts',
            'error'
          );

          return;
        }

        if (
          browserNotificationState() ===
          'enabled'
        ) {
          disableBrowserNotifications();

          toast(
            'Browser alerts turned off'
          );

          renderNotifications();

          return;
        }

        const result =
          await enableBrowserNotifications();

        toast(
          result.ok
            ? 'Browser alerts are on'
            : result.error,
          result.ok
            ? 'success'
            : 'error'
        );

        renderNotifications();
      }
    );

  document
    .getElementById(
      'notifReadAll'
    )
    ?.addEventListener(
      'click',
      async e => {
        e.stopPropagation();

        await markAllNotificationsRead();

        renderNotifications();
      }
    );

  document
    .getElementById(
      'notifClear'
    )
    ?.addEventListener(
      'click',
      async e => {
        e.stopPropagation();

        await clearNotifications();

        renderNotifications();
      }
    );

  document.addEventListener(
    'click',
    e => {
      if (
        !e.target.closest(
          '.notif-wrap'
        )
      ) {
        closeNotifMenu();
      }
    }
  );

  document.addEventListener(
    'keydown',
    e => {
      if (
        e.key ===
        'Escape'
      ) {
        closeNotifMenu();
      }
    }
  );
}

/* ---------------- maintenance notice ----------------
   The server refuses writes while maintenance mode is on. Say so up front
   rather than letting a customer discover it at the Confirm button.
--------------------------------------------------------- */

export function renderMaintenanceNotice() {
  const existing =
    document.getElementById(
      'maintenanceNotice'
    );

  if (
    !state.settings?.maintenanceMode
  ) {
    existing?.remove();
    return;
  }

  if (existing) {
    return;
  }

  const host =
    document.getElementById(
      'siteHeader'
    ) ||
    document.body;

  const el =
    document.createElement(
      'div'
    );

  el.id =
    'maintenanceNotice';

  el.className =
    'maintenance-bar';

  el.textContent =
    'DiaLux is in maintenance — browsing works, but new bookings are paused.';

  host.appendChild(el);
}