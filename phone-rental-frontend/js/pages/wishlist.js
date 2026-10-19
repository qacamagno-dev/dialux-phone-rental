// ============================================================
// DiaLux — pages/wishlist.js
// Devices saved for later: move one into the cart, book it outright,
// or drop it from the list.
//
// Works signed out — the wishlist falls back to localStorage and is
// merged into the account on sign-in, exactly like the guest cart.
// ============================================================

import * as fx from '../3d-enhancements.js';

import {
  bootPage,
  refreshFx,
  wishToggle,
} from '../core/page.js';

import {
  state,
  moveWishlistToCart,
  removeFromWishlist,
  emptyWishlist,
} from '../core/state.js';

import {
  peso,
  gradeClass,
  catLabel,
  escapeHtml,
  toast,
  updateCartBadge,
  updateWishBadge,
  emptyState,
  stockLine,
} from '../core/ui.js';

const CARD_FMT = {
  peso,
  gradeClass,
  catLabel,
};

/* ============================================================
   HEADER
============================================================ */

function headerMarkup() {
  const n =
    state.wishlist.length;

  const guestNote =
    !state.user &&
    n
      ? `
        <p
          class="summary-note"
          style="margin-top:6px;"
        >
          Saved on this device only —
          <a
            href="/index.html#auth"
            style="color:var(--accent);"
          >
            sign in
          </a>
          and it moves to your account.
        </p>
      `
      : '';

  return `
    <div class="wish-head">

      <div>

        <span>
          ${n}
          device${n === 1 ? '' : 's'}
          saved
        </span>

        ${guestNote}

      </div>

      ${
        n
          ? `
            <div class="wish-head-actions">

              <button
                class="btn btn-outline btn-sm"
                type="button"
                id="wishAllToCart"
              >
                Move all to cart
              </button>

              <button
                class="btn btn-ghost btn-sm"
                type="button"
                id="wishClear"
              >
                Clear list
              </button>

            </div>
          `
          : ''
      }

    </div>
  `;
}

/* ============================================================
   WISHLIST ITEM
============================================================ */

function itemMarkup(p) {
  return `
    <div
      class="wish-item"
      data-id="${escapeHtml(p.id)}"
    >

      ${fx.renderProductCard3D(
        p,
        CARD_FMT
      )}

      <div class="wish-actions">

        ${stockLine(p.stock)}

        <button
          class="btn btn-primary btn-sm"
          type="button"
          data-wact="move"
          data-id="${escapeHtml(p.id)}"
          ${
            p.stock === 0
              ? 'disabled'
              : ''
          }
        >
          ${
            p.stock === 0
              ? 'Out of stock'
              : 'Move to cart'
          }
        </button>

        <button
          class="btn btn-ghost btn-sm"
          type="button"
          data-wact="remove"
          data-id="${escapeHtml(p.id)}"
        >
          Remove
        </button>

      </div>

    </div>
  `;
}

/* ============================================================
   REMOVE DUPLICATE SHARED CARD ACTION
============================================================ */

/**
 * renderProductCard3D() is shared with the main catalog and therefore
 * includes its own "Add to cart" button.
 *
 * On the wishlist we already have a dedicated "Move to cart" action,
 * so the shared Add-to-cart control would be duplicated.
 *
 * Remove only that button inside the wishlist.
 * The catalog/product cards everywhere else remain unchanged.
 */
function removeDuplicateCartButtons(
  root
) {
  root
    .querySelectorAll(
      '.wish-grid .add-cart-btn'
    )
    .forEach(button => {
      button.remove();
    });
}

/* ============================================================
   RENDER
============================================================ */

function render() {
  const wrap =
    document.getElementById(
      'wishlistWrap'
    );

  if (!wrap) {
    return;
  }

  if (!state.wishlist.length) {
    wrap.innerHTML =
      emptyState(
        'Nothing saved yet',
        'Tap the heart on any device to keep it here while you decide.',
        '<a class="btn btn-primary" href="/products.html">Browse devices</a>'
      );

    updateWishBadge();

    return;
  }

  wrap.innerHTML = `
    ${headerMarkup()}

    <div class="wish-grid stagger">
      ${state.wishlist
        .map(itemMarkup)
        .join('')}
    </div>
  `;

  /*
   * IMPORTANT:
   * Remove the reusable card's Add to cart button.
   *
   * Wishlist keeps only:
   * - Details
   * - Order now
   * - Move to cart
   * - Remove
   */
  removeDuplicateCartButtons(
    wrap
  );

  bindActions(
    wrap
  );

  updateWishBadge();

  refreshFx();

  /*
   * refreshFx() can bind effects to the cards,
   * but it should never restore the removed button.
   *
   * Run once more defensively in case the shared card code
   * performs any synchronous DOM enhancement.
   */
  removeDuplicateCartButtons(
    wrap
  );
}

