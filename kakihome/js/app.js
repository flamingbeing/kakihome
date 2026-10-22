// Kaki Home: a household's inventory, on the home app kit (https://design.flamingbeing.com/v1/: DESIGN-APP.md).
// Screens are hash routes drawn by haRouter (every screen and sheet is a history entry, so the iPhone edge swipe and
// Android back always work). Each screen is an HTML string drawn from the state S; clicks are handled by one listener
// reading data-act attributes. Data lives in one of three backends (store.js, cloud.js): this phone (IndexedDB),
// the household's shared copy (Firestore), or memory only (demo mode, ?demo).
import * as L from './logic.js';
import { CATALOGUE, CATEGORIES, LOCATIONS } from './catalogue.js';
import { openLocal, openMemory, prefs, KINDS, PHOTOS } from './store.js';
import { sampleData } from './sample.js';
import { openWelcome, viewGuide, welcomed, markWelcomed, installed } from './guide.js';
import { starterChoices, tourTasks } from './tour.js';
import * as MG from './merge.js';
import { firebaseConfig } from '../config.js';
import {
  haRouter, haGo, haBack, haSheet, haCloseSheet, haSheetOpen, haConfirm, haToast, haHideToast, haStepper, haVersion,
  haIcon, haEsc as esc, haAnnounce, haLargeTitle,
} from 'https://design.flamingbeing.com/v1/app.js';

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const EMULATOR = params.has('emulator') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const WELCOME = params.has('welcome');   // show the welcome even in the demo, or again

const S = {
  items: new Map(), events: new Map(), shop: new Map(), settings: new Map(), pics: new Map(),
  backend: null, local: null, mode: DEMO ? 'demo' : 'local', cloud: null, user: null, household: null, allHouseholds: [], lookupFailed: false, creating: false, pending: null, localCount: 0,
  q: '', place: '', sort: prefs.get('sort', 'expiry'),
  draft: null, dirty: false, pendingRender: false, syncError: false,
  originTab: '#/', backLabel: 'Kaki Home',
};

// Product pictures: the photo, or a neutral kit icon for the category (no emoji).
const CAT_ICON = {
  'Sauces & condiments': 'bottle', 'Rice, noodles & grains': 'bowl', 'Canned & jarred': 'tin', 'Cooking & baking': 'jar',
  'Breakfast & spreads': 'jar', Drinks: 'cup', 'Dairy & eggs': 'carton', 'Bread & bakery': 'bread', 'Fresh produce': 'leaf',
  'Meat & seafood': 'fish', Frozen: 'snowflake', Snacks: 'cookie', Baby: 'heart', 'Laundry & cleaning': 'sparkle',
  'Kitchen & paper': 'roll', Toiletries: 'droplet', 'Medicine & first aid': 'pill', Pet: 'paw', Other: 'box',
};
const icon = (name, o) => haIcon(name, o);
const chevron = () => icon('chevron-right', { cls: 'ha-row-chevron' });

// Names the household gave its members (settings/people: { names: { email: name } }), shared with everyone in it.
const names = () => S.settings.get('people')?.names || {};
const NAME_MAX = 40;
// How a member shows: their name if someone gave one, else their email.
const personLabel = email => names()[email] || email;
// The name this phone signs changes with: the household's name for me, this phone's own, or my Google first name.
const me = () => S.user?.email || '';
const who = () => (S.user && names()[S.user.email]) || prefs.get('name') || S.user?.name?.split(' ')[0] || '';
const items = () => [...S.items.values()].filter(i => !i.archived);
const eventsFor = id => [...S.events.values()].filter(e => e.itemId === id);
function eventsByItem() {
  const m = new Map();
  for (const e of S.events.values()) { if (!m.has(e.itemId)) m.set(e.itemId, []); m.get(e.itemId).push(e); }
  return m;
}
const today = () => L.ymd();
// How many days ahead counts as "expiring soon" (Settings; per phone).
const soonDays = () => Number(prefs.get('soonDays', 7)) || 7;
const SOON = { 3: '3 days', 7: '1 week', 14: '2 weeks' };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const route = () => R?.route || { parts: [] };
const screen = () => route().parts[0] || 'home';

// ---- saving ----------------------------------------------------------------------------------------------------

function save(kind, obj) {
  if (kind === 'items') {
    obj = { ...obj, updatedAt: new Date().toISOString(), updatedBy: who() };
    if (obj.photo === '') delete obj.photo;   // left by older versions; pictures are `thumb` + photos/<id> now
  }
  S[kind].set(obj.id, obj);
  S.backend.put(kind, obj);
  return obj;
}
function remove(kind, id) {
  S[kind].delete(id);
  S.backend.del(kind, id);
}
// ---- photos (photo.js): a tiny `thumb` on the item for every list; the photo itself in photos/<item id>, read only
// when the item is opened (cached here, keyed by the thumb it belongs to, so a household member's new photo is fetched).
// Items from before 16 Oct 2026 may still carry the whole photo as `photo`: shown as it is until migratePhotos() moves it.

