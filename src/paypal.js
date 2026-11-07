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
