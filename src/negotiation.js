// The negotiation engine.
//
// Design principle: the AI does the *talking* (tone, persuasion, reading the buyer), but deterministic code owns
// the *money*. Every turn the engine computes what the seller is allowed to do, tells the AI, and then verifies
// the AI's answer. The seller's floor price is never sent to the model, so it cannot be leaked or talked out of it.
import * as ai from './ai.js';
import { HttpError, round2, clamp, money, nicePrice, dollarAmounts } from './util.js';
import { save } from './store.js';

const MAX_MESSAGES = 80;
const MAX_AGENT_ROUNDS = 10;

/* ------------------------------------------------------------------ parsing -------------------------------------- */

const ACCEPT_RE = /\b(deal|i'?ll take it|sold|accept(ed)?|agreed|let'?s do it|works for me)\b/i;
const NEGATION_RE = /\b(no|not|never|isn'?t|won'?t|can'?t|don'?t)\b[^.!?]{0,15}\b(deal|take|accept|agree|work)/i;

/** Extract the buyer's price offer from free text, or null. */
export function parseOffer(text) {
  const t = String(text).replace(/,/g, '');
  const dollars = dollarAmounts(t);
  if (dollars.length) return dollars.at(-1);
  const worded = [...t.matchAll(/(\d+(?:\.\d{1,2})?)\s?(?:dollars|bucks|usd)\b/gi)].map((m) => Number(m[1]));
  if (worded.length) return worded.at(-1);
  if (/\b(offer|give|pay|how about|what about|do|take|for)\b/i.test(t)) {
    const bare = [...t.matchAll(/(?<![\w.-])(\d{1,6}(?:\.\d{1,2})?)(?![\w%-])/g)].map((m) => Number(m[1])).filter((n) => n >= 1);
    if (bare.length) return bare.at(-1);
  }
  return null;
}

const isAcceptance = (text) => ACCEPT_RE.test(text) && !NEGATION_RE.test(text);

/* ------------------------------------------------------------------ seller policy -------------------------------- */

/**
 * What the seller may offer this turn. The minimum starts at the list price and concedes toward the
 * (secret) floor as the buyer makes serious offers. Motivated sellers concede faster.
 */
export function sellerBounds(listing, session) {
  const ceiling = session.lastSellerOffer ?? listing.listPrice;
  const step = 0.18 + 0.17 * (listing.urgency ?? 0.5);
  const frac = Math.max(0, 1 - session.offerRounds * step);
  const min = round2(Math.min(ceiling, listing.floorPrice + (listing.listPrice - listing.floorPrice) * frac));
  return { min, max: ceiling };
}

function directiveFor(listing, session, offer) {
  const { min, max } = sellerBounds(listing, session);
  if (offer != null && offer >= min) return { kind: 'accept', price: round2(Math.min(offer, max)), min, max };
  if (offer != null) {
    const target = max - (max - min) * 0.6;
    return { kind: 'counter', min, max, suggested: nicePrice(target, min, max) };
  }
  return { kind: 'chat', min, max };
}

/** Verify and, if needed, correct the AI's proposed action. Returns the final action plus guardrail events. */
export function enforceSellerRules(out, d, offer, listing) {
  const events = [];
  let reply = String(out.reply || '').trim().slice(0, 800);
  let action = out.action;
  let price = out.price == null || !Number.isFinite(Number(out.price)) ? null : round2(out.price);
  const fallback = () => ai.offlineSeller(listing, d, offer).reply;

  if (d.kind === 'accept') {
    if (action !== 'accept' || price !== d.price) {
      if (action !== 'accept') reply = fallback();
      action = 'accept';
      price = d.price;
    }
  } else {
    if (action === 'accept') {
      events.push('The AI tried to accept a price the seller has not authorised. Blocked.');
      action = 'counter';
      price = null;
      reply = '';
    }
    if (action === 'counter') {
      const proposed = price ?? d.suggested ?? d.max;
      const fixed = round2(clamp(proposed, d.min, d.max));
      if (fixed !== proposed) events.push(`The AI proposed ${money(proposed)}, outside what the seller allows. Corrected to ${money(fixed)}.`);
      price = fixed;
      if (!reply || fixed !== proposed) reply = ai.offlineSeller(listing, { ...d, kind: 'counter', suggested: fixed }, offer ?? fixed).reply;
    } else {
      action = 'hold';
      price = null;
    }
  }

  // Leak check: the reply text must never name a price below what the seller allows this turn
  // (quoting the buyer's own offer back is fine).
  const limit = d.kind === 'accept' ? d.price : d.min;
  const leaked = dollarAmounts(reply).filter((a) => a < limit - 0.001 && !(offer != null && Math.abs(a - offer) < 0.01));
  if (leaked.length) {
    events.push(`The reply mentioned ${leaked.map(money).join(', ')}, below the seller's limit. Rewritten.`);
    reply = ai.offlineSeller(listing, action === 'counter' ? { ...d, kind: 'counter', suggested: price } : d, offer ?? price).reply;
  }
  if (!reply) reply = fallback();
  return { reply, action, price, events };
}

/* ------------------------------------------------------------------ turns ---------------------------------------- */

function assertOpen(session) {
  if (session.status !== 'open') throw new HttpError(409, `This negotiation is already ${session.status}.`);
  if (session.messages.length >= MAX_MESSAGES) throw new HttpError(429, 'This negotiation is too long. Start a new one.');
}

