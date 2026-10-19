// ============================================================
// DiaLux — pages/static.js
// The page module for the five read-only content pages: about, team,
// help, terms and privacy.
//
// All it does is boot the shared chrome and let the CMS override the copy
// when an administrator has saved an edit. contact.html has its own module
// because it also carries the support form.
//
// Each shell declares which page it is: <body data-cms-slug="about">.
// ============================================================

import { bootPage } from '../core/page.js';
import { hydrateCmsContent } from '../core/cms.js';

const slug = document.body.dataset.cmsSlug || '';

bootPage('static', () => hydrateCmsContent(slug));
