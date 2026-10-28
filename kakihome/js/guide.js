// Kaki Home: help for first-time users. Two parts, kept here so app.js stays small:
// 1. The welcome: a short, skippable sheet, shown once per phone. New users get two cards (what it's for, then "fill
//    it in a minute", which opens the quick start in tour.js); the home screen and sharing are steps in the Home
//    checklist instead (tour.js). Shown once per phone (localStorage 'kakihome:welcomed'). Never in ?demo unless ?welcome is added;
//    never for someone who already uses the app (items, a household or a name on this phone). Someone opening an
//    invite (the link ends #/settings) gets a shorter version that ends at Sign in. Skip, back, Escape or dragging
//    the sheet down all close it, and it never comes back on its own ("Show the welcome again" in Settings).
// 2. The guide screen (#/guide, "How to use Kaki Home"): short grouped sections, linked from Settings and from the
//    empty Home screen.
// Everything is kit components (https://design.flamingbeing.com/v1/); the few own styles are kh-w* and kh-dots in kakihome.css.
import { haSheet, haCloseSheet, haIcon as icon, haEsc as esc, haAnnounce } from 'https://design.flamingbeing.com/v1/app.js';
import { prefs } from './store.js';

const FLAG = 'welcomed';   // prefs key: localStorage 'kakihome:welcomed'
export const welcomed = () => !!prefs.get(FLAG, false);
export const markWelcomed = () => prefs.set(FLAG, true);
// Running from the home screen already (no need for the home-screen card).
export function installed() {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; }
}

const row = (iconName, title, sub = '', trail = '') => `<li><div class="ui-row"><span class="ui-row-lead">${icon(iconName)}</span>
  <span class="ui-row-main"><span class="kh-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span>${trail}</div></li>`;
const plainRow = (title, sub = '', trail = '') => `<li><div class="ui-row"><span class="ui-row-main"><span class="kh-row-title">${title}</span>${sub ? `<span class="ui-row-sub">${sub}</span>` : ''}</span>${trail ? `<span class="ui-row-trail">${trail}</span>` : ''}</div></li>`;
const list = rows => `<ul class="ui-list">${rows.join('')}</ul>`;

// ---------- the welcome ----------

const FOR = list([
  row('box', 'What’s at home', 'In the fridge, freezer and cupboards'),
  row('clock', 'What to use first', 'Things near their date come to the top'),
  row('cart', 'What to buy', 'Running low goes on the shopping list'),
  row('mic', 'Quick to fill in', 'Tap what you have, say it, or scan the barcode'),
]);
const CARDS = {
  intro: {
    icon: 'home', title: 'Welcome to Kaki Home',
    text: 'Know what you have. Buy what you need. Use what you own before it expires. One list for the whole household, helpers included.',
    body: FOR,
  },
  invited: {
    icon: 'users', title: 'Welcome to your household',
    text: 'Someone in the household added you. Once you sign in, you see the same items and shopping list as them.',
    body: FOR,
  },
  install: {
    icon: 'download', title: 'Put it on your home screen',
    text: 'It then opens like an app, full screen, and works without signal.',
    body: list([
      row('share', 'iPhone', 'In Safari, tap Share, then Add to Home Screen.'),
      row('plus', 'Android', 'In Chrome, tap the menu (three dots), then Add to home screen or Install app.'),
    ]),
  },
  family: {
    icon: 'users', title: 'Share it with the household',
    text: 'Everyone then sees the same items and shopping list. You can skip this and use it on this phone alone.',
    body: list([
      row('user', 'Starting it', 'Settings, then Continue with Google (or Use email instead) and Start our household. Add each person’s email.'),
      row('mail', 'Already added by someone?', 'Sign in with the email they added: Google, an emailed link or a password. Your household on Kaki Home appears.'),
      row('mail', 'Signing in by email', 'Settings, Use email instead: we email you a link, or you use a password. A new password account needs its emailed link tapped once, then I’ve verified.'),
      row('users', 'In two households?', 'Settings shows a card, and Home a note. Tap Merge them, keep the one with the most people, and everything moves into it. Only whoever started the others can do it.'),
      row('info', 'Who can see it', 'Only the people added. No one else.'),
    ]),
  },
  first: {
    icon: 'plus', title: 'Fill it in a minute',
    text: 'Tap the everyday things you have at home and they go straight in, with a rough best-before date you can change later.',
    body: list([
      row('check', 'Tap what you have', 'Rice, eggs, milk, soy sauce, tissue… grouped by where they’re kept.'),
      row('mic', 'Or say it', 'The microphone on Home: “2 Meiji milk in the fridge expires 25 Oct”.'),
      row('list', 'Then a short checklist', 'Home shows a few first steps, each with a Show me button.'),
    ]),
  },
  signin: {
    icon: 'user', title: 'Sign in to join',
    text: 'Sign in once and the household appears on this phone.',
    body: list([
      row('user', 'Tap Continue with Google', 'On the Settings screen, under Household sharing. No Google? Tap Use email instead: an emailed link, or a password.'),
      row('mail', 'Use the email they added', 'The address the invite was sent to. Another account sees an empty list.'),
    ]),
  },
};

