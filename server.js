// Antique shop — public gallery + owner admin + Stripe Buy Now + offers/questions.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = (process.env.ADMIN_PIN || '').trim(); // blank = no PIN (open admin)
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const useSSL = process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: useSSL ? { rejectUnauthorized: false } : false });
const q = (text, params) => pool.query(text, params);

const DEFAULT_SETTINGS = {
  shop_name: process.env.SHOP_NAME || 'Findings at the Ranch',
  tagline: 'Antiques & vintage finds, one of a kind',
  phone: '', email: '', address: '', hours: '',
  about: 'Hand-picked antiques, vintage furniture and collectibles. Every piece is one of a kind — when it\'s gone, it\'s gone.',
  pickup_note: 'Local pickup available. Shipping on smaller items — we\'ll contact you after purchase to arrange.',
  hunt_intro: 'Guided and self-guided hunts on private ranch land. Pick your dates, tell us about your party, and we\'ll confirm your spot.',
  hunt_rules: 'Valid Texas hunting license required. Deposit holds your dates; balance due on arrival. Weather and season dates may change hunts — we\'ll work with you.',
  categories: 'Furniture,Lighting,Glass & China,Decor,Jewelry,Collectibles,Art,Tools & Primitives',
};

async function init() {
  await q(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, price_cents INT NOT NULL DEFAULT 0,
    category TEXT DEFAULT '', era TEXT DEFAULT '', condition TEXT DEFAULT '', dimensions TEXT DEFAULT '',
    description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'available', featured BOOLEAN DEFAULT false,
    accept_offers BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), sold_at TIMESTAMPTZ, sold_via TEXT, sold_price_cents INT)`);
  await q(`CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY, item_id INT REFERENCES items(id) ON DELETE CASCADE, pos INT DEFAULT 0,
    data BYTEA NOT NULL, thumb BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY, item_id INT REFERENCES items(id) ON DELETE SET NULL, kind TEXT NOT NULL,
    name TEXT, phone TEXT, email TEXT, offer_cents INT, message TEXT, status TEXT DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, item_id INT REFERENCES items(id) ON DELETE SET NULL, stripe_session TEXT UNIQUE,
    amount_cents INT, name TEXT, email TEXT, phone TEXT, address TEXT, status TEXT DEFAULT 'paid',
    note TEXT, created_at TIMESTAMPTZ DEFAULT now())`);

  await q(`CREATE TABLE IF NOT EXISTS hunts (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, game TEXT DEFAULT '', description TEXT DEFAULT '', includes TEXT DEFAULT '',
    price_cents INT DEFAULT 0, price_unit TEXT DEFAULT 'per hunter', deposit_cents INT DEFAULT 0, max_party INT DEFAULT 4,
    active BOOLEAN DEFAULT true, photo BYTEA, thumb BYTEA, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE TABLE IF NOT EXISTS hunt_dates (
    id SERIAL PRIMARY KEY, hunt_id INT REFERENCES hunts(id) ON DELETE CASCADE, start_date DATE NOT NULL, end_date DATE,
    spots INT NOT NULL DEFAULT 4, note TEXT DEFAULT '', closed BOOLEAN DEFAULT false)`);
  await q(`CREATE TABLE IF NOT EXISTS hunt_bookings (
    id SERIAL PRIMARY KEY, hunt_date_id INT REFERENCES hunt_dates(id) ON DELETE SET NULL, hunt_id INT REFERENCES hunts(id) ON DELETE SET NULL,
    name TEXT, phone TEXT, email TEXT, party_size INT DEFAULT 1, message TEXT, status TEXT DEFAULT 'new',
    date_label TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING`, [k, v]);
  }
}

async function getSettings() {
  const r = await q(`SELECT key,value FROM settings`);
  const s = { ...DEFAULT_SETTINGS };
  r.rows.forEach(x => { s[x.key] = x.value; });
  s.stripe_enabled = !!STRIPE_KEY;
  s.pin_required = !!ADMIN_PIN;
  return s;
}

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const token = crypto.createHash('sha256').update('antiques:' + ADMIN_PIN).digest('hex');
const admin = (req, res, next) => (!ADMIN_PIN || req.get('x-admin-token') === token ? next() : res.status(401).json({ error: 'Sign in again' }));
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: e.message }); });
const clean = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const cents = v => Math.max(0, Math.round(parseFloat(String(v ?? '0').replace(/[^0-9.]/g, '')) * 100) || 0);
const b64 = s => Buffer.from(String(s).replace(/^data:image\/\w+;base64,/, ''), 'base64');

const ITEM_COLS = `i.id,i.title,i.price_cents,i.category,i.era,i.condition,i.dimensions,i.description,i.status,i.featured,i.accept_offers,i.created_at,i.sold_at,i.sold_via,i.sold_price_cents,
  COALESCE((SELECT json_agg(p.id ORDER BY p.pos,p.id) FROM photos p WHERE p.item_id=i.id),'[]') AS photo_ids`;

app.get('/health', (req, res) => res.send('ok'));

// ---------- public ----------
app.get('/api/settings', wrap(async (req, res) => res.json(await getSettings())));

app.get('/api/items', wrap(async (req, res) => {
  const r = await q(`SELECT ${ITEM_COLS} FROM items i WHERE i.status <> 'hidden'
    ORDER BY (i.status='sold'), i.featured DESC, i.created_at DESC`);
  res.json(r.rows);
}));

app.get('/api/items/:id', wrap(async (req, res) => {
  const r = await q(`SELECT ${ITEM_COLS} FROM items i WHERE i.id=$1 AND i.status <> 'hidden'`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(r.rows[0]);
}));

app.get('/photo/:id', wrap(async (req, res) => {
  const col = req.query.t ? 'thumb' : 'data';
  const r = await q(`SELECT ${col} AS b FROM photos WHERE id=$1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=31536000, immutable').send(r.rows[0].b);
}));

