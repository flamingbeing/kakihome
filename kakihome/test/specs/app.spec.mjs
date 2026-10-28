// Kaki Home on a phone (390 px, touch), on the phone's own list (IndexedDB), no sign-in.
// Run: npx playwright test app    (SHOTS=<dir> also saves screenshots)
// Each test starts from a fresh phone (its own server and storage) and makes the items it needs; none relies on another.
// The design kit loads from its live address (https://design.flamingbeing.com/v1/).
import fs from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { open, hash, go, toast, sheet, welcomeSheet, expectCard, ymdPlus, SEEN, addSoy, addSamples, afterStart, shot } from './helpers.mjs';

const section = (p, id) => p.locator('#' + id).locator('xpath=..');
const stock = p => p.locator('#h-stock .ha-num');
const undo = p => toast(p).locator('.toast-action').click();
const download = async (page, selector) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  return JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
};

test('first open: the welcome once per phone, then the empty screens', async ({ phone, axe }) => {
  const page = await open(phone);
  await expectCard(page, 'Welcome to Kaki Home');
  await expect(welcomeSheet(page).locator('.kh-dot'), 'two cards for someone new').toHaveCount(2);
  await shot(page, 'w0-first-open');
  await welcomeSheet(page).locator('.ha-sheet-head [data-ha-close]', { hasText: 'Skip' }).click();
  await expect(welcomeSheet(page), 'Skip closes it').toHaveCount(0);
  expect(hash(page), 'and stays on Home').toBe('#/');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kakihome:welcomed')), { message: 'Skip remembers it' }).toBe('true');
  await page.reload();
  await expect(page.locator('.ha-large-title')).toBeVisible();
  await afterStart(page);
  await expect(welcomeSheet(page), 'the welcome does not come back after a reload').toHaveCount(0);
  await expect(page.locator('#h-tour'), 'first open: Getting started on Home').toHaveCount(1);
  await page.click('[data-act="tour-hide"]');
  await expect(page.locator('#h-tour'), 'Hide this list hides it').toHaveCount(0);
  await expect(page.locator('.ha-empty-title', { hasText: 'Nothing here yet' }), 'empty pantry says so').toBeVisible();
  await expect(page.locator('.ha-empty a[href="#/guide"]'), 'empty Home links to the guide').toBeVisible();
  await go(page, '#/shop');
  await expect(section(page, 'h-shop').locator('.ha-section-footer'), 'an empty shopping list says how things get there').toContainText('come here by themselves');
  await go(page, '#/settings');
  if (await page.locator('[data-act="signin"]').count()) await expect(section(page, 'h-family').locator('.ha-section-footer'), 'signed out: one line on why to sign in').toContainText(/^Sign in to share/);
  await page.click('.ha-tabbar a[href="#/"]');
  await expect(page.locator('.ha-tab[aria-current="page"]'), 'Pantry tab current').toHaveAttribute('href', '#/');
  await axe(page, 'empty home');
  await shot(page, '01-empty');
});

