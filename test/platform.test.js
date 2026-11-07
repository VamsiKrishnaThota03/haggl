import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PAYPAL_WEBHOOK_ID = '';
process.env.DATA_DIR = (await import('node:os')).tmpdir() + '/haggl-test-platform-' + process.pid;
const { rateLimit } = await import('../src/ratelimit.js');
const paypal = await import('../src/paypal.js');
const { buyerPlan } = await import('../src/negotiation.js');

test('rate limiter blocks requests over the limit', () => {
  const limit = rateLimit({ max: 2 });
  const results = [];
  for (let i = 0; i < 3; i++) {
    const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { results.push(c); return this; }, json() { return this; } };
    limit({ ip: '1.2.3.4' }, res, () => results.push(200));
  }
  assert.deepEqual(results, [200, 200, 429]);
});

test('webhooks fail closed when not configured', async () => {
  await assert.rejects(() => paypal.verifyWebhook({}, { id: 'WH-1' }), /not configured/);
});

test('buyer agent explains its reasoning without exceeding budget', () => {
  const listing = { listPrice: 200 };
  const plan = buyerPlan(listing, { lastSellerOffer: 190, agentRounds: 1, lastBuyerOffer: 120 }, 160);
  assert.equal(plan.kind, 'offer');
  assert.ok(plan.price <= 160 && plan.price > 120);
  assert.match(plan.why, /Round 2/);
});

test('shopping agent understands budgets and finds matching listings offline', async () => {
  process.env.GEMINI_API_KEY = '';
  const { parseBudget, planShopping } = await import('../src/ai.js');
  assert.equal(parseBudget('a bike for commuting under $200'), 200);
  assert.equal(parseBudget('max 150 for a desk'), 150);
  assert.equal(parseBudget('a camera'), null);
  const listings = [
    { id: 'a', title: 'Road Bike', description: 'fast bike', listPrice: 280 },
    { id: 'b', title: 'Ceramic Mugs', description: 'four mugs', listPrice: 60 },
    { id: 'c', title: 'City Bike with Basket', description: 'commuter bike', listPrice: 190 },
  ];
  const plan = await planShopping('a bike for commuting under $200', listings);
  assert.equal(plan.budget, 200);
  assert.deepEqual(plan.picks.map((p) => p.id).sort(), ['a', 'c']);
});

test('public listings never expose the seller payout email', async () => {
  const store = await import('../src/store.js');
  const pub = store.publicListing({ id: 'x', title: 't', floorPrice: 1, urgency: 0.5, sellerPaypalEmail: 'a@b.com' });
  assert.equal(pub.sellerPaypalEmail, undefined);
});