app.post('/api/inquiries', wrap(async (req, res) => {
  const b = req.body || {};
  const kind = ['offer', 'question', 'hold'].includes(b.kind) ? b.kind : 'question';
  if (!clean(b.name) || (!clean(b.phone) && !clean(b.email))) return res.status(400).json({ error: 'Name and a phone or email, please.' });
  if (kind === 'offer' && !cents(b.offer)) return res.status(400).json({ error: 'Enter your offer amount.' });
  await q(`INSERT INTO inquiries(item_id,kind,name,phone,email,offer_cents,message) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [b.item_id || null, kind, clean(b.name, 120), clean(b.phone, 40), clean(b.email, 160), kind === 'offer' ? cents(b.offer) : null, clean(b.message)]);
  res.json({ ok: true });
}));

// ---------- Stripe (REST, no SDK) ----------
async function stripe(method, pathName, form) {
  const r = await fetch('https://api.stripe.com/v1' + pathName, {
    method, headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Stripe error');
  return j;
}
const baseUrl = req => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;

app.post('/api/checkout/:id', wrap(async (req, res) => {
  if (!STRIPE_KEY) return res.status(400).json({ error: 'Online checkout is not turned on yet — use Make an Offer / Ask.' });
  const r = await q(`SELECT ${ITEM_COLS} FROM items i WHERE i.id=$1`, [req.params.id]);
  const it = r.rows[0];
  if (!it || it.status !== 'available') return res.status(400).json({ error: 'Sorry — this piece is no longer available.' });
  const s = await getSettings();
  const base = baseUrl(req);
  const form = {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(it.price_cents),
    'line_items[0][price_data][product_data][name]': it.title.slice(0, 200),
    'line_items[0][price_data][product_data][description]': `${s.shop_name} · Item #${it.id}`.slice(0, 300),
    'phone_number_collection[enabled]': 'true',
    'shipping_address_collection[allowed_countries][0]': 'US',
    'metadata[item_id]': String(it.id),
    success_url: `${base}/?paid={CHECKOUT_SESSION_ID}#/item/${it.id}`,
    cancel_url: `${base}/#/item/${it.id}`,
  };
  if (it.photo_ids[0]) form['line_items[0][price_data][product_data][images][0]'] = `${base}/photo/${it.photo_ids[0]}`;
  const sess = await stripe('POST', '/checkout/sessions', form);
  res.json({ url: sess.url });
}));

