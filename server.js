import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './src/store.js';
import * as paypal from './src/paypal.js';
import { aiStatus, draftListing, buyerStyles } from './src/ai.js';
import { greet, buyerSays, agentStep } from './src/negotiation.js';
import { HttpError, round2 } from './src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DEAL_TTL_MS = 30 * 60 * 1000;

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.expose) console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong.' });
  });

function loadSession(req) {
  const session = store.getSession(req.params.id);
  if (!session) throw new HttpError(404, 'Negotiation not found.');
  const listing = store.getListing(session.listingId);
  if (!listing) throw new HttpError(404, 'Listing not found.');
  return { session, listing };
}

const view = (session, listing) => ({ ...session, listing: store.publicListing(listing) });

/* ---------------------------------------------------------------- config & listings */

app.get('/api/config', (req, res) => {
  res.json({
    ai: aiStatus(),
    paypal: { configured: paypal.isConfigured(), clientId: paypal.publicClientId(), env: 'sandbox' },
    buyerStyles,
  });
});

app.get('/api/listings', (req, res) => res.json(store.listings().map(store.publicListing)));

app.post(
  '/api/listings/draft',
  h(async (req, res) => {
    const note = String(req.body?.note || '').trim().slice(0, 600);
    const sellerName = String(req.body?.sellerName || 'Alex').trim().slice(0, 30) || 'Alex';
    if (note.length < 5) throw new HttpError(400, 'Describe the item in a few words first.');
    res.json(await draftListing(note, sellerName));
  }),
);

app.post(
  '/api/listings',
  h(async (req, res) => {
    const b = req.body || {};
    const text = (v, max) => String(v ?? '').trim().slice(0, max);
    const listing = {
      title: text(b.title, 80),
      description: text(b.description, 600),
      emoji: [...text(b.emoji, 8)][0] || '📦',
      sellerName: text(b.sellerName, 30) || 'Alex',
      personality: text(b.personality, 300) || 'Friendly and honest.',
      listPrice: round2(b.listPrice),
      floorPrice: round2(b.floorPrice),
      urgency: Math.min(1, Math.max(0, Number(b.urgency ?? 0.5))) || 0.5,
      stock: 1,
    };
    if (!listing.title) throw new HttpError(400, 'Add a title.');
    if (!(listing.listPrice >= 1 && listing.listPrice <= 10000)) throw new HttpError(400, 'List price must be between $1 and $10,000.');
    if (!(listing.floorPrice > 0 && listing.floorPrice <= listing.listPrice))
      throw new HttpError(400, 'Your lowest price must be above $0 and not more than the list price.');
    res.status(201).json(store.publicListing(store.addListing(listing)));
  }),
);

/* ---------------------------------------------------------------- negotiations */

app.post(
  '/api/sessions',
  h(async (req, res) => {
    const listing = store.getListing(String(req.body?.listingId || ''));
    if (!listing) throw new HttpError(404, 'Listing not found.');
    if (listing.stock < 1) throw new HttpError(409, 'Sorry, this item has sold out.');
    const session = store.createSession(listing.id);
    await greet(listing, session);
    res.status(201).json(view(session, listing));
  }),
);

app.get(
  '/api/sessions/:id',
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    res.json(view(session, listing));
  }),
);

app.post(
  '/api/sessions/:id/messages',
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    await buyerSays(listing, session, req.body?.text);
    res.json(view(session, listing));
  }),
);

app.post(
  '/api/sessions/:id/agent-step',
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    const budget = Number(req.body?.budget);
    if (!(budget >= 1 && budget <= 10000)) throw new HttpError(400, 'Budget must be between $1 and $10,000.');
    const style = buyerStyles.includes(req.body?.style) ? req.body.style : 'friendly';
    const { done } = await agentStep(listing, session, { budget, style });
    res.json({ done, session: view(session, listing) });
  }),
);

