// Helpers shared by the Kaki Home browser specs (the ones that don't need the emulators).
import fs from 'node:fs';
import path from 'node:path';
import { expect } from './fixtures.mjs';

// the phone the app is tested on: touch, 2x pixels, downloads allowed (the backup)
export const MOBILE = { deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true };
// a phone that has seen the welcome and hidden the checklist: opens straight onto Home
export const SEEN = () => { try { localStorage.setItem('kakihome:welcomed', 'true'); localStorage.setItem('kakihome:tour', '"off"'); } catch { /* none */ } };

// open the app on a phone of this size and wait until it has started (it redraws once while starting, which would reset a
// form filled in too early: window.__kakihome is set when start-up is done).
// Service workers are blocked unless a test asks (serviceWorkers: 'allow'): on a first visit the worker claims the page and
// the app reloads itself once (sw.js clients.claim, then controllerchange), which wipes what a test has just done.
export async function open(phone, { w = 390, h = 844, url = '/kakihome/', name = 'phone', ...opts } = {}) {
  const page = await phone(name, { url, viewport: { width: w, height: h }, serviceWorkers: 'block', ...MOBILE, ...opts });
  await page.waitForFunction(() => window.__kakihome?.S);
  await expect(page.locator('.ha-large-title').first()).toBeVisible();
  return page;
}
export const hash = page => new URL(page.url()).hash;
export const toast = page => page.locator('.ha-toast.is-visible');
export const sheet = page => page.locator('dialog.ha-sheet[open]');
export const welcomeSheet = page => page.locator('dialog.ha-sheet.kh-wsheet[open]');
export const cardTitle = page => welcomeSheet(page).locator('.kh-wtitle');
export const ymdPlus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

// the screen's title, set when it has been drawn (document.title)
const TITLES = { '': 'Kaki Home', items: 'Items', shop: 'Shopping', settings: 'Settings', guide: 'How to use Kaki Home', add: 'Add an item', edit: 'Edit item' };
export async function go(page, h) {
  await page.evaluate(x => { location.hash = x; }, h);
  const name = h.replace(/^#\/?/, '').split('/')[0];
  if (name === 'item') await expect(page.locator('h1').first()).toBeVisible();
  await expect(page).toHaveTitle(name === '' ? 'Kaki Home' : name === 'item' ? / · Kaki Home$/ : `${TITLES[name]} · Kaki Home`);
}
export async function noSideways(page, what) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  expect(r.sw, `${what}: no sideways scroll (scrollWidth ${r.sw} > ${r.w})`).toBeLessThanOrEqual(r.w);
}
// add Kikkoman light soy sauce (2, a year) from the catalogue, ending on its item screen
export async function addSoy(page) {
  await page.click('.ha-tab--action');
  await page.fill('#kh-find', 'kikkoman soy');
  await page.locator('#kh-sugg [data-act="sugg"]').first().click();
  await expect(page.locator('#kh-form [name="name"]')).toHaveValue('Light soy sauce');
  await page.click('#kh-qty [data-step="1"]');
  await page.click('.kh-dates [data-act="date"]:has-text("1 year")');
  await page.click('#kh-save');
  await expect(page.locator('h1')).toHaveText('Light soy sauce');
}
// Settings > "Try it with sample items", then back to Home
export async function addSamples(page) {
  await go(page, '#/settings');
  await page.click('[data-act="sample"]');
  await expect(toast(page)).toContainText('sample items');
  await page.click('.ha-tabbar a[href="#/"]');
  await expect(page).toHaveTitle('Kaki Home');
}
// The app decides about the welcome and the checklist in a timer it starts as soon as it is up (300 ms). To prove
// something did NOT open, wait for our own timer queued after that one: timers of equal delay fire in the order set.
export async function afterStart(page) {
  await page.waitForFunction(() => window.__kakihome?.S);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
}
// SHOTS=<dir> also saves screenshots (kakihome/NOTES.md, "How to test")
export const shot = async (page, name, fullPage = false) => {
  if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png'), fullPage }); }
};
// the card's title without "Step 1 of 2: "
export const expectCard = (page, title) => expect(cardTitle(page)).toHaveText(new RegExp(`^(Step \\d+ of \\d+: )?${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