// Called by the success page — verifies payment with Stripe, then marks the item sold.
app.post('/api/checkout-confirm', wrap(async (req, res) => {
  if (!STRIPE_KEY) return res.status(400).json({ error: 'Stripe off' });
  const sid = clean(req.body?.session, 300);
  const sess = await stripe('GET', '/checkout/sessions/' + encodeURIComponent(sid));
  if (sess.payment_status !== 'paid') return res.json({ ok: false });
  const itemId = parseInt(sess.metadata?.item_id, 10);
  const exists = await q(`SELECT id FROM orders WHERE stripe_session=$1`, [sid]);
  if (!exists.rows[0]) {
    const cur = await q(`SELECT status FROM items WHERE id=$1`, [itemId]);
    const already = cur.rows[0] && cur.rows[0].status === 'sold';
    const cd = sess.customer_details || {};
    const ship = sess.shipping_details || sess.collected_information?.shipping_details || {};
    const a = ship.address || cd.address || {};
    const addr = [ship.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    await q(`INSERT INTO orders(item_id,stripe_session,amount_cents,name,email,phone,address,status,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [itemId, sid, sess.amount_total, cd.name, cd.email, cd.phone, addr, already ? 'needs refund' : 'paid',
       already ? 'Item was already sold when this payment came in — refund in Stripe.' : null]);
    if (!already) await q(`UPDATE items SET status='sold', sold_at=now(), sold_via='online', sold_price_cents=$2 WHERE id=$1`, [itemId, sess.amount_total]);
  }
  res.json({ ok: true, item_id: itemId });
}));

// ---------- admin ----------
app.post('/api/admin/login', (req, res) => (!ADMIN_PIN || String(req.body?.pin || '') === ADMIN_PIN ? res.json({ token }) : res.status(401).json({ error: 'Wrong PIN' })));

app.get('/api/admin/summary', admin, wrap(async (req, res) => {
  const r = await q(`SELECT
    (SELECT count(*) FROM items WHERE status='available')::int AS available,
    (SELECT count(*) FROM items WHERE status='hold')::int AS hold,
    (SELECT count(*) FROM items WHERE status='sold')::int AS sold,
    (SELECT count(*) FROM items WHERE status='hidden')::int AS hidden,
    (SELECT COALESCE(sum(price_cents),0) FROM items WHERE status IN ('available','hold'))::int AS inventory_value,
    (SELECT COALESCE(sum(sold_price_cents),0) FROM items WHERE status='sold')::int AS sales_total,
    (SELECT count(*) FROM inquiries WHERE status='new')::int AS new_inquiries,
    (SELECT count(*) FROM orders)::int AS orders,
    (SELECT count(*) FROM hunt_bookings WHERE status='new')::int AS hunt_new,
    (SELECT COALESCE(sum(b.party_size),0) FROM hunt_bookings b JOIN hunt_dates d ON d.id=b.hunt_date_id WHERE b.status='confirmed' AND COALESCE(d.end_date,d.start_date) >= CURRENT_DATE)::int AS hunt_upcoming,
    (SELECT count(*) FROM hunt_dates WHERE COALESCE(end_date,start_date) >= CURRENT_DATE AND NOT closed)::int AS hunt_open_dates`);
  res.json(r.rows[0]);
}));

app.get('/api/admin/items', admin, wrap(async (req, res) => {
  res.json((await q(`SELECT ${ITEM_COLS} FROM items i ORDER BY i.created_at DESC`)).rows);
}));

function itemFields(b) {
  const status = ['available', 'hold', 'sold', 'hidden'].includes(b.status) ? b.status : 'available';
  return [clean(b.title, 200) || 'Untitled', cents(b.price), clean(b.category, 80), clean(b.era, 80), clean(b.condition, 80),
    clean(b.dimensions, 120), clean(b.description, 5000), status, !!b.featured, b.accept_offers !== false];
}
async function savePhotos(itemId, photos, startPos) {
  let pos = startPos;
  for (const p of photos || []) {
    if (!p || !p.data || !p.thumb) continue;
    await q(`INSERT INTO photos(item_id,pos,data,thumb) VALUES($1,$2,$3,$4)`, [itemId, pos++, b64(p.data), b64(p.thumb)]);
  }
}

app.post('/api/admin/items', admin, wrap(async (req, res) => {
  const f = itemFields(req.body);
  const r = await q(`INSERT INTO items(title,price_cents,category,era,condition,dimensions,description,status,featured,accept_offers)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, f);
  await savePhotos(r.rows[0].id, req.body.photos, 0);
  res.json({ id: r.rows[0].id });
}));

app.put('/api/admin/items/:id', admin, wrap(async (req, res) => {
  const id = req.params.id; const b = req.body;
  const f = itemFields(b);
  const prev = (await q(`SELECT status FROM items WHERE id=$1`, [id])).rows[0];
  if (!prev) return res.status(404).json({ error: 'Not found' });
  await q(`UPDATE items SET title=$1,price_cents=$2,category=$3,era=$4,condition=$5,dimensions=$6,description=$7,status=$8,featured=$9,accept_offers=$10 WHERE id=$11`, [...f, id]);
  if (f[7] === 'sold' && prev.status !== 'sold') {
    await q(`UPDATE items SET sold_at=now(), sold_via='in store', sold_price_cents=$2 WHERE id=$1`, [id, b.sold_price ? cents(b.sold_price) : f[1]]);
  } else if (f[7] !== 'sold') {
    await q(`UPDATE items SET sold_at=NULL, sold_via=NULL, sold_price_cents=NULL WHERE id=$1`, [id]);
  }
  // photo order (existing ids) + deletions + new uploads
  if (Array.isArray(b.photo_order)) {
    const keep = b.photo_order.map(Number).filter(Boolean);
    await q(`DELETE FROM photos WHERE item_id=$1 AND NOT (id = ANY($2::int[]))`, [id, keep]);
    for (let i = 0; i < keep.length; i++) await q(`UPDATE photos SET pos=$1 WHERE id=$2 AND item_id=$3`, [i, keep[i], id]);
    await savePhotos(id, b.photos, keep.length);
  } else await savePhotos(id, b.photos, 1000);
  res.json({ ok: true });
}));

app.delete('/api/admin/items/:id', admin, wrap(async (req, res) => {
  await q(`DELETE FROM items WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/inquiries', admin, wrap(async (req, res) => {
  res.json((await q(`SELECT n.*, i.title AS item_title, i.price_cents AS item_price, i.status AS item_status,
    (SELECT p.id FROM photos p WHERE p.item_id=n.item_id ORDER BY p.pos,p.id LIMIT 1) AS photo_id
    FROM inquiries n LEFT JOIN items i ON i.id=n.item_id ORDER BY (n.status='new') DESC, n.created_at DESC`)).rows);
}));
app.put('/api/admin/inquiries/:id', admin, wrap(async (req, res) => {
  const st = ['new', 'replied', 'closed'].includes(req.body?.status) ? req.body.status : 'replied';
  await q(`UPDATE inquiries SET status=$1 WHERE id=$2`, [st, req.params.id]);
  res.json({ ok: true });
}));
app.delete('/api/admin/inquiries/:id', admin, wrap(async (req, res) => {
  await q(`DELETE FROM inquiries WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/orders', admin, wrap(async (req, res) => {
  res.json((await q(`SELECT o.*, i.title AS item_title,
    (SELECT p.id FROM photos p WHERE p.item_id=o.item_id ORDER BY p.pos,p.id LIMIT 1) AS photo_id
    FROM orders o LEFT JOIN items i ON i.id=o.item_id ORDER BY o.created_at DESC`)).rows);
}));
app.put('/api/admin/orders/:id', admin, wrap(async (req, res) => {
  await q(`UPDATE orders SET status=$1 WHERE id=$2`, [clean(req.body?.status, 40) || 'paid', req.params.id]);
  res.json({ ok: true });
}));

app.put('/api/admin/settings', admin, wrap(async (req, res) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in (req.body || {})) await q(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [k, clean(req.body[k], 5000)]);
  }
  res.json(await getSettings());
}));

