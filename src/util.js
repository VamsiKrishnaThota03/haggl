export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const money = (n) => `$${round2(n).toFixed(2).replace(/\.00$/, '')}`;

/** Round to a "human" price (whole dollars, or multiples of 5 above $100) without leaving [lo, hi]. */
export function nicePrice(n, lo, hi) {
  const step = n >= 100 ? 5 : 1;
  let p = Math.ceil(n / step) * step;
  if (p > hi) p = Math.floor(hi);
  if (p < lo) p = lo;
  return round2(clamp(p, lo, hi));
}

/** All $-prefixed amounts in a string. */
export function dollarAmounts(text) {
  return [...String(text).replace(/,/g, '').matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
