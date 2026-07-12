import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabulate } from '../server/tabulate.js';

test('first-round majority wins immediately', () => {
  const result = tabulate(['a', 'b', 'c'], [['a'], ['a'], ['a'], ['b'], ['c']]);
  assert.equal(result.rounds.length, 1);
  assert.deepEqual(result.winners, ['a']);
  assert.deepEqual(result.rounds[0].tallies, { a: 3, b: 1, c: 1 });
  assert.equal(result.rounds[0].majority, 3);
});

test('trailing candidate wins after elimination transfers', () => {
  const ballots = [['a'], ['a'], ['a'], ['a'], ['b'], ['b'], ['b'], ['c', 'b'], ['c', 'b']];
  const result = tabulate(['a', 'b', 'c'], ballots);

  assert.equal(result.rounds.length, 2);
  assert.deepEqual(result.rounds[0].eliminated, ['c']);
  assert.deepEqual(result.rounds[0].transfers, [
    { from: 'c', to: { b: 2 }, exhausted: 0, count: 2 },
  ]);
  assert.deepEqual(result.rounds[1].tallies, { a: 4, b: 5 });
  assert.deepEqual(result.winners, ['b']);
});

test('exhausted ballots drop out and majority tracks active ballots', () => {
  // c's voter ranked nobody else, so their ballot exhausts in round 2.
  const ballots = [['a'], ['a'], ['a'], ['b'], ['b'], ['c']];
  const result = tabulate(['a', 'b', 'c'], ballots);

  assert.equal(result.rounds[1].exhausted, 1);
  assert.equal(result.rounds[1].active, 5);
  assert.equal(result.rounds[1].majority, 3);
  assert.deepEqual(result.winners, ['a']);
});

test('zero-vote candidates are eliminated together in one round', () => {
  const ballots = [['a'], ['a'], ['b'], ['b'], ['c', 'b']];
  const result = tabulate(['a', 'b', 'c', 'd', 'e'], ballots);

  assert.deepEqual([...result.rounds[0].eliminated].sort(), ['d', 'e']);
  assert.deepEqual(result.rounds[0].transfers, []);
  assert.deepEqual(result.rounds[1].eliminated, ['c']);
  assert.deepEqual(result.winners, ['b']);
});

test('elimination ties break by comparing earlier rounds', () => {
  const ballots = [
    ['a'], ['a'], ['a'], ['a'], ['a'],
    ['b', 'c'], ['b', 'c'], ['b'],
    ['c'], ['c'], ['c'], ['c'],
    ['d', 'b'],
  ];
  const result = tabulate(['a', 'b', 'c', 'd'], ballots);

  // Round 2: b and c tie at 4, but b had fewer round-1 votes (3 vs 4).
  assert.deepEqual(result.rounds[1].eliminated, ['b']);
  assert.equal(result.rounds[1].tieBreak, 'prior-round');
  assert.deepEqual(result.rounds[1].transfers, [
    { from: 'b', to: { c: 2 }, exhausted: 2, count: 4 },
  ]);
  assert.deepEqual(result.rounds[2].tallies, { a: 5, c: 6 });
  assert.deepEqual(result.winners, ['c']);
});

test('full ties fall back to a seeded random draw, deterministically', () => {
  const ballots = [['a'], ['b'], ['c']];
  const first = tabulate(['a', 'b', 'c'], ballots, { seed: 'election-1' });
  const again = tabulate(['a', 'b', 'c'], ballots, { seed: 'election-1' });

  assert.equal(first.rounds[0].tieBreak, 'random');
  assert.equal(first.rounds[0].eliminated.length, 1);
  assert.deepEqual(first, again);
});

test('an exact final tie reports every tied winner', () => {
  const result = tabulate(['a', 'b'], [['a'], ['b']]);
  assert.deepEqual([...result.winners].sort(), ['a', 'b']);
});

test('no ballots means no winner', () => {
  const result = tabulate(['a', 'b'], []);
  assert.deepEqual(result.winners, []);
  assert.equal(result.rounds[0].active, 0);
});

test('ballots may rank fewer choices than allowed without breaking transfers', () => {
  const ballots = [
    ['a', 'b', 'c'],
    ['b'],
    ['c', 'a'],
    ['c'],
    ['a'],
  ];
  const result = tabulate(['a', 'b', 'c'], ballots);

  // Round 1: a=2, b=1, c=2 -> b eliminated, its ballot exhausts.
  assert.deepEqual(result.rounds[0].eliminated, ['b']);
  assert.deepEqual(result.rounds[0].transfers, [
    { from: 'b', to: {}, exhausted: 1, count: 1 },
  ]);
  assert.deepEqual(result.rounds[1].tallies, { a: 2, c: 2 });
  assert.deepEqual([...result.winners].sort(), ['a', 'c']);
});
