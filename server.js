import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './src/store.js';
import * as paypal from './src/paypal.js';
import { aiStatus, draftListing, buyerStyles } from './src/ai.js';
import { greet, buyerSays, agentStep } from './src/negotiation.js';
import { rateLimit } from './src/ratelimit.js';
import { HttpError, round2 } from './src/util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DEAL_TTL_MS = 30 * 60 * 1000;
const startedAt = Date.now();

// Behind a hosting proxy (e.g. Render), trust the first hop so rate limits see the real client IP.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ---------------------------------------------------------------- security headers */

const CSP = [
  "default-src 'self'",
  // The hash allows one small inline bootstrap script that the PayPal SDK injects.
  "script-src 'self' https://*.paypal.com https://*.paypalobjects.com 'sha256-n8SeBQJ44hfg74TlDOKj4U2ORkgMfIj5ms8CC25yEBk='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com",
  "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com",
  'frame-src https://*.paypal.com',
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/vendor/ag-grid', express.static(path.join(__dirname, 'node_modules/ag-grid-community/dist'), { maxAge: '7d' }));

const apiLimit = rateLimit({ max: 300 });
const aiLimit = rateLimit({ max: 40, message: 'The AI agents need a breather. Try again in a minute.' });
const writeLimit = rateLimit({ max: 10, message: 'Too many new listings. Try again in a minute.' });
app.use('/api', apiLimit);

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

/* ---------------------------------------------------------------- health & config */

app.get('/healthz', (req, res) => res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));

app.get('/api/config', (req, res) => {
  res.json({
    ai: aiStatus(),
    paypal: { configured: paypal.isConfigured(), clientId: paypal.publicClientId(), env: 'sandbox', webhooks: paypal.webhookConfigured() },
    buyerStyles,
  });
});

/* ---------------------------------------------------------------- listings */

app.get('/api/listings', (req, res) => res.json(store.listings().map(store.publicListing)));

app.post(
  '/api/listings/draft',
  aiLimit,
  h(async (req, res) => {
    const note = String(req.body?.note || '').trim().slice(0, 600);
    const sellerName = String(req.body?.sellerName || 'Alex').trim().slice(0, 30) || 'Alex';
    if (note.length < 5) throw new HttpError(400, 'Describe the item in a few words first.');
    res.json(await draftListing(note, sellerName));
  }),
);

app.post(
  '/api/listings',
  writeLimit,
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
    if (!(listing.listPrice >= 1 && listing.listPrice <= 10000)) throw new HttpError(400, 'Asking price must be between $1 and $10,000.');
    if (!(listing.floorPrice > 0 && listing.floorPrice <= listing.listPrice))
      throw new HttpError(400, 'Your lowest price must be above $0 and not more than the asking price.');
    res.status(201).json(store.publicListing(store.addListing(listing)));
  }),
);

/* ---------------------------------------------------------------- negotiations */

app.post(
  '/api/sessions',
  aiLimit,
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
  aiLimit,
  h(async (req, res) => {
    const { session, listing } = loadSession(req);
    await buyerSays(listing, session, req.body?.text);
    res.json(view(session, listing));
  }),
);

app.post(
  '/api/sessions/:id/agent-step',
  aiLimit,
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

/* ---------------------------------------------------------------- PayPal webhooks */

const findSessionForEvent = (resource) => {
  const id = resource.custom_id || resource.purchase_units?.[0]?.custom_id;
  if (id && store.getSession(id)) return store.getSession(id);
  // Refund events point at the original capture via an "up" link.
  const captureId = resource.links?.find((l) => l.rel === 'up')?.href?.split('/').pop() || resource.id;
  return store.allSessions().find((s) => s.capture?.id === captureId);
};

app.post(
  '/api/paypal/webhook',
  h(async (req, res) => {
    const event = req.body;
    if (!(await paypal.verifyWebhook(req.headers, event))) throw new HttpError(400, 'Webhook signature could not be verified.');

    const resource = event.resource || {};
    const session = findSessionForEvent(resource);
    const fresh = store.addEvent({
      id: event.id,
      type: event.event_type,
      summary: String(event.summary || '').slice(0, 200),
      amount: resource.amount?.value ? Number(resource.amount.value) : null,
      sessionId: session?.id || null,
      at: Date.now(),
    });
    if (fresh && session) {
      if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') session.webhookConfirmedAt = Date.now();
      if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED' || event.event_type === 'PAYMENT.CAPTURE.REVERSED') session.status = 'refunded';
      store.save();
    }
    res.json({ received: true });
  }),
);

/* ---------------------------------------------------------------- seller dashboard */

app.get('/api/stats', (req, res) => {
  const sessions = store.allSessions();
  const deals = sessions
    .filter((s) => ['agreed', 'paid', 'refunded'].includes(s.status))
    .map((s) => {
      const l = store.getListing(s.listingId);
      return {
        id: s.id,
        title: l?.title || 'Deleted item',
        emoji: l?.emoji || '📦',
        seller: l?.sellerName || '',
        listPrice: l?.listPrice,
        price: s.agreedPrice,
        discountPct: l ? Math.round((1 - s.agreedPrice / l.listPrice) * 100) : 0,
        status: s.status,
        rounds: s.messages.filter((m) => m.role === 'buyer').length,
        byAgent: s.messages.some((m) => m.actor === 'agent'),
        captureId: s.capture?.id || null,
        webhookConfirmed: Boolean(s.webhookConfirmedAt),
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
    buyerSavings: round2(deals.reduce((s, d) => s + (d.listPrice - d.price), 0)),
    avgDiscountPct: deals.length ? Math.round(deals.reduce((s, d) => s + d.discountPct, 0) / deals.length) : 0,
    agentDeals: deals.filter((d) => d.byAgent).length,
    guardrailsTriggered: sessions.reduce((n, s) => n + s.messages.reduce((k, m) => k + (m.guardrail?.length || 0), 0), 0),
    deals: deals.slice(0, 200),
    events: store.events().slice(0, 30),
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------------------------------------------------------------- start */

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  const ai = aiStatus();
  console.log(`\n  Haggl is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  AI:       ${ai.mode === 'gemini' ? `Gemini (${ai.model})` : 'offline negotiator (set GEMINI_API_KEY for real AI)'}`);
  console.log(`  PayPal:   ${paypal.isConfigured() ? 'sandbox keys loaded' : 'NOT configured - set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET'}`);
  console.log(`  Webhooks: ${paypal.webhookConfigured() ? 'enabled' : 'disabled (set PAYPAL_WEBHOOK_ID after deploying)'}\n`);
});

function shutdown(signal) {
  console.log(`${signal} received, saving data and shutting down...`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