const thumbSrc = it => it.thumb || it.photo || '';
function bestPic(it) {
  if (it.photo) return it.photo;
  const c = S.pics.get(it.id);
  return c && c.thumb === (it.thumb || '') && c.data ? c.data : it.thumb || '';
}
const fetching = new Set();
function wantPhoto(it) {
  if (!it.hasPhoto || it.photo || fetching.has(it.id)) return;
  const ver = it.thumb || '', c = S.pics.get(it.id);
  if (c && c.thumb === ver) return;
  fetching.add(it.id);
  Promise.resolve().then(() => S.backend.get(PHOTOS, it.id)).then(doc => {
    S.pics.set(it.id, { thumb: ver, data: doc?.data || null });
    const img = document.getElementById('kh-hero');
    if (doc?.data && img && img.dataset.id === it.id) img.src = doc.data;
  }, () => { /* no signal: the thumbnail stays; tried again next time */ }).finally(() => fetching.delete(it.id));
}
function savePhoto(id, thumb, data) {
  S.pics.set(id, { thumb, data });
  return S.backend.put(PHOTOS, { id, data, updatedAt: new Date().toISOString() });
}
function delPhoto(id) {
  S.pics.delete(id);
  S.backend.del(PHOTOS, id);
}
async function photoOf(it) {
  if (!it.hasPhoto) return null;
  const c = S.pics.get(it.id);
  if (c?.data) return c.data;
  // not fetched yet: ask, but never hold up a delete for long (no signal)
  const got = Promise.resolve().then(() => S.backend.get(PHOTOS, it.id)).then(d => d?.data || null, () => null);
  return Promise.race([got, new Promise(r => setTimeout(() => r(null), 1500))]);
}
// An old-style item (whole photo inside it) as { item, doc }: the item with a thumbnail, and its photos document.
// null when the picture can't be read.
async function splitOld(it) {
  try {
    const { picturesFromData } = await import('./photo.js');
    const p = await picturesFromData(it.photo);
    const item = { ...it, thumb: p.thumb, hasPhoto: true };
    delete item.photo;
    return { item, doc: { id: it.id, data: p.photo, updatedAt: new Date().toISOString() } };
  } catch { return null; }
}
// Before copying or restoring into the household (whose rules refuse old-style photos): split every old-style item.
async function splitAll(data) {
  const have = new Set(data.photos.map(p => p.id));
  data.items = await Promise.all(data.items.map(async it => {
    if (it.photo === '' || (it.photo && typeof it.photo !== 'string')) { const x = { ...it }; delete x.photo; return x; }
    if (!it.photo) return it;
    const s = await splitOld(it);
    if (!s) { const x = { ...it }; delete x.photo; return x; }   // an unreadable picture is left behind
    if (!have.has(it.id)) data.photos.push(s.doc);
    return s.item;
  }));
  return data;
}
// Moves old-style photos out of their items, quietly, a few a second: the photo is written first, and only once it is
// saved does the item lose its `photo` (so a photo is never lost). Runs again whenever items load or change.
let migrating = false;
async function migratePhotos() {
  if (migrating) return;
  migrating = true;
  let moved = 0;
  try {
    const skip = new Set();
    for (;;) {
      const it = [...S.items.values()].find(i => typeof i.photo === 'string' && i.photo && !skip.has(i.id));
      if (!it) break;
      const backend = S.backend;
      const s = await splitOld(it);
      if (!s) { skip.add(it.id); continue; }   // unreadable: left as it is
      if ((await backend.put(PHOTOS, s.doc)) === false) { skip.add(it.id); continue; }
      if (backend !== S.backend) break;   // signed in or out meanwhile: done on the next load
      const cur = S.items.get(it.id);
      if (cur && cur.photo === it.photo) {
        const next = { ...cur, thumb: s.item.thumb, hasPhoto: true };
        delete next.photo;
        S.items.set(next.id, next);
        S.pics.set(next.id, { thumb: next.thumb, data: s.doc.data });
        await backend.put('items', next);
        moved++;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  } finally { migrating = false; }
  if (moved) redraw();
}

// Apply a stock change from logic.js ({ item, event }) and offer Undo.
function apply(res, msg) {
  if (!res.event) { haToast('Nothing in stock to do that with'); return; }
  const before = S.items.get(res.item.id);
  save('items', res.item);
  save('events', res.event);
  redraw();
  haToast(msg, { action: 'Undo', onAction: () => { save('items', before); remove('events', res.event.id); redraw(); haAnnounce('Undone'); } });
}

// ---- small pieces --------------------------------------------------------------------------------------------------

function thumb(it, cls = 'ha-row-thumb') {
  const src = thumbSrc(it);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="">` : `<span class="${cls}">${icon(CAT_ICON[it.category] || 'box')}</span>`;
}
function badge(date) {
  const b = L.shortLabel(date, today());
  if (!b.text) return '';
  const tone = { bad: ' ha-badge--bad', warn: ' ha-badge--warn' }[b.tone] || '';
  return `<span class="ha-badge${tone}">${esc(b.text)}</span>`;
}
const subOf = it => [it.brand, it.size].filter(Boolean).map(esc).join(' · ');
function itemRow(it, { sub, trail } = {}) {
  const q = L.totalQty(it);
  const s = sub ?? [q ? `${q} left` : 'None left', esc(it.location || '')].filter(Boolean).join(' · ');
  const t = trail ?? badge(L.nextUseBy(it));
  return `<li><a class="ha-row kh-item" href="#/item/${esc(it.id)}">${thumb(it)}
    <span class="ha-row-body"><span class="ha-row-title">${esc(it.name)}</span>${s ? `<span class="ha-row-sub">${s}</span>` : ''}</span>
    ${t ? `<span class="ha-row-trail">${t}</span>` : ''}${chevron()}</a></li>`;
}
function section(title, body, { count = '', action = '', footer = '', id = '' } = {}) {
  const hid = 'h-' + (id || title.toLowerCase().replace(/[^a-z]+/g, '-'));
  return `<section class="ha-section" aria-labelledby="${hid}"><h2 class="ha-section-header" id="${hid}"><span>${esc(title)}</span>${action || (count !== '' ? `<span class="ha-num">${count}</span>` : '')}</h2>${body}${footer ? `<p class="ha-section-footer">${footer}</p>` : ''}</section>`;
}
function fmt(ymd) {
  const d = L.parseYmd(ymd);
  if (!d) return ymd || '';
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const fmtTime = iso => fmt(L.ymd(new Date(iso)));
function quickDates() {
  const t = today();
  return [['1 week', L.addDays(t, 7)], ['1 month', L.addDays(t, 30)], ['3 months', L.addDays(t, 91)], ['6 months', L.addDays(t, 182)], ['1 year', L.addDays(t, 365)]];
}
const dateChips = (name, value) => `<div class="ha-chips ha-chips--wrap kh-dates" role="group" aria-label="Quick dates" data-for="${name}">${quickDates().map(([l, v]) =>
  `<button type="button" class="ha-chip" aria-pressed="${v === value}" data-act="date" data-v="${v}">${l}</button>`).join('')}<button type="button" class="ha-chip" aria-pressed="false" data-act="date" data-v="">No date</button></div>`;
const shopQuery = it => [it.brand, it.name].filter(Boolean).join(' ').replace(/\(.*?\)/g, '').trim();
const onList = id => [...S.shop.values()].some(m => m.itemId === id && !m.done);

// ---- the bar ----------------------------------------------------------------------------------------------------

function setBar({ title = '', lead = '', trail = '', solid = false }) {
  $('#bar-title').textContent = title;
  $('#bar-lead').innerHTML = lead;
  $('#bar-trail').innerHTML = trail;
  $('.ha-bar').classList.toggle('ha-bar--solid', solid);
}
const backBtn = label => `<button type="button" class="ha-bar-btn ha-back" data-act="back">${icon('chevron-left')}<span>${esc(label)}</span></button>`;
const textBtn = (label, act, extra = '') => `<button type="button" class="ha-bar-btn" data-act="${act}"${extra}>${esc(label)}</button>`;
const iconBtn = (name, label, act) => `<button type="button" class="ha-bar-btn" data-act="${act}" aria-label="${esc(label)}">${icon(name)}</button>`;

// ---- Home -------------------------------------------------------------------------------------------------------

function statusLine() {
  if (S.mode === 'demo') return 'Demo: a made-up household of three. Nothing is saved.';
  if (S.mode === 'cloud') {
    if (!navigator.onLine) return 'Offline. Changes reach the household when there’s signal.';
    const n = S.household?.members?.length || 1;
    return n > 1 ? `Shared with ${plural(n - 1, 'other person', 'other people')}` : 'Shared household';
  }
  return 'Saved on this phone';
}
function viewHome() {
  const all = items();
  let h = `<h1 class="ha-large-title">Kaki Home</h1><p class="ha-large-sub">${esc(statusLine())}</p>`;
  if (S.syncError) h += `<div class="ha-panel kh-alert" role="status">${icon('alert')}<span>Some changes didn’t reach the household. ${esc(S.syncError)}</span></div>`;
  if (S.mode === 'cloud' && S.allHouseholds.length > 1) h += `<a class="ha-panel kh-alert" href="#/settings">${icon('alert')}<span>You’re in more than one household. Merge them in Settings.</span></a>`;
  h += viewTour();
  if (!all.length) {
    return h + `<div class="ha-card ha-empty">
      <span class="ha-empty-icon">${icon('box')}</span>
      <p class="ha-empty-title">Nothing here yet</p>
      <p class="ha-empty-text">Add what’s in the fridge and cupboards. Kaki Home then shows what to use first and what to buy.</p>
      <button type="button" class="ha-btn ha-btn--primary" data-act="start">Pick what you have</button>
      <button type="button" class="ha-btn ha-btn--secondary" data-act="go-add">Add one item</button>
      <button type="button" class="ha-btn ha-btn--plain" data-act="sample">Try it with sample items</button>
      <a class="ha-btn ha-btn--plain" href="#/guide">How to use Kaki Home</a>
    </div>`;
  }
  const t = today();
  const exp = L.expiring(all, { days: soonDays(), today: t });
  const expired = exp.filter(x => x.date < t), soon = exp.filter(x => x.date >= t);
  const buy = L.toBuy(all, eventsByItem());
  const low = buy.filter(b => b.why !== 'soon' || b.qty <= 0);
  const fresh = L.recent(all, { days: 7 });
  const listed = new Set(exp.map(x => x.item.id));
  const opened = all.filter(it => !listed.has(it.id) && (it.batches || []).some(b => b.openedAt && b.qty > 0));
  const m = L.monthStats([...S.events.values()], t.slice(0, 7));
  const tile = (n, label, href) => href
    ? `<a class="ha-stat kh-stat" href="${href}"><span class="ha-stat-value">${n}</span><span class="ha-stat-label">${label}</span></a>`
    : `<div class="ha-stat"><span class="ha-stat-value">${n}</span><span class="ha-stat-label">${label}</span></div>`;
  h += `<div class="ha-stats kh-stats" aria-label="Summary">
    ${tile(all.length, 'Items at home', '#/items')}
    ${tile(expired.length + soon.length, `Expiring within ${esc(SOON[soonDays()] || soonDays() + ' days')}`, '#/')}
    ${tile(low.length, 'Low in stock', '#/shop')}
    ${tile(fresh.length, 'Added this week')}
  </div>`;
  // the main measure: things used up before their date this month
  h += `<div class="ha-card kh-goal" aria-labelledby="kh-goal-h"><p class="ha-card-kicker" id="kh-goal-h">Used before expiry this month</p>
    <p class="ha-card-title">${m.saved}</p>
    <p class="ha-card-text">${m.wasted ? `${plural(m.wasted, 'thing')} thrown away${m.expired ? `, ${m.expired} of them past their date` : ''}.` : 'Nothing thrown away this month.'}</p></div>`;
  if (expired.length) h += section('Expired', `<ul class="ha-list">${expired.map(x => itemRow(x.item)).join('')}</ul>`, { count: expired.length, footer: 'Used it or binned it? Open the item and tap Used 1 or Bin 1.' });
  h += section('Use soon', soon.length ? `<ul class="ha-list">${soon.map(x => itemRow(x.item)).join('')}</ul>` : '', { count: soon.length || '', footer: soon.length ? `Within the next ${esc(SOON[soonDays()] || soonDays() + ' days')}. Use these first.` : `Nothing runs out of date in the next ${esc(SOON[soonDays()] || soonDays() + ' days')}.` });
  if (opened.length) h += section('Opened', `<ul class="ha-list">${opened.map(it => itemRow(it)).join('')}</ul>`, { count: opened.length });
  if (buy.length) {
    h += section('Running low', `<ul class="ha-list">${buy.slice(0, 5).map(b => itemRow(b.item, { sub: esc(L.whyText(b, t)), trail: '' })).join('')}</ul>`,
      { id: 'low', action: `<a href="#/shop">Shopping list</a>`, footer: buy.length > 5 ? `${buy.length - 5} more on the shopping list.` : '' });
  }
  if (fresh.length) {
    h += section('Recently added', `<ul class="ha-list">${fresh.slice(0, 5).map(it => itemRow(it, { sub: esc(['Added', it.createdBy ? `by ${it.createdBy}` : '', fmtTime(it.createdAt)].filter(Boolean).join(' ')) })).join('')}</ul>`,
      { id: 'recent', footer: fresh.length > 5 ? `${fresh.length - 5} more this week.` : '' });
  }
  const mrow = (ic, cls, title, n) => `<li><div class="ha-row"><span class="ha-row-icon${cls}">${icon(ic)}</span><span class="ha-row-body"><span class="ha-row-title">${title}</span></span><span class="ha-row-value">${n}</span></div></li>`;
  h += section('This month', `<ul class="ha-list">
    ${mrow('check', '', 'Used up', m.used)}
    ${mrow('clock', '', 'Used before expiry', m.saved)}
    ${mrow('cart', ' ha-row-icon--grey', 'Bought', m.bought)}
    ${mrow('alert', ' ha-row-icon--bad', 'Expired', m.expired)}
    ${mrow('trash', ' ha-row-icon--bad', 'Thrown away (all)', m.wasted)}
  </ul>`, { id: 'month', footer: 'Binning something past its date counts as expired.' });
  return h;
}

// ---- first steps (tour.js): the Getting started checklist and the quick start --------------------------------------

const tourOn = () => prefs.get('tour') === 'on';
const flags = () => prefs.get('tourFlags', {}) || {};
function flag(k) { if (!tourOn() || flags()[k]) return; prefs.set('tourFlags', { ...flags(), [k]: true }); }
function tasks() {
  const sharing = !S.cloud?.configured ? 'none' : (S.household?.members?.length || 0) > 1 ? 'in' : 'out';
  return tourTasks({ items: items(), events: [...S.events.values()], flags: flags(), installed: installed(), sharing });
}
function viewTour() {
  if (!tourOn()) return '';
  const list = tasks(), done = list.filter(t => t.done).length;
  if (done === list.length) {
    return section('Getting started', `<div class="ha-card kh-tour-done"><p class="ha-card-title">All set</p>
      <p class="ha-card-text">You know your way around. The guide in Settings has the rest.</p>
      <button type="button" class="ha-btn ha-btn--secondary" data-act="tour-hide">Hide this</button></div>`, { id: 'tour' });
  }
  const row = t => `<li><div class="ha-row kh-tour-row${t.done ? ' is-done' : ''}">
      <span class="kh-tour-mark" aria-hidden="true">${t.done ? icon('check') : ''}</span>
      <span class="ha-row-body"><span class="ha-row-title">${esc(t.title)}<span class="ha-sr">${t.done ? ', done' : ', to do'}</span></span><span class="ha-row-sub">${esc(t.sub)}</span></span>
      ${t.done ? '' : `<span class="ha-row-trail"><button type="button" class="ha-btn ha-btn--small" data-act="tour-show" data-task="${t.id}" aria-label="Show me: ${esc(t.title)}">Show me</button></span>`}
    </div></li>`;
  return section('Getting started', `<ul class="ha-list kh-tour">${list.map(row).join('')}</ul>
    <p class="kh-tour-foot"><button type="button" class="ha-btn ha-btn--plain ha-btn--compact" data-act="tour-hide">Hide this list</button></p>`,
    { id: 'tour', count: `${done} of ${list.length}` });
}
// Point at a button on the screen just drawn: scroll it into view, ring it for a few seconds, focus it.
function spotlight(sel) {
  setTimeout(() => {
    const el = $(sel); if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.add('kh-spot');
    el.focus({ preventScroll: true });
    setTimeout(() => el.classList.remove('kh-spot'), 4500);
  }, 400);
}
function showMe(task) {
  if (task === 'stock') return openStarter();
  if (task === 'say') return openQuick();
  if (task === 'use') {
    const all = items().filter(it => L.totalQty(it) > 0);
    const first = L.expiring(all, { days: 3650 })[0]?.item || all[0];
    if (!first) { haToast('Add something first'); return openStarter(); }
    haGo('#/item/' + first.id);
    return spotlight('[data-act="use"]');
  }
  if (task === 'shop') { haGo('#/shop'); return spotlight('#kh-shop-text'); }
  if (task === 'install') {
    return haSheet({
      title: 'On your home screen', closeLabel: 'Done', grey: true,
      body: `<ul class="ha-list">
        <li><div class="ha-row"><span class="ha-row-icon">${icon('share')}</span><span class="ha-row-body"><span class="ha-row-title">iPhone</span><span class="ha-row-sub">In Safari, tap Share (the square with an arrow), then Add to Home Screen.</span></span></div></li>
        <li><div class="ha-row"><span class="ha-row-icon">${icon('plus')}</span><span class="ha-row-body"><span class="ha-row-title">Android</span><span class="ha-row-sub">In Chrome, tap the menu (three dots), then Add to home screen or Install app.</span></span></div></li>
      </ul><p class="ha-section-footer">It then opens like an app, full screen, and works without signal.</p>`,
      onClose: () => { flag('installSeen'); afterSheet(); redraw(); },
    });
  }
  if (task === 'family') {
    haGo('#/settings');
    return spotlight('[data-act="signin"], [data-act="hh-create"], #kh-member-email');
  }
}
function openStarter() {
  const choices = starterChoices();
  const have = new Set(items().map(it => L.norm(`${it.brand} ${it.name}`)));
  const groups = [...new Set(choices.map(c => c.group))];
  const chip = c => {
    const at = have.has(L.norm(`${c.cat.brand} ${c.cat.name}`));
    return `<button type="button" class="ha-chip" aria-pressed="false" data-k="${esc(c.key)}"${at ? ' disabled' : ''}>${esc(c.cat.name.replace(/ \(.*\)$/, ''))}${at ? ' <span class="ha-chip-count">at home</span>' : ''}</button>`;
  };
  const s = haSheet({
    title: 'What do you have?', closeLabel: 'Cancel', grey: true, detent: 'large',
    body: `<p class="ha-text kh-start-intro">Tap the everyday things you have at home. Each goes in with a rough best-before date, which you can change on the item.</p>
      ${groups.map((g, i) => `<section class="ha-section" aria-labelledby="kh-sg-${i}"><h3 class="ha-section-header" id="kh-sg-${i}">${esc(g)}</h3>
        <div class="ha-chips ha-chips--wrap kh-start-chips" role="group" aria-labelledby="kh-sg-${i}">${choices.filter(c => c.group === g).map(chip).join('')}</div></section>`).join('')}
      <p class="ha-section-footer">Not here? Add it afterwards with + or the microphone.</p>`,
    footer: `<button type="button" class="ha-btn ha-btn--primary ha-btn--block" id="kh-start-go" disabled>Add items</button>`,
    onClose: afterSheet,
  });
  const go = $('#kh-start-go', s.el);
  const picked = () => [...s.el.querySelectorAll('.kh-start-chips [aria-pressed="true"]')].map(b => choices.find(c => c.key === b.dataset.k));
  s.el.addEventListener('click', e => {
    const b = e.target.closest('.kh-start-chips .ha-chip');
    if (!b || b.disabled) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    const n = picked().length;
    go.disabled = !n; go.textContent = n ? `Add ${plural(n, 'item')}` : 'Add items';
  });
  go.addEventListener('click', async () => {
    const list = picked(); if (!list.length) return;
    const added = [];
    for (const { cat, days } of list) {
      const base = { id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(), name: cat.name, brand: cat.brand, size: cat.size,
        category: cat.category, location: cat.location, openDays: cat.openDays ?? null, lowAt: 0, barcode: '' };
      const res = L.addStock(base, { qty: 1, expiry: days ? L.addDays(today(), days) : null, by: who() });
      save('items', res.item); added.push({ id: base.id, ev: save('events', res.event).id });
    }
    await haCloseSheet(s.el);
    if (screen() !== 'home') haGo('#/', { replace: screen() === 'add' }); else redraw();
    haToast(`Added ${plural(added.length, 'item')}`, { action: 'Undo', onAction: () => { for (const a of added) { remove('items', a.id); remove('events', a.ev); } redraw(); haAnnounce('Undone'); } });
  });
  return s;
}

// ---- Items ------------------------------------------------------------------------------------------------------

function viewItems() {
  const all = items();
  const places = LOCATIONS.filter(l => all.some(i => i.location === l));
  if (S.place && !places.includes(S.place)) S.place = '';
  const chip = (v, label, n) => `<button type="button" class="ha-chip" aria-pressed="${S.place === v}" data-act="place" data-v="${esc(v)}">${esc(label)} <span class="ha-chip-count">${n}</span></button>`;
  const seg = (v, label) => `<label class="ha-seg"><input type="radio" name="kh-sort" value="${v}"${S.sort === v ? ' checked' : ''}><span>${label}</span></label>`;
  return `<h1 class="ha-large-title">Items</h1>
    <div class="ha-search" role="search">${icon('search')}
      <input type="search" id="kh-q" placeholder="Search your items" aria-label="Search your items" autocomplete="off" value="${esc(S.q)}">
      <button type="button" class="ha-search-clear" data-act="q-clear" aria-label="Clear search">${icon('close')}</button></div>
    <div class="ha-chips" role="group" aria-label="Where it’s kept">${chip('', 'All', all.length)}${places.map(p => chip(p, p, all.filter(i => i.location === p).length)).join('')}</div>
    <fieldset class="ha-segmented"><legend>Sort by</legend>${seg('expiry', 'Use by')}${seg('name', 'Name')}${seg('category', 'Category')}</fieldset>
    <div id="kh-items-list">${itemsList()}</div>`;
}
function itemsList() {
  const all = items();
  const list = all.filter(i => (!S.place || i.location === S.place) && (!S.q || L.score(S.q, `${i.name} ${i.brand} ${i.category} ${i.barcode || ''}`)));
  const by = it => L.nextUseBy(it) || '9999';
  if (S.sort === 'expiry') list.sort((a, b) => by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : a.name.localeCompare(b.name));
  else if (S.sort === 'category') list.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
  else list.sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) {
    return all.length
      ? `<div class="ha-empty"><span class="ha-empty-icon">${icon('search')}</span><p class="ha-empty-title">Nothing found</p><p class="ha-empty-text">No items match. Try another word or place.</p></div>`
      : `<div class="ha-card ha-empty"><span class="ha-empty-icon">${icon('box')}</span><p class="ha-empty-title">No items yet</p><p class="ha-empty-text">Add what’s at home to start.</p><button type="button" class="ha-btn ha-btn--primary" data-act="go-add">Add an item</button></div>`;
  }
  if (S.sort !== 'category') return section(plural(list.length, 'item'), `<ul class="ha-list">${list.map(i => itemRow(i)).join('')}</ul>`, { id: 'items' });
  const groups = new Map();
  for (const it of list) { const c = it.category || 'Other'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(it); }
  return [...groups].map(([c, l], i) => section(c, `<ul class="ha-list">${l.map(it => itemRow(it)).join('')}</ul>`, { count: l.length, id: 'cat-' + i })).join('');
}
function drawItemsList() {
  const el = $('#kh-items-list'); if (el) el.innerHTML = itemsList();
}

// ---- Item -------------------------------------------------------------------------------------------------------

const VERB = { add: 'Bought', use: 'Used up', open: 'Opened', discard: 'Thrown away', expired: 'Expired, thrown away' };
function viewItem(it) {
  const evs = eventsFor(it.id).sort((a, b) => (a.at < b.at ? 1 : -1));
  const u = L.usage(evs);
  const ro = L.runOutDate(it, u);
  const q = L.totalQty(it);
  const batches = L.fefo(it);
  const t = today();
  let h = `<h1 class="ha-large-title">${esc(it.name)}</h1>${subOf(it) ? `<p class="ha-large-sub">${subOf(it)}</p>` : ''}`;
  // the thumbnail straight away; the photo replaces it once fetched (wantPhoto)
  const pic = bestPic(it);
  if (pic) h += `<img class="kh-hero" id="kh-hero" data-id="${esc(it.id)}" src="${esc(pic)}" alt="Photo of ${esc(it.name)}">`;
  wantPhoto(it);

  // stock, batch by batch (first to use at the top)
  const batchRow = b => {
    const d = L.batchUseBy(b, it);
    const what = b.openedAt ? `${b.qty} opened` : it.openDays ? `${b.qty} unopened` : plural(b.qty, 'in stock', 'in stock');
    const sub = [b.openedAt ? `Opened ${fmt(b.openedAt)}` : '', d ? `use by ${fmt(d)}` : 'No date'].filter(Boolean).join(' · ');
    const desc = d ? `use by ${fmt(d)}` : 'no date';
    return `<li><div class="ha-row kh-batch">
      <span class="ha-row-body"><span class="ha-row-title">${esc(what)}</span><span class="ha-row-sub">${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</span></span>
      <span class="ha-row-trail">${badge(d)}</span>
      <span class="kh-batch-acts">
        ${!b.openedAt && it.openDays ? `<button type="button" class="ha-btn ha-btn--small" data-act="open" data-b="${esc(b.id)}" aria-label="Open 1, ${esc(desc)}">Open</button>` : ''}
        <button type="button" class="ha-btn ha-btn--small" data-act="use" data-b="${esc(b.id)}" aria-label="Used 1, ${esc(desc)}">Used 1</button>
        <button type="button" class="ha-btn ha-btn--small ha-btn--quiet" data-act="toss" data-b="${esc(b.id)}" aria-label="Bin 1, ${esc(desc)}">Bin 1</button>
      </span></div></li>`;
  };
  h += section('In stock', `<ul class="ha-list">${batches.length ? batches.map(batchRow).join('') : `<li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-title">None left</span><span class="ha-row-sub">Bought more? Add it below.</span></span></div></li>`}</ul>`,
    { count: q, id: 'stock', footer: it.openDays ? `Keeps about ${plural(it.openDays, 'day')} once opened (the label wins).` : '' });
  h += `<div class="ha-btn-stack kh-actions">
    <button type="button" class="ha-btn ha-btn--primary ha-btn--block" data-act="bought">${icon('plus')}Bought more</button>
    <button type="button" class="ha-btn ha-btn--secondary ha-btn--block" data-act="to-list"${onList(it.id) ? ' aria-disabled="true"' : ''}>${icon('cart')}${onList(it.id) ? 'On the shopping list' : 'Add to shopping list'}</button>
  </div>`;

  // how fast the household uses it
  const max = Math.max(1, ...u.months.map(m => m.used + m.wasted));
  const cur = t.slice(0, 7);
  const cols = u.months.map(m => `<li class="ha-col${m.key === cur ? ' is-current' : ''}"><span class="ha-col-value">${m.used + m.wasted}</span><span class="ha-col-bar" style="--v:${Math.round(((m.used + m.wasted) / max) * 100)}%"></span><span>${esc(m.label)}${m.key === cur ? '<span class="ha-sr"> (this month)</span>' : ''}</span></li>`).join('');
  const pace = u.daysPerUnit
    ? `<p class="ha-card-kicker">Usual pace</p><p class="ha-card-title">${esc(L.paceLabel(u).replace(/^./, c => c.toUpperCase()))}</p>${ro ? `<p class="ha-card-text">At this pace it runs out around <strong>${esc(fmt(ro))}</strong>.</p>` : ''}`
    : `<p class="ha-card-text">Tap “Used 1” each time one is finished. After two, Kaki Home learns how fast you use it and puts it on the shopping list before it runs out.</p>`;
  h += section('How fast we use it', `<div class="ha-card">${pace}
      <p class="kh-cols-label" id="kh-cols-l">Used up or thrown away each month</p>
      <ul class="ha-cols kh-cols" aria-labelledby="kh-cols-l">${cols}</ul></div>`,
    { id: 'pace', footer: [plural(u.units, 'used up', 'used up'), u.discards ? `${u.discards} thrown away` : '', it.lowAt ? `on the shopping list at ${it.lowAt} left` : ''].filter(Boolean).join(' · ') });

  // buy it online
  const sq = shopQuery(it);
  h += section('Buy online', `<ul class="ha-list">
    <li><a class="ha-row" href="${esc(L.fairpriceUrl(sq))}" target="_blank" rel="noopener"><span class="ha-row-icon ha-row-icon--grey">${icon('cart')}</span><span class="ha-row-body"><span class="ha-row-title">Search FairPrice</span></span>${icon('external', { cls: 'ha-row-chevron' })}<span class="ha-sr"> (opens FairPrice)</span></a></li>
    <li><a class="ha-row" href="${esc(L.shengSiongUrl(sq))}" target="_blank" rel="noopener"><span class="ha-row-icon ha-row-icon--grey">${icon('cart')}</span><span class="ha-row-body"><span class="ha-row-title">Search Sheng Siong</span></span>${icon('external', { cls: 'ha-row-chevron' })}<span class="ha-sr"> (opens Sheng Siong)</span></a></li>
  </ul>`, { id: 'online' });

  // details
  const detail = (label, value) => value === '' || value == null ? '' : `<li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-title">${label}</span></span><span class="ha-row-value kh-wrap">${esc(value)}</span></div></li>`;
  h += section('Details', `<ul class="ha-list">${detail('Category', it.category)}${detail('Kept in', it.location)}${detail('Keeps once opened', it.openDays ? plural(it.openDays, 'day') : 'Not set')}${detail('Shopping list at', it.lowAt ? `${it.lowAt} left` : 'None left')}${detail('Barcode', it.barcode)}${detail('Added by', it.createdBy || '')}${detail('Last changed by', it.updatedBy || '')}</ul>`, { id: 'details' });

  // history
  h += section('History', evs.length
    ? `<ul class="ha-list">${evs.slice(0, 15).map(e => `<li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-title">${VERB[e.type] || esc(e.type)} ${e.qty > 1 ? e.qty : ''}</span><span class="ha-row-sub">${esc(fmtTime(e.at))}${e.by ? ' · ' + esc(e.by) : ''}</span></span></div></li>`).join('')}</ul>`
    : `<ul class="ha-list"><li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-sub">Nothing yet.</span></span></div></li></ul>`, { id: 'history', footer: evs.length > 15 ? `The latest 15 of ${evs.length}.` : '' });
  h += `<ul class="ha-list kh-delete"><li><button type="button" class="ha-row ha-row--danger ha-row--center" data-act="delete"><span class="ha-row-body"><span class="ha-row-title">Delete item</span></span></button></li></ul>`;
  return h;
}

// ---- Add and edit -----------------------------------------------------------------------------------------------

function blank() {
  return { id: null, name: '', brand: '', size: '', category: 'Other', location: 'Kitchen cabinet', qty: 1, expiry: '', openDays: '', lowAt: 0, barcode: '', pic: '' };
}
// The form's picture: `pic` is what it shows (a thumbnail); `_pics` is { photo, thumb } for a new picture, null when
// removed, and absent when unchanged.
function viewForm(id) {
  const editing = !!id;
  const key = id || 'new';
  if (!S.draft || S.draft._for !== key) {
    const it = id && S.items.get(id);
    S.draft = it ? { ...blank(), ...it, openDays: it.openDays ?? '', pic: thumbSrc(it), _for: key } : { ...blank(), _for: key };
    S.dirty = false;
  }
  const d = S.draft;
  const opt = (list, v) => list.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const field = (name, label, attrs = '', hint = '') => `<label class="ha-field"><span class="ha-field-label">${label}</span><input class="ha-input" name="${name}" value="${esc(d[name])}" ${attrs}>${hint ? `<span class="ha-field-hint">${hint}</span>` : ''}</label>`;
  let h = `<h1 class="ha-large-title">${editing ? 'Edit item' : 'Add an item'}</h1>`;
  if (!editing) {
    h += `<section class="ha-section kh-finder" aria-label="Find a product">
      <div class="ha-search" role="search">${icon('search')}
        <input type="search" id="kh-find" placeholder="Soy sauce, Milo, Dynamo…" aria-label="Find a product" autocomplete="off" enterkeyhint="search">
        <button type="button" class="ha-search-clear" data-act="find-clear" aria-label="Clear">${icon('close')}</button></div>
      <ul class="ha-list" id="kh-sugg" hidden></ul>
      <div class="ha-btn-row"><button type="button" class="ha-btn ha-btn--secondary" data-act="scan">${icon('barcode')}Scan barcode</button><button type="button" class="ha-btn ha-btn--secondary" data-act="quick">${icon('mic')}Say or type a list</button></div>
      <p class="ha-section-footer" id="kh-find-foot">Pick a common Singapore supermarket product, scan its barcode, or say what you bought, to fill in the details.</p>
    </section>`;
  }
  h += `<form id="kh-form" novalidate>
    <section class="ha-section" aria-labelledby="h-f-details"><h2 class="ha-section-header" id="h-f-details">Details</h2>
      <div class="kh-photo-row">
        <label class="kh-photo">${d.pic ? `<img src="${esc(d.pic)}" alt="">` : icon('camera')}<span>${d.pic ? 'Change photo' : 'Add photo'}</span>
          <input type="file" accept="image/*" capture="environment" class="kh-file" id="kh-photo-file"></label>
        <div class="kh-photo-fields">
          <label class="ha-field"><span class="ha-field-label">Name</span><input class="ha-input" name="name" value="${esc(d.name)}" required autocomplete="off" placeholder="Light soy sauce" aria-describedby="kh-name-err"></label>
          <p class="ha-field-error" id="kh-name-err" hidden>${icon('alert')}Give it a name</p>
        </div>
      </div>
      ${d.pic ? `<p class="kh-photo-del"><button type="button" class="ha-btn ha-btn--plain ha-btn--compact" data-act="photo-del">Remove photo</button></p>` : ''}
      <div class="kh-two">${field('brand', 'Brand', 'autocomplete="off" placeholder="Kikkoman"')}${field('size', 'Size', 'autocomplete="off" placeholder="500 ml"')}</div>
      <div class="kh-two">
        <label class="ha-field"><span class="ha-field-label">Category</span><select class="ha-select" name="category">${opt(CATEGORIES, d.category)}</select></label>
        <label class="ha-field"><span class="ha-field-label">Kept in</span><select class="ha-select" name="location">${opt(LOCATIONS, d.location)}</select></label>
      </div>
    </section>`;
  if (!editing) {
    h += `<section class="ha-section" aria-labelledby="h-f-stock"><h2 class="ha-section-header" id="h-f-stock">Stock</h2>
      <ul class="ha-list"><li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-title" id="kh-qty-l">How many</span></span>
        <div class="ha-stepper" role="group" aria-labelledby="kh-qty-l" id="kh-qty"><button type="button" data-step="-1" aria-label="Fewer">${icon('minus')}</button><output>${Number(d.qty) || 0}</output><button type="button" data-step="1" aria-label="More">${icon('plus')}</button></div></div></li></ul>
      <label class="ha-field kh-gap"><span class="ha-field-label">Best before or use by</span><input class="ha-input" type="date" name="expiry" value="${esc(d.expiry)}"></label>
      ${dateChips('expiry', d.expiry)}
    </section>`;
  }
  h += `<section class="ha-section" aria-labelledby="h-f-remind"><h2 class="ha-section-header" id="h-f-remind">Reminders</h2>
      <div class="kh-two">${field('openDays', 'Keeps once opened (days)', 'type="number" inputmode="numeric" min="0" placeholder="Not set"')}${field('lowAt', 'On the list when down to', 'type="number" inputmode="numeric" min="0"')}</div>
      <p class="ha-section-footer">Opened items are due the earlier of the printed date and this many days after opening.</p>
    </section>
    <section class="ha-section" aria-labelledby="h-f-code"><h2 class="ha-section-header" id="h-f-code">Barcode</h2>
      ${field('barcode', 'Barcode number', 'inputmode="numeric" autocomplete="off" placeholder="Optional"', 'Scanning it next time finds this item.')}
    </section>
  </form>`;
  return h;
}
function wireForm() {
  const f = $('#kh-form'); if (!f) return;
  const q = $('#kh-qty');
  if (q) haStepper(q, { min: 0, max: 99, onChange: v => { S.draft.qty = v; S.dirty = true; } });
  f.addEventListener('input', e => {
    const t = e.target; if (!t.name || !S.draft) return;
    S.draft[t.name] = t.value; S.dirty = true;
    if (t.name === 'name' && t.value.trim()) { t.removeAttribute('aria-invalid'); $('#kh-name-err').hidden = true; }
    if (t.name === 'expiry') for (const c of document.querySelectorAll('.kh-dates .ha-chip')) c.setAttribute('aria-pressed', String(c.dataset.v === t.value && !!t.value));
  });
  f.addEventListener('submit', submitForm);
}
// Fill the form from a suggestion or a barcode lookup, then redraw it where it was.
function fillDraft(fields) {
  Object.assign(S.draft, fields);
  S.dirty = true;
  const y = scrollY;
  draw(route(), { keep: true });
  scrollTo(0, y);
}
function suggestions(q) {
  if (!q.trim()) return [];
  const out = [];
  for (const it of items()) { const s = L.score(q, `${it.name} ${it.brand}`); if (s) out.push({ s: s + 2, mine: it }); }
  for (const [i, c] of CATALOGUE.entries()) { const s = L.score(q, `${c.name} ${c.brand} ${c.category}`); if (s) out.push({ s, cat: c, i }); }
  return out.sort((a, b) => b.s - a.s).slice(0, 8);
}
function showSugg() {
  const q = $('#kh-find')?.value || '', ul = $('#kh-sugg');
  if (!ul) return;
  const list = suggestions(q);
  const row = (act, data, thumbHtml, title, sub, trail = '') => `<li><button type="button" class="ha-row" data-act="${act}" ${data}>${thumbHtml}<span class="ha-row-body"><span class="ha-row-title">${title}</span>${sub ? `<span class="ha-row-sub">${sub}</span>` : ''}</span>${trail}</button></li>`;
  ul.innerHTML = list.map(x => x.mine
    ? row('sugg-mine', `data-id="${esc(x.mine.id)}"`, thumb(x.mine), esc(x.mine.name), subOf(x.mine), `<span class="ha-row-trail"><span class="ha-badge ha-badge--accent">At home</span></span>`)
    : row('sugg', `data-i="${x.i}"`, `<span class="ha-row-thumb">${icon(CAT_ICON[x.cat.category] || 'box')}</span>`, esc(x.cat.name), [x.cat.brand, x.cat.size].filter(Boolean).map(esc).join(' · '))).join('')
    + (q.trim() ? `<li><button type="button" class="ha-row ha-row--action" data-act="sugg-own"><span class="ha-row-icon">${icon('plus')}</span><span class="ha-row-body"><span class="ha-row-title">Add “${esc(q.trim())}”</span><span class="ha-row-sub">Not in the list? Type the details below.</span></span></button></li>` : '');
  ul.hidden = !q.trim();
  $('#kh-find-foot').hidden = !!q.trim();
}
function validName() {
  const n = $('#kh-form [name="name"]');
  if (S.draft.name.trim()) return true;
  n.setAttribute('aria-invalid', 'true'); $('#kh-name-err').hidden = false;
  n.focus(); n.scrollIntoView({ block: 'center' });
  return false;
}
function submitForm(e) {
  e.preventDefault();
  const d = S.draft;
  if (!d || !validName()) return;
  const base = d._for !== 'new' ? S.items.get(d._for) : null;
  const num = v => Math.max(0, parseInt(v, 10) || 0);
  const it = {
    ...(base || { id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who() }),
    name: d.name.trim(), brand: String(d.brand || '').trim(), size: String(d.size || '').trim(), category: d.category, location: d.location,
    openDays: num(d.openDays) || null, lowAt: num(d.lowAt), barcode: String(d.barcode || '').trim(),
  };
  // a new or removed picture: the photo is written (or deleted) first, then the item with its thumbnail
  const pics = d._pics, hadPhoto = !!base?.hasPhoto;
  if (pics !== undefined) {
    delete it.photo;
    if (pics) { it.thumb = pics.thumb; it.hasPhoto = true; savePhoto(it.id, pics.thumb, pics.photo); }
    else { delete it.thumb; delete it.hasPhoto; if (hadPhoto) delPhoto(it.id); }
  }
  S.draft = null; S.dirty = false;
  if (base) {
    save('items', it);
    haBack('#/item/' + it.id);
    haToast('Saved');
    return;
  }
  const qty = num(d.qty);
  let ev = null;
  if (qty > 0) {
    const res = L.addStock(it, { qty, expiry: d.expiry || null, by: who() });
    save('items', res.item); ev = save('events', res.event);
  } else save('items', it);
  haGo('#/item/' + it.id, { replace: true });
  haToast(`${it.name} added`, { action: 'Undo', onAction: () => { remove('items', it.id); if (ev) remove('events', ev.id); if (it.hasPhoto) delPhoto(it.id); redraw(); } });
}

// ---- barcode scanning -------------------------------------------------------------------------------------------

let scanning = null;
async function openScan() {
  const s = haSheet({
    title: 'Scan a barcode', closeLabel: 'Cancel',
    body: `<div class="kh-scan"><video muted playsinline aria-label="Camera view"></video></div>
      <p class="ha-text kh-scan-msg" id="kh-scan-msg" role="status">Point the camera at the barcode.</p>
      <label class="ha-btn ha-btn--secondary ha-btn--block kh-file-btn">${icon('camera')}Use a photo instead<input type="file" accept="image/*" class="kh-file" id="kh-scan-file"></label>`,
    onClose: () => { scanning?.cancel(); scanning = null; afterSheet(); },
  });
  const msg = $('#kh-scan-msg', s.el);
  const found = async code => { await haCloseSheet(s.el); gotBarcode(code); };
  $('#kh-scan-file', s.el).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    msg.textContent = 'Reading the photo…';
    try {
      const { scanFile } = await import('./scan.js');
      scanning?.cancel();
      const code = await scanFile(file);
      if (code) return found(code);
      msg.textContent = 'No barcode found in that photo. Try closer, flat and in focus.';
    } catch { msg.textContent = 'This phone can’t read barcodes. Type the number into Barcode instead.'; }
  });
  try {
    const { scanVideo } = await import('./scan.js');
    if (!s.el.open) return;
    scanning = scanVideo($('video', s.el));
    const code = await scanning.done;
    scanning = null;
    if (code) found(code);
  } catch (e) {
    msg.textContent = /Permission|NotAllowed/i.test(`${e?.name} ${e?.message}`)
      ? 'The camera is blocked. Allow it in the browser’s settings, or use a photo of the barcode.'
      : 'No live camera here. Use a photo of the barcode instead.';
  }
}
async function gotBarcode(code) {
  const mine = items().find(i => i.barcode === code);
  if (mine) {
    haGo('#/item/' + mine.id, { replace: screen() === 'add' });
    haToast(`Found ${mine.name}`);
    openBought(mine);
    return;
  }
  if (screen() !== 'add') haGo('#/add');
  if (!S.draft) draw(route());
  haToast('Looking up the barcode…');
  const { lookup } = await import('./scan.js');
  const p = await lookup(code);
  if (!S.draft) return;
  if (!p) { fillDraft({ barcode: code }); haToast('Barcode saved. Type the name once and it’s known next time.'); $('#kh-form [name="name"]')?.focus(); return; }
  fillDraft({ barcode: code, name: p.name, brand: p.brand, size: p.size });
  haToast(`Found ${p.name}`);
  if (p.image && !S.draft.pic) {
    const { fromUrl } = await import('./photo.js');
    const ph = await fromUrl(p.image);
    if (ph && S.draft && !S.draft.pic) fillDraft({ pic: ph.thumb, _pics: ph });
  }
}

// ---- the "bought more" sheet ----------------------------------------------------------------------------------

function openBought(it, { shopId = null } = {}) {
  const s = haSheet({
    title: 'Bought more', closeLabel: 'Cancel', grey: true,
    body: `<form id="kh-bought" novalidate>
      <ul class="ha-list"><li><div class="ha-row">${thumb(it)}<span class="ha-row-body"><span class="ha-row-title">${esc(it.name)}</span>${subOf(it) ? `<span class="ha-row-sub">${subOf(it)}</span>` : ''}</span></div></li>
        <li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-title" id="kh-b-qty-l">How many</span></span>
          <div class="ha-stepper" role="group" aria-labelledby="kh-b-qty-l" id="kh-b-qty"><button type="button" data-step="-1" aria-label="Fewer">${icon('minus')}</button><output>1</output><button type="button" data-step="1" aria-label="More">${icon('plus')}</button></div></div></li></ul>
      <label class="ha-field kh-gap"><span class="ha-field-label">Best before or use by</span><input class="ha-input" type="date" name="expiry"></label>
      ${dateChips('expiry', '')}
    </form>`,
    footer: `<button type="submit" form="kh-bought" class="ha-btn ha-btn--primary ha-btn--block">Add to stock</button>`,
    onClose: afterSheet,
  });
  const qty = haStepper($('#kh-b-qty', s.el), { min: 1, max: 99 });
  const f = $('#kh-bought', s.el);
  f.addEventListener('input', e => { if (e.target.name === 'expiry') for (const c of s.el.querySelectorAll('.kh-dates .ha-chip')) c.setAttribute('aria-pressed', 'false'); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const n = qty.get(), cur = S.items.get(it.id);
    if (!cur) { haCloseSheet(s.el); return; }
    const res = L.addStock(cur, { qty: n, expiry: f.expiry.value || null, by: who() });
    const ticked = [...S.shop.values()].filter(m => m.itemId === it.id && !m.done && m.id !== shopId);
    for (const m of ticked) save('shop', { ...m, done: true });
    await haCloseSheet(s.el);
    apply(res, `Added ${n} ${it.name}`);
  });
}
// ---- "Say or type" (quick.js): a sentence becomes items to confirm -----------------------------------------------

async function openQuick() {
  const Q = await import('./quick.js');
  let found = [], mic = null;
  const s = haSheet({
    title: 'Say or type', closeLabel: 'Cancel', grey: true,
    body: `<form id="kh-quick" novalidate>
      <label class="ha-field"><span class="ha-field-label">What did you buy?</span>
        <textarea class="ha-input kh-quick-text" id="kh-quick-text" autocomplete="off" placeholder="2 Meiji milk in the fridge expires 25 Oct, eggs and 3 tins of sardines"></textarea></label>
      ${Q.canListen() ? `<div class="ha-btn-row"><button type="button" class="ha-btn ha-btn--secondary kh-mic" id="kh-mic" aria-pressed="false">${icon('mic')}<span>Speak</span></button></div>` : ''}
      <p class="ha-section-footer" id="kh-quick-hint">${Q.canListen() ? 'Tap Speak, or type.' : 'Type, or tap the microphone on your keyboard.'} Say how many, where it’s kept and the date; separate things with “and” or commas.</p>
      <ul class="ha-list" id="kh-quick-list" aria-live="polite"></ul>
    </form>`,
    footer: `<button type="submit" form="kh-quick" class="ha-btn ha-btn--primary ha-btn--block" id="kh-quick-go" disabled>Add items</button>`,
    onClose: () => { mic?.stop(); afterSheet(); },
  });
  const ta = $('#kh-quick-text', s.el), ul = $('#kh-quick-list', s.el), go = $('#kh-quick-go', s.el);
  const describe = x => [x.brand, plural(x.qty, 'unit'), x.location, x.expiry ? `use by ${fmt(x.expiry)}` : 'no date',
    x.match?.mine ? 'adds to the one at home' : x.match?.cat ? '' : 'new item'].filter(Boolean).join(' · ');
  const show = () => {
    found = Q.parseQuick(ta.value, { today: today(), items: items(), catalogue: CATALOGUE });
    ul.innerHTML = found.map((x, i) => `<li><label class="ha-row"><input type="checkbox" data-q="${i}" checked>
      <span class="ha-row-body"><span class="ha-row-title">${esc(x.name)}</span><span class="ha-row-sub">${esc(describe(x))}</span></span></label></li>`).join('');
    count();
  };
  const count = () => {
    const n = ul.querySelectorAll('input:checked').length;
    go.disabled = !n;
    go.textContent = n ? `Add ${plural(n, 'item')}` : 'Add items';
  };
  ta.addEventListener('input', show);
  ul.addEventListener('change', count);
  $('#kh-mic', s.el)?.addEventListener('click', e => {
    const btn = e.currentTarget;
    if (mic) { mic.stop(); return; }
    const before = ta.value.trim();
    btn.classList.add('is-on'); btn.setAttribute('aria-pressed', 'true'); btn.lastElementChild.textContent = 'Stop';
    try {
      mic = Q.listen({
        onText: text => { ta.value = [before, text].filter(Boolean).join(', '); show(); },
        onEnd: err => {
          mic = null; btn.classList.remove('is-on'); btn.setAttribute('aria-pressed', 'false'); btn.lastElementChild.textContent = 'Speak';
          if (err && err !== 'no-speech' && err !== 'aborted') haToast(/not-allowed|service/.test(err) ? 'The microphone is blocked. Allow it in the browser’s settings, or type instead.' : 'Didn’t catch that. Try again or type.');
        },
      });
    } catch { mic = null; haToast('Speech isn’t available here. Type instead.'); }
  });
  $('#kh-quick', s.el).addEventListener('submit', async e => {
    e.preventDefault();
    mic?.stop();
    const picked = [...ul.querySelectorAll('input:checked')].map(c => found[Number(c.dataset.q)]);
    if (!picked.length) return;
    const undo = [];
    for (const x of picked) {
      const mine = x.match?.mine && S.items.get(x.match.mine.id);
      const c = x.match?.cat;
      const base = mine || {
        id: L.uid(), batches: [], createdAt: new Date().toISOString(), createdBy: who(),
        name: x.name, brand: x.brand || '', size: c?.size || '', category: c?.category || 'Other',
        location: x.location || c?.location || 'Kitchen cabinet', openDays: c?.openDays ?? null, lowAt: 0, barcode: '',
      };
      const res = L.addStock(base, { qty: x.qty, expiry: x.expiry || null, by: who() });
      undo.push({ before: mine || null, id: base.id, ev: save('events', res.event).id });
      save('items', res.item);
    }
    flag('said');
    await haCloseSheet(s.el);
    if (screen() === 'add') { S.draft = null; S.dirty = false; haGo('#/', { replace: true }); } else redraw();
    haToast(`Added ${plural(picked.length, 'item')}`, { action: 'Undo', onAction: () => {
      for (const u of undo.reverse()) { if (u.before) save('items', u.before); else remove('items', u.id); remove('events', u.ev); }
      redraw(); haAnnounce('Undone');
    } });
  });
  setTimeout(() => ta.focus(), 50);
}

// A sheet closed: draw anything the household changed while it was open.
function afterSheet() {
  if (S.pendingRender && !haSheetOpen()) redraw();
}

// ---- Shopping ---------------------------------------------------------------------------------------------------

function shopLists() {
  const buy = L.toBuy(items(), eventsByItem());
  const manual = [...S.shop.values()].sort((a, b) => (a.done - b.done) || (a.at < b.at ? -1 : 1));
  const listed = new Set(manual.filter(m => m.itemId && !m.done).map(m => m.itemId));
  return { manual, suggested: buy.filter(b => !listed.has(b.item.id)) };
}
function viewShop() {
  const { manual, suggested } = shopLists();
  const left = manual.filter(m => !m.done).length, done = manual.length - left;
  let h = `<h1 class="ha-large-title">Shopping</h1>
    <form class="kh-addline" id="kh-shop-add"><label class="ha-sr" for="kh-shop-text">Add something to buy</label>
      <input class="ha-input" id="kh-shop-text" placeholder="Add something to buy" autocomplete="off" enterkeyhint="done">
      <button class="ha-btn ha-btn--compact" type="submit">Add</button></form>`;
  const line = m => `<li><label class="ha-row${m.done ? ' is-done' : ''}">
      <input type="checkbox" data-shop="${esc(m.id)}"${m.done ? ' checked' : ''}>
      <span class="ha-row-body"><span class="ha-row-title">${esc(m.name)}</span>${m.by ? `<span class="ha-row-sub">Added by ${esc(m.by)}</span>` : ''}</span>
      <button type="button" class="ha-btn ha-btn--quiet ha-btn--icon" data-act="shop-del" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">${icon('trash')}</button></label></li>`;
  h += section('To buy', manual.length ? `<ul class="ha-list" id="kh-shop">${manual.map(line).join('')}</ul>`
    : `<ul class="ha-list" id="kh-shop"><li><div class="ha-row"><span class="ha-row-body"><span class="ha-row-sub">Nothing on the list yet.</span></span></div></li></ul>`,
  { id: 'shop', action: done ? `<button type="button" data-act="shop-clear">Clear ticked</button>` : (left ? `<span class="ha-num">${left}</span>` : ''),
    footer: manual.length || suggested.length ? 'Tick things off as you buy them. An item from your stock asks how many you bought and the date.'
      : 'Your items come here by themselves when none are left, when they’re down to their “on the list when down to” number, or when they’ll run out within a week at your usual pace. Type anything else above.' });
  h += section('Suggested from your stock', suggested.length
    ? `<ul class="ha-list">${suggested.map(b => `<li><div class="ha-row">${thumb(b.item)}<span class="ha-row-body"><span class="ha-row-title">${esc(b.item.name)}</span><span class="ha-row-sub">${esc(L.whyText(b, today()))}</span></span>
        <span class="ha-row-trail"><button type="button" class="ha-btn ha-btn--small" data-act="to-list" data-id="${esc(b.item.id)}" aria-label="Add ${esc(b.item.name)} to the list">Add</button></span></div></li>`).join('')}</ul>`
    : '', { id: 'suggested', footer: suggested.length ? 'Out of stock, running low, or due to run out within a week at your usual pace.' : 'Nothing is running low.' });
  return h;
}
function shareLines() {
  const { manual, suggested } = shopLists();
  return [...manual.filter(m => !m.done).map(m => m.name), ...suggested.map(b => [b.item.brand, b.item.name].filter(Boolean).join(' '))];
}
function addToList(it) {
  if (onList(it.id)) { haToast('Already on the shopping list'); return; }
  const m = save('shop', { id: L.uid(), name: [it.brand, it.name].filter(Boolean).join(' '), itemId: it.id, done: false, at: new Date().toISOString(), by: who() });
  redraw();
  haToast(`${it.name} is on the shopping list`, { action: 'Undo', onAction: () => { remove('shop', m.id); redraw(); } });
}

// ---- Settings ---------------------------------------------------------------------------------------------------

function viewSettings() {
  const configured = !!S.cloud?.configured;
  const row = (inner, cls = '') => `<li><div class="ha-row${cls}">${inner}</div></li>`;
  const btnRow = (act, title, { cls = ' ha-row--action', iconName = '', sub = '' } = {}) => `<li><button type="button" class="ha-row${cls}" data-act="${act}">${iconName ? `<span class="ha-row-icon">${icon(iconName)}</span>` : ''}<span class="ha-row-body"><span class="ha-row-title">${title}</span>${sub ? `<span class="ha-row-sub">${sub}</span>` : ''}</span></button></li>`;
  let fam, famFoot = '';
  if (S.mode === 'demo') {
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon ha-row-icon--grey">${icon('info')}</span><span class="ha-row-body"><span class="ha-row-title">Not in the demo</span><span class="ha-row-sub">The demo uses made-up items and saves nothing.</span></span>`)}</ul>`;
  } else if (!configured) {
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon ha-row-icon--grey">${icon('box')}</span><span class="ha-row-body"><span class="ha-row-title">On this phone only</span><span class="ha-row-sub">Household sharing isn’t set up yet.</span></span>`)}</ul>`;
    famFoot = 'Sharing with the household needs a one-time setup of Kaki Home’s Firebase project (SETUP.md).';
  } else if (S.pending) {
    // a new password account, not verified yet: no household data until the emailed link has been tapped
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon">${icon('mail')}</span><span class="ha-row-body"><span class="ha-row-title">Check your email</span><span class="ha-row-sub kh-break">We sent a link to ${esc(S.pending.email)}. Tap it, then come back here.</span></span>`)}
      ${btnRow('verified', 'I’ve verified', { iconName: 'check' })}${btnRow('verify-resend', 'Send it again')}${btnRow('signout', 'Use a different email')}</ul>`;
    famFoot = 'The link proves the email is yours. Look in Junk or Spam if it doesn’t arrive in a minute or two.';
  } else if (!S.user) {
    fam = `<ul class="ha-list">${btnRow('signin', 'Continue with Google', { iconName: 'user' })}</ul>
      <p class="kh-quiet"><button type="button" class="ha-btn ha-btn--plain ha-btn--compact" data-act="email-open">Use email instead</button></p>`;
    famFoot = 'Sign in to share one list with your household: everyone sees the same items and shopping list. Only the people added can see it.';
  } else if (!S.household && S.lookupFailed) {
    // couldn't ask the server (no signal): not "no household", so no Start button
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon">${icon('alert')}</span><span class="ha-row-body"><span class="ha-row-title">Can’t check right now</span><span class="ha-row-sub kh-break">${esc(S.user.email)}</span></span>`)}
      ${btnRow('hh-check', 'Try again', { iconName: 'refresh' })}${btnRow('signout', 'Sign out')}</ul>`;
    famFoot = 'Connect to the internet and try again. Your household is looked up first, so a second one is never started by mistake.';
  } else if (!S.household) {
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon">${icon('user')}</span><span class="ha-row-body"><span class="ha-row-title">Signed in</span><span class="ha-row-sub">${esc(S.user.email)}</span></span>`)}
      ${btnRow('hh-create', 'Start our household')}${btnRow('hh-check', 'Check again')}${btnRow('signout', 'Sign out')}</ul>`;
    famFoot = `Not in a household yet. Start one, or ask whoever started yours to add ${esc(S.user.email)}, then tap Check again.`;
  } else {
    const h = S.household;
    fam = `<ul class="ha-list">${row(`<span class="ha-row-icon">${icon('cloud')}</span><span class="ha-row-body"><span class="ha-row-title">${esc(h.name)}</span><span class="ha-row-sub">Signed in as ${esc(S.user.email)}</span></span>`)}
      ${h.members.map(m => {
        const n = names()[m];
        const sub = [n ? m : '', m === h.owner ? 'Started it' : '', m === S.user.email ? 'You' : ''].filter(Boolean).join(' · ');
        return `<li><button type="button" class="ha-row kh-person" data-act="person" data-v="${esc(m)}"><span class="ha-row-icon ha-row-icon--grey">${icon('user')}</span>
          <span class="ha-row-body"><span class="ha-row-title kh-break">${esc(n || m)}</span>${sub ? `<span class="ha-row-sub kh-break">${esc(sub)}</span>` : ''}</span>${chevron()}</button></li>`;
      }).join('')}
      ${S.localCount ? btnRow('copy-up', `Copy ${plural(S.localCount, 'item')} from this phone`, { iconName: 'upload', sub: 'Saved here before you signed in' }) : ''}
      ${btnRow('signout', 'Sign out')}</ul>
      <form class="kh-addline kh-member" id="kh-member-add"><label class="ha-sr" for="kh-member-email">Household member’s email</label>
        <input class="ha-input" id="kh-member-email" type="email" placeholder="Household member’s email" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="ha-btn ha-btn--compact" type="submit">Add</button></form>`;
    famFoot = 'They sign in with that email (Google, or an emailed link or password) to see Kaki Home. Tap someone to give them a name, email them the link again, or stop sharing. Whoever started it can’t be removed.';
  }
  return `<h1 class="ha-large-title">Settings</h1>
    ${mergeCard()}
    ${section('Household sharing', fam, { id: 'family', footer: famFoot })}
    ${section('Reminders', `<div class="ha-chips ha-chips--wrap" role="group" aria-label="Expiring soon means within">${Object.entries(SOON).map(([v, l]) =>
      `<button type="button" class="ha-chip" aria-pressed="${soonDays() === Number(v)}" data-act="soon" data-v="${v}">${l}</button>`).join('')}</div>`,
      { id: 'remind', footer: 'How far ahead “Expiring soon” looks, on Home. Each item’s own “on the list when down to” sets when it counts as low in stock. Kept on this phone.' })}
    ${section('Help', `<ul class="ha-list">
      <li><a class="ha-row" href="#/guide"><span class="ha-row-icon">${icon('info')}</span><span class="ha-row-body"><span class="ha-row-title">How to use Kaki Home</span></span>${chevron()}</a></li>
      ${btnRow('welcome', 'Show the welcome again', { iconName: 'home' })}
      ${tourOn() ? '' : btnRow('tour-on', 'Show the getting-started list', { iconName: 'list' })}
    </ul>`, { id: 'help' })}
    ${section('You', `<ul class="ha-list"><li><label class="ha-row"><span class="ha-row-body"><span class="ha-row-title">Your name</span></span>
      <input class="ha-input ha-input--inline" id="kh-name" value="${esc(prefs.get('name') || '')}" placeholder="${esc(S.user?.name?.split(' ')[0] || 'For example, Mum')}" autocomplete="off"></label></li></ul>`,
      { id: 'you', footer: 'Shows in each item’s history and on the shopping list. Kept on this phone.' })}
    ${section('Your data', `<ul class="ha-list">
      ${btnRow('csv', 'Export as CSV', { iconName: 'download', sub: 'A spreadsheet of what’s in stock' })}
      ${btnRow('backup', 'Back up', { iconName: 'download', sub: 'Everything, as a JSON file' })}
      <li><label class="ha-row ha-row--action"><span class="ha-row-icon">${icon('upload')}</span><span class="ha-row-body"><span class="ha-row-title">Restore a backup</span><span class="ha-row-sub">Adds the items in a backup file</span></span><input type="file" accept="application/json,.json" class="kh-file" id="kh-restore"></label></li>
      ${btnRow('sample', 'Add sample items', { iconName: 'box', sub: 'Made-up items to try the app with' })}
      ${S.mode === 'local' ? btnRow('wipe', 'Delete everything on this phone', { cls: ' ha-row--danger' }) : ''}
    </ul>`, { id: 'data' })}
    ${section('On your home screen', `<div class="ha-card kh-install"><p class="ha-card-text"><strong>iPhone:</strong> in Safari, tap Share, then Add to Home Screen.</p><p class="ha-card-text"><strong>Android:</strong> in Chrome, open the menu, then Add to home screen or Install app.</p><p class="ha-card-text">It then opens like an app and works without signal.</p></div>`, { id: 'install' })}
    ${section('About', '', { id: 'about', footer: 'Product suggestions are common Singapore supermarket goods; “keeps once opened” days are a rough guide, so check the label. Barcode look-ups use Open Food Facts. Shop links open FairPrice’s and Sheng Siong’s own search.' })}
    <div id="kh-version"></div>`;
}

// ---- drawing ----------------------------------------------------------------------------------------------------

const TOP = { home: 'Kaki Home', items: 'Items', shop: 'Shopping', settings: 'Settings' };
const GUIDE = 'How to use Kaki Home';
function draw(r, { keep = false } = {}) {
  let [name = 'home', id] = r.parts;
  const main = $('#main');
  const task = name === 'add' || name === 'edit';
  if (!task) { S.draft = null; S.dirty = false; }
  let it = null;
  if (name === 'item' || name === 'edit') {
    it = S.items.get(id);
    if (!it) {
      // deleted (here or by the household): go back to where it was opened from, after this draw has finished
      main.innerHTML = '';
      setTimeout(() => { if (route().parts[1] === id) haGo(S.originTab, { replace: true, nav: 'pop' }); });
      return;
    }
  }
  if (!['home', 'items', 'item', 'add', 'edit', 'shop', 'settings', 'guide'].includes(name)) name = 'home';
  if (TOP[name]) { S.originTab = name === 'home' ? '#/' : '#/' + name; S.backLabel = TOP[name]; }

  document.body.classList.toggle('ha-has-tabbar', !task);
  document.body.classList.toggle('ha-has-toolbar', task);
  $('.ha-tabbar').hidden = task;
  $('#kh-toolbar').hidden = !task;

  let title = TOP[name] || '';
  if (name === 'home') { main.innerHTML = viewHome(); setBar({ title, trail: iconBtn('mic', 'Say or type what you bought', 'quick') + iconBtn('barcode', 'Scan a barcode', 'scan-home') }); }
  else if (name === 'items') { main.innerHTML = viewItems(); setBar({ title }); }
  else if (name === 'item') {
    title = it.name;
    main.innerHTML = viewItem(it);
    setBar({ title, lead: backBtn(S.backLabel), trail: textBtn('Edit', 'edit') });
  } else if (name === 'add' || name === 'edit') {
    title = name === 'add' ? 'Add an item' : 'Edit item';
    main.innerHTML = viewForm(name === 'edit' ? id : null);
    setBar({ title, lead: textBtn('Cancel', 'back') });
    $('#kh-save').textContent = name === 'add' ? 'Add item' : 'Save';
    wireForm();
  } else if (name === 'shop') { flag('shopped'); main.innerHTML = viewShop(); setBar({ title, trail: iconBtn('share', 'Share the list', 'share') }); }
  else if (name === 'guide') { title = GUIDE; main.innerHTML = viewGuide(); setBar({ title: 'How to use it', lead: backBtn(S.backLabel) }); }
  else if (name === 'settings') {
    main.innerHTML = viewSettings(); setBar({ title });
    haVersion($('#kh-version'), 'kakihome');
  }
  document.title = name === 'home' ? 'Kaki Home' : `${title} · Kaki Home`;
  drawBadge();
  S.pendingRender = false;
  if (keep) haLargeTitle();
}
// Draw the current screen again after a data change, keeping the scroll position. Not while a form is being filled
// in or a sheet is open: then it waits (a household member's change must never wipe what someone is typing).
function redraw() {
  if (!R) return;
  if (haSheetOpen() || ['add', 'edit'].includes(screen())) { S.pendingRender = true; drawBadge(); return; }
  // someone is typing (a household member's email, a shopping line): draw once they leave the field
  const a = document.activeElement;
  if (a?.matches?.('#main input:not([type=checkbox]):not([type=radio]):not([type=search]), #main textarea') && a.value) {
    S.pendingRender = true;
    a.addEventListener('blur', () => { if (S.pendingRender) setTimeout(redraw); }, { once: true });
    return;
  }
  const y = scrollY, focus = document.activeElement?.id;
  draw(route(), { keep: true });
  scrollTo(0, y);
  if (focus && $('#' + focus)) $('#' + focus).focus({ preventScroll: true });
}
function drawBadge() {
  const left = [...S.shop.values()].filter(m => !m.done).length + shopLists().suggested.length;
  const b = $('#kh-shop-badge');
  b.textContent = left > 99 ? '99+' : left; b.hidden = !left;
  $('#kh-shop-sr').textContent = left ? `, ${left} to buy` : '';
}

// ---- clicks and forms ---------------------------------------------------------------------------------------------

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const act = b.dataset.act;
  const it = screen() === 'item' ? S.items.get(route().parts[1]) : (b.dataset.id && S.items.get(b.dataset.id));
  switch (act) {
    case 'back': return haBack(screen() === 'edit' ? '#/item/' + route().parts[1] : S.originTab);
    case 'welcome': return showWelcome({ save: S.mode !== 'demo' });
    case 'go-add': return haGo('#/add');
    case 'scan-home': haGo('#/add'); return openScan();
    case 'scan': return openScan();
    case 'edit': return haGo('#/edit/' + it.id);
    case 'use': return apply(L.takeOut(it, { type: 'use', by: who(), batchId: b.dataset.b || null }), `Used 1 ${it.name}`);
    case 'toss': {
      const res = L.takeOut(it, { type: 'discard', by: who(), batchId: b.dataset.b || null });
      return apply(res, res.event?.type === 'expired' ? `Binned 1 ${it.name} (expired)` : `Binned 1 ${it.name}`);
    }
    case 'quick': return openQuick();
    case 'start': return openStarter();
    case 'tour-show': return showMe(b.dataset.task);
    case 'tour-hide': { prefs.set('tour', 'off'); redraw(); return haToast('Hidden. Settings → Help can show it again.'); }
    case 'tour-on': { prefs.set('tour', 'on'); haGo('#/'); return haToast('The getting-started list is on Home'); }
    case 'soon': { prefs.set('soonDays', Number(b.dataset.v)); redraw(); return haToast(`Expiring soon: within ${SOON[b.dataset.v]}`); }
    case 'open': return apply(L.openOne(it, { by: who(), batchId: b.dataset.b || null }), `Opened 1 ${it.name}`);
    case 'bought': return openBought(it);
    case 'to-list': return addToList(it);
    case 'delete': {
      const evs = eventsFor(it.id);
      const photo = await photoOf(it);   // kept for Undo (already fetched when the item opened)
      remove('items', it.id);
      for (const ev of evs) remove('events', ev.id);
      if (it.hasPhoto) delPhoto(it.id);
      haBack(S.originTab);
      haToast(`${it.name} deleted`, { action: 'Undo', onAction: () => {
        if (photo) savePhoto(it.id, it.thumb || '', photo);
        save('items', it); for (const ev of evs) save('events', ev); redraw();
      } });
      return;
    }
    case 'place': {
      S.place = b.dataset.v;
      for (const c of document.querySelectorAll('[data-act="place"]')) c.setAttribute('aria-pressed', String(c === b));
      return drawItemsList();
    }
    case 'q-clear': { S.q = ''; const q = $('#kh-q'); q.value = ''; drawItemsList(); return q.focus(); }
    case 'find-clear': { const f = $('#kh-find'); f.value = ''; showSugg(); return f.focus(); }
    case 'sample': {
      const data = sampleData(who() || 'Sample');
      for (const k of ['items', 'events']) for (const o of data[k]) save(k, o);
      redraw();
      return haToast(`Added ${data.items.length} sample items`);
    }
    case 'date': {
      const box = b.closest('.kh-dates'), input = b.closest('form').querySelector(`[name="${box.dataset.for}"]`);
      input.value = b.dataset.v;
      if (S.draft && input.closest('#kh-form')) { S.draft[input.name] = input.value; S.dirty = true; }
      for (const c of box.querySelectorAll('.ha-chip')) c.setAttribute('aria-pressed', String(c === b));
      return;
    }
    case 'sugg': {
      const c = CATALOGUE[Number(b.dataset.i)];
      $('#kh-find').value = '';
      fillDraft({ name: c.name, brand: c.brand, size: c.size, category: c.category, location: c.location, openDays: c.openDays ?? '' });
      $('#h-f-details')?.scrollIntoView({ block: 'start' });
      haAnnounce(`${c.name} filled in`);
      return;
    }
    case 'sugg-own': {
      const v = $('#kh-find').value.trim();
      $('#kh-find').value = '';
      fillDraft({ name: v });
      const n = $('#kh-form [name="name"]'); n.focus(); return;
    }
    case 'sugg-mine': {
      const mine = S.items.get(b.dataset.id);
      S.draft = null; S.dirty = false;
      haGo('#/item/' + mine.id, { replace: true });
      return openBought(mine);
    }
    case 'photo-del': return fillDraft({ pic: '', _pics: null });
    case 'shop-del': {
      e.preventDefault();
      const m = S.shop.get(b.dataset.id);
      remove('shop', m.id); redraw();
      return haToast(`${m.name} removed`, { action: 'Undo', onAction: () => { save('shop', m); redraw(); } });
    }
    case 'shop-clear': {
      const gone = [...S.shop.values()].filter(m => m.done);
      for (const m of gone) remove('shop', m.id);
      redraw();
      return haToast(`Cleared ${plural(gone.length, 'ticked item')}`, { action: 'Undo', onAction: () => { for (const m of gone) save('shop', m); redraw(); } });
    }
    case 'share': {
      const text = L.shareText(shareLines());
      if (navigator.share) { try { await navigator.share({ text }); } catch { /* cancelled */ } return; }
      try { await navigator.clipboard.writeText(text); haToast('Copied the list. Paste it into a message.'); } catch { haToast('Couldn’t copy the list on this phone'); }
      return;
    }
    case 'csv': return download('kakihome.csv', L.toCsv(items()), 'text/csv');
    case 'backup': {
      let photos;
      try { photos = await S.backend.list(PHOTOS); } catch (err) { return haToast(S.cloud ? S.cloud.explain(err, 'The backup') : 'The backup didn’t work. Try again.'); }
      return download(`kakihome-backup-${today()}.json`, JSON.stringify(L.backup({ items: [...S.items.values()], events: [...S.events.values()], shop: [...S.shop.values()], photos })), 'application/json');
    }
    case 'wipe': {
      if (!(await haConfirm({ title: 'Delete everything?', text: 'Every item, its history and the shopping list on this phone are deleted. This can’t be undone. A backup first keeps a copy.', ok: 'Delete everything', danger: true }))) return;
      await S.local.clear();
      for (const k of KINDS) S[k].clear();
      S.pics.clear();
      redraw(); return haToast('Deleted everything on this phone');
    }
    case 'signin':
      try { await S.cloud.signIn(); } catch (err) { haToast(S.cloud.explain(err, 'Sign-in')); }
      return;
    case 'email-open': return openEmailSheet();
    case 'merge-open': return openMerge();
    case 'verified': return checkVerified();
    case 'verify-resend':
      try { await S.cloud.resendVerification(); haToast('Sent again. Check your email.'); } catch (err) { haToast(S.cloud.explain(err, 'Sending it')); }
      return;
    case 'signout': {
      haToast('Checking everything reached the household…');
      const ok = await S.cloud.synced(4000);
      haHideToast();
      if (!ok && !(await haConfirm({ title: 'Sign out now?', text: 'Some changes on this phone haven’t reached the household yet (no signal?). Signing out now loses them. Wait for signal, then sign out.', ok: 'Sign out anyway', cancel: 'Wait', danger: true }))) return;
      try { await S.cloud.signOut(); haToast('Signed out. This phone is back to its own list.'); } catch (err) { haToast(S.cloud.explain(err, 'Signing out')); }
      return;
    }
    case 'hh-create': {
      if (S.creating) return;   // a double tap, or a second try while the first is still going
      S.creating = true;
      try {
        // never a second household for someone already in one: ask the server right now (offline this throws, and
        // nothing is created: the create itself also needs the server)
        const had = await locate(S.user.email);
        if (had) { S.lookupFailed = false; await useHousehold(had); return haToast('You’re already in a household; it’s open now.'); }
        await useHousehold(await S.cloud.createHousehold(S.user.email, 'Our home'));
        haToast('Household started. Add its members below.');
      } catch (err) { haToast(S.cloud.explain(err, 'Starting the household')); }
      finally { S.creating = false; }
      return;
    }
    case 'hh-check': {
      try {
        const h = await locate(S.user.email);
        S.lookupFailed = false;
        if (!h) { redraw(); return haToast('Not added yet. Ask whoever started it to add you.'); }
        await useHousehold(h);
      } catch (err) { S.lookupFailed = true; redraw(); haToast(S.cloud.explain(err, 'Checking')); }
      return;
    }
    case 'person': return openPerson(b.dataset.v);
    case 'member-del': {
      const m = b.dataset.v;
      if (!(await haConfirm({ title: 'Stop sharing?', text: `${m} won’t see Kaki Home any more. You can add them again later.`, ok: 'Stop sharing', danger: true }))) return;
      try { await S.cloud.setMembers(S.household.id, S.household.members.filter(x => x !== m)); } catch (err) { haToast(S.cloud.explain(err, 'Removing them')); }
      return;
    }
    case 'copy-up': {
      try {
        const data = await splitAll({ ...(await S.local.load()), photos: await S.local.list(PHOTOS) });
        await S.backend.putMany(PHOTOS, data.photos);   // photos first, so no item points at a missing photo
        for (const k of KINDS) await S.backend.putMany(k, data[k] || []);
        for (const k of KINDS) for (const o of data[k] || []) S[k].set(o.id, o);
        await S.local.clear();
        S.localCount = 0; redraw();
        haToast(`Copied ${plural(data.items.length, 'item')} into the household`);
      } catch (err) { haToast(S.cloud.explain(err, 'Copying')); }
      return;
    }
  }
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function onChange(e) {
  const t = e.target;
  if (t.name === 'kh-sort') { S.sort = t.value; prefs.set('sort', t.value); return drawItemsList(); }
  if (t.id === 'kh-name') { prefs.set('name', t.value.trim()); return haToast('Saved'); }
  if (t.dataset.shop) {
    const m = S.shop.get(t.dataset.shop); if (!m) return;
    save('shop', { ...m, done: t.checked });
    const item = t.checked && m.itemId && S.items.get(m.itemId);
    if (item) { S.pendingRender = true; openBought(item, { shopId: m.id }); return; }
    return redraw();
  }
  if (t.id === 'kh-photo-file' && t.files[0]) {
    const { pictures } = await import('./photo.js');
    try { const p = await pictures(t.files[0]); fillDraft({ pic: p.thumb, _pics: p }); } catch { haToast('Couldn’t read that picture. Try another.'); }
    return;
  }
  if (t.id === 'kh-restore' && t.files[0]) {
    try {
      const data = L.parseBackup(await t.files[0].text());
      S.pics.clear();
      if (S.backend.putMany) {
        await splitAll(data);   // Kaki Home's rules take only thumbnails on items
        await S.backend.putMany(PHOTOS, data.photos);
        for (const k of KINDS) await S.backend.putMany(k, data[k] || []);
      } else for (const p of data.photos) S.backend.put(PHOTOS, p);
      for (const k of KINDS) for (const o of data[k] || []) { if (S.backend.putMany) S[k].set(o.id, o); else save(k, o); }
      redraw(); haToast(`Restored ${plural(data.items.length, 'item')}`);
      migratePhotos();
    } catch (err) { haToast(err?.message?.startsWith('That file') ? err.message : 'Couldn’t restore that file.'); }
    t.value = '';
  }
}
function onInput(e) {
  if (e.target.id === 'kh-q') { S.q = e.target.value; drawItemsList(); }
  if (e.target.id === 'kh-find') showSugg();
}
async function onSubmit(e) {
  if (e.target.id === 'kh-shop-add') {
    e.preventDefault();
    const inp = $('#kh-shop-text'), v = inp.value.trim();
    if (!v) return inp.focus();
    const mine = items().find(i => L.norm(i.name) === L.norm(v) || L.norm(`${i.brand} ${i.name}`) === L.norm(v));
    save('shop', { id: L.uid(), name: v, itemId: mine?.id || null, done: false, at: new Date().toISOString(), by: who() });
    redraw();
    $('#kh-shop-text')?.focus();
    return;
  }
  if (e.target.id === 'kh-member-add') {
    e.preventDefault();
    const v = $('#kh-member-email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return haToast('Type their email address');
    try {
      await S.cloud.setMembers(S.household.id, [...S.household.members, v]);
      $('#kh-member-email').value = '';
      haToast(`Added ${v}`, { action: 'Email invite', onAction: () => { location.href = inviteHref(v); }, ms: 10000 });
    } catch (err) { haToast(S.cloud.explain(err, 'Adding them')); }
  }
}

// A household member's card: their email, a name everyone in the household sees, invite again, stop sharing.
function openPerson(email) {
  const h = S.household; if (!h) return;
  const canRemove = email !== h.owner && email !== S.user.email;
  const s = haSheet({
    title: names()[email] || 'Household member', closeLabel: 'Done', grey: true,
    body: `<ul class="ha-list"><li><div class="ha-row"><span class="ha-row-icon">${icon('mail')}</span><span class="ha-row-body"><span class="ha-row-title kh-break">${esc(email)}</span>
        <span class="ha-row-sub">${email === h.owner ? 'Started the household' : 'Signs in with this email'}${email === S.user.email ? ' · you' : ''}</span></span></div></li></ul>
      <form id="kh-person" class="kh-person-form" novalidate>
        <label class="ha-field"><span class="ha-field-label">Name</span>
          <input class="ha-input" name="name" id="kh-person-name" value="${esc(names()[email] || '')}" maxlength="${NAME_MAX}" autocomplete="off" placeholder="For example, Mum or Ah Mei"></label>
        <p class="ha-section-footer">Everyone in the household sees this name instead of the email. Leave it empty to show the email.</p>
        <button type="submit" class="ha-btn ha-btn--primary ha-btn--block">Save name</button>
      </form>
      <ul class="ha-list kh-person-acts">
        ${email !== S.user.email ? `<li><a class="ha-row ha-row--action" href="${esc(inviteHref(email))}"><span class="ha-row-icon">${icon('mail')}</span><span class="ha-row-body"><span class="ha-row-title">Email an invite</span><span class="ha-row-sub">From your own mail app, with the link</span></span></a></li>` : ''}
        ${canRemove ? `<li><button type="button" class="ha-row ha-row--danger ha-row--center" data-act="member-del" data-v="${esc(email)}"><span class="ha-row-body"><span class="ha-row-title">Stop sharing</span></span></button></li>` : ''}
      </ul>`,
    onClose: afterSheet,
  });
  $('#kh-person', s.el).addEventListener('submit', async e => {
    e.preventDefault();
    const v = $('#kh-person-name', s.el).value.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    const next = { ...names() };
    if (v) next[email] = v; else delete next[email];
    save('settings', { id: 'people', names: next, updatedAt: new Date().toISOString() });
    await haCloseSheet(s.el);
    redraw();
    haToast(v ? `Saved: ${v}` : 'Name removed; the email shows instead');
  });
  // Stop sharing from inside the sheet: confirm, then close the card
  s.el.addEventListener('click', async e => {
    const b = e.target.closest('[data-act="member-del"]'); if (!b) return;
    e.stopPropagation();
    const label = personLabel(email);
    if (!(await haConfirm({ title: 'Stop sharing?', text: `${label} won’t see Kaki Home any more. You can add them again later.`, ok: 'Stop sharing', danger: true }))) return;
    try {
      await S.cloud.setMembers(h.id, h.members.filter(x => x !== email));
      await haCloseSheet(s.el);
      haToast(`Stopped sharing with ${label}`);
    } catch (err) { haToast(S.cloud.explain(err, 'Removing them')); }
  }, true);
  return s;
}

// An invite from the person's own mail app (no email server: Kaki Home never sends mail itself).
function inviteHref(email) {
  const from = who() || S.user?.name?.split(' ')[0] || '';
  const link = location.origin + location.pathname.replace(/[^/]*$/, '') + '#/settings';   // lands on Sign in
  const body = `Hi! I've added you to our household on Kaki Home, so we can all see what's at home, what to use first and what to buy.\n\n`
    + `1. Open ${link}\n2. Settings → Continue with Google (or Use email instead), using this email address (${email})\n3. Add it to your home screen: Safari's Share button → Add to Home Screen (iPhone), or Chrome's menu → Add to home screen (Android)`
    + (from ? `\n\n${from}` : '');
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Our household on Kaki Home')}&body=${encodeURIComponent(body)}`;
}

