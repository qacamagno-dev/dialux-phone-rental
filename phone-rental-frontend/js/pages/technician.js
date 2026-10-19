// ============================================================
// DiaLux — pages/technician.js
// Returned-device inspection and automatic deposit settlement.
// ============================================================

import * as fx from '../3d-enhancements.js';

import {
  bootPage,
  refreshFx,
} from '../core/page.js';

import {
  state,
  INSPECTION_CHECKLIST,
} from '../core/state.js';

import {
  ordersApi,
} from '../core/api.js';

import {
  peso,
  escapeHtml,
  formatDateTime,
  toast,
  emptyState,
  titleCase,
} from '../core/ui.js';

let queue = [];

let selectedId = '';

let submitting = false;

/* ============================================================
   HELPERS
============================================================ */

const orderIdOf =
  order =>
    order?.id ||
    order?._id ||
    '';

const shortId =
  id =>
    String(id || '')
      .slice(-6)
      .toUpperCase();

function invoiceOf(order) {
  return (
    order.invoiceNo ||
    `DLX-${shortId(orderIdOf(order))}`
  );
}

function selectedOrder() {
  return (
    queue.find(
      order =>
        orderIdOf(order) ===
        selectedId
    ) ||
    null
  );
}

function itemSummary(order) {
  const items =
    Array.isArray(order?.items)
      ? order.items
      : [];

  if (!items.length) {
    return 'Device';
  }

  return items
    .map(item => {
      const qty =
        Number(item.qty || 1);

      return (
        qty > 1
          ? `${qty}× ${item.name}`
          : item.name
      );
    })
    .join(', ');
}

function returnedAt(order) {
  return (
    order.returnedAt ||
    order.updatedAt ||
    order.createdAt
  );
}

/* ============================================================
   ACCESS
============================================================ */

function hasTechnicianAccess() {
  return [
    'technician',
    'admin',
  ].includes(
    state.user?.role
  );
}

/* ============================================================
   QUEUE MARKUP
============================================================ */

function queueMarkup() {
  if (!queue.length) {
    return `
      <div class="tech-queue-panel">

        <h2 class="tech-panel-title">
          Inspection queue
        </h2>

        <p class="tech-panel-subtitle">
          Returned devices waiting for inspection appear here.
        </p>

        <div class="tech-empty">
          No returned devices waiting for inspection.
        </div>

      </div>
    `;
  }

  return `
    <div class="tech-queue-panel">

      <h2 class="tech-panel-title">
        Inspection queue
      </h2>

      <p class="tech-panel-subtitle">
        ${queue.length}
        returned
        ${queue.length === 1 ? 'booking' : 'bookings'}
        waiting.
      </p>

      <div id="techQueueList">

        ${queue.map(order => {
          const id =
            orderIdOf(order);

          return `
            <button
              type="button"
              class="tech-order ${
                id === selectedId
                  ? 'active'
                  : ''
              }"
              data-order-id="${escapeHtml(id)}"
            >

              <b>
                ${escapeHtml(invoiceOf(order))}
              </b>

              <div class="tech-order-meta">

                <span>
                  ${escapeHtml(
                    order.userName ||
                    order.userEmail ||
                    'Customer'
                  )}
                </span>

                <span>
                  ${escapeHtml(
                    itemSummary(order)
                  )}
                </span>

                <span>
                  Returned:
                  ${escapeHtml(
                    formatDateTime(
                      returnedAt(order)
                    )
                  )}
                </span>

              </div>

              <span
                class="status-pill tech-order-status"
              >
                ${escapeHtml(
                  titleCase(order.status || 'returned')
                )}
              </span>

            </button>
          `;
        }).join('')}

      </div>

    </div>
  `;
}

/* ============================================================
   INSPECTION MARKUP
============================================================ */

