import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { createLocalDb } from '../server/db-local.js';
import { runDataMigrations } from '../server/migrate.js';

test('legacy single-question elections are backfilled and still serve results', async (t) => {
  const db = createLocalDb(':memory:');
  t.after(async () => db.close());

  // Simulate a pre-questions election exactly as the old code wrote it:
  // counting rules on the election row, candidates without a question,
  // ballots with flat rankings arrays.
  await db.run(
    `INSERT INTO elections (id, admin_token_hash, title, description, num_ranks, method, num_winners, status, created_at)
     VALUES ('old1', 'hash1', 'Legacy election', '', 3, 'irv', 1, 'closed', 1)`,
  );
  await db.run("INSERT INTO candidates (id, election_id, name, position) VALUES ('c1', 'old1', 'Alpha', 1)");
  await db.run("INSERT INTO candidates (id, election_id, name, position) VALUES ('c2', 'old1', 'Beta', 2)");
  await db.run(
    `INSERT INTO ballots (id, election_id, voter_name, rankings, created_at) VALUES ('b1', 'old1', NULL, '["c1","c2"]', 1)`,
  );
  await db.run(
    `INSERT INTO ballots (id, election_id, voter_name, rankings, created_at) VALUES ('b2', 'old1', NULL, '["c1"]', 2)`,
  );
  await db.run(
    `INSERT INTO ballots (id, election_id, voter_name, rankings, created_at) VALUES ('b3', 'old1', 'Kim', '["c2"]', 3)`,
  );

  await runDataMigrations(db);
  await runDataMigrations(db); // must be idempotent

  const questions = await db.query("SELECT * FROM questions WHERE election_id = 'old1'");
  assert.equal(questions.length, 1);
  assert.equal(questions[0].method, 'irv');
  assert.equal(questions[0].num_ranks, 3);
  const questionId = questions[0].id;

  const candidates = await db.query("SELECT question_id AS q FROM candidates WHERE election_id = 'old1'");
  assert.ok(candidates.every((c) => c.q === questionId));

  const ballots = await db.query("SELECT rankings FROM ballots WHERE election_id = 'old1' ORDER BY created_at");
  assert.deepEqual(JSON.parse(ballots[0].rankings), { [questionId]: ['c1', 'c2'] });
  assert.deepEqual(JSON.parse(ballots[2].rankings), { [questionId]: ['c2'] });

  // The migrated election serves results through the real API.
  const app = createApp({ db, rateLimits: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/elections/old1/results`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.totalBallots, 3);
  assert.equal(data.questions.length, 1);
  assert.equal(data.questions[0].official, 'irv');
  assert.deepEqual(data.questions[0].results.irv.winners, ['c1']);
});