// ---- data sources ------------------------------------------------------------------------------------------------

function loadInto(data) {
  for (const k of KINDS) { S[k].clear(); for (const o of data[k] || []) S[k].set(o.id, o); }
}
function onRemote(kind, docs, removed) {
  for (const d of docs) S[kind].set(d.id, d);
  for (const id of removed) S[kind].delete(id);
  redraw();
  if (kind === 'items' && docs.some(d => d.photo)) migratePhotos();
}
let unwatch = null;
async function useHousehold(h) {
  S.household = h;
  prefs.set('household', h.id);
  S.backend?.close?.();
  S.backend = await S.cloud.openCloud(h.id, err => { S.syncError = S.cloud.explain(err, 'Saving'); redraw(); });
  S.mode = 'cloud';
  S.pics.clear();
  loadInto(await S.backend.load());
  migratePhotos();
  S.backend.listen(onRemote);
  unwatch?.();
  unwatch = await S.cloud.watchHousehold(h.id, x => { if (x) { S.household = x; redraw(); } });
  S.localCount = (await S.local.load()).items.length;
  redraw();
}
async function useLocal() {
  S.backend?.close?.();
  unwatch?.(); unwatch = null;
  S.backend = S.local;
  S.mode = 'local';
  S.household = null; S.allHouseholds = []; S.lookupFailed = false; S.syncError = false;
  S.pics.clear();
  loadInto(await S.local.load());
  migratePhotos();
  redraw();
}

