import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tallyBorda } from '../server/methods/borda.js';

function points(result) {
  return Object.fromEntries(result.standings.map((s) => [s.id, s.points]));
}

test('points follow position: K for 1st, K-1 for 2nd, down to 1', () => {
  const result = tallyBorda(['a', 'b', 'c'], [['a', 'b', 'c']], { numRanks: 3 });
  assert.equal(result.method, 'borda');
  assert.deepEqual(points(result), { a: 3, b: 2, c: 1 });
  assert.deepEqual(result.winners, ['a']);
  assert.deepEqual(result.standings.map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(result.numRanks, 3);
});

test('short ballots still give the top ranks full value', () => {
  const result = tallyBorda(['a', 'b'], [['a'], ['b', 'a']], { numRanks: 2 });
  assert.deepEqual(points(result), { a: 3, b: 2 });
  assert.deepEqual(result.winners, ['a']);
});

test('unranked options score zero and sit at the bottom in ballot order', () => {
  const result = tallyBorda(['c', 'a', 'b', 'd'], [['a', 'b']], { numRanks: 2 });
  assert.deepEqual(points(result), { a: 2, b: 1, c: 0, d: 0 });
  assert.deepEqual(result.standings.map((s) => s.id), ['a', 'b', 'c', 'd']);
});

test('point ties break by higher placements', () => {
  const ballots = [['x', 'y'], ['x', 'y'], ['z', 'y']];
  const result = tallyBorda(['x', 'y', 'z'], ballots, { numRanks: 3 });
  assert.deepEqual(points(result), { x: 6, y: 6, z: 3 });
  assert.deepEqual(result.standings.map((s) => s.id), ['x', 'y', 'z']);
  assert.deepEqual(result.winners, ['x']);
});

test('identical point profiles are an exact tie with every leader reported', () => {
  const result = tallyBorda(['a', 'b'], [['a', 'b'], ['b', 'a']], { numRanks: 2 });
  assert.deepEqual(points(result), { a: 3, b: 3 });
  assert.deepEqual([...result.winners].sort(), ['a', 'b']);
});

test('no ballots means no winner', () => {
  const result = tallyBorda(['a', 'b'], [], { numRanks: 2 });
  assert.deepEqual(result.winners, []);
  assert.deepEqual(points(result), { a: 0, b: 0 });
});

test('rank counts and voter reach are reported per option', () => {
  const ballots = [['a', 'b'], ['a'], ['b', 'a']];
  const result = tallyBorda(['a', 'b'], ballots, { numRanks: 2 });
  const a = result.standings.find((s) => s.id === 'a');
  const b = result.standings.find((s) => s.id === 'b');
  assert.deepEqual(a, { id: 'a', points: 5, rankCounts: [2, 1], ballotsRanking: 3 });
  assert.deepEqual(b, { id: 'b', points: 3, rankCounts: [1, 1], ballotsRanking: 2 });
});

test('a single ranked choice behaves like plurality', () => {
  const result = tallyBorda(['a', 'b'], [['a'], ['a'], ['b']], { numRanks: 1 });
  assert.deepEqual(points(result), { a: 2, b: 1 });
  assert.deepEqual(result.winners, ['a']);
});
