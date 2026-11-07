import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function seedListings() {
  const now = Date.now();
  return [
    {
      emoji: '📷',
      title: 'Vintage 35mm Film Camera',
      description:
        'All-metal 1970s SLR with a 50mm f/1.8 lens. Light meter works, shutter fires at every speed, new light seals. Small brassing on the top plate.',
      listPrice: 180,
      floorPrice: 130,
      sellerName: 'Vince',
      personality: 'A grumpy-but-fair retired photographer. Loves telling stories about the shots he took with it. Softens up for buyers who are actually going to shoot film.',
      urgency: 0.2,
    },
    {
      emoji: '🚲',
      title: '21-Speed Mountain Bike',
      description:
        'Aluminium frame (M), front suspension, disc brakes serviced last month, new tubes. Ridden mostly on weekends.',
      listPrice: 250,
      floorPrice: 175,
      sellerName: 'Lena',
      personality: 'A busy student moving abroad next week. Friendly, upbeat and genuinely motivated to sell fast, but knows what the bike is worth.',
      urgency: 0.9,
    },
    {
      emoji: '☕',
      title: 'Hand-thrown Ceramic Mug Set (4)',
      description:
        'Four stoneware mugs, speckled oat glaze, 350ml each. Dishwasher safe. Each one is slightly different - made by hand in my studio.',
      listPrice: 64,
      floorPrice: 45,
      sellerName: 'Maya',
      personality: 'A cheerful potter who cares about where her mugs end up. Gives better deals to kind, polite buyers; gets a little firmer with rude ones.',
      urgency: 0.5,
    },
    {
      emoji: '🪑',
      title: 'Mid-century Oak Desk',
      description:
        'Solid oak, 120x60cm, three dovetailed drawers. Refinished with hardwax oil. A couple of honest marks on the left leg.',
      listPrice: 320,
      floorPrice: 240,
      sellerName: 'Raj',
      personality: 'A sharp, data-driven furniture flipper. Cites comparable sales, respects confident buyers, never sounds desperate.',
      urgency: 0.35,
    },
  ].map((l, i) => ({ ...l, id: `seed-${i + 1}`, stock: 3, createdAt: now }));
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { events: [], ...data };
  } catch {
    return { listings: seedListings(), sessions: {}, events: [] };
  }
}

const db = load();

function writeNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  } catch (err) {
    console.error('Could not persist data:', err.message);
  }
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 150);
}

/** Write pending changes immediately (used on shutdown). */
export function flush() {
  clearTimeout(saveTimer);
  writeNow();
}

/** Record a verified PayPal webhook event. Returns false if it was already recorded (PayPal retries deliveries). */
export function addEvent(event) {
  if (db.events.some((e) => e.id === event.id)) return false;
  db.events.unshift(event);
  db.events.length = Math.min(db.events.length, 200);
  save();
  return true;
}
export const events = () => db.events;

/** What anyone on the internet may see about a listing. The floor price and strategy never leave the server. */
export function publicListing(l) {
  const { floorPrice, urgency, ...rest } = l;
  return rest;
}

export const listings = () => db.listings;
export const getListing = (id) => db.listings.find((l) => l.id === id);

export function addListing(data) {
  const listing = { ...data, id: crypto.randomUUID(), stock: data.stock ?? 1, createdAt: Date.now() };
  db.listings.unshift(listing);
  save();
  return listing;
}

export function createSession(listingId) {
  const s = {
    id: crypto.randomUUID(),
    listingId,
    status: 'open', // open -> agreed -> paid  |  open -> walked
    messages: [],
    offerRounds: 0,
    agentRounds: 0,
    lastSellerOffer: null,
    lastBuyerOffer: null,
    agreedPrice: null,
    agreedAt: null,
    orderId: null,
    capture: null,
    createdAt: Date.now(),
  };
  db.sessions[s.id] = s;
  save();
  return s;
}

export const getSession = (id) => db.sessions[id];
export const allSessions = () => Object.values(db.sessions);
