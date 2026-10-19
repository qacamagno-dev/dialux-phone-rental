# DiaLux (Phone Rent V1) — Project Structure

A device-rental web app: a **vanilla ES-module frontend** (no build step, no framework)
served by an **Express 5 + MongoDB/Mongoose backend**. Two folders, one origin —
Express serves the static frontend, so the whole thing runs on `localhost:5000`.

---

## Tree

```
Phone Rent V1/
│
├── phone-rental-frontend/              # static site — plain HTML/CSS/ES modules, no bundler
│   ├── index.html                      # landing page + sign-in / sign-up panel
│   ├── products.html                   # catalog; #device-<id> hash opens the detail view
│   ├── cart.html                       # cart review + checkout
│   ├── checkout.html                   # express checkout — one device, cart untouched
│   │                                   #   entered as ?product=<id>&plan=Weekly
│   ├── profile.html                    # account details, saved address, rental history
│   ├── admin.html                      # admin dashboard shell
│   │                                   #   ↑ each page = markup + one <script type="module">
│   │
│   ├── css/
│   │   ├── styles.css                  # design tokens (CSS vars) + all base/layout styles
│   │   └── enhancements.css            # glassmorphism / 3D layer — must load AFTER styles.css
│   │
│   ├── js/
│   │   ├── core/                       # shared plumbing — every page imports from here
│   │   │   ├── api.js                  # fetch wrapper, ApiError, JWT in localStorage,
│   │   │   │                           #   auto-detects same-origin vs :5000 dev server
│   │   │   ├── auth.js                 # session restore, sign-in/out, account dropdown
│   │   │   ├── state.js                # in-memory store; cart = server (signed in)
│   │   │   │                           #   or localStorage (guest), merged on sign-in
│   │   │   ├── ui.js                   # peso()/formatters, toasts, header+footer, reveal observer
│   │   │   └── page.js                 # bootPage() — one bootstrap for chrome, session, hydrate, fx
│   │   │
│   │   ├── pages/                      # one module per HTML page (the actual entry points)
│   │   │   ├── home.js                 # hero slider + featured devices + auth panel
│   │   │   ├── products.js             # filters (client-side) + device detail + reviews
│   │   │   ├── cart.js                 # qty / plan controls, checkout
│   │   │   ├── checkout.js             # express checkout — one device, never via the cart
│   │   │   ├── profile.js              # profile form + order history
│   │   │   └── admin.js                # product CRUD, order management, inventory, reports
│   │   │
│   │   ├── 3d-enhancements.js          # tilt / parallax / reveal effects; respects
│   │   │                               #   prefers-reduced-motion and coarse pointers
│   │   └── app.js                      # ⚠️ LEGACY single-file frontend — no HTML loads it.
│   │                                   #   Superseded by core/ + pages/. Safe to delete.
│   │
│   └── assets/
│       ├── dialux-logo.png             # logo + favicon
│       ├── products/                   # (empty — product images come from URLs in the DB)
│       └── team/                       # (empty)
│
├── phone-rental-backend/               # package name: "dialux-backend"
│   ├── src/
│   │   ├── index.js                    # entry: validates required env, CORS, JSON body limit,
│   │   │                               #   mounts /api/*, serves the frontend, 404 + error handler
│   │   ├── constants.js                # single source of truth for domain enums:
│   │   │                               #   CATEGORIES, GRADES, PLANS, PLAN_DAYS, ORDER_STATUSES,
│   │   │                               #   DELIVERY_FEE — routes, models and validation all read it
│   │   ├── seed.js                     # `npm run seed` — 46-device catalog, upserted by name
│   │   │                               #   (re-runnable); flags: --reset, --admin=email@example.com
│   │   │                               #   Resolves product photos from Wikipedia at seed time;
│   │   │                               #   devices with no article fall back to a category icon
│   │   │
│   │   ├── middlewares/
│   │   │   ├── auth.js                 # verifies Bearer JWT → sets req.userId
│   │   │   └── admin.js                # admin gate; re-reads role from the DB, not the token,
│   │   │                               #   so a demotion takes effect before the 7-day expiry
│   │   │
│   │   ├── models/                     # Mongoose schemas
│   │   │   ├── User.js                 # name, email, password hash, role, embedded delivery profile
│   │   │   ├── Product.js              # name, brand, cat, grade, daily/weekly/monthly rates, stock,
│   │   │   │                           #   plus denormalized avgRating / reviewCount
│   │   │   ├── Cart.js                 # one document per user (unique index on user)
│   │   │   ├── Order.js                # line items snapshot name/rate/deposit at booking time,
│   │   │   │                           #   so later price edits never rewrite order history
│   │   │   └── Review.js               # one review per user per product (unique compound index);
│   │   │                               #   a repeat submission updates rather than duplicates
│   │   │
│   │   └── routes/
│   │       ├── auth.js                 # /api/auth      POST /register /login /google · GET /me
│   │       ├── products.js             # /api/products  GET / /:id · GET /:id/reviews   (public)
│   │       │                           #                POST /:id/reviews  (verified renters only)
│   │       │                           #                POST / · PUT /:id · PATCH /:id/stock
│   │       │                           #                DELETE /:id           (admin only)
│   │       ├── cart.js                 # /api/cart      GET / · POST /items /merge
│   │       │                           #                PATCH /items · DELETE /items and /
│   │       │                           #                (router.use(auth) — all authenticated)
│   │       ├── orders.js               # /api/orders    POST / (cart checkout — clears the cart)
│   │       │                           #                POST /direct ("Order now" — one device,
│   │       │                           #                   leaves the cart untouched)
│   │       │                           #                GET /mine /:id
│   │       │                           #                POST /:id/pay /return /extend /cancel
│   │       │                           #                GET / · GET /reports/summary
│   │       │                           #                PATCH /:id/status     (admin only)
│   │       └── users.js                # /api/users     PATCH /me/profile
│   │                                   #                GET / · PATCH /:id/role  (admin only)
│   │
│   ├── .env                            # real secrets — gitignored, NEVER commit
│   ├── .env.example                    # template: PORT, MONGODB_URI, JWT_SECRET, GOOGLE_CLIENT_ID
│   ├── package.json                    # scripts: start · dev (nodemon) · seed
│   ├── package-lock.json
│   ├── node_modules/                   # gitignored
│   └── .claude/settings.local.json     # local Claude Code settings (gitignored)
│
├── .gitignore                          # node_modules, .env*, logs, dist/build, editor & OS cruft
├── .claude/                            # Claude Code workspace config (settings.local.json gitignored)
├── dialux-status.html                  # generated requirements-audit snapshot (Sep 2026) —
│                                       #   a standalone doc, not part of the app
└── STRUCTURE.md                        # this file
```