// ---- two households for one account: merge them into one ---------------------------------------------------------

// The Settings card, only when this account is in more than one household (a second "Start our household"
// made a duplicate). Only an owner can delete a household, so someone else is asked to do it.
function mergeCard() {
  if (S.mode !== 'cloud' || S.allHouseholds.length < 2) return '';
  const p = MG.plan(S.allHouseholds, S.household?.id, me());
  const notMine = [...new Set(p.notMine.map(h => personLabel(h.owner)))];
  const body = p.notMine.length && !S.allHouseholds.some(h => h.owner === me())
    ? `<li><div class="ha-row"><span class="ha-row-icon">${icon('alert')}</span><span class="ha-row-body"><span class="ha-row-title">You’re in more than one household</span><span class="ha-row-sub kh-break">Ask ${esc(notMine.join(' or '))} to merge them.</span></span></div></li>`
    : `<li><button type="button" class="ha-row ha-row--action" data-act="merge-open"><span class="ha-row-icon">${icon('alert')}</span><span class="ha-row-body"><span class="ha-row-title">You’re in more than one household</span><span class="ha-row-sub">Merge them into one</span></span>${chevron()}</button></li>`;
  return section('Two households', `<ul class="ha-list">${body}</ul>`, { id: 'merge', footer: 'The same email is in more than one household, so you may see a different one on another phone. Merging moves everything into one.' });
}
// The merge sheet: each household (name, who started it, how many people), the one with the most people chosen to keep.
async function openMerge() {
  let all;
  try { all = await S.cloud.findHouseholds(me()); } catch (err) { return haToast(S.cloud.explain(err, 'Looking')); }
  S.allHouseholds = all;
  if (all.length < 2) { redraw(); return haToast('There’s only one household now.'); }
  let keep = S.cloud.pickHousehold(all, '').id;
  const s = haSheet({ title: 'Merge households', closeLabel: 'Cancel', grey: true, body: '', onClose: afterSheet });
  const body = $('.ha-sheet-body', s.el);
  const draw = () => {
    const p = MG.plan(all, keep, me());
    const rows = all.map(h => `<li><label class="ha-row kh-pick"><span class="ha-row-body"><span class="ha-row-title kh-break">${esc(h.name || 'Our home')}</span>
      <span class="ha-row-sub kh-break">${esc(plural((h.members || []).length, 'person', 'people'))} · started by ${esc(personLabel(h.owner))}</span></span>
      <input type="radio" name="kh-keep" value="${esc(h.id)}"${h.id === keep ? ' checked' : ''} aria-label="Keep ${esc(h.name || 'Our home')}, ${esc(plural((h.members || []).length, 'person', 'people'))}"></label></li>`).join('');
    const why = p.over ? `Together they have ${p.total} people and a household holds ${MG.MAX_MEMBERS}. Remove some people first, then merge.`
      : p.notMine.length ? `Only whoever started a household can merge it away. Ask ${[...new Set(p.notMine.map(h => personLabel(h.owner)))].join(' or ')} to merge them.` : '';
    body.innerHTML = `<p class="kh-em-lead">Choose the one to keep. Everything in the others (items, history, shopping lists, photos, places, names and people) moves into it, then the others are deleted.</p>
      <ul class="ha-list" role="radiogroup" aria-label="Household to keep">${rows}</ul>
      ${why ? `<p class="ha-field-error" role="alert">${icon('alert')}<span>${esc(why)}</span></p>` : ''}
      <p class="ha-section-footer" id="kh-merge-msg" role="status"></p>
      <button type="button" class="ha-btn ha-btn--primary ha-btn--block" data-pm="go"${p.canMerge ? '' : ' disabled'}>Merge into this one</button>`;
  };
  draw();
  let busy = false;
  s.el.addEventListener('change', e => { if (e.target.name === 'kh-keep' && !busy) { keep = e.target.value; draw(); } });
  s.el.addEventListener('click', async e => {
    if (!e.target.closest('[data-pm="go"]') || busy) return;
    const p = MG.plan(all, keep, me());
    if (!p.canMerge) return;
    if (!(await haConfirm({ title: 'Merge and delete the others?', text: `${plural(p.others.length, 'other household', 'other households')} will be deleted after everything is copied into ${p.keep.name || 'Our home'}. This can’t be undone.`, ok: 'Merge', danger: true }))) return;
    busy = true;
    const say = t => { const m = $('#kh-merge-msg', s.el); if (m) m.textContent = t; };
    body.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
    try {
      say('Copying…');
      for (const o of p.others) await S.cloud.copyHousehold(p.keep.id, o.id, p.members);   // any failure stops here: nothing deleted
      if (p.members.length !== (p.keep.members || []).length) await S.cloud.addMembers(p.keep.id, p.members);
      if (S.household?.id !== p.keep.id) await useHousehold({ ...p.keep, members: p.members });   // leave the ones about to go
      say('Removing the extra households…');
      for (const o of p.others) await S.cloud.removeHousehold(o.id);
      S.allHouseholds = [{ ...p.keep, members: p.members }];
      await haCloseSheet(s.el);
      redraw();
      haToast(`Merged. One household now, with ${plural(p.members.length, 'person', 'people')}.`);
    } catch (err) {
      busy = false;
      say(`${S.cloud.explain(err, 'Merging')} Nothing was lost; the households are as they were, so you can try again.`);
      body.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    }
  });
  return s;
}