function inspectionMarkup() {
  const order =
    selectedOrder();

  if (!order) {
    return `
      <div class="tech-inspection-panel">

        <div class="tech-empty">
          Select a returned booking from the inspection queue.
        </div>

      </div>
    `;
  }

  const deposit =
    Number(order.deposit || 0);

  return `
    <div class="tech-inspection-panel">

      <div class="tech-inspection-head">

        <div>

          <h2>
            ${escapeHtml(invoiceOf(order))}
          </h2>

          <p>
            ${escapeHtml(
              order.userName ||
              order.userEmail ||
              'Customer'
            )}
          </p>

        </div>

        <span class="status-pill">
          Returned
        </span>

      </div>

      <div class="tech-device-box">

        <strong>
          ${escapeHtml(itemSummary(order))}
        </strong>

        <p>
          Customer:
          ${escapeHtml(
            order.userName ||
            order.userEmail ||
            '—'
          )}
        </p>

        <p>
          Return received:
          ${escapeHtml(
            formatDateTime(
              returnedAt(order)
            )
          )}
        </p>

        <p>
          Deposit held:
          <strong>
            ${peso(deposit)}
          </strong>
        </p>

      </div>

      <form id="inspectionForm">

        <div class="tech-section">

          <h3>
            Device checklist
          </h3>

          <div class="inspection-grid">

            ${INSPECTION_CHECKLIST.map(
              item => `
                <label class="inspection-check">

                  <input
                    type="checkbox"
                    name="check-${escapeHtml(item.key)}"
                    checked
                  >

                  <span>
                    ${escapeHtml(item.label)}
                    OK
                  </span>

                </label>
              `
            ).join('')}

          </div>

        </div>

        <div class="tech-section">

          <h3>
            Inspection result
          </h3>

          <div class="tech-field">

            <label for="inspectionPassed">
              Result
            </label>

            <select
              id="inspectionPassed"
              class="mini-select"
              name="passed"
            >
              <option value="true">
                Passed inspection
              </option>

              <option value="false">
                Failed inspection
              </option>
            </select>

          </div>

          <div class="tech-field">

            <label for="damageCharge">
              Damage deduction (₱)
            </label>

            <input
              id="damageCharge"
              name="damageCharge"
              type="number"
              min="0"
              max="${deposit}"
              step="1"
              value="0"
            >

          </div>

          <div class="tech-field">

            <label for="inspectionNotes">
              Technician notes
            </label>

            <textarea
              id="inspectionNotes"
              name="notes"
              placeholder="Condition of the device, accessories returned, damage found, or other inspection notes."
            ></textarea>

          </div>

          <div class="tech-field">

            <label for="inspectionPhoto">
              Inspection photo
            </label>

            <input
              id="inspectionPhoto"
              name="inspectionPhoto"
              type="file"
              accept="image/*"
            >

            <img
              id="inspectionPhotoPreview"
              class="tech-photo-preview"
              alt="Inspection preview"
            >

          </div>

        </div>

        <div
          class="tech-result-preview"
          id="settlementPreview"
        >

          <div class="tech-result-row">
            <span>
              Deposit held
            </span>

            <strong>
              ${peso(deposit)}
            </strong>
          </div>

          <div class="tech-result-row">
            <span>
              Damage deduction
            </span>

            <strong id="damagePreview">
              ${peso(0)}
            </strong>
          </div>

          <div class="tech-result-row">
            <span>
              Estimated refund
            </span>

            <strong id="refundPreview">
              ${peso(deposit)}
            </strong>
          </div>

        </div>

        <div class="tech-warning">
          Final settlement is calculated by the server.
          Any applicable late-return penalty is also deducted automatically.
        </div>

        <div class="tech-inspection-actions">

          <button
            type="submit"
            class="btn btn-primary"
            id="saveInspectionBtn"
          >
            Complete inspection &amp; settle
          </button>

        </div>

      </form>

    </div>
  `;
}

/* ============================================================
   RENDER
============================================================ */

