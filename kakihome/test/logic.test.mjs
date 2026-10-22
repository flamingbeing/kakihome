// Unit tests for js/logic.js: node kakihome/test/logic.test.mjs
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { CATALOGUE, CATEGORIES, LOCATIONS } from '../js/catalogue.js';

const T = '2026-10-16';
const item = (batches, f = {}) => ({ id: 'i1', name: 'Soy sauce', openDays: 90, batches, ...f });

// dates
assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
assert.equal(L.daysBetween('2026-10-16', '2026-10-09'), -7);
assert.equal(L.expiryStatus('2026-10-15', T), 'expired');
assert.equal(L.expiryStatus('2026-10-23', T), 'soon');
assert.equal(L.expiryStatus('2026-11-10', T), 'month');
assert.equal(L.expiryStatus('2027-06-01', T), 'ok');
assert.equal(L.expiryStatus(null, T), 'none');
assert.equal(L.expiryLabel('2026-10-15', T), 'expired yesterday');
assert.equal(L.expiryLabel('2026-10-16', T), 'use by today');
assert.equal(L.expiryLabel('2026-10-26', T), '10 days left');

// opened: the earlier of the printed date and opened + keeps-days
const opened = { id: 'b1', qty: 1, expiry: '2027-10-01', openedAt: '2026-10-01' };
assert.equal(L.batchUseBy(opened, item([])), '2026-12-30');
assert.equal(L.batchUseBy({ ...opened, expiry: '2026-11-01' }, item([])), '2026-11-01');
assert.equal(L.batchUseBy({ id: 'x', qty: 1, expiry: null, openedAt: null }, item([])), null);

// first expiring first out; opened ones first
const it = item([{ id: 'a', qty: 2, expiry: '2027-05-01' }, { id: 'b', qty: 1, expiry: '2027-01-01' }, { id: 'c', qty: 1, expiry: '2028-01-01', openedAt: '2026-10-10' }]);
assert.deepEqual(L.fefo(it).map(b => b.id), ['c', 'b', 'a']);
assert.equal(L.totalQty(it), 4);
let r = L.takeOut(it, { qty: 2, at: '2026-10-16T10:00:00Z' });
assert.deepEqual(r.item.batches.map(b => [b.id, b.qty]), [['a', 2]]);
assert.equal(r.event.type, 'use'); assert.equal(r.event.qty, 2);
assert.equal(it.batches.length, 3, 'never mutates');
r = L.takeOut(it, { qty: 9 });
assert.equal(r.event.qty, 4); assert.equal(r.item.batches.length, 0);
assert.equal(L.takeOut(item([]), {}).event, null);
r = L.takeOut(it, { type: 'discard', batchId: 'a' });
assert.equal(r.event.type, 'discard'); assert.equal(r.item.batches.find(b => b.id === 'a').qty, 1);

// opening one splits it off its batch
r = L.openOne(item([{ id: 'a', qty: 3, expiry: '2027-05-01', openedAt: null }]), { today: T });
assert.deepEqual(r.item.batches.map(b => [b.qty, b.openedAt]).sort(), [[1, T], [2, null]]);
r = L.openOne(item([{ id: 'a', qty: 1, expiry: '2027-05-01', openedAt: null }, { id: 'b', qty: 1, expiry: '2027-01-01', openedAt: null }]), { today: T, batchId: 'a' });
assert.equal(r.item.batches.find(b => b.openedAt).expiry, '2027-05-01');

r = L.addStock(item([]), { qty: 3, expiry: '2027-01-01', at: '2026-10-16T02:00:00Z' });
assert.equal(L.totalQty(r.item), 3); assert.equal(r.event.type, 'add');