// Prevent two turns running at once on the same session (double clicks, autopilot + typing).
const busy = new Set();
async function exclusive(session, fn) {
  if (busy.has(session.id)) throw new HttpError(409, 'Still thinking about your last message...');
  busy.add(session.id);
  try {
    return await fn();
  } finally {
    busy.delete(session.id);
    save();
  }
}

async function runSellerTurn(listing, session, offer) {
  const d = directiveFor(listing, session, offer);
  const out = await ai.sellerReply({ listing, history: session.messages, directive: d, offer });
  const res = enforceSellerRules(out, d, offer, listing);
  if (res.action === 'counter' || res.action === 'accept') session.lastSellerOffer = res.price;
  if (res.action === 'accept') {
    session.status = 'agreed';
    session.agreedPrice = res.price;
    session.agreedAt = Date.now();
  }
  session.messages.push({ role: 'seller', text: res.reply, action: res.action, price: res.price, guardrail: res.events, source: out.source, at: Date.now() });
}

export async function greet(listing, session) {
  const d = { kind: 'greet', min: listing.listPrice, max: listing.listPrice };
  const out = await ai.sellerReply({ listing, history: [], directive: d });
  const res = enforceSellerRules(out, d, null, listing);
  session.lastSellerOffer = listing.listPrice;
  session.messages.push({ role: 'seller', text: res.reply, action: 'hold', price: null, guardrail: res.events, source: out.source, at: Date.now() });
  save();
}

function recordBuyer(session, text, offer, actor) {
  if (offer != null) {
    if (offer >= session.lastSellerOffer * 0.7 || offer >= (session.lastBuyerOffer ?? 0)) session.offerRounds += 1;
    session.lastBuyerOffer = offer;
  }
  session.messages.push({ role: 'buyer', actor, text, offer, at: Date.now() });
}

/** A human buyer sends a chat message. */
export function buyerSays(listing, session, rawText) {
  const text = String(rawText || '').trim().slice(0, 500);
  if (!text) throw new HttpError(400, 'Say something to the seller.');
  return exclusive(session, async () => {
    assertOpen(session);
    let offer = parseOffer(text);
    if (offer == null && isAcceptance(text) && session.lastSellerOffer != null) offer = session.lastSellerOffer;
    recordBuyer(session, text, offer, 'you');
    await runSellerTurn(listing, session, offer);
  });
}

/* ------------------------------------------------------------------ buyer agent ---------------------------------- */

/** Deterministic buyer strategy: open low, concede toward the budget, never exceed it. */
export function buyerPlan(listing, session, budget) {
  const ask = session.lastSellerOffer ?? listing.listPrice;
  const r = session.agentRounds;
  const opening = Math.min(budget, Math.round(listing.listPrice * 0.6));
  const target = Math.min(budget, Math.round(opening + (budget - opening) * Math.min(1, r * 0.3)));
  const why = (s) => `Round ${r + 1} · seller asks ${money(ask)} · budget ${money(budget)} · ${s}`;
  if (ask <= target) return { kind: 'accept', price: ask, why: why(`ask is within my target of ${money(target)}, so I accept.`) };
  if (ask <= budget && r >= 3) return { kind: 'accept', price: ask, why: why('ask is within budget and the seller is slowing down, so I lock it in.') };
  if (r >= MAX_AGENT_ROUNDS) return { kind: 'walk', why: why('too many rounds without a deal, so I walk away.') };
  const last = session.lastBuyerOffer ?? 0;
  const price = Math.min(budget, Math.max(target, last + 1));
  if (price <= last && ask > budget) return { kind: 'walk', why: why('the seller will not come within budget, so I walk away.') };
  const move = last ? `raising my offer by ${money(price - last)} to ${money(price)}` : `opening low at ${money(price)}`;
  return { kind: 'offer', price, why: why(`${move}. I never reveal the budget.`) };
}

/** One round of "my AI vs. their AI": the buyer agent speaks, then the seller agent replies. */
export function agentStep(listing, session, { budget, style }) {
  budget = round2(budget);
  if (!(budget > 0)) throw new HttpError(400, 'Give your agent a budget.');
  return exclusive(session, async () => {
    assertOpen(session);
    const plan = buyerPlan(listing, session, budget);
    const msg = await ai.buyerMessage({ listing, history: session.messages, plan, style });
    let text = msg.text || '';

    if (plan.kind === 'walk') {
      session.messages.push({ role: 'buyer', actor: 'agent', text, offer: null, thought: plan.why, source: msg.source, at: Date.now() });
      session.status = 'walked';
      return { done: true };
    }
    // Buyer-side guardrail: the message must state the planned price and nothing above the budget.
    const named = dollarAmounts(text);
    if (!named.includes(plan.price) || named.some((a) => a > budget)) text = `${text.replace(/\$\s?[\d,.]+/g, '').trim()} I can do ${money(plan.price)}.`.trim();

    session.agentRounds += 1;
    recordBuyer(session, text, plan.price, 'agent');
    Object.assign(session.messages.at(-1), { thought: plan.why, source: msg.source });
    await runSellerTurn(listing, session, plan.price);
    return { done: session.status !== 'open' };
  });
}
