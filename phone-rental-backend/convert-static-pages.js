/* One-off codemod: converts the six static content pages to the shared
   chrome (#siteHeader / #siteFooter), adds features.css, tags each <body>
   with its CMS slug, points them at the right page module, and marks up the
   CMS hooks (#cmsTitle / #cmsIntro / #cmsContent).

   Safe to re-run: every step is guarded or idempotent. Delete after use. */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'phone-rental-frontend');
const PAGES = ['about', 'team', 'contact', 'help', 'terms', 'privacy'];

for (const slug of PAGES) {
  const file = path.join(DIR, `${slug}.html`);
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // 1. features.css, after enhancements.css
  if (!src.includes('css/features.css')) {
    src = src.replace(
      '<link rel="stylesheet" href="css/enhancements.css" />',
      '<link rel="stylesheet" href="css/enhancements.css" />\n  <link rel="stylesheet" href="css/features.css" />'
    );
  }

  // 2. hardcoded header -> shared mount
  src = src.replace(
    /[ \t]*<!-- ===== NAVIGATION ===== -->\s*\r?\n[ \t]*<header class="glass-nav">[\s\S]*?<\/header>/,
    '  <!-- Shared header: nav, wishlist, notification bell, cart badge and\n       the account menu. Rendered by core/ui.js. -->\n  <div id="siteHeader"></div>'
  );

  // 3. hardcoded footer -> shared mount
  src = src.replace(
    /[ \t]*<!-- ===== FOOTER ===== -->\s*\r?\n[ \t]*<footer>[\s\S]*?<\/footer>/,
    '  <div id="siteFooter"></div>'
  );

  // 4. body carries the CMS slug, read by pages/static.js
  if (!src.includes('data-cms-slug')) {
    src = src.replace('<body>', `<body data-cms-slug="${slug}">`);
  }

  // 5. the right page module
  const mod = slug === 'contact' ? 'contact' : 'static';
  src = src.replace('src="js/pages/home.js"', `src="js/pages/${mod}.js"`);

  // 6. CMS hooks on the page header
  if (!src.includes('id="cmsTitle"')) {
    src = src.replace(/<h1>([^<]*)<\/h1>/, '<h1 id="cmsTitle">$1</h1>');
    src = src.replace(
      /(<h1 id="cmsTitle">[^<]*<\/h1>\s*\r?\n\s*)<p>/,
      '$1<p id="cmsIntro">'
    );
  }

  fs.writeFileSync(file, src, 'utf8');

  const checks = {
    features: src.includes('css/features.css'),
    header: src.includes('id="siteHeader"'),
    noOldHeader: !src.includes('class="glass-nav"'),
    footer: src.includes('id="siteFooter"'),
    noOldFooter: !/<footer>/.test(src),
    slug: src.includes(`data-cms-slug="${slug}"`),
    module: src.includes(`js/pages/${mod}.js`),
    cmsTitle: src.includes('id="cmsTitle"'),
    cmsIntro: src.includes('id="cmsIntro"'),
    changed: src !== before,
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`${(slug + '.html').padEnd(14)} ${failed.length ? 'CHECK: ' + failed.join(', ') : 'ok'}`);
}
