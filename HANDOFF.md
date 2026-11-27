# Findings at the Ranch — HANDOFF (start here)

Antique shop website: owner posts items with phone photos; buyers browse, **Buy Now** (Stripe card checkout) or **Make an Offer / Ask a Question / Hold for pickup**.

## How Steve works (rules)
- Terse, direct. End replies with the app links. Give Render env var names exactly (e.g. `STRIPE_SECRET_KEY`), with clickable Render links.
- UI: wrapped cards (no sideways-scrolling tables), headers aligned with data, summary tiles drill down with a Back button.
- Session holder = manager; hire coders/reviewers on Opus 5.5. Update this file in the same commit as every change.

## Build / run / ship
- Node 20+, Express, Postgres (`pg`). No build step. `npm install` / `npm start`.
- Env vars: `DATABASE_URL` (required), `ADMIN_PIN` (owner sign-in, default 1234 — set it!), `STRIPE_SECRET_KEY` (optional; Buy Now hidden without it), `PUBLIC_URL` (optional), `SHOP_NAME` (optional seed; real name is edited in Admin → Shop Settings).
- Tables auto-create on boot: settings, items, photos (JPEG bytes in Postgres: 1600px main + 480px thumb, resized in the browser), inquiries, orders.
- Routes: `/` shop (hash routes `#/item/:id`, `#/about`), `/admin` owner tools, `/photo/:id[?t=1]`, `/health`.

## Payments
- `POST /api/checkout/:id` makes a Stripe Checkout session (collects phone + US shipping address).
- Success redirect `/?paid=SESSION` → `POST /api/checkout-confirm` verifies with Stripe, records the order, marks item sold.
- If two people pay for the same piece, the second order is flagged **needs refund** in Admin → Online Sales.

## Change log
- 2026-11-27: v1 built. Shop, item pages (swipe gallery, zoom), offers/questions/holds, Stripe Buy Now, admin (dashboard tiles w/ drill-down, post/edit items w/ camera photos + reorder, offers inbox with call/text/email, online sales, shop settings).

## Decisions
- 2026-11-27: Render app (Steve chose over a quick page). Checkout = both Buy Now + offers (Steve). Name "Findings at the Ranch" (Steve).
- 2026-11-27: Photos stored in Postgres (no extra storage account needed); resized client-side to keep DB small.
- 2026-11-27: Stripe via REST (no SDK), verified on success page — no webhook needed for v1.

## Open items
- GitHub repo + Render service + Postgres (waiting on repo).
- Stripe key for Buy Now.
- Optional: email/text alert to owner when an offer comes in; custom domain.