test('add from the catalogue, open one, Used 1 and Undo, Bought more, the shopping list, back', async ({ phone, axe }) => {
  const page = await open(phone, { init: SEEN });
  await page.click('.ha-tab--action');
  await expect(page, 'Add opens the add screen').toHaveURL(/#\/add$/);
  await expect(page.locator('.ha-tabbar'), 'a task swaps the tab bar for a toolbar').toBeHidden();
  await expect(page.locator('#kh-toolbar')).toBeVisible();
  await page.fill('#kh-find', 'kikkoman soy');
  await page.locator('#kh-sugg [data-act="sugg"]').first().click();
  await expect(page.locator('#kh-form [name="name"]'), 'catalogue fills the name').toHaveValue('Light soy sauce');
  await expect(page.locator('#kh-form [name="brand"]'), 'and the brand').toHaveValue('Kikkoman');
  await expect(page.locator('#kh-form [name="openDays"]'), 'and keeps-once-opened days').toHaveValue('90');
  await page.click('#kh-qty [data-step="1"]');
  await expect(page.locator('#kh-qty output'), 'stepper adds one').toHaveText('2');
  await page.click('.kh-dates [data-act="date"]:has-text("1 year")');
  await expect(page.locator('#kh-form [name="expiry"]'), 'quick date fills the date').toHaveValue(ymdPlus(365));
  await axe(page, 'add form');
  await shot(page, '02-add', true);
  await page.click('#kh-save');
  await expect(page, 'saving opens the item').toHaveURL(/#\/item\//);
  await expect(page.locator('h1'), 'item title').toHaveText('Light soy sauce');
  await expect(stock(page), 'two in stock').toHaveText('2');

  // open one, then Used 1 and Undo
  await page.locator('[data-act="open"]').first().click();
  await expect(toast(page), 'open says so').toContainText('Opened 1 Light soy sauce');
  await expect(page.locator('.kh-batch .ha-row-title', { hasText: '1 opened' }), 'an opened batch appears').toHaveCount(1);
  await page.locator('.kh-batch', { hasText: '1 opened' }).locator('[data-act="use"]').click();
  await expect(stock(page), 'Used 1 takes one out').toHaveText('1');
  await undo(page);
  await expect(stock(page), 'Undo puts it back').toHaveText('2');
  await axe(page, 'item');
  await shot(page, '03-item', true);

  // Bought more sheet: back closes it and stays on the item
  const itemUrl = page.url();
  await page.click('[data-act="bought"]');
  await expect(sheet(page), 'Bought more opens a sheet').toHaveCount(1);
  await axe(page, 'bought sheet');
  await shot(page, '04-bought');
  await page.goBack();
  await expect(sheet(page), 'back closes the sheet').toHaveCount(0);
  expect(page.url(), 'and stays on the item').toBe(itemUrl);

  // add to the shopping list from the item
  await page.click('[data-act="to-list"]');
  await expect(page.locator('[data-act="to-list"]'), 'item shows it is on the list').toContainText('On the shopping list');

  // back from the item returns to where Add was opened from (Home)
  await page.goBack();
  await expect(page, 'back from the item returns to Home (the add screen was replaced)').toHaveURL(/#\/$/);
});

test('something expiring in 2 days is under Use soon; an empty name is refused; Cancel goes back', async ({ phone }) => {
  const page = await open(phone, { init: SEEN });
  await page.click('.ha-tab--action');
  await page.fill('#kh-form [name="name"]', 'Baby spinach');
  await page.selectOption('#kh-form [name="category"]', 'Fresh produce');
  await page.selectOption('#kh-form [name="location"]', 'Fridge');
  await page.fill('#kh-form [name="expiry"]', ymdPlus(2));
  await page.click('#kh-save');
  await expect(page.locator('h1')).toHaveText('Baby spinach');
  await page.click('.ha-tabbar a[href="#/"]');
  const row = section(page, 'h-use-soon').locator('.ha-row', { hasText: 'Baby spinach' });
  await expect(row, 'expiring item under Use soon').toHaveCount(1);
  await expect(row.locator('.ha-badge--warn'), 'with a 2 days badge').toHaveText('2 days');
  // an empty name is refused in words
  await page.click('.ha-tab--action');
  await page.click('#kh-save');
  await expect(page.locator('#kh-name-err'), 'empty name shows an error').toBeVisible();
  await page.click('[data-act="back"]');
  await expect(page, 'Cancel goes back').toHaveURL(/#\/$/);
});

test('shopping: a line by hand, tick an item from your stock, remove a line and Undo', async ({ phone, axe }) => {
  const page = await open(phone, { init: SEEN });
  await addSoy(page);
  await page.click('[data-act="to-list"]');
  await expect(page.locator('[data-act="to-list"]')).toContainText('On the shopping list');
  await page.click('.ha-tabbar a[href="#/shop"]');
  await page.fill('#kh-shop-text', 'Bananas');
  await page.click('#kh-shop-add button[type=submit]');
  await expect(page.locator('#kh-shop .ha-row-title', { hasText: 'Bananas' }), 'a line added by hand').toHaveCount(1);
  await page.locator('#kh-shop label', { hasText: 'Kikkoman Light soy sauce' }).locator('input').check();
  await expect(sheet(page).locator('.ha-sheet-title'), 'ticking an item from your stock asks what was bought').toHaveText('Bought more');
  await page.click('dialog.ha-sheet[open] [data-act="date"]:has-text("1 month")');
  await page.click('dialog.ha-sheet[open] .ha-sheet-foot .ha-btn--primary');
  await expect(sheet(page), 'the sheet closes').toHaveCount(0);
  await expect(toast(page), 'stock added').toContainText('Added 1 Light soy sauce');
  await expect(page.locator('#kh-shop label.is-done', { hasText: 'Light soy sauce' }), 'ticked line struck through').toHaveCount(1);
  // remove a line, then Undo
  await page.click('#kh-shop [data-act="shop-del"][aria-label="Remove Bananas"]');
  await expect(page.locator('#kh-shop .ha-row-title', { hasText: 'Bananas' }), 'bin removes a line').toHaveCount(0);
  await undo(page);
  await expect(page.locator('#kh-shop .ha-row-title', { hasText: 'Bananas' }), 'Undo brings it back').toHaveCount(1);
  await axe(page, 'shopping');
  await shot(page, '05-shop', true);
});

test('sample items: the expired one, the dashboard, and binning an expired item', async ({ phone, axe }) => {
  const page = await open(phone, { init: SEEN });
  await addSamples(page);
  await expect(section(page, 'h-expired').locator('.ha-row', { hasText: 'Wholemeal bread' }), 'expired sample under Expired').toHaveCount(1);
  // the dashboard: four tiles and the main measure
  await expect(page.locator('.kh-stats .ha-stat'), 'four tiles on Home').toHaveCount(4);
  await expect(page.locator('.kh-stats'), 'tile: items at home').toContainText('Items at home');
  await expect(page.locator('.kh-goal'), 'the used-before-expiry card').toBeVisible();
  await expect(page.locator('#h-recent'), 'Recently added').toHaveCount(1);
  await axe(page, 'home');
  await shot(page, '06-home', true);

  // binning the expired bread counts as expired
  await section(page, 'h-expired').locator('a.ha-row', { hasText: 'Wholemeal bread' }).click();
  await page.locator('[data-act="toss"]').first().click();
  await expect(toast(page), 'binning past its date says expired').toContainText('(expired)');
  await expect(section(page, 'h-history'), 'history says expired').toContainText('Expired, thrown away');
});

test('Say or type: a sentence becomes items to confirm', async ({ phone, axe }) => {
  const page = await open(phone, { init: SEEN });
  await addSamples(page);
  await page.click('#bar-trail [data-act="quick"]');
  await expect(sheet(page).locator('.ha-sheet-title'), 'the mic opens Say or type').toHaveText('Say or type');
  await page.fill('#kh-quick-text', '2 Meiji milk in the fridge expires 25 Oct, salmon fillet freezer in 3 months and 3 tins of sardines');
  await expect(page.locator('#kh-quick-list li'), 'three things heard').toHaveCount(3);
  await expect(page.locator('#kh-quick-list'), 'matched to the catalogue').toContainText('Fresh milk');
  await expect(page.locator('#kh-quick-go'), 'the button counts them').toHaveText('Add 3 items');
  await page.locator('#kh-quick-list input').nth(2).uncheck();
  await expect(page.locator('#kh-quick-go'), 'unticking one leaves it out').toHaveText('Add 2 items');
  await axe(page, 'say or type');
  await shot(page, '06b-quick');
  const size = () => page.evaluate(() => window.__kakihome.S.items.size);
  const before = await size();
  await page.click('#kh-quick-go');
  await expect(toast(page), 'adds them').toContainText('Added 2 items');
  await expect.poll(size, { message: 'milk adds to the one at home, salmon is new' }).toBe(before + 1);
  await undo(page);
  await expect.poll(size, { message: 'Undo takes them back out' }).toBe(before);
});

test('items: search, place chips, sort, open one and come back', async ({ phone, axe }) => {
  const page = await open(phone, { init: SEEN });
  await addSamples(page);
  await page.click('.ha-tabbar a[href="#/items"]');
  await page.fill('#kh-q', 'kaya');
  await expect(page.locator('#kh-items-list .ha-row'), 'search finds one').toHaveCount(1);
  await page.click('[data-act="q-clear"]');
  await page.click('[data-act="place"][data-v="Fridge"]');
  await expect(page.locator('#kh-items-list .ha-row-sub', { hasText: 'Kitchen cabinet' }), 'place chip filters').toHaveCount(0);
  await page.click('.ha-seg:has(input[value="category"])');
  await expect.poll(() => page.locator('#kh-items-list .ha-section').count(), { message: 'category sort groups the list' }).toBeGreaterThan(1);
  await page.click('[data-act="place"][data-v=""]');
  await axe(page, 'items');
  await shot(page, '07-items', true);
  // open an item from the list, back returns to Items
  await page.locator('#kh-items-list a.ha-row', { hasText: 'Kaya' }).click();
  await expect(page.locator('.ha-back span'), 'back button names Items').toHaveText('Items');
  await page.click('.ha-back');
  await expect(page, 'back button returns to Items').toHaveURL(/#\/items$/);
});

test('Settings: expiring soon, the guide, the welcome again from Settings', async ({ phone }) => {
  const page = await open(phone, { init: SEEN });
  await go(page, '#/settings');
  await page.click('[data-act="soon"][data-v="14"]');
  await expect(page.locator('[data-act="soon"][data-v="14"]'), 'expiring soon can be 2 weeks').toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kakihome:soonDays')), { message: 'kept on this phone' }).toBe('14');
  await expect(section(page, 'h-help'), 'Settings has a Help section').toContainText('How to use Kaki Home');
  await page.click('#main a[href="#/guide"]');
  await expect(page).toHaveURL(/#\/guide$/);
  await expect(page.locator('h1'), 'the guide opens from Settings').toHaveText('How to use Kaki Home');
  await expect(page.locator('.ha-back span'), 'its back button names Settings').toHaveText('Settings');
  await expect(page.locator('.ha-tab[aria-current="page"]'), 'Settings stays the current tab').toHaveAttribute('href', '#/settings');
  await expect(page.locator('#main .ha-section'), 'eight guide sections').toHaveCount(8);
  await page.goBack();
  await expect(page, 'back returns to Settings').toHaveURL(/#\/settings$/);
  await page.click('#main a[href="#/guide"]');
  await expect(page).toHaveURL(/#\/guide$/);
  await page.click('.ha-back');
  await expect(page, 'the back button returns to Settings').toHaveURL(/#\/settings$/);
  // show the welcome again from Settings: back closes it
  await page.click('[data-act="welcome"]');
  await expectCard(page, 'Welcome to Kaki Home');
  await page.goBack();
  await expect(welcomeSheet(page), 'back closes the welcome').toHaveCount(0);
  expect(hash(page)).toBe('#/settings');
});

test('the backup, the version lines, no signal, and offline', async ({ phone, server, axe }) => {
  const page = await open(phone, { init: SEEN, serviceWorkers: 'allow' });
  // the first time the worker takes control the app reloads itself once, which would wipe whatever a test had just
  // done: let that happen first, then reload ourselves so the page is controlled from its start
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await page.reload();
  await page.waitForFunction(() => window.__kakihome?.S && navigator.serviceWorker.controller);
  await addSamples(page);
  // two lines on the shopping list, for the backup
  await go(page, '#/shop');
  for (const line of ['Bananas', 'Eggs']) {
    await page.fill('#kh-shop-text', line);
    await page.click('#kh-shop-add button[type=submit]');
    await expect(page.locator('#kh-shop .ha-row-title', { hasText: line })).toHaveCount(1);
  }
  await go(page, '#/settings');
  const items = await page.evaluate(() => window.__kakihome.S.items.size);
  const backup = await download(page, '[data-act="backup"]');
  expect(backup.app).toBe('kakihome');
  expect(backup.items.length, 'backup holds the items').toBe(items);
  expect(backup.items.length).toBeGreaterThanOrEqual(10);
  expect(backup.events.length, 'and the history').toBeGreaterThan(10);
  expect(backup.shop.length, 'and the list').toBe(2);
  await page.reload();
  await expect(page.locator('.ha-large-title')).toBeVisible();
  await expect(page.locator('#kh-version .ha-version-text')).toBeVisible();
  await expect(page.locator('#kh-version .ha-version-text'), 'version line from the cache name').toHaveText(/^App version (v\d+|\d{4}-\d{2}-\d{2} \([0-9a-f]{8}\))$/);
  await expect(page.locator('#kh-version .ha-version-btn'), 'get-latest button').toHaveText('Not updating? Get the latest version');
  expect(await page.evaluate(() => document.querySelector('#main').lastElementChild.id), 'version lines come last').toBe('kh-version');
  await axe(page, 'settings');
  await shot(page, '08-settings', true);
  // no signal: says so, keeps the caches
  server.swOffline = true;
  await page.click('#kh-version .ha-version-btn');
  await expect(page.locator('#kh-version .ha-version-msg')).toHaveText(/No signal|could not be reached/);
  expect((await page.evaluate(() => caches.keys())).some(k => k.startsWith('kakihome-')), 'no signal leaves the cache').toBe(true);
  server.swOffline = false;

  // offline: the app and its data still open
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page').toBe(true);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator('.ha-large-title')).toBeVisible();
  await go(page, '#/items');
  await expect(page.locator('#kh-items-list .ha-row', { hasText: 'Kaya' }), 'offline reload shows Kaki Home').toHaveCount(1);
  await expect(page.locator('.ha-tabbar'), 'offline: the kit styles load from the cache').toHaveCSS('position', 'fixed');
  // the kit comes from another address: its sprite is put in the page, so tab and row icons draw (also offline)
  await page.locator('[data-ha-sprite] symbol').first().waitFor({ state: 'attached' });
  const iconWidths = await page.evaluate(() => [...document.querySelectorAll('.ha-tabbar use, .ha-main use')].filter(u => u.closest('svg').getClientRects().length).map(u => u.getBBox().width));
  expect(iconWidths.length, `offline: icons draw (${iconWidths.join(', ')})`).toBeGreaterThanOrEqual(5);
  expect(iconWidths.every(w => w > 0), `offline: icons draw (${iconWidths.join(', ')})`).toBe(true);
  await page.context().setOffline(false);
});
