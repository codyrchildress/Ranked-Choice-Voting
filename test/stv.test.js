import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tallyStv } from '../server/methods/stv.js';

test('elects across rounds: quota, surplus transfer, elimination, default fill', () => {
  // 12 ballots, 2 seats -> Droop quota floor(12/3)+1 = 5.
  const ballots = [
    ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'],
    ['b'], ['b'],
    ['c'], ['c'], ['c'],
    ['d', 'c'],
  ];
  const result = tallyStv(['a', 'b', 'c', 'd'], ballots, { numWinners: 2, seed: 's' });

  assert.equal(result.method, 'stv');
  assert.equal(result.quota, 5);
  assert.equal(result.seats, 2);

  // Round 1: a has 6 >= quota -> elected; surplus 1 flows to b at weight 1/6.
  assert.deepEqual(result.rounds[0].tallies, { a: 6, b: 2, c: 3, d: 1 });
  assert.deepEqual(result.rounds[0].elected, ['a']);
  assert.deepEqual(result.rounds[0].transfers, [
    { from: 'a', to: { b: 1 }, exhausted: 0, count: 1 },
  ]);

  // Round 2: b 3, c 3, d 1 -> d eliminated, its ballot moves to c.
  assert.deepEqual(result.rounds[1].tallies, { b: 3, c: 3, d: 1 });
  assert.deepEqual(result.rounds[1].eliminated, ['d']);
  assert.deepEqual(result.rounds[1].transfers, [
    { from: 'd', to: { c: 1 }, exhausted: 0, count: 1 },
  ]);

  // Round 3: b 3 < c 4 -> b eliminated; all its ballots exhaust.
  assert.deepEqual(result.rounds[2].eliminated, ['b']);
  assert.equal(result.rounds[2].transfers[0].exhausted, 3);

  // Round 4: only c remains for the last seat.
  assert.equal(result.rounds[3].defaultElected, true);
  assert.deepEqual(result.rounds[3].elected, ['c']);
  assert.deepEqual(result.winners, ['a', 'c']);
});

test('a single seat behaves like a majority-quota runoff', () => {
  const result = tallyStv(['a', 'b'], [['a'], ['a'], ['a'], ['b'], ['b']], { numWinners: 1 });
  assert.equal(result.quota, 3);
  assert.deepEqual(result.rounds[0].elected, ['a']);
  assert.deepEqual(result.winners, ['a']);
});

test('everyone is elected when the field is no larger than the seats', () => {
  const result = tallyStv(['a', 'b'], [['a'], ['b']], { numWinners: 2 });
  assert.equal(result.rounds[0].defaultElected, true);
  assert.deepEqual([...result.winners].sort(), ['a', 'b']);
});

test('elimination ties break by earlier rounds after a surplus transfer', () => {
  // 7 ballots, 2 seats -> quota 3. a elected with surplus 1 (weight 1/4 each
  // to b). Round 2: b and c tie at 2, but b had less in round 1.
  const ballots = [
    ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'],
    ['c'], ['c'],
    ['b'],
  ];
  const result = tallyStv(['a', 'b', 'c'], ballots, { numWinners: 2, seed: 's' });

  assert.deepEqual(result.rounds[0].elected, ['a']);
  assert.deepEqual(result.rounds[1].tallies, { b: 2, c: 2 });
  assert.equal(result.rounds[1].tieBreak, 'prior-round');
  assert.deepEqual(result.rounds[1].eliminated, ['b']);
  assert.deepEqual(result.winners, ['a', 'c']);
});

test('no ballots means no winners', () => {
  const result = tallyStv(['a', 'b'], [], { numWinners: 2 });
  assert.deepEqual(result.winners, []);
  assert.deepEqual(result.rounds, []);
});

test('ties resolved by seeded draw are deterministic', () => {
  const ballots = [['a'], ['b'], ['c']];
  const first = tallyStv(['a', 'b', 'c'], ballots, { numWinners: 1, seed: 'election-9' });
  const again = tallyStv(['a', 'b', 'c'], ballots, { numWinners: 1, seed: 'election-9' });
  assert.deepEqual(first, again);
  assert.equal(first.winners.length, 1);
});
