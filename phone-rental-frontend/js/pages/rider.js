// ============================================================
// DiaLux — pages/rider.js
// The rider dashboard: assigned deliveries, today's schedule, and the
// handover actions (picked up → on the way → arriving → delivered/failed).
//
// "Map-less tracking" per the brief: no map, just a plain checkpoint list
// per delivery — a rider taps a button, a timestamped checkpoint appears.
// ============================================================

import * as fx from '../3d-enhancements.js';
import { bootPage } from '../core/page.js';
import { state } from '../core/state.js';
import { isRider, isAdmin } from '../core/auth.js';
import { ridersApi } from '../core/api.js';
import {
  peso, escapeHtml, toast, emptyState, formatDateTime, titleCase,
} from '../core/ui.js';

let deliveries = [];
let activeModal = null; // { deliveryId, kind: 'delivered' | 'failed' }

const shortId = (id) => String(id).slice(-6).toUpperCase();

/* ---------------- status → next action ---------------- */

const NEXT_ACTION = {
  unassigned: { label: 'Picked up', status: 'picked-up' },
  assigned:   { label: 'Picked up', status: 'picked-up' },
  'picked-up':  { label: 'On the way', status: 'in-transit' },
  'in-transit': { label: 'Arriving', status: 'arriving' },
  arriving:     { label: 'Delivered', status: null },
};

const DELIVERY_STATUS_LABEL = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  'picked-up': 'Picked up',
  'in-transit': 'In transit',
  arriving: 'Arriving',
  delivered: 'Delivered',
  failed: 'Failed',
};

/* ---------------- markup ---------------- */

function checkpointsMarkup(d) {
  if (!d.checkpoints?.length) {
    return '<p class="field-hint">No checkpoints yet.</p>';
  }

  return `
    <ul class="rider-checkpoints">
      ${[...d.checkpoints].reverse().map(c => `
        <li>
          <b>${escapeHtml(
            DELIVERY_STATUS_LABEL[c.status] ||
            titleCase(c.status)
          )}</b>

          <span class="field-hint">
            ${escapeHtml(formatDateTime(c.at))}
          </span>

          ${c.note
            ? `<p>${escapeHtml(c.note)}</p>`
            : ''}
        </li>
      `).join('')}
    </ul>
  `;
}

function actionsMarkup(d) {
  if (
    ['delivered', 'failed'].includes(d.status)
  ) {
    return `
      <p class="field-hint">
        This ${d.type === 'return' ? 'pickup' : 'delivery'} is closed out.
      </p>
    `;
  }

  const next =
    NEXT_ACTION[d.status];

  const buttons = [];

  if (next) {
    if (next.status) {
      buttons.push(`
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-act="advance"
          data-status="${next.status}"
        >
          ${escapeHtml(next.label)}
        </button>
      `);
    } else {
      buttons.push(`
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-act="open-delivered"
        >
          ${escapeHtml(
            d.type === 'return'
              ? 'Returned'
              : next.label
          )}
        </button>
      `);
    }
  }

  buttons.push(`
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      data-act="open-failed"
    >
      Failed
    </button>
  `);

  return `
    <div class="rider-actions">
      ${buttons.join('')}
    </div>
  `;
}

function deliveryCard(d) {
  const o =
    d.order || {};

  const destination =
    o.orderType === 'pickup'
      ? `Hub pickup · ${escapeHtml(o.pickupHub || '')}`
      : o.orderType === 'meetup'
        ? `Meet-up · ${escapeHtml(o.meetupLocation || '')}`
        : escapeHtml(o.address || '');

  const isReturn =
    d.type === 'return';

  const isCod =
    !isReturn &&
    o.payment?.method === 'cash';

  return `
    <div
      class="rider-card"
      data-delivery="${d.id}"
    >
      <div class="rider-card-head">
        <div>
          <b>
            ${escapeHtml(
              o.invoiceNo ||
              `DLX-${shortId(d.order?.id || d.id)}`
            )}
          </b>

          <span
            class="status-pill status-${escapeHtml(d.status)}"
          >
            ${escapeHtml(
              DELIVERY_STATUS_LABEL[d.status] ||
              titleCase(d.status)
            )}
          </span>
        </div>

        <span class="plan-tier-tag">
          ${escapeHtml(titleCase(d.type))}
        </span>
      </div>

      <div class="rider-card-body">
        <p>
          <b>${escapeHtml(o.userName || 'Customer')}</b>
          ·
          ${escapeHtml(
            o.phone ||
            'no phone on file'
          )}
        </p>

        <p>${destination}</p>

        ${
          d.scheduledAt
            ? `
              <p class="field-hint">
                Scheduled:
                ${escapeHtml(
                  formatDateTime(d.scheduledAt)
                )}
              </p>
            `
            : ''
        }

        ${
          o.timeSlot
            ? `
              <p class="field-hint">
                Window:
                ${escapeHtml(o.timeSlot)}
              </p>
            `
            : ''
        }

        ${
          o.items?.length
            ? `
              <p class="field-hint">
                ${o.items
                  .map(i => escapeHtml(i.name))
                  .join(', ')}
              </p>
            `
            : ''
        }

        ${
          isCod
            ? `
              <p class="field-hint">
                <b>
                  Collect ${peso(o.total || 0)}
                  cash on delivery.
                </b>
              </p>
            `
            : ''
        }

        ${
          isReturn
            ? `
              <p class="field-hint">
                Return pickup — no payment should be collected.
              </p>
            `
            : ''
        }
      </div>

      ${actionsMarkup(d)}

      <details class="rider-checkpoints-wrap">
        <summary>Checkpoints</summary>
        ${checkpointsMarkup(d)}
      </details>
    </div>
  `;
}

