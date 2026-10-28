// ============================================================
// DiaLux — core/page.js
// Shared page bootstrap. Each page module calls bootPage() with its
// nav key and a render function; everything common (chrome, session,
// data hydration, 3D effects, reveal observer) happens here once.
// ============================================================

import * as fx from '../3d-enhancements.js';

import {
  mountChrome,
  initReveal,
  updateCartBadge,
  updateWishBadge,
  bindImageFallbacks,
  renderNotifications,
  toast,
} from './ui.js';

import {
  restoreSession,
  initAcctMenu,
  initIdleLogout,
  renderAcctButton,
} from './auth.js';

import {
  state,
  hydrate,
  refreshNotifications,
  toggleWishlist,
  isWishlisted,
} from './state.js';

import {
  seedBrowserNotifications,
  announceNewBrowserNotifications,
} from './browser-notifications.js';

/**
 * Re-apply the effects that depend on freshly rendered DOM.
 * Safe to call after every re-render.
 */
export function refreshFx() {
  fx.initTilt(
    '.tilt-card'
  );

  fx.initFlipCards(
    '.flip-card'
  );

  fx.initRipple(
    '.btn, .add-cart-btn, .view-details-btn, .order-now-btn'
  );

  fx.initStagger(
    '.stagger'
  );

  bindImageFallbacks();

  initReveal();

  syncWishButtons();
}

/**
 * Paint wishlist buttons according to state.
 */
export function syncWishButtons(
  root = document
) {
  root
    .querySelectorAll(
      '[data-action="wish"]'
    )
    .forEach(btn => {
      const on =
        isWishlisted(
          btn.dataset.id
        );

      btn.classList.toggle(
        'on',
        on
      );

      btn.setAttribute(
        'aria-pressed',
        on
          ? 'true'
          : 'false'
      );

      btn.setAttribute(
        'aria-label',
        on
          ? 'Remove from wishlist'
          : 'Save to wishlist'
      );

      btn.title =
        on
          ? 'Saved — click to remove'
          : 'Save to wishlist';
    });
}

/**
 * Shared wishlist toggle.
 */
export async function wishToggle(
  productId,
  btn
) {
  const res =
    await toggleWishlist(
      productId
    );

  if (!res.ok) {
    toast(
      res.error,
      'error'
    );

    return res;
  }

  syncWishButtons();

  updateWishBadge();

  const name =
    res.product?.name ||
    'Device';

  toast(
    res.saved
      ? `${name} saved to your wishlist`
      : `${name} removed from your wishlist`
  );

  if (btn) {
    btn.blur();
  }

  return res;
}

/**
 * Warn when backend is unavailable.
 */
function renderOfflineBanner() {
  if (!state.offline) {
    return;
  }

  const main =
    document.querySelector(
      'main .container'
    ) ||
    document.querySelector(
      'main'
    );

  if (
    !main ||
    document.getElementById(
      'offlineBanner'
    )
  ) {
    return;
  }

  const el =
    document.createElement(
      'div'
    );

  el.id =
    'offlineBanner';

  el.className =
    'return-reminder';

  el.style.marginBottom =
    '20px';

  el.textContent =
    'Cannot reach the DiaLux server — the catalog is unavailable. Start the backend with "npm run dev" and reload this page.';

  main.prepend(el);
}

/*
 * Staff accounts should not enter shopping pages.
 */
const CUSTOMER_ONLY_PAGES =
  new Set([
    'products',
    'wishlist',
    'cart',
    'checkout',
  ]);

/*
 * IMPORTANT:
 * Each staff role returns to its own dashboard.
 */
const ROLE_HOME = {
  admin:
    '/admin.html',

  rider:
    '/rider.html',

  technician:
    '/technician.html',
};

/**
 * Redirect signed-in staff away from customer-only pages.
 */
function redirectStaffAwayFromShopping(
  active
) {
  const role =
    state.user?.role;

  if (
    !role ||
    role === 'user'
  ) {
    return false;
  }

  if (
    !CUSTOMER_ONLY_PAGES.has(
      active
    )
  ) {
    return false;
  }

  location.replace(
    ROLE_HOME[role] ||
    '/profile.html'
  );

  return true;
}

/* ---------------- live notification polling ---------------- */

let notificationPoll =
  null;

let notificationPollUser =
  null;

function startNotificationPolling() {
  if (notificationPoll) {
    return;
  }

  notificationPollUser =
    state.user?.id ||
    state.user?._id ||
    null;

  seedBrowserNotifications(
    state.notifications ||
    []
  );

  notificationPoll =
    window.setInterval(
      async () => {
        const userId =
          state.user?.id ||
          state.user?._id ||
          null;

        if (!userId) {
          notificationPollUser =
            null;

          seedBrowserNotifications(
            []
          );

          return;
        }

        await refreshNotifications();

        if (
          notificationPollUser !==
          userId
        ) {
          notificationPollUser =
            userId;

          seedBrowserNotifications(
            state.notifications ||
            []
          );

          renderNotifications();

          return;
        }

        announceNewBrowserNotifications(
          state.notifications ||
          []
        );

        renderNotifications();
      },
      15000
    );
}

/**
 * Shared page bootstrap.
 *
 * active examples:
 * home
 * products
 * wishlist
 * cart
 * checkout
 * profile
 * admin
 * rider
 * technician
 * order
 * support
 * static
 */
export async function bootPage(
  active,
  render
) {
  document.body.dataset.page =
    active;

  /*
   * Header and footer mount first.
   */
  mountChrome(
    active
  );

  initAcctMenu();

  fx.markSupport();

  fx.initPageTransitions();

  fx.initHeroRig();

  /*
   * Restore logged-in account.
   */
  await restoreSession();

  /*
   * Web sessions automatically expire after five minutes with no user
   * activity. If the restored session is already stale, stop booting this
   * page while auth.js clears the account and redirects to the home page.
   */
  if (!initIdleLogout()) {
    return;
  }

  /*
   * If a staff member tries entering a customer shopping page,
   * immediately send them to their own dashboard.
   */
  if (
    redirectStaffAwayFromShopping(
      active
    )
  ) {
    return;
  }

  /*
   * Load shared application data.
   */
  await hydrate();

  /*
   * Account button + notifications.
   */
  renderAcctButton();

  renderNotifications();

  startNotificationPolling();

  /*
   * Render the current page.
   */
  try {
    await render();
  } catch (err) {
    console.error(
      `[DiaLux] ${active} page failed to render:`,
      err
    );

    toast(
      'Something went wrong rendering this page',
      'error'
    );
  }

  renderOfflineBanner();

  updateCartBadge();

  updateWishBadge();

  refreshFx();
}