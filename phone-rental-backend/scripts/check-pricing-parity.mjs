// ============================================================
// Pricing parity check
//
// bestValue() is deliberately duplicated: the backend prices what it charges
// (constants.js) and the browser prices what it quotes (core/state.js). If
// the two ever drift, a customer is shown one number and billed another —
// the single worst class of bug this codebase can have.
//
// So CI runs both implementations over a wide grid of rate cards and day
// counts and fails if any pair disagrees.
//
//   node phone-rental-backend/scripts/check-pricing-parity.mjs
// ============================================================

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const server = require(path.join(here, '..', 'src', 'constants.js'));
// import() needs a URL, not a path: on Windows a bare "C:\..." is read as a
// "c:" protocol and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
const client = await import(
  pathToFileURL(path.join(here, '..', '..', 'phone-rental-frontend', 'js', 'core', 'state.js')).href
);

/* ---------------- fixtures ---------------- */

// Real rate cards from the seed, plus the awkward edges: a single tier, a
// zero tier, and a monthly rate that beats seven weeklies.
const RATE_CARDS = [
  { name: 'iPhone 15 Pro Max', daily: 1800, weekly: 9500, monthly: 30000 },
  { name: 'iPhone 13',         daily: 800,  weekly: 4500, monthly: 14000 },
  { name: 'Pocket Wi-Fi',      daily: 150,  weekly: 800,  monthly: 2500 },
  { name: 'daily only',        daily: 500,  weekly: 0,    monthly: 0 },
  { name: 'weekly only',       daily: 0,    weekly: 2000, monthly: 0 },
  { name: 'monthly only',      daily: 0,    weekly: 0,    monthly: 6000 },
  { name: 'no rates',          daily: 0,    weekly: 0,    monthly: 0 },
  { name: 'cheap monthly',     daily: 900,  weekly: 5000, monthly: 9000 },
  { name: 'flat',              daily: 100,  weekly: 700,  monthly: 3000 },
];

// Every day count a customer can realistically pick, plus the boundaries
// where the DP switches tiers, plus nonsense a URL could carry.
const DAYS = [
  ...Array.from({ length: 70 }, (_, i) => i + 1),
  90, 120, 180, 365,
  0, -3, 1.5, 6.99, NaN, undefined, null, '7',
];

/* ---------------- comparison ---------------- */

let checked = 0;
const mismatches = [];

for (const card of RATE_CARDS) {
  for (const days of DAYS) {
    const a = server.bestValue(card, days);
    const b = client.bestValue(card, days);
    checked += 1;
    if (a !== b) {
      mismatches.push({ card: card.name, days: String(days), server: a, browser: b });
    }
  }
}

// daysBetween() feeds bestValue(), so a drift there is just as damaging.
const DATE_PAIRS = [
  ['2026-09-01', '2026-09-08'],
  ['2026-09-01', '2026-09-01'],
  ['2026-09-01', '2026-10-01'],
  ['2026-02-27', '2026-03-01'],
  ['2026-12-28', '2027-01-04'],
  ['2026-09-08', '2026-09-01'],   // reversed
  ['not-a-date', '2026-09-08'],
  ['2026-09-01', ''],
];

for (const [from, to] of DATE_PAIRS) {
  const a = server.daysBetween(from, to);
  const b = client.daysBetween(from, to);
  checked += 1;
  if (a !== b) {
    mismatches.push({ card: 'daysBetween', days: `${from} → ${to}`, server: a, browser: b });
  }
}

// protectionFeeFor() is the third shared money function.
for (const rent of [0, 1, 999, 4500, 9500, 30000, 123456]) {
  for (const pct of [0, 5, 8, 12.5, 100]) {
    const a = server.protectionFeeFor(rent, pct);
    // The browser reads the rate from state.settings rather than an argument.
    client.state.settings = { ...client.state.settings, protectionFeePct: pct };
    const b = client.protectionFeeFor(rent);
    checked += 1;
    if (a !== b) {
      mismatches.push({ card: `protection ${pct}%`, days: `rent ${rent}`, server: a, browser: b });
    }
  }
}

/* ---------------- report ---------------- */

if (mismatches.length) {
  console.error(`✗ ${mismatches.length} of ${checked} pricing checks disagree:\n`);
  mismatches.slice(0, 20).forEach(m => {
    console.error(`  ${m.card} @ ${m.days}: server=${m.server} browser=${m.browser}`);
  });
  if (mismatches.length > 20) console.error(`  … and ${mismatches.length - 20} more`);
  console.error(
    '\nbestValue() / daysBetween() / protectionFeeFor() must stay identical in\n' +
    '  phone-rental-backend/src/constants.js\n' +
    '  phone-rental-frontend/js/core/state.js\n'
  );
  process.exit(1);
}

console.log(`✓ pricing parity — ${checked} checks, server and browser agree`);
