// Pure logic for Kaki Home: dates, expiry, stock, consumption patterns and the shopping list.
// No DOM and no storage here, so the unit tests (test/logic.test.mjs) can run it in Node.

export const DAY = 86400000;

// Local calendar dates as 'YYYY-MM-DD' (expiry dates are calendar days, not instants).
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return ymd(d);
}
// Whole days from a to b (both 'YYYY-MM-DD'); negative when b is before a.
export function daysBetween(a, b) {
  const x = parseYmd(a), y = parseYmd(b);
  if (!x || !y) return null;
  return Math.round((y - x) / DAY);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- stock -------------------------------------------------------------------------------------------------

export const totalQty = item => (item.batches || []).reduce((n, b) => n + (Number(b.qty) || 0), 0);

// The date a batch should be used by: the printed date, or "opened on + keeps N days after opening",
// whichever comes first.
export function batchUseBy(batch, item) {
  let d = batch.expiry || null;
  if (batch.openedAt && item.openDays > 0) {
    const o = addDays(batch.openedAt, Number(item.openDays));
    if (!d || o < d) d = o;
  }
  return d;
}

// Batches in "first expiring, first out" order: opened ones first, then by use-by date (no date last).
export function fefo(item) {
  return [...(item.batches || [])].filter(b => b.qty > 0).sort((a, b) => {
    if (!!a.openedAt !== !!b.openedAt) return a.openedAt ? -1 : 1;
    const x = batchUseBy(a, item) || '9999', y = batchUseBy(b, item) || '9999';
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function nextUseBy(item) {
  const b = fefo(item).map(b => batchUseBy(b, item)).filter(Boolean).sort();
  return b[0] || null;
}

// 'expired' | 'soon' (within 7 days) | 'month' (within 30) | 'ok' | 'none' (no date)
export function expiryStatus(date, today = ymd()) {
  if (!date) return 'none';
  const d = daysBetween(today, date);
  if (d < 0) return 'expired';
  if (d <= 7) return 'soon';
  if (d <= 30) return 'month';
  return 'ok';
}

export function expiryLabel(date, today = ymd()) {
  if (!date) return '';
  const d = daysBetween(today, date);
  if (d < -1) return `expired ${-d} days ago`;
  if (d === -1) return 'expired yesterday';
  if (d === 0) return 'use by today';
  if (d === 1) return 'use by tomorrow';
  if (d <= 60) return `${d} days left`;
  const m = Math.round(d / 30.4);
  if (m < 24) return `${m} months left`;
  return `${Math.round(d / 365)} years left`;
}

// Stock changes. Each returns { item, event } (a new item object; never mutates the one given).
function ev(item, type, qty, by, at = new Date().toISOString(), extra = {}) {
  return { id: uid(), itemId: item.id, name: item.name, type, qty, at, by: by || '', ...extra };
}

export function addStock(item, { qty = 1, expiry = null, by, at, price = null } = {}) {
  const batches = [...(item.batches || []), { id: uid(), qty: Number(qty) || 1, expiry: expiry || null, openedAt: null, addedAt: ymd(at ? new Date(at) : new Date()) }];
  return { item: { ...item, batches }, event: ev(item, 'add', Number(qty) || 1, by, at, price != null ? { price } : {}) };
}

// Take n units out of the batches, first expiring first. type: 'use' (used up) or 'discard' (thrown away).
// The event also says how the units stood against their dates, for "used before expiry" (Kaki Home's main
// measure): saved = units used up while still in date (dated batches only); a discard where every unit was already
// past its date is recorded as type 'expired', so wasted-because-forgotten shows apart from thrown away.
export function takeOut(item, { qty = 1, type = 'use', by, at, batchId = null, today = ymd() } = {}) {
  let left = Number(qty) || 1;
  const order = batchId ? (item.batches || []).filter(b => b.id === batchId) : fefo(item);
  const take = new Map();
  let inDate = 0, past = 0;
  for (const b of order) {
    if (left <= 0) break;
    const n = Math.min(b.qty, left);
    take.set(b.id, n);
    left -= n;
    const d = batchUseBy(b, item);
    if (d && d < today) past += n; else if (d) inDate += n;
  }
  const taken = (Number(qty) || 1) - left;
  if (!taken) return { item, event: null };
  const batches = (item.batches || []).map(b => take.has(b.id) ? { ...b, qty: b.qty - take.get(b.id) } : b).filter(b => b.qty > 0);
  const kind = type === 'discard' && past === taken ? 'expired' : type;
  return { item: { ...item, batches }, event: ev(item, kind, taken, by, at, kind === 'use' && inDate ? { saved: inDate } : {}) };
}

// Open one unit: split it off its batch with today's opening date (so "keeps N days after opening" starts).
export function openOne(item, { by, at, today = ymd(), batchId = null } = {}) {
  const b = fefo(item).find(b => !b.openedAt && (!batchId || b.id === batchId));
  if (!b) return { item, event: null };
  const batches = [];
  for (const x of item.batches || []) {
    if (x.id !== b.id) { batches.push(x); continue; }
    batches.push({ ...x, id: uid(), qty: 1, openedAt: today });
    if (x.qty > 1) batches.push({ ...x, qty: x.qty - 1 });
  }
  return { item: { ...item, batches }, event: ev(item, 'open', 1, by, at) };
}

// ---- consumption patterns ------------------------------------------------------------------------------------

// Thrown away, for whatever reason ('expired': it was already past its date).
export const WASTE = new Set(['discard', 'expired']);

// From an item's events: how fast the household gets through it.
// daysPerUnit: average days one unit lasts (needs two or more "used up" events).
export function usage(events, now = new Date()) {
  const uses = events.filter(e => e.type === 'use').sort((a, b) => (a.at < b.at ? -1 : 1));
  const units = uses.reduce((n, e) => n + (e.qty || 1), 0);
  const discards = events.filter(e => WASTE.has(e.type)).reduce((n, e) => n + (e.qty || 1), 0);
  const out = { uses: uses.length, units, discards, daysPerUnit: null, perMonth: null, lastUse: uses.length ? uses[uses.length - 1].at : null };
  if (uses.length >= 2) {
    const span = (new Date(uses[uses.length - 1].at) - new Date(uses[0].at)) / DAY;
    const counted = units - (uses[0].qty || 1);   // the first finish only marks the start of the clock
    if (span >= 1 && counted > 0) {
      out.daysPerUnit = span / counted;
      out.perMonth = 30.4 / out.daysPerUnit;
    }
  }
  // the last 6 calendar months, oldest first, units used up in each
  const months = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: m.toLocaleString('en-SG', { month: 'short' }), used: 0, wasted: 0 });
  }
  for (const e of events) {
    const k = String(e.at).slice(0, 7);
    const m = months.find(x => x.key === k);
    if (!m) continue;
    if (e.type === 'use') m.used += e.qty || 1;
    if (WASTE.has(e.type)) m.wasted += e.qty || 1;
  }
  out.months = months;
  return out;
}

// When the stock will run out at the usual pace ('YYYY-MM-DD'), or null without a pattern yet.
// The unit in use started at the last "used up"; every unit in stock lasts daysPerUnit.
export function runOutDate(item, u, now = new Date()) {
  if (!u || !u.daysPerUnit || !u.lastUse) return null;
  const qty = totalQty(item);
  const end = new Date(new Date(u.lastUse).getTime() + Math.max(qty, 0) * u.daysPerUnit * DAY);
  return ymd(end < now ? now : end);
}

export function paceLabel(u) {
  if (!u || !u.daysPerUnit) return '';
  const d = u.daysPerUnit;
  if (d < 1.5) return 'about 1 a day';
  if (d < 10) return `1 every ${Math.round(d)} days`;
  if (d < 60) return `1 every ${Math.round(d / 7)} week${Math.round(d / 7) === 1 ? '' : 's'}`;
  return `1 every ${Math.round(d / 30.4)} month${Math.round(d / 30.4) === 1 ? '' : 's'}`;
}

// ---- the shopping list ---------------------------------------------------------------------------------------

// Items to buy: out of stock, at or below their "running low" level, or due to run out within `days`.
export function toBuy(items, eventsByItem, { days = 7, now = new Date() } = {}) {
  const today = ymd(now);
  const out = [];
  for (const it of items) {
    if (it.archived || it.noRestock) continue;
    const q = totalQty(it);
    const low = Number(it.lowAt) || 0;
    const u = usage(eventsByItem.get(it.id) || [], now);
    const ro = runOutDate(it, u, now);
    let why = null;
    if (q <= 0) why = 'out';
    else if (q <= low) why = 'low';
    else if (ro && daysBetween(today, ro) <= days) why = 'soon';
    if (why) out.push({ item: it, why, runOut: ro, qty: q });
  }
  const rank = { out: 0, low: 1, soon: 2 };
  return out.sort((a, b) => rank[a.why] - rank[b.why] || a.item.name.localeCompare(b.item.name));
}

// Items whose next use-by date is past or within `days`.
export function expiring(items, { days = 14, today = ymd() } = {}) {
  return items
    .filter(it => !it.archived && totalQty(it) > 0)
    .map(it => ({ item: it, date: nextUseBy(it) }))
    .filter(x => x.date && daysBetween(today, x.date) <= days)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- search --------------------------------------------------------------------------------------------------

export const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Simple word-prefix scoring, good enough for a few hundred names.
export function score(query, text) {
  const q = norm(query).split(' ').filter(Boolean);
  if (!q.length) return 0;
  const t = norm(text);
  const words = t.split(' ');
  let s = 0;
  for (const w of q) {
    if (words.some(x => x === w)) s += 3;
    else if (words.some(x => x.startsWith(w))) s += 2;
    else if (t.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

export function fairpriceUrl(q) { return 'https://www.fairprice.com.sg/search?query=' + encodeURIComponent(q); }
export function shengSiongUrl(q) { return 'https://shengsiong.com.sg/search/' + encodeURIComponent(q); }

// ---- export ----------------------------------------------------------------------------------------------------

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(items, today = ymd()) {
  const rows = [['Name', 'Brand', 'Size', 'Category', 'Where', 'Quantity', 'Next use-by', 'Status', 'Barcode']];
  for (const it of items) {
    if (it.archived) continue;
    const d = nextUseBy(it);
    rows.push([it.name, it.brand, it.size, it.category, it.location, totalQty(it), d || '', d ? expiryLabel(d, today) : '', it.barcode]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

// ---- small words for the screens -------------------------------------------------------------------------------

// A short badge for a use-by date: 'Expired', 'Today', 'Tomorrow', '3 days', '2 weeks', or '' when it is far off.
// tone: 'bad' (expired), 'warn' (within 7 days), 'plain' (within 30 days), '' (later or no date).
export function shortLabel(date, today = ymd()) {
  if (!date) return { text: '', tone: '' };
  const d = daysBetween(today, date);
  if (d < 0) return { text: 'Expired', tone: 'bad' };
  if (d === 0) return { text: 'Today', tone: 'warn' };
  if (d === 1) return { text: 'Tomorrow', tone: 'warn' };
  if (d <= 7) return { text: `${d} days`, tone: 'warn' };
  if (d <= 30) { const w = Math.round(d / 7); return { text: `${w} week${w === 1 ? '' : 's'}`, tone: 'plain' }; }
  return { text: '', tone: '' };
}

// Why something is on the shopping list, in words.
export function whyText(b, today = ymd()) {
  if (b.why === 'out') return 'None left';
  if (b.why === 'low') return `Only ${b.qty} left`;
  const d = daysBetween(today, b.runOut);
  return d <= 0 ? 'Runs out about now' : `Runs out in about ${d} day${d === 1 ? '' : 's'}`;
}

// This month's totals from the events (units): used, bought, wasted (thrown away, expired included), expired, and
// saved: used up while still in date, Kaki Home's main measure ("household waste prevented").
export function monthStats(events, month = ymd().slice(0, 7)) {
  const out = { used: 0, wasted: 0, bought: 0, expired: 0, saved: 0 };
  for (const e of events) {
    if (!String(e.at).startsWith(month)) continue;
    const n = Number(e.qty) || 1;
    if (e.type === 'use') { out.used += n; out.saved += Math.min(n, Number(e.saved) || 0); }
    else if (WASTE.has(e.type)) { out.wasted += n; if (e.type === 'expired') out.expired += n; }
    else if (e.type === 'add') out.bought += n;
  }
  return out;
}

// Items added in the last `days` days, newest first (for "Recently added").
export function recent(items, { days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  return items.filter(it => !it.archived && (it.createdAt || '') >= since).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// The shopping list as plain text to share (WhatsApp, Notes).
export function shareText(lines) {
  return 'Shopping list\n' + (lines.length ? lines.map(l => '- ' + l).join('\n') : '(nothing to buy)');
}

// ---- backups ---------------------------------------------------------------------------------------------------

export function backup(data, at = new Date().toISOString()) {
  return { app: 'kakihome', v: 1, at, items: data.items || [], events: data.events || [], shop: data.shop || [], photos: data.photos || [] };
}
// Reads a backup file's text. Returns { items, events, shop, photos } with only well-formed documents, or throws a plain
// message when the file is not a Kaki Home backup.
export function parseBackup(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not a Kaki Home backup.'); }
  if (!j || j.app !== 'kakihome' || typeof j !== 'object') throw new Error('That file is not a Kaki Home backup.');
  const ok = o => o && typeof o === 'object' && typeof o.id === 'string' && o.id && !o.id.includes('/');
  const out = {};
  for (const k of ['items', 'events', 'shop', 'photos']) out[k] = Array.isArray(j[k]) ? j[k].filter(ok) : [];
  out.photos = out.photos.filter(p => typeof p.data === 'string' && p.data.startsWith('data:image/'));
  return out;
}
