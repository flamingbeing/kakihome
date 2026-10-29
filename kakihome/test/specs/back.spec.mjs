// Back with tabs, as Android apps do it: switching tabs adds at most one Back step, Back on another tab goes to the first
// tab, Back on the first tab leaves the app; a screen opened over a tab still closes first. Run: npx playwright test back
import { test, expect } from './fixtures.mjs';
import { MOBILE, SEEN, hash, sheet } from './helpers.mjs';

const tab = (page, h) => page.locator(`.ha-tabbar a[href="${h}"]`);
async function start(phone) {
  // a page before the app, so leaving it is seen
  const page = await phone('phone', { url: '/kakihome/icons/favicon-32.png', init: SEEN, serviceWorkers: 'block', ...MOBILE });
  await page.goto('/kakihome/?demo');
  await page.waitForFunction(() => window.__kakihome?.S);
  await expect(page).toHaveTitle('Kaki Home');
  return page;
}
const len = page => page.evaluate(() => history.length);

test('tabs add one Back step: Back goes to the first tab, then leaves', async ({ phone }) => {
  const page = await start(phone);
  const before = await len(page);
  for (const [h, title] of [['#/items', 'Items'], ['#/shop', 'Shopping'], ['#/settings', 'Settings'], ['#/items', 'Items']]) {
    await tab(page, h).click();
    await expect(page, `tab ${h}`).toHaveTitle(`${title} · Kaki Home`);
    expect(hash(page)).toBe(h);
  }
  expect(await len(page) - before, 'four tab changes: at most one more Back step').toBeLessThanOrEqual(1);
  await page.goBack();
  await expect(page, 'Back on another tab: the first tab').toHaveTitle('Kaki Home');
  expect(hash(page)).toBe('#/');
  await page.goBack();
  await expect(page, 'Back on the first tab: leaves the app').toHaveURL(/favicon-32\.png$/);
});

test('tapping the first tab takes the step away again', async ({ phone }) => {
  const page = await start(phone);
  const before = await len(page);
  await tab(page, '#/shop').click();
  await expect(page).toHaveTitle('Shopping · Kaki Home');
  await tab(page, '#/').click();
  await expect(page).toHaveTitle('Kaki Home');
  await tab(page, '#/items').click();
  await expect(page).toHaveTitle('Items · Kaki Home');
  expect(await len(page) - before).toBeLessThanOrEqual(1);
  await page.goBack();
  await expect(page).toHaveTitle('Kaki Home');
  await page.goBack();
  await expect(page).toHaveURL(/favicon-32\.png$/);
});

test('a screen over a tab closes first; a tab tap from it adds nothing', async ({ phone }) => {
  const page = await start(phone);
  await tab(page, '#/items').click();
  await expect(page).toHaveTitle('Items · Kaki Home');
  await page.locator('a.kh-item').first().click();
  await expect(page).toHaveTitle(/ · Kaki Home$/);
  expect(hash(page)).toMatch(/^#\/item\//);
  await page.goBack();
  await expect(page, 'Back on an item: its tab').toHaveTitle('Items · Kaki Home');
  // open an item again, then tap another tab: the item's step goes, the tab's step stays one
  const before = await len(page);
  await page.locator('a.kh-item').first().click();
  await expect(page).toHaveTitle(/ · Kaki Home$/);
  await tab(page, '#/shop').click();
  await expect(page).toHaveTitle('Shopping · Kaki Home');
  expect(await len(page)).toBeLessThanOrEqual(before + 1);
  await page.goBack();
  await expect(page, 'Back: the first tab, not the item').toHaveTitle('Kaki Home');
  await page.goBack();
  await expect(page).toHaveURL(/favicon-32\.png$/);
});

test('Back closes a sheet, then the screen, then goes to the first tab, then leaves', async ({ phone }) => {
  const page = await start(phone);
  await tab(page, '#/items').click();
  await expect(page).toHaveTitle('Items · Kaki Home');
  await page.locator('a.kh-item').first().click();
  await expect(page).toHaveTitle(/ · Kaki Home$/);
  await page.click('[data-act="bought"]');
  await expect(sheet(page)).toHaveCount(1);
  await page.goBack();
  await expect(sheet(page), 'Back: the sheet closes').toHaveCount(0);
  expect(hash(page), 'on the item still').toMatch(/^#\/item\//);
  await page.goBack();
  await expect(page, 'Back: the item closes').toHaveTitle('Items · Kaki Home');
  await page.goBack();
  await expect(page, 'Back: the first tab').toHaveTitle('Kaki Home');
  await page.goBack();
  await expect(page).toHaveURL(/favicon-32\.png$/);
});