// Which cards: invited people get a short version ending at Sign in; someone signed in already skips sharing.
export function welcomeCards({ invited = false, signedIn = false, isInstalled = installed() } = {}) {
  const ids = invited ? ['invited', 'install', 'signin'] : ['intro', 'first'];
  return ids.filter(id => id !== 'install' || !isInstalled);
}

// Open the welcome sheet. onDone(choice) runs after it closes: 'add' (Add my first item), 'signin' (Go to sign in) or
// undefined (skipped or Look around first). The flag is set however it closes (unless save is false: the demo).
export function openWelcome({ invited = false, signedIn = false, save = true, onDone } = {}) {
  const ids = welcomeCards({ invited, signedIn });
  let at = 0;
  const s = haSheet({
    title: 'Getting started', closeLabel: 'Skip', grey: true, detent: 'large',
    lead: `<button type="button" class="ui-plain" data-size="small" data-kh-w="prev" hidden>Back</button>`,
    body: `<div class="kh-welcome" id="kh-welcome"></div>`,
    footer: `<div class="kh-dots" aria-hidden="true">${ids.map(() => '<span class="kh-dot"></span>').join('')}</div><div class="ui-buttons kh-wbtns" id="kh-wbtns"></div>`,
    onClose: v => { if (save) markWelcomed(); onDone?.(v); },
  });
  const el = s.el;
  el.classList.add('kh-wsheet');
  const card = el.querySelector('#kh-welcome'), btns = el.querySelector('#kh-wbtns');
  const prev = el.querySelector('[data-kh-w="prev"]'), skip = el.querySelector('.ha-sheet-head [data-ha-close]');
  const draw = (focus = false) => {
    const id = ids[at], c = CARDS[id], last = at === ids.length - 1;
    card.dataset.card = id;
    card.innerHTML = `<div class="kh-wtop"><span class="kh-wicon">${icon(c.icon)}</span>
      <h3 class="kh-wtitle" tabindex="-1"><span class="ha-sr">Step ${at + 1} of ${ids.length}: </span>${esc(c.title)}</h3>
      <p class="kh-wtext">${esc(c.text)}</p></div>${c.body}`;
    el.querySelectorAll('.kh-dot').forEach((d, i) => d.classList.toggle('is-current', i === at));
    prev.hidden = at === 0;
    skip.textContent = last ? 'Close' : 'Skip';
    btns.innerHTML = !last
      ? `<button type="button" class="ui-fill ui-wide" data-kh-w="next">Next</button>`
      : invited
        ? `<button type="button" class="ui-fill ui-wide" data-kh-w="signin">Go to sign in</button>
           <button type="button" class="ui-plain ui-wide" data-kh-w="done">Look around first</button>`
        : `<button type="button" class="ui-fill ui-wide" data-kh-w="start">Pick what you have</button>
           <button type="button" class="ui-plain ui-wide" data-kh-w="done">Look around first</button>`;
    el.querySelector('.ha-sheet-body').scrollTop = 0;
    if (focus) { el.querySelector('.kh-wtitle').focus({ preventScroll: true }); }
  };
  const step = d => {
    const n = Math.min(ids.length - 1, Math.max(0, at + d));
    if (n === at) return;
    at = n; draw(true);
    haAnnounce(`Step ${at + 1} of ${ids.length}`);
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-kh-w]'); if (!b) return;
    const a = b.dataset.khW;
    if (a === 'next') step(1);
    else if (a === 'prev') step(-1);
    else haCloseSheet(el, a === 'done' ? undefined : a);
  });
  // swipe sideways between cards (optional; the buttons do the same)
  let x0 = null, y0 = 0;
  card.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
  card.addEventListener('pointerup', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  card.addEventListener('pointercancel', () => { x0 = null; });
  draw();
  return s;
}

// ---------- the guide screen ----------

const badge = (text, tone = '') => `<span class="ui-badge"${tone ? ` data-tone="${tone === 'bad' ? 'danger' : tone}"` : ''}>${esc(text)}</span>`;
function section(id, title, rows, footer = '') {
  return `<section class="ui-section" aria-labelledby="h-g-${id}"><h2 class="ui-section-head" id="h-g-${id}"><span>${esc(title)}</span></h2>${list(rows)}${footer ? `<p class="ui-section-foot">${footer}</p>` : ''}</section>`;
}