// consumption pattern: 4 bottles finished over 60 days -> one every 20 days
const now = new Date('2026-10-16T12:00:00Z');
const evs = ['2026-08-01', '2026-08-21', '2026-09-10', '2026-09-30'].map((d, i) => ({ id: 'e' + i, itemId: 'i1', type: 'use', qty: 1, at: d + 'T12:00:00Z' }));
evs.push({ id: 'd', itemId: 'i1', type: 'discard', qty: 1, at: '2026-10-02T12:00:00Z' });
const u = L.usage(evs, now);
assert.equal(Math.round(u.daysPerUnit), 20);
assert.equal(u.units, 4); assert.equal(u.discards, 1);
assert.equal(u.months.length, 6);
assert.deepEqual(u.months.slice(-3).map(m => [m.used, m.wasted]), [[2, 0], [2, 0], [0, 1]]);
assert.equal(L.paceLabel(u), '1 every 3 weeks');
// 1 in stock (the one in use, started when the last ran out on 30 Sep) lasts 20 days -> 20 Oct
assert.equal(L.runOutDate(item([{ id: 'a', qty: 1 }]), u, now), '2026-10-20');
assert.equal(L.usage(evs.slice(0, 1), now).daysPerUnit, null);

// shopping list
const byItem = new Map([['i1', evs]]);
const list = L.toBuy([
  item([{ id: 'a', qty: 1 }]),
  { id: 'i2', name: 'Rice', batches: [] },
  { id: 'i3', name: 'Milo', lowAt: 1, batches: [{ id: 'x', qty: 1 }] },
  { id: 'i4', name: 'Salt', batches: [{ id: 'x', qty: 1 }] },
  { id: 'i5', name: 'Gone', archived: true, batches: [] },
], byItem, { now, days: 30 });
assert.deepEqual(list.map(x => [x.item.name, x.why]), [['Rice', 'out'], ['Milo', 'low'], ['Soy sauce', 'soon']]);

const ex = L.expiring([item([{ id: 'a', qty: 1, expiry: '2026-10-20' }]), { id: 'z', name: 'z', batches: [{ id: 'q', qty: 1, expiry: '2027-10-20' }] }], { today: T });
assert.deepEqual(ex.map(x => x.date), ['2026-10-20']);

// search and shop links
assert.ok(L.score('soy', 'Light soy sauce Kikkoman') > 0);
assert.equal(L.score('soy milk', 'Light soy sauce'), 0);
assert.ok(L.score('kikk', 'Kikkoman soy') > 0);
assert.equal(L.fairpriceUrl('Kaya & butter'), 'https://www.fairprice.com.sg/search?query=Kaya%20%26%20butter');
assert.equal(L.shengSiongUrl('milo'), 'https://shengsiong.com.sg/search/milo');

// CSV quotes commas
assert.match(L.toCsv([{ id: '1', name: 'Eggs, large', brand: 'Pasar', batches: [{ id: 'b', qty: 2, expiry: '2026-10-20' }] }], T), /"Eggs, large",Pasar,,,,2,2026-10-20,4 days left,/);

// the catalogue is well formed
assert.ok(CATALOGUE.length > 150);
for (const c of CATALOGUE) {
  assert.ok(c.name, 'name');
  assert.ok(CATEGORIES.includes(c.category), `${c.name}: category ${c.category}`);
  assert.ok(LOCATIONS.includes(c.location), `${c.name}: location ${c.location}`);
  assert.ok(c.openDays === null || c.openDays > 0, `${c.name}: openDays`);
}
// badges and words
assert.deepEqual(L.shortLabel('2026-10-15', T), { text: 'Expired', tone: 'bad' });
assert.deepEqual(L.shortLabel('2026-10-16', T), { text: 'Today', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-17', T), { text: 'Tomorrow', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-21', T), { text: '5 days', tone: 'warn' });
assert.deepEqual(L.shortLabel('2026-10-30', T), { text: '2 weeks', tone: 'plain' });
assert.deepEqual(L.shortLabel('2027-10-30', T), { text: '', tone: '' });
assert.deepEqual(L.shortLabel(null, T), { text: '', tone: '' });
assert.equal(L.whyText({ why: 'out' }, T), 'None left');
assert.equal(L.whyText({ why: 'low', qty: 1 }, T), 'Only 1 left');
assert.equal(L.whyText({ why: 'soon', runOut: '2026-10-19' }, T), 'Runs out in about 3 days');
assert.equal(L.whyText({ why: 'soon', runOut: '2026-10-16' }, T), 'Runs out about now');
assert.deepEqual(L.monthStats([...evs, { type: 'add', qty: 3, at: '2026-10-05T00:00:00Z' }], '2026-10'), { used: 0, wasted: 1, bought: 3, expired: 0, saved: 0 });