/* ---------------------------------------------------------------- PayPal checkout */

app.post(
  '/api/sessions/:id/paypal/order',
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    if (session.status !== 'agreed') throw new HttpError(409, 'Agree on a price before paying.');
    if (Date.now() - session.agreedAt > DEAL_TTL_MS) throw new HttpError(410, 'This deal expired. Start a new negotiation.');
    if (listing.stock < 1) throw new HttpError(409, 'Sorry, this item just sold out.');
    const order = await paypal.createOrder({
      sessionId: session.id,
      title: listing.title,
      listPrice: listing.listPrice,
      agreedPrice: session.agreedPrice,
    });
    session.orderId = order.id;
    store.save();
    res.json({ orderId: order.id });
  }),
);

app.post(
  '/api/sessions/:id/paypal/capture',
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    const orderId = String(req.body?.orderId || '');
    if (session.status === 'paid') return res.json(view(session, listing));
    if (session.status !== 'agreed') throw new HttpError(409, 'There is no agreed deal to pay for.');
    if (!orderId || orderId !== session.orderId) throw new HttpError(400, 'This PayPal order does not belong to this deal.');

    const result = await paypal.captureOrder(orderId);
    const unit = result.purchase_units?.[0];
    const cap = unit?.payments?.captures?.[0];
    const paidValue = Number(cap?.amount?.value);
    if (result.status !== 'COMPLETED' || cap?.status !== 'COMPLETED' || unit?.reference_id !== session.id || paidValue !== session.agreedPrice) {
      console.error('Unexpected capture result', JSON.stringify(result));
      throw new HttpError(402, 'PayPal did not complete the payment for the agreed amount.');
    }

    session.status = 'paid';
    session.capture = {
      id: cap.id,
      amount: paidValue,
      currency: cap.amount.currency_code,
      payer: result.payer?.name?.given_name || 'Buyer',
      at: Date.now(),
    };
    listing.stock = Math.max(0, listing.stock - 1);
    store.save();
    res.json(view(session, listing));
  }),
);

/* ---------------------------------------------------------------- seller dashboard */

app.get('/api/stats', (req, res) => {
  const sessions = store.allSessions();
  const deals = sessions
    .filter((s) => s.status === 'agreed' || s.status === 'paid')
    .map((s) => {
      const l = store.getListing(s.listingId);
      return {
        id: s.id,
        title: l?.title || 'Deleted item',
        emoji: l?.emoji || '📦',
        listPrice: l?.listPrice,
        price: s.agreedPrice,
        status: s.status,
        rounds: s.messages.filter((m) => m.role === 'buyer').length,
        byAgent: s.messages.some((m) => m.actor === 'agent'),
        captureId: s.capture?.id || null,
        guardrails: s.messages.reduce((n, m) => n + (m.guardrail?.length || 0), 0),
        at: s.capture?.at || s.agreedAt,
      };
    })
    .sort((a, b) => b.at - a.at);
  const paid = deals.filter((d) => d.status === 'paid');
  res.json({
    negotiations: sessions.length,
    dealsAgreed: deals.length,
    dealsPaid: paid.length,
    revenue: round2(paid.reduce((s, d) => s + d.price, 0)),
    avgDiscountPct: deals.length ? Math.round((deals.reduce((s, d) => s + (1 - d.price / d.listPrice), 0) / deals.length) * 100) : 0,
    guardrailsTriggered: sessions.reduce((n, s) => n + s.messages.reduce((k, m) => k + (m.guardrail?.length || 0), 0), 0),
    deals: deals.slice(0, 25),
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`\n  Haggl is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  AI:     ${ai.mode === 'gemini' ? `Gemini (${ai.model})` : 'offline negotiator (set GEMINI_API_KEY for real AI)'}`);
  console.log(`  PayPal: ${paypal.isConfigured() ? 'sandbox keys loaded' : 'NOT configured - set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET'}\n`);
});