function render() {
  const wrap =
    document.getElementById(
      'riderDashWrap'
    );

  if (!wrap) {
    return;
  }

  if (!state.user) {
    wrap.innerHTML =
      emptyState(
        'Rider access required',
        'Sign in with a rider account to see your deliveries.',
        '<a class="btn btn-primary" href="/index.html#auth">Sign in</a>'
      );

    return;
  }

  if (
    !isRider() &&
    !isAdmin()
  ) {
    wrap.innerHTML =
      emptyState(
        'This page isn’t available',
        'Rider access is required to view this dashboard.',
        '<a class="btn btn-primary" href="/products.html">Back to the catalog</a>'
      );

    return;
  }

  if (!deliveries.length) {
    wrap.innerHTML =
      emptyState(
        'No deliveries assigned',
        'New delivery and return jobs will show up here as soon as DiaLux assigns them to you.'
      );

    return;
  }

  const today =
    new Date()
      .toISOString()
      .slice(0, 10);

  const scheduledToday =
    deliveries.filter(
      d =>
        d.scheduledAt &&
        String(d.scheduledAt)
          .slice(0, 10) === today
    );

  const active =
    deliveries.filter(
      d =>
        ![
          'delivered',
          'failed',
        ].includes(
          d.status
        )
    );

  const closed =
    deliveries.filter(
      d =>
        [
          'delivered',
          'failed',
        ].includes(
          d.status
        )
    );

  wrap.innerHTML = `
    ${
      scheduledToday.length
        ? `
          <h3>Today's schedule</h3>

          <div class="rider-grid">
            ${scheduledToday
              .map(deliveryCard)
              .join('')}
          </div>
        `
        : ''
    }

    <h3
      style="margin-top:${
        scheduledToday.length
          ? '28px'
          : '0'
      };"
    >
      Assigned deliveries
    </h3>

    <div class="rider-grid">
      ${
        active.length
          ? active
              .map(deliveryCard)
              .join('')
          : `
            <p class="field-hint">
              Nothing active right now.
            </p>
          `
      }
    </div>

    ${
      closed.length
        ? `
          <h3 style="margin-top:28px;">
            Completed today
          </h3>

          <div class="rider-grid">
            ${closed
              .map(deliveryCard)
              .join('')}
          </div>
        `
        : ''
    }

    ${modalMarkup()}
  `;

  bindActions();
}

/* ---------------- modal ---------------- */