/* ============================================================
   ACTIONS
============================================================ */

function bindActions(wrap) {
  /*
   * Shared product-card actions.
   *
   * We intentionally DO NOT provide onAdd here because Wishlist
   * uses its own Move-to-cart action.
   */
  fx.initCardActions(
    '.wish-grid',
    {
      onView: id => {
        location.href =
          `/products.html#device-${id}`;
      },

      onOrder: id => {
        location.href =
          `/checkout.html?product=${id}&plan=Weekly`;
      },

      onWish: async (
        id,
        btn
      ) => {
        await wishToggle(
          id,
          btn
        );

        /*
         * Removing the heart while already on Wishlist
         * should immediately remove the item from the page.
         */
        render();
      },
    }
  );

  /*
   * Bind wishlist-specific actions once.
   */
  if (
    !wrap.dataset
      .actionsBound
  ) {
    wrap.dataset.actionsBound =
      '1';

    wrap.addEventListener(
      'click',
      async e => {
        const btn =
          e.target.closest(
            '[data-wact]'
          );

        if (!btn) {
          return;
        }

        const {
          wact,
          id,
        } =
          btn.dataset;

        /* ---------------- Move to cart ---------------- */

        if (
          wact ===
          'move'
        ) {
          const done =
            fx.setBtnLoading(
              btn,
              'Moving…'
            );

          const res =
            await moveWishlistToCart(
              id,
              'Weekly'
            );

          done();

          if (!res.ok) {
            toast(
              res.error,
              'error'
            );

            return;
          }

          updateCartBadge();

          toast(
            'Moved to cart'
          );

          render();

          return;
        }

        /* ---------------- Remove ---------------- */

        if (
          wact ===
          'remove'
        ) {
          const res =
            await removeFromWishlist(
              id
            );

          if (!res.ok) {
            toast(
              res.error,
              'error'
            );

            return;
          }

          toast(
            'Removed from your wishlist'
          );

          render();
        }
      }
    );
  }

  /* ---------------- Clear wishlist ---------------- */

  document
    .getElementById(
      'wishClear'
    )
    ?.addEventListener(
      'click',
      async () => {
        if (
          !confirm(
            'Remove every saved device?'
          )
        ) {
          return;
        }

        const res =
          await emptyWishlist();

        if (!res.ok) {
          toast(
            res.error,
            'error'
          );

          return;
        }

        toast(
          'Wishlist cleared'
        );

        render();
      }
    );

  /* ---------------- Move all to cart ---------------- */

  document
    .getElementById(
      'wishAllToCart'
    )
    ?.addEventListener(
      'click',
      async e => {
        const inStock =
          state.wishlist.filter(
            p =>
              p.stock > 0
          );

        if (
          !inStock.length
        ) {
          toast(
            'Nothing on your list is in stock right now',
            'error'
          );

          return;
        }

        const done =
          fx.setBtnLoading(
            e.currentTarget,
            'Moving…'
          );

        let moved =
          0;

        const failures =
          [];

        /*
         * Sequential on purpose.
         * Cart is one server document, so parallel writes
         * can race with each other.
         */
        for (
          const p of
          inStock
        ) {
          const res =
            await moveWishlistToCart(
              p.id,
              'Weekly'
            );

          if (res.ok) {
            moved +=
              1;
          } else {
            failures.push(
              `${p.name}: ${res.error}`
            );
          }
        }

        done();

        updateCartBadge();

        if (moved) {
          toast(
            `${moved} device${moved === 1 ? '' : 's'} moved to your cart`
          );
        }

        if (
          failures.length
        ) {
          toast(
            failures[0],
            'error'
          );
        }

        render();
      }
    );
}

/* ============================================================
   BOOT
============================================================ */

bootPage(
  'wishlist',
  render
);