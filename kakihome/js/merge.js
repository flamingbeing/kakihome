// Merging duplicate households. An account can end up in two (a second "Start our household" tapped when the first
// couldn't be found); this is the pure part of moving one into the other: who may do it, and which members and settings
// result. cloud.js does the copying. Plain Node, so test/merge.test.mjs runs it. (From the pantry's merge.js; Kaki Home
// has one settings document, `people`, the names given to members.)

export const MAX_MEMBERS = 20;   // the rules allow at most 20 members
export const PEOPLE_ID = 'people';
const lc = s => String(s ?? '').trim().toLowerCase();

// The kept household's members plus everyone in the others, in that order, without repeats. `over` when more than 20.
export function unionMembers(keep = [], others = []) {
  const out = [];
  for (const m of [...keep, ...others.flat()]) { const e = lc(m); if (e && !out.includes(e)) out.push(e); }
  return { members: out.slice(0, MAX_MEMBERS), over: out.length > MAX_MEMBERS, total: out.length };
}
// Only the owner of a household may delete it (the rules). `me` is this account's email.
export function plan(households, keepId, me) {
  const keep = households.find(h => h.id === keepId) || null;
  const others = households.filter(h => h.id !== keepId);
  const notMine = others.filter(h => lc(h.owner) !== lc(me));
  const u = unionMembers(keep?.members, others.map(h => h.members || []));
  return { keep, others, notMine, canMerge: !!keep && others.length > 0 && !notMine.length && !u.over, ...u };
}
const isPeople = d => !!d && d.id === PEOPLE_ID && d.names && typeof d.names === 'object' && !Array.isArray(d.names);
// The settings documents to write into the kept household after copying `other`'s: names joined (the kept household's
// name for someone wins), only for people who are members. Only what changes is returned.
export function mergeSettings(keepDocs = [], otherDocs = [], members = []) {
  const find = (docs, id) => docs.find(d => d && d.id === id);
  const kn = find(keepDocs, PEOPLE_ID), on = find(otherDocs, PEOPLE_ID);
  if (!isPeople(on)) return [];
  const mine = isPeople(kn) ? kn.names : {};
  const joined = {};
  for (const [e, n] of Object.entries({ ...on.names, ...mine })) if (members.includes(lc(e)) && typeof n === 'string' && n.trim()) joined[lc(e)] = n.trim().slice(0, 40);
  return JSON.stringify(joined) === JSON.stringify(mine) ? [] : [{ id: PEOPLE_ID, names: joined, updatedAt: new Date().toISOString() }];
}
