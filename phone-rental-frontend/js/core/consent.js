// ============================================================
// DiaLux — core/consent.js
// Shared customer Terms acceptance + optional promotional-email choice.
// Acceptance is stored on the server so website and Android stay in sync.
// ============================================================

import { request } from './api.js';
import { state } from './state.js';
import { doLogout } from './auth.js';
import { escapeHtml, toast } from './ui.js';

let openPromise = null;

function ensureStyles() {
  if (document.getElementById('dialuxConsentStyles')) return;

  const style = document.createElement('style');
  style.id = 'dialuxConsentStyles';
  style.textContent = `
    .consent-lock { overflow: hidden; }
    .consent-scrim {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: grid;
      place-items: center;
      padding: 22px;
      background: rgba(8, 15, 30, .62);
      backdrop-filter: blur(8px);
    }
    .consent-card {
      width: min(520px, 100%);
      max-height: min(720px, calc(100vh - 44px));
      overflow: auto;
      border-radius: 24px;
      background: #fff;
      color: #111827;
      box-shadow: 0 26px 80px rgba(0,0,0,.24);
      border: 1px solid rgba(82,143,255,.18);
    }
    .consent-head {
      padding: 24px 26px 18px;
      background: linear-gradient(135deg, #f4f8ff, #fff);
      border-bottom: 1px solid #e9eef7;
    }
    .consent-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px;
      border-radius: 999px;
      background: #eaf2ff;
      color: #2468df;
      font-size: .76rem;
      font-weight: 800;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .consent-head h2 {
      margin: 13px 0 8px;
      font-size: 1.55rem;
      line-height: 1.2;
    }
    .consent-head p,
    .consent-body p {
      margin: 0;
      color: #667085;
      line-height: 1.58;
      font-size: .94rem;
    }
    .consent-body { padding: 22px 26px 26px; }
    .consent-links {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin: 14px 0 20px;
    }
    .consent-links a {
      color: #2e73e8;
      font-weight: 700;
      text-decoration: none;
    }
    .consent-choice {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 15px;
      border: 1px solid #dfe7f3;
      border-radius: 15px;
      background: #f8fbff;
      cursor: pointer;
    }
    .consent-choice input {
      width: 18px;
      height: 18px;
      margin-top: 2px;
      accent-color: #4f8ff7;
    }
    .consent-choice strong {
      display: block;
      margin-bottom: 4px;
      font-size: .93rem;
    }
    .consent-choice small {
      display: block;
      color: #718096;
      line-height: 1.45;
    }
    .consent-note {
      margin-top: 13px !important;
      font-size: .78rem !important;
    }
    .consent-error {
      min-height: 18px;
      margin-top: 12px;
      color: #c92b35;
      font-size: .82rem;
      font-weight: 650;
    }
    .consent-actions {
      display: flex;
      gap: 10px;
      margin-top: 6px;
    }
    .consent-actions .btn {
      flex: 1;
      justify-content: center;
    }
    @media (max-width: 520px) {
      .consent-scrim { padding: 14px; align-items: end; }
      .consent-card { border-radius: 22px 22px 14px 14px; }
      .consent-actions { flex-direction: column-reverse; }
    }
  `;

  document.head.appendChild(style);
}

async function fetchConsent() {
  return request('/users/me/consent', {
    fallback: 'Could not load your consent settings',
  });
}

async function saveConsent(marketingEmails) {
  return request('/users/me/consent', {
    method: 'PATCH',
    body: {
      acceptTerms: true,
      marketingEmails: Boolean(marketingEmails),
    },
    fallback: 'Could not save your choices',
  });
}

function closeModal(scrim) {
  scrim?.remove();
  document.body.classList.remove('consent-lock');
}

/**
 * Show the customer consent dialog.
 *
 * preferencesOnly=false:
 *   required first-time Terms acceptance, with Sign out as the alternative.
 *
 * preferencesOnly=true:
 *   profile settings mode; Terms stay accepted while marketing preference
 *   can be changed at any time.
 */
