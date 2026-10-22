// Merging duplicate households (js/merge.js): plain node.
import assert from 'node:assert/strict';
import { unionMembers, plan, mergeSettings, MAX_MEMBERS } from '../js/merge.js';

const people = names => ({ id: 'people', names, updatedAt: 'x' });
// members: kept first, no repeats, any case
assert.deepEqual(unionMembers(['a@x.com', 'b@x.com'], [['B@x.com', 'c@x.com'], ['c@x.com', ' d@x.com ']]).members, ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
const many = n => Array.from({ length: n }, (_, i) => `p${i}@x.com`);
assert.equal(unionMembers(many(15), [many(25).slice(10)]).over, true, '25 people in all');
assert.equal(unionMembers(many(20), [many(20)]).over, false, 'the same 20 people');
assert.equal(unionMembers(many(12), [many(25).slice(12)]).members.length, MAX_MEMBERS);

// who may merge: only the owner of every household being deleted
const H = (id, owner, members) => ({ id, owner, members });
const mine = H('a', 'me@x.com', ['me@x.com']), big = H('b', 'me@x.com', ['me@x.com', 'x@x.com', 'y@x.com']), theirs = H('c', 'mum@x.com', ['mum@x.com', 'me@x.com']);
let p = plan([mine, big], 'b', 'ME@x.com');
assert.ok(p.canMerge && p.others.length === 1 && p.keep.id === 'b' && p.members.length === 3);
p = plan([mine, theirs], 'a', 'me@x.com');
assert.ok(!p.canMerge && p.notMine[0].id === 'c', 'can’t delete someone else’s household');
p = plan([mine, theirs], 'c', 'me@x.com');
assert.ok(p.canMerge, 'keeping theirs and deleting mine is fine');
assert.ok(!plan([mine], 'a', 'me@x.com').canMerge, 'nothing to merge');
assert.ok(!plan([H('a', 'me@x.com', many(15).concat('me@x.com')), H('b', 'me@x.com', many(30).slice(15).concat('me@x.com'))], 'a', 'me@x.com').canMerge, 'over 20 people');

// names: joined (the kept household's name wins), only for members, only what changes
const keepDocs = [people({ 'a@x.com': 'Mum' })];
const otherDocs = [people({ 'a@x.com': 'Old', 'b@x.com': 'Dad', 'gone@x.com': 'Gone' })];
const out = mergeSettings(keepDocs, otherDocs, ['a@x.com', 'b@x.com']);
assert.equal(out.length, 1);
assert.deepEqual(out[0].names, { 'a@x.com': 'Mum', 'b@x.com': 'Dad' });
assert.deepEqual(mergeSettings(keepDocs, [people({ 'a@x.com': 'Other' })], ['a@x.com']), [], 'nothing new, nothing written');
assert.deepEqual(mergeSettings([], otherDocs, ['b@x.com']).map(d => d.names), [{ 'b@x.com': 'Dad' }], 'the kept household had none');
assert.deepEqual(mergeSettings(keepDocs, [], ['a@x.com']), []);
assert.deepEqual(mergeSettings(keepDocs, [{ id: 'other' }], ['a@x.com']), [], 'only the names document is merged');
console.log('kakihome merge: ok');