---

## How the layers connect

```
Browser                          Express (:5000)                 MongoDB Atlas
──────────────────────────       ────────────────────────         ─────────────
*.html                           src/index.js
  └─ js/pages/<page>.js            ├─ express.static() ──► serves phone-rental-frontend/
       ├─ core/page.js             │
       ├─ core/state.js            ├─ /api/auth      ──► routes/auth.js ──┐
       └─ core/api.js  ──fetch──►  ├─ /api/products  ──► routes/…        ├─► models/*  ──► collections
            (Bearer JWT)           ├─ /api/cart      ──► routes/…        │   (Mongoose)
                                   ├─ /api/orders    ──► routes/…        │
                                   └─ /api/users     ──► routes/…      ──┘
                                        ▲
                          middlewares/auth.js → middlewares/admin.js
```

**Key conventions**

| Concern | Where it lives |
|---|---|
| Domain enums (categories, grades, plans, statuses, fees) | `backend/src/constants.js` — never hardcode these |
| Every HTTP call from the browser | `frontend/js/core/api.js` — pages never call `fetch` directly |
| Shared header / footer / toasts | `frontend/js/core/ui.js` — not duplicated across the 5 HTML files |
| Page startup (chrome, session, data, effects) | `frontend/js/core/page.js` → `bootPage()` |
| Authorization | Server-side (`middlewares/admin.js`). Hiding admin UI is courtesy only. |

---

## Running it

```bash
cd phone-rental-backend
cp .env.example .env      # then fill in MONGODB_URI and JWT_SECRET
npm install
npm run seed              # populate the catalog
npm run dev               # http://localhost:5000  (serves API + frontend)
```

Opening the frontend on a separate dev server (e.g. Live Server on `:5500`) also works —
`core/api.js` detects the mismatch and points itself at `http://localhost:5000`.

---

## Notes / cleanup candidates

- **`frontend/js/app.js`** is dead code: the original monolithic frontend, replaced by
  `core/` + `pages/`. No HTML file references it, and it still points at a hardcoded
  `API_BASE = 'http://localhost:5000/api/auth'`.
- **`assets/products/`** and **`assets/team/`** are empty (Git doesn't track empty
  directories, so they exist only on this machine).
- There is **no root `package.json`** — the two halves are independent; all npm
  commands run from `phone-rental-backend/`.
- Naming is mixed: the folders say *phone-rental* / *PhoneRent*, the product says
  *DiaLux*. Worth settling on one.
