// ============================================================
// Link and asset integrity check
//
// The original build shipped six footer links to pages that did not exist —
// the catch-all route quietly served the homepage instead, so nothing looked
// broken until someone clicked. This makes that class of mistake a CI failure.
//
// Checks, across every HTML file in the frontend:
//   • every <script src> resolves to a real file
//   • every <link rel=stylesheet href> resolves (local ones)
//   • every internal href="/x.html" resolves
//   • every page that expects the shared chrome actually mounts it
//
//   node phone-rental-backend/scripts/check-page-modules.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..', '..', 'phone-rental-frontend');

const problems = [];
const note = (file, msg) => problems.push(`${file}: ${msg}`);

const htmlFiles = fs.readdirSync(FRONTEND).filter(f => f.endsWith('.html'));
if (!htmlFiles.length) {
  console.error('✗ no HTML files found — is the frontend folder in the right place?');
  process.exit(1);
}

/** Does a root-relative or page-relative path exist on disk? */
function resolves(ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return true;
  const rel = clean.startsWith('/') ? clean.slice(1) : clean;
  return fs.existsSync(path.join(FRONTEND, rel));
}

const isExternal = (ref) => /^(https?:)?\/\//i.test(ref) || ref.startsWith('mailto:') || ref.startsWith('tel:');

let scripts = 0;
let styles = 0;
let links = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(FRONTEND, file), 'utf8');

  // ---- <script src> ----
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    const ref = m[1];
    if (isExternal(ref)) continue;
    scripts += 1;
    if (!resolves(ref)) note(file, `script not found → ${ref}`);
  }

  // ---- <link rel="stylesheet"> ----
  for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1];
    if (!href || isExternal(href)) continue;
    styles += 1;
    if (!resolves(href)) note(file, `stylesheet not found → ${href}`);
  }

  // ---- <link rel="icon"> ----
  for (const m of html.matchAll(/<link[^>]*rel="icon"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1];
    if (href && !isExternal(href) && !resolves(href)) {
      note(file, `favicon not found → ${href}`);
    }
  }

  // ---- internal hrefs ----
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const ref = m[1];
    if (isExternal(ref) || ref.startsWith('#') || ref === '/') continue;
    // Only page and asset links — stylesheets are covered above.
    if (!/\.(html|png|jpg|jpeg|svg|webp|pdf|css|js)(\?|#|$)/i.test(ref)) continue;
    links += 1;
    if (!resolves(ref)) note(file, `dead link → ${ref}`);
  }

  // ---- shared chrome ----
  // Every page bar none should mount the shared header and footer; a page that
  // does not gets no cart badge and no notification bell.
  if (!html.includes('id="siteHeader"')) note(file, 'does not mount #siteHeader');
  if (!html.includes('id="siteFooter"')) note(file, 'does not mount #siteFooter');
  if (!html.includes('id="toast"')) note(file, 'has no #toast container');

  // A leftover hardcoded nav means the page has drifted from core/ui.js.
  if (/<header class="glass-nav">/.test(html)) {
    note(file, 'still has a hardcoded <header class="glass-nav"> — use #siteHeader');
  }
}

// ---- ES module imports resolve ----
const jsDir = path.join(FRONTEND, 'js');
let imports = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.js')) continue;

    const src = fs.readFileSync(full, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      imports += 1;
      const target = path.resolve(path.dirname(full), m[1]);
      if (!fs.existsSync(target)) {
        note(path.relative(FRONTEND, full), `import not found → ${m[1]}`);
      }
    }
  }
}
if (fs.existsSync(jsDir)) walk(jsDir);

/* ---------------- report ---------------- */

if (problems.length) {
  console.error(`✗ ${problems.length} integrity problem(s):\n`);
  problems.forEach(p => console.error(`  ${p}`));
  process.exit(1);
}

console.log(
  `✓ integrity — ${htmlFiles.length} pages, ${scripts} scripts, ${styles} stylesheets, ` +
  `${links} links, ${imports} module imports all resolve`
);
