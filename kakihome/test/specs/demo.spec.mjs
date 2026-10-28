// Demo mode (?demo: a made-up household in memory), every screen at 390, 360 and 320 px: no sideways scroll, axe clean,
// edit and delete with Undo, and 200% text. Run: npx playwright test demo   (SHOTS=<dir> saves the 320 px screens)
import { test, expect } from './fixtures.mjs';
import { open, hash, go, toast, noSideways, shot } from './helpers.mjs';

for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
  test(`demo at ${w} px: every screen`, async ({ phone, axe }) => {
    const page = await open(phone, { w, h, url: '/kakihome/?demo' });
    await expect(page.locator('.ha-large-sub'), `demo ${w}: says it is a demo`).toContainText('Demo');
    expect(await page.evaluate(() => window.__kakihome.S.mode), `demo ${w}: memory only`).toBe('demo');
    const itemId = await page.evaluate(() => [...window.__kakihome.S.items.values()].find(i => i.name === 'Light soy sauce').id);
    for (const hsh of ['#/', '#/items', '#/item/' + itemId, '#/add', '#/edit/' + itemId, '#/shop', '#/settings', '#/guide']) {
      await go(page, hsh);
      await noSideways(page, `demo ${w} ${hsh}`);
      if (w !== 390) await axe(page, `demo ${w} ${hsh}`);
      if (w === 320) await shot(page, `320-${hsh.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'home'}`);
    }
    if (w === 390) {
      // edit: change the name, save goes back to the item
      await go(page, '#/item/' + itemId);
      await page.click('[data-act="edit"]');
      await page.fill('#kh-form [name="name"]', 'Light soy sauce (big)');
      await page.click('#kh-save');
      await expect(page.locator('h1'), 'edit saves and returns').toHaveText('Light soy sauce (big)');
      expect(hash(page)).toBe('#/item/' + itemId);
      // delete with Undo
      const has = () => page.evaluate(id => window.__kakihome.S.items.has(id), itemId);
      await page.click('[data-act="delete"]');
      await expect.poll(has, { message: 'delete removes it' }).toBe(false);
      await toast(page).locator('.toast-action').click();
      await expect.poll(has, { message: 'Undo restores it' }).toBe(true);
      // 200% text: still no sideways scroll
      await page.evaluate(() => { document.documentElement.style.fontSize = '212.5%'; });
      for (const hsh of ['#/', '#/items', '#/item/' + itemId, '#/add', '#/shop', '#/settings', '#/guide']) { await go(page, hsh); await noSideways(page, `demo 200% ${hsh}`); }
    }
  });
}
