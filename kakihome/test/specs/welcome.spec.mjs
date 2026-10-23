// The welcome (every card, Add my first item, the installed and invite versions, small screens and 200% text), the guide,
// and the first steps (quick start, Getting started checklist). Run: npx playwright test welcome   (SHOTS=<dir> saves screenshots)
// Each test opens its own fresh phone; ?demo keeps everything in memory, ?welcome shows the welcome even there.
import { test, expect } from './fixtures.mjs';
import { open, hash, go, toast, sheet, welcomeSheet, expectCard, noSideways, afterStart, shot } from './helpers.mjs';

const next = p => welcomeSheet(p).locator('[data-kh-w="next"]');

test('plain ?demo shows no welcome', async ({ phone }) => {
  const page = await open(phone, { url: '/kakihome/?demo' });
  await afterStart(page);
  await expect(welcomeSheet(page)).toHaveCount(0);
});

test('the demo welcome: every card, Back, Look around first, Pick what you have', async ({ phone, axe }) => {
  const page = await open(phone, { url: '/kakihome/?demo&welcome' });
  await expectCard(page, 'Welcome to Kaki Home');
  await expect(welcomeSheet(page).locator('[data-kh-w="prev"]'), 'no Back on the first card').toBeHidden();
  await axe(page, 'welcome card 1');
  await shot(page, 'w1-intro');
  await next(page).click();
  await expectCard(page, 'Fill it in a minute');
  await expect(welcomeSheet(page).locator('.kh-dot').nth(1), 'dot 2 is current').toHaveClass(/is-current/);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('kh-wtitle')), { message: 'card 2: focus moves to its title' }).toBe(true);
  await axe(page, 'welcome card 2');
  await shot(page, 'w2-fill');
  await expect(next(page), 'no Next on the last card').toHaveCount(0);
  await expect(welcomeSheet(page).locator('.ha-sheet-head [data-ha-close]'), 'the last card says Close, not Skip').toHaveText('Close');
  await welcomeSheet(page).locator('[data-kh-w="prev"]').click();
  await expectCard(page, 'Welcome to Kaki Home');   // Back shows the previous card
  await next(page).click();
  await expect(welcomeSheet(page).locator('[data-kh-w="done"]'), 'a quiet Look around first').toHaveText('Look around first');
  await welcomeSheet(page).locator('[data-kh-w="start"]').click();
  await expect(sheet(page).locator('.ha-sheet-title'), 'Pick what you have opens the quick start').toHaveText('What do you have?');
  expect(await page.evaluate(() => localStorage.getItem('kakihome:welcomed')), 'the demo saves no flag').toBeNull();
});

test('installed (opened from the home screen): two cards, no home-screen card', async ({ phone }) => {
  const page = await open(phone, { url: '/kakihome/?demo&welcome', init: () => Object.defineProperty(navigator, 'standalone', { get: () => true }) });
  await expect(welcomeSheet(page).locator('.kh-dot'), 'installed: two cards').toHaveCount(2);
  await next(page).click();
  await expectCard(page, 'Fill it in a minute');
});

test('opened from an invite (the link ends #/settings): short, ends at Sign in, on Settings', async ({ phone, axe }) => {
  const page = await open(phone, { url: '/kakihome/?demo&welcome#/settings' });
  await expectCard(page, 'Welcome to your household');
  await expect(welcomeSheet(page).locator('.kh-dot'), 'invite: three cards').toHaveCount(3);
  for (let i = 0; i < 2; i++) await next(page).click();
  await expectCard(page, 'Sign in to join');
  await axe(page, 'welcome invite');
  await shot(page, 'w5-invite-signin');
  await welcomeSheet(page).locator('[data-kh-w="signin"]').click();
  await expect(welcomeSheet(page)).toHaveCount(0);
  expect(hash(page), 'Go to sign in leaves them on Settings').toBe('#/settings');
});

// the welcome and the guide at 390, 360 and 320, and (at 390) at 200% text
for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
  test(`the welcome and the guide at ${w} px`, async ({ phone, axe }) => {
    const page = await open(phone, { w, h, url: '/kakihome/?demo&welcome' });
    await expect(welcomeSheet(page).locator('.kh-dot').first()).toBeVisible();
    for (let i = 1; i <= 2; i++) {
      await noSideways(page, `welcome ${w} card ${i}`);
      if (w !== 390) await axe(page, `welcome ${w} card ${i}`);
      if (i < 2) { await next(page).click(); await expectCard(page, 'Fill it in a minute'); }
    }
    await welcomeSheet(page).locator('[data-kh-w="done"]').click();
    await expect(welcomeSheet(page), `welcome ${w}: Look around first closes it`).toHaveCount(0);
    expect(hash(page)).toBe('#/');
    await go(page, '#/guide');
    await noSideways(page, `guide ${w}`);
    await axe(page, `guide ${w}`);
    if (w === 390) {
      await shot(page, 'g1-guide-top');
      if (process.env.SHOTS) for (const [n, y] of [['g2-guide-scrolled', 900], ['g3-guide-more', 2000], ['g4-guide-end', 1e6]]) { await page.evaluate(y => scrollTo(0, y), y); await shot(page, n); }
      // the guide's own "Show the welcome again"
      await page.click('[data-act="welcome"]');
      await expect(welcomeSheet(page), 'the guide can show the welcome again').toHaveCount(1);
      await page.goBack();
      await expect(welcomeSheet(page)).toHaveCount(0);
      expect(hash(page), 'closing it stays on the guide').toBe('#/guide');
      // 200% text
      await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; });
      await noSideways(page, 'guide 200%');
      await page.click('[data-act="welcome"]');
      await expect(welcomeSheet(page)).toHaveCount(1);
      for (let i = 1; i <= 2; i++) {
        await noSideways(page, `welcome 200% card ${i}`);
        const r = await welcomeSheet(page).evaluate(d => ({ sw: d.querySelector('.ha-sheet-body').scrollWidth, cw: d.querySelector('.ha-sheet-body').clientWidth }));
        expect(r.sw, `welcome 200% card ${i}: no sideways scroll in the sheet`).toBeLessThanOrEqual(r.cw);
        if (i === 2) await shot(page, 'w6-200pc');
        if (i < 2) { await next(page).click(); await expectCard(page, 'Fill it in a minute'); }
      }
    }
  });
}