// ---- signing in by email (besides Google): an emailed link, or a password ----------------------------------------------

// Every change of who is signed in comes here. A new password account is `pending` until the emailed link has been
// tapped: no household lookup, no household data, nothing from Firestore (its rules need a verified email).
async function handleUser(u) {
  S.pending = u && !u.verified ? u : null;
  S.user = u && u.verified ? u : null;
  if (!S.user) { if (S.mode !== 'local') await useLocal(); else redraw(); return; }
  let h = null;
  S.lookupFailed = false;
  try { h = await locate(S.user.email); } catch (e) { console.warn('household', e?.code); S.lookupFailed = true; }   // can't tell (no signal): never "none"
  if (h) await useHousehold(h); else redraw();
}
// Which household this account opens: the one this phone used last, else the biggest. Every one it is in is kept in
// S.allHouseholds (two means a duplicate to merge: Settings offers it).
async function locate(email) {
  const all = await S.cloud.findHouseholds(email);
  S.allHouseholds = all;
  return S.cloud.pickHousehold(all, prefs.get('household') || '');
}
// "I've verified": reload the account and its token, then carry on as signed in (or say it isn't done yet).
async function checkVerified({ quiet = false } = {}) {
  try {
    const u = await S.cloud.refreshUser();
    if (!u) { if (!quiet) haToast('Sign in again, please.'); return; }
    if (!u.verified) { if (!quiet) haToast('Not yet. Tap the link in the email first, then try again.'); return; }
    await handleUser(u);
    haToast('Verified. You’re signed in.');
  } catch (err) { if (!quiet) haToast(S.cloud.explain(err, 'Checking')); }
}
// The one sheet for email: the address, then "Email me a sign-in link" or "Use a password" (Sign in, Create account,
// Forgot password). `confirm` is for an emailed link opened where the address wasn't saved: just ask for it.
function openEmailSheet({ confirm = false, onSubmit = null } = {}) {
  const C = S.cloud;
  let step = confirm ? 'confirm' : 'email', mail = C.savedEmail(), err = '', busy = false;
  const s = haSheet({ title: confirm ? 'Finish signing in' : 'Sign in with email', closeLabel: 'Cancel', grey: true, body: '', onClose: afterSheet });
  const body = $('.ha-sheet-body', s.el);
  const emailField = (hint = '') => `<label class="ha-field"><span class="ha-field-label">Email</span>
      <input class="ha-input" id="kh-em-email" name="email" type="email" value="${esc(mail)}" autocomplete="email" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="you@example.com"${hint ? ' aria-describedby="kh-em-hint"' : ''}></label>${hint ? `<p class="ha-section-footer kh-em-hint" id="kh-em-hint">${hint}</p>` : ''}`;
  const errBox = () => `<p class="ha-field-error" id="kh-em-err" role="alert"${err ? '' : ' hidden'}>${icon('alert')}<span>${esc(err)}</span></p>`;
  const views = {
    email: () => `<form id="kh-em-form" novalidate>${emailField('Use the email the household added. No password needed: we email you a link that signs you in.')}${errBox()}
        <button type="submit" class="ha-btn ha-btn--primary ha-btn--block" data-pe="link">Email me a sign-in link</button>
        <button type="button" class="ha-btn ha-btn--block kh-em-second" data-pe="pw">Use a password</button></form>`,
    password: () => `<form id="kh-em-form" novalidate>${emailField()}
        <label class="ha-field"><span class="ha-field-label">Password</span>
          <input class="ha-input" id="kh-em-pass" name="password" type="password" autocomplete="current-password" minlength="${C.MIN_PASSWORD}" aria-describedby="kh-em-phint"></label>
        <p class="ha-section-footer kh-em-hint" id="kh-em-phint">New here? Choose at least ${C.MIN_PASSWORD} characters, then tap Create account. We email a link to check the address.</p>${errBox()}
        <button type="submit" class="ha-btn ha-btn--primary ha-btn--block" data-pe="signin">Sign in</button>
        <button type="button" class="ha-btn ha-btn--block kh-em-second" data-pe="create">Create account</button>
        <div class="kh-em-links"><button type="button" class="ha-btn ha-btn--plain ha-btn--compact" data-pe="forgot">Forgot password?</button>
          <button type="button" class="ha-btn ha-btn--plain ha-btn--compact" data-pe="back">Email me a link instead</button></div></form>`,
    sent: () => `<div class="kh-em-note"><span class="ha-row-icon">${icon('mail')}</span><div><p class="kh-em-title">Check your email</p>
        <p>We sent a sign-in link to <strong class="kh-break">${esc(mail)}</strong>. Tap it on this phone and you’re in.</p>
        <p>On an iPhone the link may open in Safari instead of the home-screen app. That’s fine: you’ll be signed in there. In the home-screen app, use a password instead, or ask for the link from inside the home-screen app.</p></div></div>${errBox()}
      <button type="button" class="ha-btn ha-btn--primary ha-btn--block" data-pe="link">Send it again</button>
      <button type="button" class="ha-btn ha-btn--block kh-em-second" data-pe="pw">Use a password instead</button>`,
    reset: () => `<div class="kh-em-note"><span class="ha-row-icon">${icon('mail')}</span><div><p class="kh-em-title">Check your email</p>
        <p>We sent a link to <strong class="kh-break">${esc(mail)}</strong>. Open it, choose a new password, then come back and sign in.</p></div></div>
      <button type="button" class="ha-btn ha-btn--primary ha-btn--block" data-pe="pw">Back to sign in</button>`,
    confirm: () => `<form id="kh-em-form" novalidate><p class="kh-em-lead">You opened a sign-in link. Type the email it was sent to, to finish.</p>${emailField()}${errBox()}
        <button type="submit" class="ha-btn ha-btn--primary ha-btn--block" data-pe="finish">Sign in</button></form>`,
  };
  const draw = (focus = true) => {
    body.innerHTML = views[step]();
    if (focus) requestAnimationFrame(() => (step === 'password' && mail ? $('#kh-em-pass', body) : $('#kh-em-email', body))?.focus({ preventScroll: true }));
  };
  const fail = e => { err = step === 'confirm' && e?.code === 'auth/invalid-email' && C.goodEmail(mail) ? 'That isn’t the email the link was sent to. Check it and try again.' : C.explain(e, 'That'); const box = $('#kh-em-err', body); if (box) { box.hidden = false; box.lastElementChild.textContent = err; } };
  const run = async fn => {
    if (busy) return; busy = true; err = '';
    const box = $('#kh-em-err', body); if (box) box.hidden = true;
    body.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { fail(e); }
    busy = false;
    body.querySelectorAll('button').forEach(b => { b.disabled = false; });
  };
  const read = () => { const i = $('#kh-em-email', body); if (i) mail = i.value.trim(); return mail; };
  const act = {
    link: () => run(async () => { mail = (read() || mail).toLowerCase(); await C.sendLink(mail); step = 'sent'; draw(); }),
    pw: () => { read(); step = 'password'; err = ''; draw(); },
    back: () => { read(); step = 'email'; err = ''; draw(); },
    signin: () => run(async () => { await C.passwordSignIn(read(), $('#kh-em-pass', body).value); await haCloseSheet(s.el); }),
    create: () => run(async () => {
      await C.passwordCreate(read(), $('#kh-em-pass', body).value);
      await haCloseSheet(s.el);
      haToast('Check your email and tap the link, then come back.');
    }),
    forgot: () => run(async () => { await C.resetPassword(read()); step = 'reset'; draw(); }),
    finish: () => run(async () => { if (await onSubmit(read())) await haCloseSheet(s.el); }),
  };
  s.el.addEventListener('click', e => { const b = e.target.closest('[data-pe]'); if (b && b.type !== 'submit') act[b.dataset.pe]?.(); });
  s.el.addEventListener('submit', e => {
    e.preventDefault();
    const b = e.submitter?.dataset.pe || (step === 'password' ? 'signin' : step === 'confirm' ? 'finish' : 'link');
    act[b]?.();
  });
  draw();
  return s;
}
// A link from the sign-in email opened this page: finish with the saved address, or ask for it (the link was opened in
// another browser, such as Safari instead of the home-screen app). The link's query comes off the address afterwards.
async function finishEmailLink() {
  const C = S.cloud;
  let isLink = false;
  try { isLink = await C.isEmailLink(); } catch { return; }
  if (!isLink) return;
  const href = location.href;
  let used = false;
  const tidy = () => { used = true; history.replaceState(history.state, '', C.stripLinkParams(href)); };
  const attempt = async email => {
    try { await C.finishLink(email, href); tidy(); haToast('Signed in.'); return true; }
    catch (err) {
      if (err?.code === 'auth/invalid-email') throw err;   // wrong address: let them retype it
      tidy(); haToast(C.explain(err, 'Signing in')); return true;
    }
  };
  const saved = C.savedEmail();
  if (saved) { try { if (await attempt(saved)) return; } catch { /* the saved address was wrong: ask */ } }
  // closing the sheet steps back in history, so the address is tidied again once it has gone
  openEmailSheet({ confirm: true, onSubmit: attempt }).closed.then(() => { if (used) tidy(); });
}