export async function ensureWebConsent({ preferencesOnly = false } = {}) {
  if (!state.user || state.user.role !== 'user') return true;

  if (openPromise) return openPromise;

  openPromise = (async () => {
    let status;

    try {
      status = await fetchConsent();
    } catch (err) {
      console.error('[DiaLux] consent status failed:', err);

      if (!preferencesOnly) {
        toast('Could not load Terms & Conditions. Please try again.', 'error');
        return false;
      }

      throw err;
    }

    if (!preferencesOnly && status?.termsAccepted) {
      state.user = {
        ...state.user,
        consents: {
          ...(state.user.consents || {}),
          termsVersion: status.termsVersion || status.currentTermsVersion,
          termsAcceptedAt: status.termsAcceptedAt,
          marketingEmails: Boolean(status.marketingEmails),
          marketingUpdatedAt: status.marketingUpdatedAt,
        },
      };

      return true;
    }

    ensureStyles();
    document.body.classList.add('consent-lock');

    const scrim = document.createElement('div');
    scrim.className = 'consent-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'consentTitle');

    const acceptedCopy = status?.termsAccepted
      ? `Terms accepted${status.termsAcceptedAt ? ` on ${new Date(status.termsAcceptedAt).toLocaleDateString('en-PH')}` : ''}.`
      : 'Please review and accept our Terms & Conditions before using your DiaLux customer account.';

    scrim.innerHTML = `
      <section class="consent-card">
        <div class="consent-head">
          <span class="consent-badge">🛡️ DiaLux account</span>
          <h2 id="consentTitle">${preferencesOnly ? 'Communication preferences' : 'Terms & Conditions'}</h2>
          <p>${escapeHtml(acceptedCopy)}</p>
        </div>

        <div class="consent-body">
          ${preferencesOnly ? '' : `
            <p>
              By selecting <strong>Accept &amp; continue</strong>, you confirm that you have read
              and agree to the current DiaLux Terms &amp; Conditions and acknowledge our Privacy Policy.
            </p>

            <div class="consent-links">
              <a href="/terms.html" target="_blank" rel="noopener">Read Terms &amp; Conditions ↗</a>
              <a href="/privacy.html" target="_blank" rel="noopener">Read Privacy Policy ↗</a>
            </div>
          `}

          <label class="consent-choice">
            <input id="marketingEmailChoice" type="checkbox" ${status?.marketingEmails ? 'checked' : ''}>
            <span>
              <strong>Email me DiaLux offers and new-device promotions</strong>
              <small>Optional. We may send rental deals, product launches, and limited promotions. You can turn this off anytime.</small>
            </span>
          </label>

          <p class="consent-note">
            Transactional emails such as booking confirmations, receipts, password resets,
            and support updates are separate and are not affected by this optional choice.
          </p>

          <div class="consent-error" id="consentError" aria-live="polite"></div>

          <div class="consent-actions">
            ${preferencesOnly
              ? '<button class="btn btn-ghost" type="button" id="consentCancel">Cancel</button>'
              : '<button class="btn btn-ghost" type="button" id="consentSignOut">Sign out</button>'}
            <button class="btn btn-primary" type="button" id="consentAccept">
              ${preferencesOnly ? 'Save choices' : 'Accept & continue'}
            </button>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(scrim);

    return new Promise((resolve) => {
      const accept = scrim.querySelector('#consentAccept');
      const cancel = scrim.querySelector('#consentCancel');
      const signOut = scrim.querySelector('#consentSignOut');
      const error = scrim.querySelector('#consentError');
      const marketing = scrim.querySelector('#marketingEmailChoice');

      cancel?.addEventListener('click', () => {
        closeModal(scrim);
        resolve(false);
      });

      signOut?.addEventListener('click', () => {
        closeModal(scrim);
        doLogout();
        resolve(false);
      });

      accept?.addEventListener('click', async () => {
        accept.disabled = true;
        accept.textContent = preferencesOnly ? 'Saving…' : 'Accepting…';
        if (error) error.textContent = '';

        try {
          const saved = await saveConsent(Boolean(marketing?.checked));

          state.user = saved?.user || {
            ...state.user,
            consents: {
              ...(state.user?.consents || {}),
              termsVersion: saved?.termsVersion || saved?.currentTermsVersion,
              termsAcceptedAt: saved?.termsAcceptedAt,
              marketingEmails: Boolean(saved?.marketingEmails),
              marketingUpdatedAt: saved?.marketingUpdatedAt,
            },
          };

          closeModal(scrim);

          if (preferencesOnly) {
            toast('Communication preferences saved');
          }

          resolve(true);
        } catch (err) {
          if (error) {
            error.textContent = err?.message || 'Could not save your choices.';
          }
          accept.disabled = false;
          accept.textContent = preferencesOnly ? 'Save choices' : 'Accept & continue';
        }
      });
    });
  })();

  try {
    return await openPromise;
  } finally {
    openPromise = null;
  }
}

export function openConsentPreferences() {
  return ensureWebConsent({ preferencesOnly: true });
}