function render() {
  const wrap =
    document.getElementById(
      'technicianDashWrap'
    );

  if (!wrap) {
    return;
  }

  if (!state.user) {
    wrap.className = '';

    wrap.innerHTML =
      emptyState(
        'Technician access required',
        'Sign in with a technician account to inspect returned devices.'
      );

    return;
  }

  if (!hasTechnicianAccess()) {
    wrap.className = '';

    wrap.innerHTML =
      emptyState(
        'Access denied',
        'This dashboard is only available to DiaLux technicians.'
      );

    return;
  }

  wrap.className =
    'technician-layout';

  wrap.innerHTML = `
    ${queueMarkup()}
    ${inspectionMarkup()}
  `;

  bindEvents();

  refreshFx();
}

/* ============================================================
   LOAD
============================================================ */

async function loadQueue({
  preserveSelection = true,
} = {}) {
  try {
    const result =
      await ordersApi
        .inspectionQueue();

    /*
     * Backend currently returns the raw order array.
     * This also tolerates { orders: [] } if the API changes later.
     */
    queue =
      Array.isArray(result)
        ? result
        : (
            result?.orders ||
            []
          );

    if (
      preserveSelection &&
      selectedId &&
      queue.some(
        order =>
          orderIdOf(order) ===
          selectedId
      )
    ) {
      // Keep selection.
    } else {
      selectedId =
        queue.length
          ? orderIdOf(queue[0])
          : '';
    }

    render();
  } catch (err) {
    queue = [];
    selectedId = '';

    const wrap =
      document.getElementById(
        'technicianDashWrap'
      );

    if (wrap) {
      wrap.className = '';

      wrap.innerHTML =
        emptyState(
          'Could not load inspection queue',
          err.message ||
          'Please reload the page and try again.'
        );
    }

    toast(
      err.message ||
      'Could not load inspection queue',
      'error'
    );
  }
}

/* ============================================================
   EVENTS
============================================================ */

function bindEvents() {
  document
    .querySelectorAll(
      '[data-order-id]'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          selectedId =
            button.dataset.orderId;

          render();
        }
      );
    });

  const form =
    document.getElementById(
      'inspectionForm'
    );

  if (!form) {
    return;
  }

  const passedSelect =
    document.getElementById(
      'inspectionPassed'
    );

  const damageInput =
    document.getElementById(
      'damageCharge'
    );

  const photoInput =
    document.getElementById(
      'inspectionPhoto'
    );

  passedSelect
    ?.addEventListener(
      'change',
      syncInspectionMode
    );

  damageInput
    ?.addEventListener(
      'input',
      updateSettlementPreview
    );

  photoInput
    ?.addEventListener(
      'change',
      previewPhoto
    );

  form.addEventListener(
    'submit',
    submitInspection
  );

  syncInspectionMode();
  updateSettlementPreview();
}

/* ============================================================
   UI STATE
============================================================ */

function syncInspectionMode() {
  const passed =
    document.getElementById(
      'inspectionPassed'
    )?.value ===
    'true';

  const damage =
    document.getElementById(
      'damageCharge'
    );

  if (!damage) {
    return;
  }

  /*
   * A passed device normally has no damage deduction.
   * Technician can switch to Failed if damage exists.
   */
  if (passed) {
    damage.value =
      '0';
  }

  damage.disabled =
    passed;

  updateSettlementPreview();
}

function updateSettlementPreview() {
  const order =
    selectedOrder();

  if (!order) {
    return;
  }

  const deposit =
    Number(
      order.deposit ||
      0
    );

  const damage =
    Math.max(
      0,
      Number(
        document
          .getElementById(
            'damageCharge'
          )
          ?.value ||
        0
      )
    );

  const estimated =
    Math.max(
      0,
      deposit -
      damage
    );

  const damageEl =
    document.getElementById(
      'damagePreview'
    );

  const refundEl =
    document.getElementById(
      'refundPreview'
    );

  if (damageEl) {
    damageEl.textContent =
      peso(damage);
  }

  if (refundEl) {
    refundEl.textContent =
      peso(estimated);
  }
}

/* ============================================================
   PHOTO
============================================================ */

