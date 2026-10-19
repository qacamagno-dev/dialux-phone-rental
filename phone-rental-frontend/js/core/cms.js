// ============================================================
// DiaLux — core/cms.js
// Hydrates one of the six editable content pages from the database.
//
// The copy stays in the HTML shells, which is what a visitor sees by
// default. A page is only rewritten from the database once an administrator
// has actually saved an edit — GET /api/pages/:slug reports that with
// `saved`. That way the CMS can override the text without the hand-written
// markup ever being lost or downgraded to plain paragraphs.
//
// Lives in core/ rather than in pages/static.js because contact.js needs it
// too, and importing a page module would run its bootPage() a second time.
// ============================================================

import { pagesApi } from './api.js';
import { escapeHtml, paragraphs, formatDate } from './ui.js';

/**
 * Replace a page's content with the saved CMS version, if there is one.
 *
 * @param {string} slug  about | team | contact | help | terms | privacy
 * @returns {Promise<boolean>} true when CMS content was applied
 */
export async function hydrateCmsContent(slug) {
  const host = document.getElementById('cmsContent');
  if (!host || !slug) return false;

  let page;
  try {
    page = await pagesApi.one(slug);
  } catch {
    // The shell already holds readable copy; a failed fetch changes nothing.
    return false;
  }

  // Never saved, unpublished, or empty → leave the hand-written markup alone.
  if (!page || !page.saved || page.published === false) return false;
  if (!page.sections?.length && !page.intro) return false;

  // Page header, when the shell exposes the hooks for it.
  const titleEl = document.getElementById('cmsTitle');
  const introEl = document.getElementById('cmsIntro');
  if (titleEl && page.title) titleEl.textContent = page.title;
  if (introEl && page.intro) introEl.textContent = page.intro;

  // #cmsContent is whatever wrapper the shell used for its own copy — an
  // .info-card on most pages, the .team-grid on the team page. Normalise it to
  // a plain prose card so CMS text never inherits a grid meant for tiles.
  host.className = 'info-card';
  host.removeAttribute('style');

  host.innerHTML = `
    ${(page.sections || []).map(s => `
      ${s.heading ? `<h3>${escapeHtml(s.heading)}</h3>` : ''}
      ${paragraphs(s.body)}
    `).join('')}
    ${page.updatedAt
      ? `<p class="cms-stamp">Last updated ${escapeHtml(formatDate(page.updatedAt))}</p>`
      : ''}`;

  document.title = `${page.title} – DiaLux`;
  return true;
}