// ---- updates: a new version takes over only when nobody is in the middle of something ----------------------------

const idle = () => !haSheetOpen() && !['add', 'edit'].includes(screen()) && !S.dirty
  && !(document.activeElement?.matches?.('input, textarea, select') && document.activeElement.value);
let waiting = null, reloading = false;
function offerUpdate(w) {
  waiting = w;
  if (idle()) { w.postMessage('take-over'); return; }
  haToast('Update ready', { action: 'Restart', ms: 10000, onAction: () => waiting?.postMessage('take-over') });
}
function watchUpdates(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  // the app went to the background: a good moment to take the update quietly
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && waiting && idle()) waiting.postMessage('take-over'); });
}

// ---- start ----------------------------------------------------------------------------------------------------

let R = null;
async function start() {
  if (DEMO) {
    S.local = S.backend = openMemory(sampleData('Sample', { household: true }));
  } else {
    try { S.local = await openLocal(); }
    catch { S.local = openMemory(); haToast('This browser can’t save here (private mode?). Changes last until you close it.'); }
    S.backend = S.local;
  }
  loadInto(await S.backend.load());
  setTimeout(migratePhotos, 1000);   // old-style photos move out quietly, after the first screen is drawn
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  addEventListener('online', () => { if (S.user && !S.household && S.lookupFailed && S.cloud) handleUser(S.user); else redraw(); });
  addEventListener('offline', redraw);
  R = haRouter({
    render: r => draw(r),
    tabOf: r => ['item', 'edit', 'add', 'guide'].includes(r.parts[0]) ? S.originTab : r.hash,
  });
  // family sharing, only when a Firebase project is set up (config.js) or in the emulator tests
  if (!DEMO && (firebaseConfig || EMULATOR)) {
    try {
      S.cloud = await import('./cloud.js');
      if (S.cloud.configured) {
        if (EMULATOR) window.__kakihome = { S, signIn: S.cloud.emulatorSignIn };
        S.cloud.onUser(handleUser).catch(() => { /* no signal on the very first open: stays on this phone's list */ });
        finishEmailLink();
        // someone verified their email in the mail app and came back: carry on without asking
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.pending) checkVerified({ quiet: true }); });
      }
    } catch { /* sharing unavailable (no signal on the first open) */ }
    redraw();
  }
  if ('serviceWorker' in navigator && !EMULATOR) {
    navigator.serviceWorker.register('sw.js').then(watchUpdates).catch(() => { /* no offline copy (private window) */ });
  }
  window.__kakihome = { ...(window.__kakihome || {}), S };
  setTimeout(maybeWelcome, 300);
}

