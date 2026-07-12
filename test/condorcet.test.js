import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tallyCondorcet } from '../server/methods/condorcet.js';

test('a candidate who beats everyone head-to-head wins', () => {
  const ballots = [
    ['a', 'b', 'c'],
    ['a', 'c', 'b'],
    ['b', 'a', 'c'],
  ];
  const result = tallyCondorcet(['a', 'b', 'c'], ballots);

  assert.equal(result.method, 'condorcet');
  assert.equal(result.cycle, false);
  assert.deepEqual(result.winners, ['a']);
  assert.equal(result.standings[0].id, 'a');
  assert.equal(result.standings[0].wins, 2);
  assert.equal(result.matchups.length, 3);
  assert.equal(result.pairwise.a.b, 2);
  assert.equal(result.pairwise.b.a, 1);
});

test('a rock-paper-scissors cycle falls back to the best record, then margin', () => {
  // a beats b 3-2, b beats c 4-1, c beats a 3-2: all records 1-1, but b's
  // margins are strongest.
  const ballots = [
    ['a', 'b', 'c'], ['a', 'b', 'c'],
    ['b', 'c', 'a'], ['b', 'c', 'a'],
    ['c', 'a', 'b'],
  ];
  const result = tallyCondorcet(['a', 'b', 'c'], ballots);

  assert.equal(result.cycle, true);
  assert.deepEqual(result.winners, ['b']);
  assert.equal(result.standings[0].id, 'b');
  assert.equal(result.standings[0].margin, 2);
});

test('a perfectly symmetric cycle is reported as a full tie', () => {
  const ballots = [['a', 'b', 'c'], ['b', 'c', 'a'], ['c', 'a', 'b']];
  const result = tallyCondorcet(['a', 'b', 'c'], ballots);

  assert.equal(result.cycle, true);
  assert.equal(result.winners.length, 3);
});

test('ranking one option and not another counts as preferring it', () => {
  const ballots = [['a'], ['b', 'c']];
  const result = tallyCondorcet(['a', 'b', 'c'], ballots);

  // a vs b split 1-1; b beats c 1-0 (first ballot expresses no preference).
  assert.equal(result.pairwise.a.b, 1);
  assert.equal(result.pairwise.b.a, 1);
  assert.equal(result.pairwise.b.c, 1);
  assert.equal(result.pairwise.c.b, 0);
  // Nobody beats everyone; b has the best record (1 win, 1 tie).
  assert.equal(result.cycle, true);
  assert.deepEqual(result.winners, ['b']);
});

test('no ballots means no winner', () => {
  const result = tallyCondorcet(['a', 'b'], []);
  assert.deepEqual(result.winners, []);
  assert.equal(result.cycle, false);
});
