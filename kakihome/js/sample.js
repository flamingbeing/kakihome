// Made-up sample items (with a few months of history, so the consumption patterns show) for trying the app.
// The demo is a made-up Singapore household of three (Mum, Dad and the helper), so "who added it" and the monthly
// measures (used before expiry, expired) have something to show. No real people or data.
import { uid, ymd, addDays } from './logic.js';

const PEOPLE = ['Mum', 'Dad', 'Helper'];

export function sampleData(by = 'Sample', { household = false } = {}) {
  let turn = 0;
  const who = () => (household ? PEOPLE[turn++ % PEOPLE.length] : by);
  const t = ymd();
  const now = Date.now();
  const ago = d => new Date(now - d * 86400000).toISOString();
  const items = [], events = [];
  const add = (f, batches, history = []) => {
    const it = { id: uid(), brand: '', size: '', lowAt: 0, barcode: '', openDays: null, createdAt: ago(200), createdBy: who(), sample: true, ...f, batches: batches.map(b => ({ id: uid(), openedAt: null, addedAt: t, ...b })) };
    items.push(it);
    // used up while still in date unless marked 'late'; 'expired' is binned past its date
    for (const [type, d, qty = 1, late] of history) {
      events.push({ id: uid(), itemId: it.id, name: it.name, type, qty, at: ago(d), by: who(), ...(type === 'use' && !late ? { saved: qty } : {}) });
    }
  };
  add({ name: 'Light soy sauce', brand: 'Kikkoman', size: '500 ml', category: 'Sauces & condiments', location: 'Kitchen cabinet', openDays: 90, lowAt: 1 },
    [{ qty: 1, expiry: addDays(t, 300), openedAt: addDays(t, -80) }, { qty: 1, expiry: addDays(t, 420) }],
    [['add', 170, 3], ['use', 160], ['use', 110], ['use', 80]]);
  add({ name: 'Premium oyster sauce', brand: 'Lee Kum Kee', size: '510 g', category: 'Sauces & condiments', location: 'Fridge', openDays: 90 },
    [{ qty: 1, expiry: addDays(t, 200), openedAt: addDays(t, -40) }], [['add', 60], ['open', 40]]);
  add({ name: 'Fresh milk', brand: 'Meiji', size: '2 L', category: 'Dairy & eggs', location: 'Fridge', openDays: 5, lowAt: 1 },
    [{ qty: 1, expiry: addDays(t, 3) }], [['add', 30, 4], ['use', 26], ['use', 21], ['use', 16], ['use', 12], ['add', 10, 3], ['use', 7], ['use', 3]]);
  add({ name: 'Wholemeal bread', brand: 'Gardenia', size: '400 g', category: 'Bread & bakery', location: 'Kitchen cabinet' },
    [{ qty: 1, expiry: addDays(t, -1) }], [['add', 6, 2], ['expired', 0]]);
  add({ name: 'Kaya', brand: 'Glory', size: '250 g', category: 'Breakfast & spreads', location: 'Fridge', openDays: 14 },
    [{ qty: 1, expiry: addDays(t, 40), openedAt: addDays(t, -10) }], [['add', 12], ['open', 10]]);
  add({ name: 'Thai hom mali rice', brand: 'Royal Umbrella', size: '5 kg', category: 'Rice, noodles & grains', location: 'Kitchen cabinet', lowAt: 0 },
    [{ qty: 1, expiry: addDays(t, 250) }], [['add', 150, 2], ['use', 120], ['use', 75]]);
  add({ name: 'Sardines in tomato sauce', brand: 'Ayam Brand', size: '155 g', category: 'Canned & jarred', location: 'Kitchen cabinet', openDays: 2 },
    [{ qty: 4, expiry: addDays(t, 700) }], [['add', 90, 4]]);
  add({ name: 'Milo powder', brand: 'Nestlé', size: '1.5 kg', category: 'Drinks', location: 'Kitchen cabinet', openDays: 90 },
    [{ qty: 1, expiry: addDays(t, 9), openedAt: addDays(t, -50) }], [['add', 100, 2], ['use', 95], ['use', 50]]);
  add({ name: 'Laundry liquid', brand: 'Dynamo', size: '2.7 kg', category: 'Laundry & cleaning', location: 'Laundry', lowAt: 1 },
    [{ qty: 1, expiry: null }], [['add', 120, 3], ['use', 100], ['use', 55]]);
  add({ name: 'Bathroom tissue (10 rolls)', brand: 'Kleenex', size: '10 rolls', category: 'Kitchen & paper', location: 'Store room' },
    [], [['add', 60, 2], ['use', 45], ['use', 15]]);
  add({ name: 'Paracetamol tablets', brand: 'Panadol', size: '20 tablets', category: 'Medicine & first aid', location: 'Medicine box' },
    [{ qty: 2, expiry: addDays(t, 25) }], [['add', 300, 2]]);
  add({ name: 'Bananas', brand: '', size: '1 bunch', category: 'Fresh produce', location: 'Kitchen cabinet', createdAt: ago(1) },
    [{ qty: 1, expiry: addDays(t, 4) }], [['add', 1]]);
  add({ name: 'Chicken thighs', brand: '', size: '500 g', category: 'Meat & seafood', location: 'Freezer', createdAt: ago(3) },
    [{ qty: 2, expiry: addDays(t, 80) }], [['add', 3, 2]]);
  add({ name: 'Yoghurt', brand: 'Marigold', size: '130 g', category: 'Dairy & eggs', location: 'Fridge', createdAt: ago(5) },
    [{ qty: 2, expiry: addDays(t, 6) }], [['add', 5, 4], ['use', 4], ['use', 2]]);
  add({ name: 'Eggs (10)', brand: 'Pasar', size: '10 eggs', category: 'Dairy & eggs', location: 'Fridge' },
    [{ qty: 1, expiry: addDays(t, 12) }], [['add', 20, 2], ['use', 14], ['add', 3]]);
  return { items, events };
}