// Kaki Home's measures: used before expiry ("saved"), and binned after the date ("expired")
const dated = item([{ id: 'old', qty: 1, expiry: '2026-10-10' }, { id: 'new', qty: 2, expiry: '2026-11-01' }], { openDays: null });
r = L.takeOut(dated, { batchId: 'new', today: T });
assert.equal(r.event.type, 'use'); assert.equal(r.event.saved, 1);
r = L.takeOut(dated, { type: 'discard', batchId: 'old', today: T });
assert.equal(r.event.type, 'expired', 'binned past its date counts as expired');
r = L.takeOut(dated, { type: 'discard', batchId: 'new', today: T });
assert.equal(r.event.type, 'discard', 'binned in date stays thrown away');
r = L.takeOut(dated, { batchId: 'old', today: T });
assert.equal(r.event.saved, undefined, 'used after its date is not saved');
r = L.takeOut(item([{ id: 'x', qty: 1, expiry: null }], { openDays: null }), { today: T });
assert.equal(r.event.saved, undefined, 'no date: not counted');
const ms = L.monthStats([
  { type: 'use', qty: 2, saved: 2, at: '2026-10-02T00:00:00Z' }, { type: 'use', qty: 1, at: '2026-10-03T00:00:00Z' },
  { type: 'expired', qty: 1, at: '2026-10-04T00:00:00Z' }, { type: 'discard', qty: 1, at: '2026-10-05T00:00:00Z' },
  { type: 'use', qty: 1, saved: 1, at: '2026-09-30T00:00:00Z' },
], '2026-10');
assert.deepEqual(ms, { used: 3, saved: 2, wasted: 2, expired: 1, bought: 0 });
assert.equal(L.usage([{ type: 'expired', qty: 1, at: '2026-10-04T00:00:00Z' }], now).discards, 1);
const rec = L.recent([{ id: 'a', createdAt: '2026-10-15T00:00:00Z' }, { id: 'b', createdAt: '2026-09-01T00:00:00Z' }, { id: 'c', createdAt: '2026-10-12T00:00:00Z' }], { now });
assert.deepEqual(rec.map(x => x.id), ['a', 'c']);
assert.equal(L.shareText(['Milk', 'Eggs']), 'Shopping list\n- Milk\n- Eggs');

// backups: round trip, and anything else is refused in plain words
const b = L.backup({ items: [{ id: 'a', name: 'x' }], events: [], shop: [{ id: 's' }] }, '2026-10-16T00:00:00Z');
assert.deepEqual(L.parseBackup(JSON.stringify(b)), { items: [{ id: 'a', name: 'x' }], events: [], shop: [{ id: 's' }], photos: [] });
// photos travel in backups too (only pictures, nothing else)
const pb = L.backup({ items: [{ id: 'a', thumb: 'data:image/jpeg;base64,t', hasPhoto: true }], photos: [{ id: 'a', data: 'data:image/jpeg;base64,p' }, { id: 'b', data: 'javascript:x' }, { id: 'c' }] });
assert.deepEqual(L.parseBackup(JSON.stringify(pb)).photos, [{ id: 'a', data: 'data:image/jpeg;base64,p' }]);
assert.deepEqual(L.parseBackup(JSON.stringify({ app: 'kakihome', items: [] })).photos, [], 'an old backup has no photos');
assert.deepEqual(L.parseBackup(JSON.stringify({ app: 'kakihome', items: [{ id: 'ok' }, { id: 'a/b' }, { name: 'no id' }, null] })).items, [{ id: 'ok' }]);
assert.throws(() => L.parseBackup('{"app":"other"}'), /not a Kaki Home backup/);
assert.throws(() => L.parseBackup('nonsense'), /not a Kaki Home backup/);

console.log('kakihome logic: ok');