// ---- first steps: the quick start and the Getting started checklist, on a fresh phone ----
test('first steps: the quick start, then the checklist ticks as things are done', async ({ phone, axe }) => {
  const page = await open(phone);
  await expectCard(page, 'Welcome to Kaki Home');
  await next(page).click();
  await welcomeSheet(page).locator('[data-kh-w="start"]').click();
  const starter = sheet(page);
  await expect.poll(() => starter.locator('.kh-start-chips .ha-chip').count(), { message: 'the quick start offers everyday things' }).toBeGreaterThanOrEqual(20);
  for (const n of ['Fresh milk', 'Eggs', 'Thai hom mali rice', 'Bathroom tissue']) await starter.locator('.kh-start-chips .ha-chip', { hasText: n }).first().click();
  await expect(page.locator('#kh-start-go'), 'the button counts the picks').toHaveText('Add 4 items');
  await axe(page, 'quick start');
  await shot(page, 't1-quick-start');
  await page.click('#kh-start-go');
  await expect(toast(page), 'adds them').toContainText('Added 4 items');
  await expect.poll(() => page.evaluate(() => window.__kakihome.S.items.size), { message: 'four items in the pantry' }).toBe(4);
  const milk = await page.evaluate(() => [...window.__kakihome.S.items.values()].find(i => i.name === 'Fresh milk'));
  expect(milk.batches[0].expiry && milk.location === 'Fridge', 'with a rough date and its usual place').toBeTruthy();
  const total = await page.locator('#h-tour').locator('xpath=..').locator('.kh-tour-row').count();
  const count = page.locator('#h-tour .ha-num');
  await expect(count, 'the checklist ticks "Add what you have"').toHaveText(`1 of ${total}`);
  await axe(page, 'home with the checklist');
  await shot(page, 't2-checklist', true);
  // Show me: Used 1 is pointed at on an item
  await page.click('[data-act="tour-show"][data-task="use"]');
  await expect(page, 'Show me opens an item').toHaveURL(/#\/item\//);
  await expect(page.locator('[data-act="use"].kh-spot'), 'and rings Used 1').toHaveCount(1);
  await shot(page, 't3-show-me');
  await page.locator('[data-act="use"]').first().click();
  await page.click('.ha-back');
  await expect(count, 'Used 1 ticks it').toHaveText(`2 of ${total}`);
  // the shopping list, the home-screen tip, and Say or type
  await page.click('[data-act="tour-show"][data-task="shop"]');
  await expect(page, 'Show me opens the shopping list').toHaveURL(/#\/shop$/);
  await page.click('.ha-tabbar a[href="#/"]');
  await page.click('[data-act="tour-show"][data-task="install"]');
  await expect(sheet(page).locator('.ha-sheet-title'), 'the home-screen steps').toHaveText('On your home screen');
  await page.click('dialog.ha-sheet[open] [data-ha-close]');
  await expect(sheet(page)).toHaveCount(0);
  await page.click('[data-act="tour-show"][data-task="say"]');
  await page.fill('#kh-quick-text', 'kaya in the fridge');
  await expect(page.locator('#kh-quick-list li')).toHaveCount(1);
  await page.click('#kh-quick-go');
  await expect(count, 'shopping, home screen and Say or type tick').toHaveText(`5 of ${total}`);
  if (total === 6) {
    await page.click('[data-act="tour-show"][data-task="family"]');
    await expect(page, 'Show me for the family opens Settings').toHaveURL(/#\/settings$/);
    await expect(page.locator('.kh-spot'), 'and rings the sign-in button').toHaveCount(1);
  }
  // hide it, then bring it back from Settings
  await go(page, '#/');
  await page.click('[data-act="tour-hide"]');
  await expect(page.locator('#h-tour')).toHaveCount(0);
  await go(page, '#/settings');
  await page.click('[data-act="tour-on"]');
  await expect(page.locator('#h-tour'), 'Settings brings the checklist back').toHaveCount(1);
  expect(hash(page)).toBe('#/');
});

test('an existing household (items already on the phone): no checklist', async ({ phone }) => {
  const page = await open(phone, { init: () => { localStorage.setItem('kakihome:welcomed', 'true'); } });
  await afterStart(page);
  await expect(page.locator('#h-tour'), 'no checklist for someone already using it').toHaveCount(0);
});
