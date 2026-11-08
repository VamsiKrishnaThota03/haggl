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

// Zero code points of decimal digit scripts (Arabic-Indic, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, fullwidth).
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
/** Convert digits from any of those scripts to ASCII, so "$२४०" is checked like "$240". */
export function normalizeDigits(text) {
  return String(text).replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0);
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    return zero == null ? ch : String(cp - zero);
  }).replace(/＄/g, '$');
}

/** All $-prefixed amounts in a string. */
export function dollarAmounts(text) {
  return [...normalizeDigits(text).replace(/,/g, '').matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