export function viewGuide() {
  return `<h1 class="ha-large-title">How to use Kaki Home</h1>
    <p class="ha-large-sub">Everything it does, in a few words each.</p>
    ${section('adding', 'Adding things', [
      row('search', 'Search the list', 'Tap + and type a name, like soy sauce or Milo. Picking a common Singapore product fills in the brand, size and where it’s kept.'),
      row('mic', 'Say or type a list', 'Tap the microphone on Home, or Say or type a list on Add. Say “2 Meiji milk in the fridge expires 25 Oct and 3 tins of sardines”, check the list it makes, then Add.'),
      row('barcode', 'Scan a barcode', 'Tap Scan barcode and point the camera at it. Once something is named, its barcode finds it next time.'),
      row('camera', 'Add a photo', 'So everyone knows which one it is.'),
      row('plus', 'How many', 'How many you have now. Tap + or − to change it.'),
      row('calendar', 'Best before', 'Type the date on the pack, or tap 1 week, 1 month… for a rough one.'),
      row('clock', 'Keeps once opened', 'How many days it lasts after opening, like 5 for milk. Leave it empty for things that don’t go off.'),
    ])}
    ${section('daily', 'Every day', [
      row('check', 'Used 1', 'Tap on the item when one is finished. It takes one out of stock.'),
      row('box', 'Open', 'Tap when you open one. Its countdown starts (only for things with “keeps once opened”).'),
      row('trash', 'Bin 1', 'Tap when one is thrown away. If it was past its date, it counts as expired. Home counts what gets wasted each month.'),
      row('refresh', 'Undo', 'Tapped the wrong thing? Tap Undo in the message at the bottom.'),
      row('cart', 'Bought more', 'On the item, add what you bought and its date.'),
    ])}
    ${section('soon', 'Use soon and expired', [
      plainRow('Past its date', 'Use it today or throw it away.', badge('Expired', 'bad')),
      plainRow('Within a week', 'Use these first. Home lists everything due soon (a week, unless you change it in Settings).', badge('2 days', 'warn')),
      plainRow('Within a month', 'Fine for now.', badge('3 weeks')),
    ], 'Opened items count down from the day they were opened, or to the printed date if that comes first.')}
    ${section('shop', 'Shopping list', [
      row('cart', 'It fills itself', 'Items land here when none are left, when they’re down to their “on the list when down to” number, or when they’ll run out within a week at your usual pace.'),
      row('plus', 'Add anything', 'Type it at the top of the list.'),
      row('check', 'Tick when bought', 'For an item from your stock, it asks how many you bought and the new date.'),
      row('external', 'FairPrice and Sheng Siong', 'Each item links to their search, to buy online.'),
      row('share', 'Share the list', 'Tap Share at the top to send it in WhatsApp or a message.'),
    ])}
    ${section('measure', 'Used before expiry', [
      row('clock', 'The number on Home', 'How many things the household used up this month while they were still in date: the waste Kaki Home helped prevent.'),
      row('alert', 'Expired', 'Things binned after their date. Fewer is better.'),
    ])}
    ${section('pace', 'How fast we use it', [
      row('clock', 'Two “Used 1”s', 'After the second, the item shows how long one lasts and when it will run out, and puts it on the list in time.'),
    ])}
    ${section('family', 'Household sharing', [
      row('user', 'Start it', 'One person: Settings, Continue with Google (or Use email instead), then Start our household.'),
      row('users', 'Add the household', 'Family, helpers or caregivers: type each person’s email and tap Add. The envelope emails them the link.'),
      row('mail', 'When you’re invited', 'Open the link, then Settings, Continue with Google or Use email instead, with the email that was added.'),
      row('info', 'Who can see it', 'Only the people added. Whoever started it can stop sharing with anyone else.'),
    ])}
    ${section('phone', 'Phone tips', [
      row('download', 'On your home screen', 'iPhone: in Safari, Share, then Add to Home Screen. Android: in Chrome, the menu, then Add to home screen.'),
      row('cloud', 'No signal', 'It still works. Changes reach the household when you’re back online.'),
      row('refresh', 'Looks out of date?', 'At the bottom of Settings, tap Get the latest version. Your items are kept.'),
    ])}
    <ul class="ui-list kh-gagain"><li><button type="button" class="ui-row" data-tone="action" data-align="center" data-act="welcome"><span class="ui-row-main"><span class="kh-row-title">Show the welcome again</span></span></button></li></ul>`;
}