// ---- the welcome, once per phone (guide.js) -------------------------------------------------------------------------

// Someone opening an invite: the email's link ends #/settings, where Sign in is.
const INVITED = /^#\/settings/.test(location.hash);
function maybeWelcome() {
  if (!WELCOME) {
    if (DEMO || EMULATOR || welcomed()) return;
    // already using the app on this phone (from before the welcome existed): never interrupt them
    if (S.items.size || prefs.get('household') || prefs.get('name')) { markWelcomed(); return; }
  }
  if (haSheetOpen() || ['add', 'edit'].includes(screen())) return;
  // a first-time user: the Getting started checklist goes on Home too (never for anyone already using the app)
  if (!DEMO && prefs.get('tour') == null) { prefs.set('tour', 'on'); redraw(); }
  showWelcome({ invited: INVITED && !S.user, save: !DEMO });
}
function showWelcome({ invited = false, save = true } = {}) {
  openWelcome({
    invited, save, signedIn: !!S.user,
    onDone: v => {
      afterSheet();
      if (v === 'add') haGo('#/add');
      else if (v === 'start') openStarter();
      else if (v === 'signin') {
        if (screen() !== 'settings') haGo('#/settings');
        requestAnimationFrame(() => $('[data-act="signin"]')?.focus());
      }
    },
  });
}
start();