// ---------- hunts ----------
// spots taken = new + confirmed requests (declined/cancelled free the spots)
const DATE_COLS = `d.id,d.hunt_id,to_char(d.start_date,'YYYY-MM-DD') AS start_date,to_char(d.end_date,'YYYY-MM-DD') AS end_date,d.spots,d.note,d.closed,
  COALESCE((SELECT sum(b.party_size) FROM hunt_bookings b WHERE b.hunt_date_id=d.id AND b.status IN ('new','confirmed')),0)::int AS taken`;
const HUNT_COLS = `h.id,h.title,h.game,h.description,h.includes,h.price_cents,h.price_unit,h.deposit_cents,h.max_party,h.active,(h.photo IS NOT NULL) AS has_photo`;

async function huntList(adminView) {
  const hs = (await q(`SELECT ${HUNT_COLS} FROM hunts h ${adminView ? '' : 'WHERE h.active'} ORDER BY h.created_at`)).rows;
  const ds = (await q(`SELECT ${DATE_COLS} FROM hunt_dates d ${adminView ? '' : 'WHERE COALESCE(d.end_date,d.start_date) >= CURRENT_DATE AND NOT d.closed'} ORDER BY d.start_date`)).rows;
  hs.forEach(h => { h.dates = ds.filter(d => d.hunt_id === h.id).map(d => ({ ...d, left: Math.max(0, d.spots - d.taken) })); });
  return hs;
}
app.get('/api/hunts', wrap(async (req, res) => res.json(await huntList(false))));
app.get('/hunt-photo/:id', wrap(async (req, res) => {
  const r = await q(`SELECT ${req.query.t ? 'thumb' : 'photo'} AS b FROM hunts WHERE id=$1`, [req.params.id]);
  if (!r.rows[0] || !r.rows[0].b) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=300').send(r.rows[0].b);
}));
app.post('/api/hunt-bookings', wrap(async (req, res) => {
  const b = req.body || {};
  if (!clean(b.name) || (!clean(b.phone) && !clean(b.email))) return res.status(400).json({ error: 'Name and a phone or email, please.' });
  const d = (await q(`SELECT ${DATE_COLS}, h.title, h.max_party, h.active FROM hunt_dates d JOIN hunts h ON h.id=d.hunt_id WHERE d.id=$1`, [b.hunt_date_id])).rows[0];
  if (!d || !d.active || d.closed) return res.status(400).json({ error: 'Those dates are no longer open.' });
  const party = Math.max(1, Math.min(parseInt(b.party_size, 10) || 1, d.max_party || 50));
  const left = d.spots - d.taken;
  if (party > left) return res.status(400).json({ error: left > 0 ? `Only ${left} spot${left === 1 ? '' : 's'} left on those dates.` : 'Those dates just filled up — pick another.' });
  const label = d.start_date + (d.end_date && d.end_date !== d.start_date ? ' to ' + d.end_date : '');
  await q(`INSERT INTO hunt_bookings(hunt_date_id,hunt_id,name,phone,email,party_size,message,date_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [d.id, d.hunt_id, clean(b.name, 120), clean(b.phone, 40), clean(b.email, 160), party, clean(b.message), label]);
  res.json({ ok: true });
}));

app.get('/api/admin/hunts', admin, wrap(async (req, res) => res.json(await huntList(true))));
function huntFields(b) {
  return [clean(b.title, 200) || 'Hunt', clean(b.game, 120), clean(b.description, 5000), clean(b.includes, 2000), cents(b.price),
    ['per hunter', 'per group', 'per day', 'per hunter / day'].includes(b.price_unit) ? b.price_unit : 'per hunter', cents(b.deposit),
    Math.max(1, parseInt(b.max_party, 10) || 4), b.active !== false];
}
async function saveHuntExtras(id, b) {
  if (b.photo && b.photo.data && b.photo.thumb) await q(`UPDATE hunts SET photo=$2, thumb=$3 WHERE id=$1`, [id, b64(b.photo.data), b64(b.photo.thumb)]);
  if (b.remove_photo) await q(`UPDATE hunts SET photo=NULL, thumb=NULL WHERE id=$1`, [id]);
  if (Array.isArray(b.dates)) {
    const keep = b.dates.filter(d => d.id).map(d => +d.id);
    await q(`DELETE FROM hunt_dates WHERE hunt_id=$1 AND NOT (id = ANY($2::int[]))`, [id, keep]);
    for (const d of b.dates) {
      if (!d.start_date) continue;
      const v = [d.start_date, d.end_date || null, Math.max(1, parseInt(d.spots, 10) || 1), clean(d.note, 200), !!d.closed];
      if (d.id) await q(`UPDATE hunt_dates SET start_date=$1,end_date=$2,spots=$3,note=$4,closed=$5 WHERE id=$6 AND hunt_id=$7`, [...v, d.id, id]);
      else await q(`INSERT INTO hunt_dates(start_date,end_date,spots,note,closed,hunt_id) VALUES($1,$2,$3,$4,$5,$6)`, [...v, id]);
    }
  }
}
app.post('/api/admin/hunts', admin, wrap(async (req, res) => {
  const r = await q(`INSERT INTO hunts(title,game,description,includes,price_cents,price_unit,deposit_cents,max_party,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, huntFields(req.body));
  await saveHuntExtras(r.rows[0].id, req.body); res.json({ id: r.rows[0].id });
}));
app.put('/api/admin/hunts/:id', admin, wrap(async (req, res) => {
  await q(`UPDATE hunts SET title=$1,game=$2,description=$3,includes=$4,price_cents=$5,price_unit=$6,deposit_cents=$7,max_party=$8,active=$9 WHERE id=$10`, [...huntFields(req.body), req.params.id]);
  await saveHuntExtras(req.params.id, req.body); res.json({ ok: true });
}));
app.delete('/api/admin/hunts/:id', admin, wrap(async (req, res) => { await q(`DELETE FROM hunts WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }));
app.get('/api/admin/hunt-bookings', admin, wrap(async (req, res) => {
  res.json((await q(`SELECT b.*, h.title AS hunt_title, h.price_cents, h.price_unit, h.deposit_cents FROM hunt_bookings b LEFT JOIN hunts h ON h.id=b.hunt_id
    ORDER BY (b.status='new') DESC, b.created_at DESC`)).rows);
}));
app.put('/api/admin/hunt-bookings/:id', admin, wrap(async (req, res) => {
  const st = ['new', 'confirmed', 'declined', 'cancelled'].includes(req.body?.status) ? req.body.status : 'new';
  await q(`UPDATE hunt_bookings SET status=$1 WHERE id=$2`, [st, req.params.id]); res.json({ ok: true });
}));
app.delete('/api/admin/hunt-bookings/:id', admin, wrap(async (req, res) => { await q(`DELETE FROM hunt_bookings WHERE id=$1`, [req.params.id]); res.json({ ok: true }); }));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

init().then(() => app.listen(PORT, () => console.log('Antique shop on :' + PORT)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
