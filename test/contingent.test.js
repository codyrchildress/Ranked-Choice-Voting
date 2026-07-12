import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tallyContingent } from '../server/methods/contingent.js';

test('an outright first-count majority wins in one round', () => {
  const result = tallyContingent(['a', 'b', 'c'], [['a'], ['a'], ['a'], ['b'], ['c']]);
  assert.equal(result.method, 'contingent');
  assert.equal(result.rounds.length, 1);
  assert.deepEqual(result.winners, ['a']);
});

test('otherwise the top two face a runoff fed by everyone else', () => {
  const ballots = [
    ['a'], ['a'], ['a'],
    ['b'], ['b'], ['b'],
    ['c', 'a'], ['c', 'a'],
    ['d', 'b'],
  ];
  const result = tallyContingent(['a', 'b', 'c', 'd'], ballots);

  assert.deepEqual([...result.finalists].sort(), ['a', 'b']);
  assert.deepEqual([...result.rounds[0].eliminated].sort(), ['c', 'd']);
  assert.deepEqual(
    result.rounds[0].transfers.find((t) => t.from === 'c'),
    { from: 'c', to: { a: 2 }, exhausted: 0, count: 2 },
  );
  assert.deepEqual(result.rounds[1].tallies, { a: 5, b: 4 });
  assert.deepEqual(result.winners, ['a']);
});

test('ballots ranking neither finalist exhaust in the runoff', () => {
  const ballots = [['a'], ['a'], ['b'], ['b'], ['c']];
  const result = tallyContingent(['a', 'b', 'c'], ballots);

  assert.equal(result.rounds[1].exhausted, 1);
  assert.deepEqual(result.rounds[1].tallies, { a: 2, b: 2 });
  assert.deepEqual([...result.winners].sort(), ['a', 'b']); // exact runoff tie
});

test('ties for a finalist spot use a seeded draw, deterministically', () => {
  const ballots = [['a'], ['a'], ['b'], ['c']];
  const first = tallyContingent(['a', 'b', 'c', 'd'], ballots, { seed: 'election-4' });
  const again = tallyContingent(['a', 'b', 'c', 'd'], ballots, { seed: 'election-4' });

  assert.equal(first.rounds[0].tieBreak, 'random');
  assert.ok(first.finalists.includes('a'));
  assert.deepEqual(first, again);
});

test('two candidates are decided by the first count alone', () => {
  const result = tallyContingent(['a', 'b'], [['a'], ['b']]);
  assert.equal(result.rounds.length, 1);
  assert.deepEqual([...result.winners].sort(), ['a', 'b']);
});

test('no ballots means no winner', () => {
  const result = tallyContingent(['a', 'b'], []);
  assert.deepEqual(result.winners, []);
});
