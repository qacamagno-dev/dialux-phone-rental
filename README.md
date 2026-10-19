# DiaLux

A device-rental platform — phones, tablets, laptops and pocket Wi-Fi — with a
customer storefront and an administrator dashboard.

**Stack:** Express 5 + MongoDB (Mongoose) behind a dependency-free
vanilla-ES-module frontend. No bundler, no build step, no framework. Express
serves the static frontend as well as the API, so the whole thing runs on one
origin and one port.

---

## Contents

- [Quick start](#quick-start)
- [Docker](#docker)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [What's in it](#whats-in-it)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Checks and smoke tests](#checks-and-smoke-tests)
- [Notes on the simulated parts](#notes-on-the-simulated-parts)

---

## Quick start

```bash
cd phone-rental-backend
cp .env.example .env        # then fill in MONGODB_URI and JWT_SECRET
npm install
npm run seed                # 46-device catalog, re-runnable
npm run dev                 # http://localhost:5000
```

Open <http://localhost:5000>. The API and the frontend are both there.

**Make yourself an administrator.** Register through the UI first, then:

```bash
npm run seed -- --admin=you@example.com
```

A "Dashboard" link appears in the nav once that account signs in again.

Other seed flags:

| Flag | Effect |
|---|---|
| `--reset` | delete existing products before seeding |
| `--admin=email` | promote that (already registered) account to admin |

Opening the frontend on a separate dev server (Live Server on `:5500`, say)
also works — `js/core/api.js` detects the mismatch and points itself at
`http://localhost:5000`.

---

## Docker

Runs the app **and** its own MongoDB, so no Atlas account is needed.

```bash
# One-time: a JWT secret for the container to use.
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" > .env

docker compose up --build
docker compose exec api node phone-rental-backend/src/seed.js
```

Open <http://localhost:5000>.

```bash
docker compose logs -f api    # follow the server log
docker compose down           # stop; database survives in the volume
docker compose down -v        # stop and delete the database
```

The image is built from `phone-rental-backend/Dockerfile` with the **repository
root** as its build context, because the server also serves the frontend
folder. It is a two-stage build on `node:20-alpine`, installs only production
dependencies from the lockfile, runs as a non-root user, and carries a health
check that fails if the Mongo connection drops.

To build it by hand:

```bash
docker build -f phone-rental-backend/Dockerfile -t dialux .
docker run --rm -p 5000:5000 --env-file phone-rental-backend/.env dialux
```

---

## Deployment

One process serves the API and the frontend, so any Node host works. MongoDB
Atlas has a free tier that is plenty for this.

### Before you deploy — the one thing that matters

Set **`NODE_ENV=production`**.

Outside production, `POST /api/auth/forgot-password` returns the reset link in
its own response body, so the flow is testable on a machine with no mail
server. On a public host that is an account-takeover vector. The server prints a
warning at boot if `NODE_ENV` is not `production`.

### Render

1. New → Web Service → connect the repository.
2. **Environment:** Docker. **Dockerfile path:** `phone-rental-backend/Dockerfile`.
   **Docker build context:** `.` (the repository root).
3. Add the environment variables from the table below.
4. Deploy, then seed once from the Render shell:
   `node phone-rental-backend/src/seed.js --admin=you@example.com`

Render gives you a deploy hook URL under Settings → Deploy Hook. Put it in the
repository's GitHub secrets as `DEPLOY_HOOK_URL` and the CI workflow will
trigger a deploy on every green push to `main`.

### Railway / Fly.io

Both detect the Dockerfile. Railway: set the Dockerfile path and root build
context in the service settings. Fly: `fly launch --dockerfile phone-rental-backend/Dockerfile`,
then `fly secrets set JWT_SECRET=… MONGODB_URI=…`.

### A plain VPS

```bash
git clone <repo> && cd <repo>/phone-rental-backend
npm ci --omit=dev
cp .env.example .env && $EDITOR .env       # NODE_ENV=production
npm run seed
# keep it running:
npx pm2 start src/index.js --name dialux
```

Put nginx or Caddy in front for TLS and proxy to `127.0.0.1:5000`. The server
already sets `trust proxy`, so the audit trail records real client IPs.

### After any deployment

- Update `APP_URL` so email links point at the live host.
- Update the `<meta name="google-client-id">` in the HTML **and** add the live
  origin to the authorised origins of that OAuth client, or Google sign-in
  will fail with a 400.
- Nothing in the frontend needs editing: `api.js` treats any non-localhost
  host as same-origin and calls `/api` relatively.

---

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | **yes** | — | Mongo connection string. The server exits at boot without it. |
| `JWT_SECRET` | **yes** | — | Signs session tokens. Long and random. |
| `PORT` | no | `5000` | Listen port. |
| `NODE_ENV` | no | `development` | Set to `production` on any deployed instance. See the warning above. |
| `APP_URL` | no | `http://localhost:$PORT` | Public base URL for links inside emails. |
| `GOOGLE_CLIENT_ID` | no | — | Enables "Sign in with Google". Other auth works without it. |
| `SMTP_URL` | no | — | Enables real email. Needs `npm i nodemailer` too. |
| `MAIL_FROM` | no | `DiaLux <no-reply@dialux.test>` | From address on outgoing mail. |

---

## What's in it

### Customer

- **Catalog** — category tabs, keyword search, brand/condition/price filters,
  six sort orders, all client-side over the loaded catalog.
- **Device detail** — multi-image gallery with a thumbnail strip, full spec
  table, included-accessories list, plan picker, and reviews with a star
  histogram.
- **Wishlist** — heart any device, from a card or the detail page. Works signed
  out (localStorage) and merges into the account on sign-in. Move one item or
  the whole list into the cart.
- **Cart** — quantities, per-line plans, a rental date range that reprices
  everything, and optional damage protection.
- **Two checkout paths** — the cart, and an express "Order now" that books a
  single device without touching the cart.
- **Bookings** — six-stage tracking timeline with real timestamps, a printable
  invoice, pay / cancel / extend / request-return, and deposit-settlement
  detail once a return closes.
- **Notifications** — a header bell with an unread count. Every booking,
  payment, status move, return, refund and support reply lands there.
- **Account** — editable name and phone, change or set a password, and an
  address book with a default that checkout preselects.
- **Password reset** — email a single-use link, redeem it, sign straight in.
- **Support** — a contact form that creates a real ticket, with the staff reply
  threaded back into the customer's profile and notifications.
- **Reviews** — 1–5 stars with comments, restricted to customers who actually
  rented that device and had it delivered.

### Administrator

- **Products** — full CRUD including the photo gallery and spec parsing.
  Delete is a soft retire so order history survives; retired devices can be
  listed and restored.
- **Orders** — filterable table with a drill-in panel: customer, address,
  line items, payment reference, status moves with a note, and deposit
  settlement (refund plus any withheld amount, with a reason).
- **Inventory** — on-shelf versus rented-out per device, ±1/+5 adjustments,
  and low-stock crossings that actively notify every administrator.
- **Users** — list with per-customer booking count and spend, promote, demote,
  delete. Guards against removing the last administrator, deleting yourself,
  or deleting anyone with an open rental.
- **Support desk** — every ticket, status workflow, threaded replies.
- **Pages** — edit the copy on About, Team, Contact, Help, Terms and Privacy.
  Until a page is saved it serves the copy that ships with the site, so it can
  never end up blank; a saved page can be reverted.
- **Settings** — currency, delivery fee, free-delivery threshold, protection
  rate, min/max rental days, low-stock threshold, which payment methods are
  offered, support email, and a maintenance mode that pauses bookings
  site-wide while leaving administrators working.
- **Announcements** — push a notification to every customer.
- **Audit trail** — every privileged write, with before/after values, actor and
  IP. Filterable and paged. Deliberately has no write endpoint.
- **Reports** — revenue over time (week/month/year), top devices, revenue by
  category, top customers by spend, bookings by status, catalog by condition,
  fleet utilisation, deposits held/refunded/withheld.

---

## Project layout

```
Phone Rent V1/
├── docker-compose.yml              # app + MongoDB
├── .dockerignore
├── .github/workflows/deploy.yml    # CI: parse, parity, build, smoke, deploy
│
├── phone-rental-backend/
│   ├── Dockerfile                  # build context = repository root
│   ├── scripts/
│   │   ├── check-pricing-parity.mjs # server and browser must price alike
│   │   ├── check-page-modules.mjs   # no dead links, scripts or imports
│   │   └── smoke.sh                 # end-to-end API walk
│   └── src/
│       ├── index.js                # env guard, maintenance gate, routers, static
│       ├── constants.js            # domain enums + the shared money functions
│       ├── seed.js                 # 46-device catalog, upserted by name
│       ├── data/pageDefaults.js    # built-in CMS copy
│       ├── middlewares/            # auth · admin · optionalAuth
│       ├── models/                 # User Product Cart Order Review
│       │                           # Notification SupportTicket Page
│       │                           # Settings AuditLog
│       ├── services/               # notify · audit · mailer · stockAlert
│       └── routes/                 # auth products cart orders users
│                                   # wishlist notifications support
│                                   # pages settings audit
│
└── phone-rental-frontend/
    ├── *.html                      # 15 pages, each a shell + one module
    ├── css/
    │   ├── styles.css              # design tokens + base/layout
    │   ├── enhancements.css        # glassmorphism / 3D layer
    │   └── features.css            # everything added after the first build
    └── js/
        ├── core/                   # api · auth · state · ui · page · cms
        ├── pages/                  # one module per page
        └── 3d-enhancements.js      # tilt / flip / ripple / reveal
```

**Conventions worth knowing before editing:**

| Concern | Where it lives |
|---|---|
| Domain enums (categories, grades, plans, statuses) | `backend/src/constants.js` — never hardcode them |
| Prices, fees, currency | the `Settings` document, read via `Settings.get()` — `constants.js` only holds the defaults |
| Every HTTP call from the browser | `frontend/js/core/api.js` — pages never call `fetch` directly |
| Header, footer, bell, badges | `frontend/js/core/ui.js` — mounted into `#siteHeader` / `#siteFooter` |
| Page startup | `frontend/js/core/page.js` → `bootPage()` |
| Authorization | server-side (`middlewares/admin.js`). Hiding admin UI is courtesy only. |
| Notifications, audit entries | `services/notify.js`, `services/audit.js` — both swallow their own failures so a side effect can never break the action that caused it |

`bestValue()` — the cheapest mix of daily/weekly/monthly tiers for N days —
exists in **two** places on purpose: the server prices what it charges, the
browser prices what it quotes. `npm run check:pricing` compares them across
hundreds of cases and fails if they drift.

---

## API reference

All paths are under `/api`. 🔓 public · 🔑 signed in · 🛡 admin.

**Auth** `/auth`
| | |
|---|---|
| 🔓 `POST /register` `POST /login` `POST /google` | sign up / in |
| 🔓 `POST /forgot-password` `POST /reset-password` | reset flow |
| 🔑 `GET /me` · `PATCH /password` | session, change password |

**Products** `/products`
| | |
|---|---|
| 🔓 `GET /` `GET /:id` `GET /:id/reviews` | catalog and reviews |
| 🔑 `POST /:id/reviews` | verified renters only |
| 🛡 `POST /` `PUT /:id` `PATCH /:id/stock` `DELETE /:id` `POST /:id/restore` `GET /all/including-inactive` | catalog management |

**Wishlist** `/wishlist` — 🔑 `GET /` · `POST /:productId` · `DELETE /:productId` · `DELETE /`

**Cart** `/cart` — 🔑 `GET /` · `PATCH /` (dates, protection) · `POST /items` · `PATCH /items` · `DELETE /items` · `DELETE /` · `POST /merge`

**Orders** `/orders`
| | |
|---|---|
| 🔑 `POST /` `POST /direct` | cart checkout · express checkout |
| 🔑 `GET /mine` `GET /:id` | own bookings (`/:id` also allows admin) |
| 🔑 `POST /:id/pay` `/return` `/extend` `/cancel` | customer actions |
| 🛡 `GET /` `PATCH /:id/status` `POST /:id/refund` `GET /reports/summary` | management |

**Users** `/users`
| | |
|---|---|
| 🔑 `PATCH /me` `PATCH /me/profile` | account details |
| 🔑 `GET/POST /me/addresses` · `PATCH/DELETE /me/addresses/:id` · `POST /me/addresses/:id/default` | address book |
| 🛡 `GET /` `PATCH /:id/role` `DELETE /:id` | user management |

**Notifications** `/notifications` — 🔑 `GET /` · `PATCH /:id/read` · `POST /read-all` · `DELETE /:id` · `DELETE /` · 🛡 `POST /broadcast`

**Support** `/support` — 🔓 `POST /` · 🔑 `GET /mine` `GET /:id` `POST /:id/reply` · 🛡 `GET /` `PATCH /:id/status`

**Pages** `/pages` — 🔓 `GET /` `GET /:slug` · 🛡 `PUT /:slug` `DELETE /:slug`

**Settings** `/settings` — 🔓 `GET /` · 🛡 `PUT /`

**Audit** `/audit` — 🛡 `GET /` (read-only by design)

**Health** — 🔓 `GET /health` reports liveness, the Mongo state, the active
mail transport and `NODE_ENV`.

---

## Checks and smoke tests

```bash
cd phone-rental-backend

npm run check            # both static checks
npm run check:pricing    # server vs browser pricing parity
npm run check:links      # dead links, missing scripts, unresolved imports

npm run smoke            # end-to-end API walk against a running server
npm run smoke -- https://your-host.example.com
```

`smoke.sh` registers a throwaway account and walks the real journey: browse,
wishlist, address, cart, dates, protection, checkout, payment, invoice,
support ticket. It then asserts the **negative** cases too — that a customer
account gets 403 from the user list, the audit trail, reports, settings, the
CMS and product writes; that an anonymous caller gets 401 from the cart; that a
double payment is refused; that a forged reset token is rejected; and that the
forgot-password response is byte-identical for a registered and an
unregistered address. Needs `curl` and `jq`.

CI runs the static checks on every push and pull request, builds the image,
and on pushes to `main` boots that image against a real MongoDB and runs the
smoke test against it.

---

## Notes on the simulated parts

Three things are deliberately simulated. None of them pretend otherwise.

**Payments.** There is no gateway. `POST /orders/:id/pay` records a mock
reference (`PAY-XXXXXXXX`) and moves the booking to `payment-confirmed`;
`POST /orders/:id/refund` records the deposit decision (`RFD-XXXXXXXX`) without
moving money. Everything downstream — order state, revenue reports, deposits
held versus refunded versus withheld — is real bookkeeping on top of that.

**Email.** No mail dependency ships in `package.json`, so `npm install` stays
clean. `services/mailer.js` picks a transport at call time: SMTP if `SMTP_URL`
is set *and* `nodemailer` is installed, otherwise it writes the whole message
to the server log and returns `{ delivered: false, transport: 'console' }`.
Callers surface that honestly — the contact form says the ticket is logged
rather than emailed, and the password-reset screen hands you the link. In-app
notifications work regardless, which is why they are the primary channel.

**Image uploads.** There is no upload endpoint or object storage. Product
photos are URLs — up to eight per device, `http(s)` or a path under
`/assets`. The admin form takes one URL per line and the first is the cover.
To use local files, drop them in `phone-rental-frontend/assets/products/` and
reference them as `/assets/products/name.jpg`.

---

*A student project for IT 009 — Systems Integration and Architecture,
Technological Institute of the Philippines, Quezon City.*
