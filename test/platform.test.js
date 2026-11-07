import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.PAYPAL_WEBHOOK_ID = '';
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