function modalMarkup() {
  if (!activeModal) {
    return '';
  }

  const d =
    deliveries.find(
      x =>
        x.id ===
        activeModal.deliveryId
    );

  if (!d) {
    return '';
  }

  const isReturn =
    d.type === 'return';

  const isCod =
    !isReturn &&
    d.order?.payment?.method === 'cash';

  if (
    activeModal.kind ===
    'failed'
  ) {
    return `
      <div
        class="rider-modal-scrim"
        id="modalScrim"
      >
        <div class="rider-modal">
          <h3>
            Record a failed ${
              isReturn
                ? 'pickup'
                : 'delivery'
            }
          </h3>

          <div class="field">
            <label for="failReason">
              What happened?
            </label>

            <textarea
              id="failReason"
              rows="3"
              placeholder="e.g. No one answered, wrong address..."
            ></textarea>
          </div>

          <div class="rider-modal-actions">
            <button
              type="button"
              class="btn btn-ghost"
              id="modalCancel"
            >
              Cancel
            </button>

            <button
              type="button"
              class="btn btn-primary"
              id="modalSubmit"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div
      class="rider-modal-scrim"
      id="modalScrim"
    >
      <div class="rider-modal">
        <h3>
          ${
            isReturn
              ? 'Confirm return handover'
              : 'Confirm handover'
          }
        </h3>

        <div class="field">
          <label for="proofFile">
            Proof photo
          </label>

          <input
            type="file"
            id="proofFile"
            accept="image/*"
          >
        </div>

        <div class="field">
          <label for="recipientName">
            ${
              isReturn
                ? 'Received by'
                : 'Recipient name'
            }
          </label>

          <input
            type="text"
            id="recipientName"
            placeholder="${
              isReturn
                ? 'Who received the returned device?'
                : 'Who received it?'
            }"
          >
        </div>

        <div class="field">
          <label>
            Signature
          </label>

          <canvas
            id="sigPad"
            width="400"
            height="120"
            class="rider-sig-pad"
          ></canvas>

          <button
            type="button"
            class="btn btn-ghost btn-sm"
            id="sigClear"
            style="margin-top:6px;"
          >
            Clear signature
          </button>
        </div>

        ${
          isCod
            ? `
              <div class="field">
                <label for="cashAmount">
                  Cash collected (₱)
                </label>

                <input
                  type="number"
                  id="cashAmount"
                  min="0"
                  step="1"
                  value="${d.order?.total || ''}"
                >
              </div>
            `
            : ''
        }

        ${
          isReturn
            ? `
              <p class="field-hint">
                This is a return pickup. No cash collection is required.
              </p>
            `
            : ''
        }

        <div class="rider-modal-actions">
          <button
            type="button"
            class="btn btn-ghost"
            id="modalCancel"
          >
            Cancel
          </button>

          <button
            type="button"
            class="btn btn-primary"
            id="modalSubmit"
          >
            ${
              isReturn
                ? 'Confirm returned'
                : 'Confirm delivered'
            }
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ---------------- signature ---------------- */

let sigCtx =
  null;

let sigDrawing =
  false;

let sigHasInk =
  false;

function initSignaturePad() {
  const canvas =
    document.getElementById(
      'sigPad'
    );

  if (!canvas) {
    return;
  }

  sigCtx =
    canvas.getContext('2d');

  sigCtx.strokeStyle =
    '#10132B';

  sigCtx.lineWidth =
    2;

  sigCtx.lineCap =
    'round';

  sigHasInk =
    false;

  const pos =
    e => {
      const rect =
        canvas.getBoundingClientRect();

      const pointer =
        e.touches
          ? e.touches[0]
          : e;

      return {
        x:
          pointer.clientX -
          rect.left,

        y:
          pointer.clientY -
          rect.top,
      };
    };

  const start =
    e => {
      sigDrawing =
        true;

      const {
        x,
        y,
      } =
        pos(e);

      sigCtx.beginPath();

      sigCtx.moveTo(
        x,
        y
      );
    };

  const move =
    e => {
      if (!sigDrawing) {
        return;
      }

      e.preventDefault();

      const {
        x,
        y,
      } =
        pos(e);

      sigCtx.lineTo(
        x,
        y
      );

      sigCtx.stroke();

      sigHasInk =
        true;
    };

  const end =
    () => {
      sigDrawing =
        false;
    };

  canvas.addEventListener(
    'mousedown',
    start
  );

  canvas.addEventListener(
    'mousemove',
    move
  );

  window.addEventListener(
    'mouseup',
    end
  );

  canvas.addEventListener(
    'touchstart',
    start,
    {
      passive:
        true,
    }
  );

  canvas.addEventListener(
    'touchmove',
    move,
    {
      passive:
        false,
    }
  );

  canvas.addEventListener(
    'touchend',
    end
  );

  document
    .getElementById(
      'sigClear'
    )
    ?.addEventListener(
      'click',
      () => {
        sigCtx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        sigHasInk =
          false;
      }
    );
}

/* ---------------- data ---------------- */

async function load() {
  try {
    const res =
      await ridersApi
        .myDeliveries();

    deliveries =
      res.deliveries ||
      [];
  } catch {
    deliveries =
      [];
  }

  render();
}

/* ---------------- actions ---------------- */

function bindActions() {
  const wrap =
    document.getElementById(
      'riderDashWrap'
    );

  /*
   * Use onclick instead of repeatedly adding listeners every render.
   * This prevents duplicate rider actions after dashboard refreshes.
   */
  wrap.onclick =
    async e => {
      const card =
        e.target.closest(
          '[data-delivery]'
        );

      if (!card) {
        return;
      }

      const id =
        card.dataset.delivery;

      if (
        e.target.dataset.act ===
        'advance'
      ) {
        const status =
          e.target.dataset.status;

        const done =
          fx.setBtnLoading(
            e.target,
            ''
          );

        try {
          await ridersApi
            .setStatus(
              id,
              status
            );

          toast(
            `Marked ${status.replace('-', ' ')}`
          );

          await load();
        } catch (err) {
          done();

          toast(
            err.message ||
            'Could not update the delivery',
            'error'
          );
        }

        return;
      }

      if (
        e.target.dataset.act ===
        'open-delivered'
      ) {
        activeModal = {
          deliveryId:
            id,

          kind:
            'delivered',
        };

        render();

        setTimeout(
          initSignaturePad,
          0
        );

        return;
      }

      if (
        e.target.dataset.act ===
        'open-failed'
      ) {
        activeModal = {
          deliveryId:
            id,

          kind:
            'failed',
        };

        render();

        return;
      }
    };

  document
    .getElementById(
      'modalScrim'
    )
    ?.addEventListener(
      'click',
      e => {
        if (
          e.target.id ===
            'modalScrim' ||
          e.target.id ===
            'modalCancel'
        ) {
          activeModal =
            null;

          render();
        }
      }
    );

  document
    .getElementById(
      'modalSubmit'
    )
    ?.addEventListener(
      'click',
      async e => {
        if (!activeModal) {
          return;
        }

        const btn =
          e.currentTarget;

        /*
         * Failed job
         */
        if (
          activeModal.kind ===
          'failed'
        ) {
          const reason =
            document
              .getElementById(
                'failReason'
              )
              ?.value
              .trim();

          if (!reason) {
            toast(
              'A reason is required',
              'error'
            );

            return;
          }

          const done =
            fx.setBtnLoading(
              btn,
              'Submitting…'
            );

          try {
            await ridersApi
              .setStatus(
                activeModal.deliveryId,
                'failed',
                reason
              );

            toast(
              'Recorded as failed'
            );

            activeModal =
              null;

            await load();
          } catch (err) {
            done();

            toast(
              err.message ||
              'Could not submit',
              'error'
            );
          }

          return;
        }

        /*
         * Delivered / Returned
         */
        const delivery =
          deliveries.find(
            x =>
              x.id ===
              activeModal.deliveryId
          );

        const isReturn =
          delivery?.type ===
          'return';

        const fileInput =
          document.getElementById(
            'proofFile'
          );

        const recipientName =
          document
            .getElementById(
              'recipientName'
            )
            ?.value
            .trim() ||
          '';

        const cashInput =
          document.getElementById(
            'cashAmount'
          );

        const file =
          fileInput
            ?.files?.[0];

        if (!file) {
          toast(
            'A proof photo is required',
            'error'
          );

          return;
        }

        if (
          !recipientName &&
          !sigHasInk
        ) {
          toast(
            'Add a recipient name or a signature',
            'error'
          );

          return;
        }

        const done =
          fx.setBtnLoading(
            btn,
            'Confirming…'
          );

        try {
          const proofUrl =
            await fileToDataUrl(
              file
            );

          const signature =
            sigHasInk
              ? document
                  .getElementById(
                    'sigPad'
                  )
                  .toDataURL(
                    'image/png'
                  )
              : '';

          /*
           * cashAmount only exists for outbound COD.
           * Return jobs never send cashCollected.
           */
          const cashCollected =
            cashInput
              ? Number(
                  cashInput.value
                ) ||
                undefined
              : undefined;

          await ridersApi
            .submitProof(
              activeModal.deliveryId,
              {
                proofUrl,
                signature,
                recipientName,
                cashCollected,
              }
            );

          toast(
            isReturn
              ? 'Return confirmed'
              : 'Delivery confirmed'
          );

          activeModal =
            null;

          await load();
        } catch (err) {
          done();

          toast(
            err.message ||
              (
                isReturn
                  ? 'Could not confirm the return'
                  : 'Could not confirm the delivery'
              ),
            'error'
          );
        }
      }
    );
}

/* ---------------- image helper ---------------- */

function fileToDataUrl(file) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      if (
        file.size >
        500 * 1024
      ) {
        reject(
          new Error(
            'Please choose an image under 500KB'
          )
        );

        return;
      }

      const reader =
        new FileReader();

      reader.onload =
        () =>
          resolve(
            reader.result
          );

      reader.onerror =
        reject;

      reader.readAsDataURL(
        file
      );
    }
  );
}

/* ---------------- boot ---------------- */

bootPage(
  'rider',
  load
);