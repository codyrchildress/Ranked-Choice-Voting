import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

async function startServer(t, options = { rateLimits: false }) {
  const db = await openDatabase({ path: ':memory:' });
  const app = createApp({ db, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await db.close();
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, cookie } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON response
    }
    return { status: res.status, data, setCookie: res.headers.getSetCookie() };
  };
  return { base, request };
}

test('election lifecycle', async (t) => {
  const { request } = await startServer(t);
  let electionId;
  let admin;
  let candidatesByName;

  await t.test('creation validates its input', async () => {
    assert.equal((await request('/api/elections', { method: 'POST', body: {} })).status, 400);
    assert.equal(
      (await request('/api/elections', { method: 'POST', body: { title: 'X', numRanks: 0 } })).status,
      400,
    );
    const dup = await request('/api/elections', {
      method: 'POST',
      body: { title: 'X', numRanks: 2, candidates: ['Tacos', 'tacos'] },
    });
    assert.equal(dup.status, 400);
    assert.match(dup.data.error, /more than once/);
  });

  await t.test('create a draft election', async () => {
    const res = await request('/api/elections', {
      method: 'POST',
      body: {
        title: 'Team Lunch Spot',
        description: 'Where should the team eat on Friday?',
        numRanks: 3,
        candidates: ['Tacos', 'Sushi', 'Pizza'],
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.election.status, 'draft');
    assert.match(res.data.adminToken, /^[\w-]{20,}$/);
    assert.equal(res.data.election.adminTokenHash, undefined);
    electionId = res.data.election.id;
    admin = res.data.adminToken;
  });

  await t.test('public view exposes no secrets and no results', async () => {
    const res = await request(`/api/elections/${electionId}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.election.status, 'draft');
    assert.equal(res.data.candidates.length, 3);
    assert.equal(res.data.ballotCount, 0);
    assert.equal(res.data.hasVoted, false);
    assert.equal(res.data.election.adminTokenHash, undefined);

    candidatesByName = Object.fromEntries(res.data.candidates.map((c) => [c.name, c.id]));
  });

  await t.test('voting and results are gated while drafting', async () => {
    const vote = await request(`/api/elections/${electionId}/ballots`, {
      method: 'POST',
      body: { rankings: [candidatesByName.Tacos] },
    });
    assert.equal(vote.status, 409);

    const results = await request(`/api/elections/${electionId}/results`);
    assert.equal(results.status, 403);
    assert.equal(results.data.status, 'draft');
  });

  await t.test('bogus admin tokens are rejected', async () => {
    assert.equal((await request('/api/admin/not-a-real-token')).status, 404);
  });

  await t.test('admin can adjust the draft', async () => {
    const patch = await request(`/api/admin/${admin}`, {
      method: 'PATCH',
      body: { description: 'Vote for Friday lunch. Rank your top three!' },
    });
    assert.equal(patch.status, 200);

    const add = await request(`/api/admin/${admin}/candidates`, {
      method: 'POST',
      body: { name: 'Thai' },
    });
    assert.equal(add.status, 201);
    assert.equal(add.data.candidates.length, 4);

    const thaiId = add.data.candidates.find((c) => c.name === 'Thai').id;
    const remove = await request(`/api/admin/${admin}/candidates/${thaiId}`, { method: 'DELETE' });
    assert.equal(remove.status, 200);
    assert.equal(remove.data.candidates.length, 3);
  });

  await t.test('open voting', async () => {
    const res = await request(`/api/admin/${admin}/status`, {
      method: 'POST',
      body: { status: 'open' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.election.status, 'open');
    assert.ok(res.data.election.openedAt > 0);

    const again = await request(`/api/admin/${admin}/status`, {
      method: 'POST',
      body: { status: 'open' },
    });
    assert.equal(again.status, 409);
  });

  await t.test('ballots are validated', async () => {
    const { Tacos, Sushi, Pizza } = candidatesByName;
    const cases = [
      { rankings: [] },
      { rankings: [Tacos, Sushi, Pizza, Tacos] },
      { rankings: [Tacos, Tacos] },
      { rankings: ['nope'] },
      { rankings: 'Tacos' },
    ];
    for (const body of cases) {
      const res = await request(`/api/elections/${electionId}/ballots`, { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  await t.test('five voters cast ballots', async () => {
    const { Tacos, Sushi, Pizza } = candidatesByName;
    const ballots = [
      { rankings: [Tacos] },
      { rankings: [Tacos, Pizza] },
      { rankings: [Sushi] },
      { rankings: [Sushi, Tacos], voterName: 'Cody' },
      { rankings: [Pizza, Sushi] },
    ];
    for (const body of ballots) {
      const res = await request(`/api/elections/${electionId}/ballots`, { method: 'POST', body });
      assert.equal(res.status, 201);
      assert.ok(res.setCookie.some((c) => c.startsWith(`rcv_voted_${electionId}=`)));
    }
  });

  await t.test('the voted cookie blocks a second ballot', async () => {
    const res = await request(`/api/elections/${electionId}/ballots`, {
      method: 'POST',
      body: { rankings: [candidatesByName.Tacos] },
      cookie: `rcv_voted_${electionId}=1`,
    });
    assert.equal(res.status, 409);
    assert.equal(res.data.alreadyVoted, true);

    const view = await request(`/api/elections/${electionId}`, {
      cookie: `rcv_voted_${electionId}=1`,
    });
    assert.equal(view.data.hasVoted, true);
    assert.equal(view.data.ballotCount, 5);
  });

  await t.test('results stay sealed while voting is open', async () => {
    const res = await request(`/api/elections/${electionId}/results`);
    assert.equal(res.status, 403);
    assert.equal(res.data.ballotCount, 5);
  });

  await t.test('admin sees a live tally and the voter roster', async () => {
    const res = await request(`/api/admin/${admin}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.ballotCount, 5);
    assert.deepEqual(res.data.results.winners, [candidatesByName.Sushi]);
    assert.equal(res.data.voters.length, 5);
    assert.ok(res.data.voters.some((v) => v.name === 'Cody'));
  });

  await t.test('options are locked while voting is open', async () => {
    const res = await request(`/api/admin/${admin}/candidates`, {
      method: 'POST',
      body: { name: 'Burgers' },
    });
    assert.equal(res.status, 409);
  });

  await t.test('closing publishes results', async () => {
    const close = await request(`/api/admin/${admin}/status`, {
      method: 'POST',
      body: { status: 'closed' },
    });
    assert.equal(close.status, 200);
    assert.ok(close.data.election.closedAt > 0);

    const vote = await request(`/api/elections/${electionId}/ballots`, {
      method: 'POST',
      body: { rankings: [candidatesByName.Tacos] },
    });
    assert.equal(vote.status, 409);

    const results = await request(`/api/elections/${electionId}/results`);
    assert.equal(results.status, 200);
    // Round 1: Tacos 2, Sushi 2, Pizza 1 -> Pizza out, transfers to Sushi.
    assert.deepEqual(results.data.winners, [candidatesByName.Sushi]);
    assert.equal(results.data.rounds.length, 2);
    assert.equal(results.data.totalBallots, 5);
  });

  await t.test('reopening seals results again', async () => {
    const reopen = await request(`/api/admin/${admin}/status`, {
      method: 'POST',
      body: { status: 'open' },
    });
    assert.equal(reopen.status, 200);
    assert.equal(reopen.data.election.closedAt, null);
    assert.equal((await request(`/api/elections/${electionId}/results`)).status, 403);

    await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'closed' } });
    assert.equal((await request(`/api/elections/${electionId}/results`)).status, 200);
  });

  await t.test('rule changes are rejected outside setup', async () => {
    const res = await request(`/api/admin/${admin}`, {
      method: 'PATCH',
      body: { numRanks: 2 },
    });
    assert.equal(res.status, 409);

    const backToDraft = await request(`/api/admin/${admin}/status`, {
      method: 'POST',
      body: { status: 'draft' },
    });
    assert.equal(backToDraft.status, 409);
  });

  await t.test('deleting the election removes everything', async () => {
    const res = await request(`/api/admin/${admin}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await request(`/api/elections/${electionId}`)).status, 404);
    assert.equal((await request(`/api/admin/${admin}`)).status, 404);
  });
});

test('opening clamps ranks to the option count and allows returning to setup', async (t) => {
  const { request } = await startServer(t);

  const created = await request('/api/elections', {
    method: 'POST',
    body: { title: 'Two options, ten ranks', numRanks: 10, candidates: ['X', 'Y'] },
  });
  const admin = created.data.adminToken;

  const solo = await request('/api/elections', {
    method: 'POST',
    body: { title: 'Lonely', numRanks: 1, candidates: ['Only'] },
  });
  const openSolo = await request(`/api/admin/${solo.data.adminToken}/status`, {
    method: 'POST',
    body: { status: 'open' },
  });
  assert.equal(openSolo.status, 409);

  const open = await request(`/api/admin/${admin}/status`, {
    method: 'POST',
    body: { status: 'open' },
  });
  assert.equal(open.data.election.numRanks, 2);

  // No ballots cast yet, so the admin can go back to setup and edit options.
  const back = await request(`/api/admin/${admin}/status`, {
    method: 'POST',
    body: { status: 'draft' },
  });
  assert.equal(back.status, 200);
  assert.equal(back.data.election.openedAt, null);
  const add = await request(`/api/admin/${admin}/candidates`, {
    method: 'POST',
    body: { name: 'Z' },
  });
  assert.equal(add.status, 201);
});

test('malformed JSON gets a 400, unknown API routes a 404', async (t) => {
  const { base, request } = await startServer(t);

  const res = await fetch(`${base}/api/elections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);

  assert.equal((await request('/api/nope')).status, 404);
});

test('rate limiting kicks in when configured', async (t) => {
  const { request } = await startServer(t, {
    rateLimits: { create: { windowMs: 60_000, max: 2 } },
  });

  const body = { title: 'Spam', numRanks: 1, candidates: ['A', 'B'] };
  assert.equal((await request('/api/elections', { method: 'POST', body })).status, 201);
  assert.equal((await request('/api/elections', { method: 'POST', body })).status, 201);
  assert.equal((await request('/api/elections', { method: 'POST', body })).status, 429);
});