async function previewPhoto() {
  const input =
    document.getElementById(
      'inspectionPhoto'
    );

  const preview =
    document.getElementById(
      'inspectionPhotoPreview'
    );

  const file =
    input?.files?.[0];

  if (
    !preview ||
    !file
  ) {
    if (preview) {
      preview.style.display =
        'none';
    }

    return;
  }

  try {
    const data =
      await fileToDataUrl(
        file
      );

    preview.src =
      data;

    preview.style.display =
      'block';
  } catch (err) {
    input.value = '';

    preview.style.display =
      'none';

    toast(
      err.message,
      'error'
    );
  }
}

function fileToDataUrl(file) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      /*
       * Base64 becomes larger than the source image,
       * so keep this below the backend's photo size limit.
       */
      if (
        file.size >
        450 * 1024
      ) {
        reject(
          new Error(
            'Please use an inspection photo under 450KB'
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
        () =>
          reject(
            new Error(
              'Could not read the inspection photo'
            )
          );

      reader.readAsDataURL(
        file
      );
    }
  );
}

/* ============================================================
   SUBMIT
============================================================ */

async function submitInspection(event) {
  event.preventDefault();

  if (submitting) {
    return;
  }

  const order =
    selectedOrder();

  if (!order) {
    toast(
      'Select a returned booking first',
      'error'
    );

    return;
  }

  const passed =
    document
      .getElementById(
        'inspectionPassed'
      )
      ?.value ===
    'true';

  const notes =
    document
      .getElementById(
        'inspectionNotes'
      )
      ?.value
      .trim() ||
    '';

  const damageCharge =
    passed
      ? 0
      : Math.max(
          0,
          Number(
            document
              .getElementById(
                'damageCharge'
              )
              ?.value ||
            0
          )
        );

  if (
    !passed &&
    !notes
  ) {
    toast(
      'Add a note explaining why the inspection failed',
      'error'
    );

    return;
  }

  const checklist =
    {};

  let allPassed =
    true;

  for (
    const item of
    INSPECTION_CHECKLIST
  ) {
    const checkbox =
      document.querySelector(
        `[name="check-${CSS.escape(item.key)}"]`
      );

    const ok =
      checkbox?.checked ===
      true;

    checklist[
      item.key
    ] =
      ok;

    if (!ok) {
      allPassed =
        false;
    }
  }

  if (
    passed &&
    !allPassed
  ) {
    toast(
      'A device cannot pass while a checklist item is marked not OK',
      'error'
    );

    return;
  }

  const photos =
    [];

  const photo =
    document
      .getElementById(
        'inspectionPhoto'
      )
      ?.files?.[0];

  try {
    if (photo) {
      photos.push(
        await fileToDataUrl(
          photo
        )
      );
    }
  } catch (err) {
    toast(
      err.message,
      'error'
    );

    return;
  }

  const button =
    document.getElementById(
      'saveInspectionBtn'
    );

  const done =
    fx.setBtnLoading(
      button,
      'Settling…'
    );

  submitting =
    true;

  try {
    const result =
      await ordersApi
        .inspect(
          orderIdOf(order),
          {
            passed,
            notes,
            damageCharge,
            photos,
            checklist,
          }
        );

    const settlement =
      result?.settlement;

    if (settlement) {
      toast(
        `Inspection complete — ${peso(
          settlement.refundAmount || 0
        )} refund settled`
      );
    } else {
      toast(
        'Inspection completed'
      );
    }

    selectedId = '';

    await loadQueue({
      preserveSelection:
        false,
    });
  } catch (err) {
    done?.();

    toast(
      err.message ||
      'Could not complete inspection',
      'error'
    );
  } finally {
    submitting =
      false;
  }
}

/* ============================================================
   BOOT
============================================================ */

async function bootTechnician() {
  if (
    state.user &&
    !hasTechnicianAccess()
  ) {
    render();
    return;
  }

  await loadQueue({
    preserveSelection:
      false,
  });
}

bootPage(
  'technician',
  bootTechnician
);