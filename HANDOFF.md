# Findings at the Ranch — HANDOFF (start here)

Antique shop website + ranch hunt booking. Owner posts items with phone photos; buyers browse, **Buy Now** (Stripe card checkout) or **Make an Offer / Ask a Question / Hold for pickup**. Hunters pick open hunt dates and request a spot; owner confirms in admin.

## How Steve works (rules)
- Terse, direct. End replies with the app links. Give Render env var names exactly (e.g. `STRIPE_SECRET_KEY`), with clickable Render links.
- UI: wrapped cards (no sideways-scrolling tables), headers aligned with data, summary tiles drill down with a Back button.
- Session holder = manager; hire coders/reviewers on Opus 5.5. Update this file in the same commit as every change.

## Build / run / ship
- Node 20+, Express, Postgres (`pg`). No build step. `npm install` / `npm start`.
- Env vars: `DATABASE_URL` (required), `ADMIN_PIN` (owner sign-in; blank/unset = no PIN, admin is open), `STRIPE_SECRET_KEY` (optional; Buy Now hidden without it), `PUBLIC_URL` (optional), `SHOP_NAME` (optional seed; real name is edited in Admin → Shop Settings).
- Tables auto-create on boot: settings, items, photos (JPEG bytes in Postgres: 1600px main + 480px thumb, resized in the browser), inquiries, orders.
- Routes: `/` landing page (`#/`), shop `#/shop[?cat=]`, `#/item/:id`, hunts `#/hunts`, `#/about`, `/admin` owner tools, `/photo/:id[?t=1]`, `/health`.

## Hunts
- Tables: hunts (title, game, price + unit, deposit, max party, includes, photo), hunt_dates (start/end, spots, note, closed), hunt_bookings (party size, contact, status new/confirmed/declined/cancelled).
- Spots left = spots − (new + confirmed party sizes). Server rejects requests over the spots left. Declined/cancelled free spots.
- No online payment for hunts — request only; owner calls to confirm and collect deposit.
- Admin tabs: Hunt Bookings (filter by status / by date; call/text/email; Confirm/Decline/Cancel) and Hunts & Dates (editor with date rows). Dashboard tiles drill down.

## Payments
- `POST /api/checkout/:id` makes a Stripe Checkout session (collects phone + US shipping address).
- Success redirect `/?paid=SESSION` → `POST /api/checkout-confirm` verifies with Stripe, records the order, marks item sold.
- If two people pay for the same piece, the second order is flagged **needs refund** in Admin → Online Sales.

## Change log
- 2026-11-27: Catchy landing page (sunset ranch hero, polaroid photos of real listings, ticker, Just Found, Shop by Treasure, How it works, story + stats, final CTA). Shop moved to #/shop.
- 2026-11-27: Book a Hunt — public hunts page with open dates + booking request form; admin to add hunts/dates/spots and manage bookings.
- 2026-11-27: Pages show "Loading…" + a visible error message instead of ever going blank (Steve saw a white screen right after first deploy; server/API checked fine).
- 2026-11-27: Owner PIN optional — blank ADMIN_PIN opens /admin with no sign-in (Steve: "No pin right now").
- 2026-11-27: v1 built. Shop, item pages (swipe gallery, zoom), offers/questions/holds, Stripe Buy Now, admin (dashboard tiles w/ drill-down, post/edit items w/ camera photos + reorder, offers inbox with call/text/email, online sales, shop settings).

## Decisions
- 2026-11-27: Steve asked for a catchy landing page and a Book a Hunt page with admin for hunt dates. Hunts are request-to-book (no payment) since Stripe isn't on yet.
- 2026-11-27: No PIN for now, no Stripe yet (Steve). Buy Now stays hidden until STRIPE_SECRET_KEY is set. Add a PIN before sharing the site widely — /admin is open to anyone who finds it.
- 2026-11-27: Render app (Steve chose over a quick page). Checkout = both Buy Now + offers (Steve). Name "Findings at the Ranch" (Steve).
- 2026-11-27: Photos stored in Postgres (no extra storage account needed); resized client-side to keep DB small.
- 2026-11-27: Own repo FINDINGS-AT-THE-RANCH (Steve created it); Render MY APPS workspace, ohio.
- 2026-11-27: Stripe via REST (no SDK), verified on success page — no webhook needed for v1.

## Where it lives
- Repo: WSS5480/FINDINGS-AT-THE-RANCH (main auto-deploys)
- Render MY APPS: web service findings-at-the-ranch (srv-dc4j6849v7es73f64350, ohio, 0.5c-512mb) → https://findings-at-the-ranch.onrender.com
- Postgres: findings-at-the-ranch-db (dpg-dc4j63vf3r2c73bj0v90-a, basic_256mb, ohio)

## Open items
- Steve pastes the DB's Internal Database URL into the service as DATABASE_URL (Render API doesn't expose the password).
- Stripe key for Buy Now (later, per Steve).
- Turn the PIN back on before going public.
- Optional: email/text alert to owner when an offer comes in; custom domain.
