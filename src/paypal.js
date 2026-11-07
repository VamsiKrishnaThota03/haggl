// Minimal PayPal REST client for the Orders v2 API (sandbox only).
import crypto from 'node:crypto';
import { HttpError } from './util.js';

const BASE = 'https://api-m.sandbox.paypal.com';

const clientId = () => process.env.PAYPAL_CLIENT_ID || '';
const clientSecret = () => process.env.PAYPAL_CLIENT_SECRET || '';

export const isConfigured = () => Boolean(clientId() && clientSecret());
export const publicClientId = () => clientId();

let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  if (!isConfigured()) throw new HttpError(503, 'PayPal sandbox keys are not configured on the server (see README).');
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('PayPal auth failed:', res.status, data.error_description || data);
    throw new HttpError(502, 'Could not authenticate with PayPal. Check your sandbox Client ID and Secret.');
  }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function call(method, path, body, requestId) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': requestId || crypto.randomUUID(),
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`PayPal ${method} ${path} failed:`, res.status, JSON.stringify(data));
    const issue = data.details?.[0]?.issue || data.name || 'PAYPAL_ERROR';
    throw new HttpError(502, `PayPal rejected the request (${issue}).`);
  }
  return data;
}

/** Create an order for exactly the negotiated amount. The amount comes from the server's deal record, never the browser. */
export function createOrder({ sessionId, title, listPrice, agreedPrice }) {
  const value = agreedPrice.toFixed(2);
  const usd = (v) => ({ currency_code: 'USD', value: v });
  return call('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: sessionId,
        custom_id: sessionId,
        description: `${title} - negotiated by Haggl AI from $${listPrice}`.slice(0, 127),
        amount: { ...usd(value), breakdown: { item_total: usd(value) } },
        items: [{ name: title.slice(0, 127), quantity: '1', unit_amount: usd(value) }],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: { brand_name: 'Haggl', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
      },
    },
  });
}

/** Capture an approved order. Idempotent per order id, so a double click can't charge twice. */
export const captureOrder = (orderId) =>
  call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, undefined, `capture-${orderId}`);

/**
 * Pay the seller their share with the Payouts API. Idempotent per deal via sender_batch_id.
 * https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
 */
export function createPayout({ sessionId, receiver, amount, title }) {
  return call('POST', '/v1/payments/payouts', {
    sender_batch_header: {
      sender_batch_id: `haggl-${sessionId}`,
      email_subject: 'You sold an item on Haggl!',
      email_message: `Your AI agent closed a deal for "${title}". Here is your payout.`.slice(0, 1000),
    },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver,
        amount: { value: amount.toFixed(2), currency: 'USD' },
        note: `Haggl payout: ${title}`.slice(0, 4000),
        sender_item_id: sessionId,
      },
    ],
  }, `payout-${sessionId}`);
}

export const getPayout = (batchId) => call('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);

export const webhookConfigured = () => Boolean(process.env.PAYPAL_WEBHOOK_ID && isConfigured());

/**
 * Ask PayPal to verify a webhook delivery's signature. Fails closed: anything unverifiable is rejected.
 * https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
 */
export async function verifyWebhook(headers, event) {
  if (!webhookConfigured()) throw new HttpError(503, 'Webhooks are not configured (set PAYPAL_WEBHOOK_ID).');
  const h = (name) => headers[name];
  const fields = {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
  };
  if (Object.values(fields).some((v) => !v) || !event?.id) return false;
  const result = await call('POST', '/v1/notifications/verify-webhook-signature', {
    ...fields,
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: event,
  });
  return result.verification_status === 'SUCCESS';
}
