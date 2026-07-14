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

test('election lifecycle (single question, legacy create shape)', async (t) => {
  const { request } = await startServer(t);
  let electionId;
  let admin;
  let questionId;
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

  await t.test('public view exposes one question and no secrets', async () => {
    const res = await request(`/api/elections/${electionId}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.election.status, 'draft');
    assert.equal(res.data.questions.length, 1);
    assert.equal(res.data.questions[0].numRanks, 3);
    assert.equal(res.data.questions[0].candidates.length, 3);
    assert.equal(res.data.ballotCount, 0);
    assert.equal(res.data.hasVoted, false);

    questionId = res.data.questions[0].id;
    candidatesByName = Object.fromEntries(res.data.questions[0].candidates.map((c) => [c.name, c.id]));
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

    const add = await request(`/api/admin/${admin}/questions/${questionId}/candidates`, {
      method: 'POST',
      body: { name: 'Thai' },
    });
    assert.equal(add.status, 201);
    assert.equal(add.data.questions[0].candidates.length, 4);

    const thaiId = add.data.questions[0].candidates.find((c) => c.name === 'Thai').id;
    const remove = await request(`/api/admin/${admin}/questions/${questionId}/candidates/${thaiId}`, {
      method: 'DELETE',
    });
    assert.equal(remove.status, 200);
    assert.equal(remove.data.questions[0].candidates.length, 3);
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
      { answers: {} },
      { answers: { 'not-a-question': [Tacos] } },
    ];
    for (const body of cases) {
      const res = await request(`/api/elections/${electionId}/ballots`, { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  await t.test('five voters cast ballots (legacy rankings shape still works)', async () => {
    const { Tacos, Sushi, Pizza } = candidatesByName;
    const ballots = [
      { rankings: [Tacos] },
      { answers: { [questionId]: [Tacos, Pizza] } },
      { rankings: [Sushi] },
      { answers: { [questionId]: [Sushi, Tacos] }, voterName: 'Cody' },
      { rankings: [Pizza, Sushi, Tacos] },
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

  await t.test('admin sees a live per-question tally and the voter roster', async () => {
    const res = await request(`/api/admin/${admin}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.ballotCount, 5);
    assert.deepEqual(res.data.results[0].results.borda.winners, [candidatesByName.Tacos]);
    assert.equal(res.data.voters.length, 5);
    assert.ok(res.data.voters.some((v) => v.name === 'Cody'));
  });

  await t.test('options are locked while voting is open', async () => {
    const res = await request(`/api/admin/${admin}/questions/${questionId}/candidates`, {
      method: 'POST',
      body: { name: 'Burgers' },
    });
    assert.equal(res.status, 409);
  });

  await t.test('closing publishes per-question results', async () => {
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
    assert.equal(results.data.totalBallots, 5);
    assert.equal(results.data.questions.length, 1);
    const question = results.data.questions[0];
    assert.equal(question.official, 'borda');
    assert.equal(question.answered, 5);
    assert.deepEqual(
      Object.keys(question.results).sort(),
      ['borda', 'condorcet', 'contingent', 'irv', 'stv'],
    );
    // Points (top 3): Tacos 3+3+2+1 = 9, Sushi 3+3+2 = 8, Pizza 3+2 = 5.
    const borda = question.results.borda;
    assert.deepEqual(borda.winners, [candidatesByName.Tacos]);
    assert.equal(borda.standings[0].points, 9);
    for (const key of ['irv', 'stv', 'condorcet', 'contingent']) {
      assert.ok(question.results[key].winners.length >= 1, key);
    }
    // Anonymous elections never publish signed ballots.
    assert.equal(results.data.ballots, undefined);
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
    const res = await request(`/api/admin/${admin}/questions/${questionId}`, {
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

test('multi-question elections tally each question over its own answers', async (t) => {
  const { request } = await startServer(t);

  const created = await request('/api/elections', {
    method: 'POST',
    body: {
      title: 'Annual meeting',
      questions: [
        { prompt: 'Who should be president?', method: 'irv', numRanks: 2, candidates: ['Ada', 'Boole'] },
        { prompt: 'Where should we meet?', method: 'borda', numRanks: 3, candidates: ['Hall', 'Park', 'Cafe'] },
      ],
    },
  });
  assert.equal(created.status, 201);
  const admin = created.data.adminToken;
  const id = created.data.election.id;

  const pub = await request(`/api/elections/${id}`);
  assert.equal(pub.data.questions.length, 2);
  assert.deepEqual(pub.data.questions.map((q) => q.prompt), ['Who should be president?', 'Where should we meet?']);
  const [president, venue] = pub.data.questions;
  const name = (question, wanted) => question.candidates.find((c) => c.name === wanted).id;

  // Question management in setup: add, edit, delete, and the minimum guard.
  const added = await request(`/api/admin/${admin}/questions`, {
    method: 'POST',
    body: { prompt: 'Budget?', candidates: ['Approve', 'Reject'] },
  });
  assert.equal(added.status, 201);
  assert.equal(added.data.questions.length, 3);
  const budget = added.data.questions[2];
  const edited = await request(`/api/admin/${admin}/questions/${budget.id}`, {
    method: 'PATCH',
    body: { prompt: 'Approve the budget?', method: 'contingent' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.questions[2].prompt, 'Approve the budget?');
  assert.equal(edited.data.questions[2].method, 'contingent');
  const removed = await request(`/api/admin/${admin}/questions/${budget.id}`, { method: 'DELETE' });
  assert.equal(removed.data.questions.length, 2);

  // Opening validates every question, naming the offender.
  const lonely = await request(`/api/admin/${admin}/questions`, {
    method: 'POST',
    body: { prompt: 'Mascot?', candidates: ['Owl'] },
  });
  const failedOpen = await request(`/api/admin/${admin}/status`, {
    method: 'POST',
    body: { status: 'open' },
  });
  assert.equal(failedOpen.status, 409);
  assert.match(failedOpen.data.error, /Mascot\?/);
  await request(`/api/admin/${admin}/questions/${lonely.data.questions[2].id}`, { method: 'DELETE' });
  const open = await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'open' } });
  assert.equal(open.status, 200);

  // Ballots may skip questions, but not answer unknown or invalid ones.
  const vote1 = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: {
      answers: {
        [president.id]: [name(president, 'Ada')],
        [venue.id]: [name(venue, 'Hall'), name(venue, 'Park')],
      },
    },
  });
  assert.equal(vote1.status, 201);
  const vote2 = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { answers: { [president.id]: [name(president, 'Ada')] } }, // skips the venue
  });
  assert.equal(vote2.status, 201);
  const crossed = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { answers: { [president.id]: [name(venue, 'Hall')] } },
  });
  assert.equal(crossed.status, 400);
  assert.match(crossed.data.error, /president/);

  // Each question is tallied over the ballots that answered it.
  await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'closed' } });
  const results = await request(`/api/elections/${id}/results`);
  assert.equal(results.data.totalBallots, 2);
  const [presidentResults, venueResults] = results.data.questions;
  assert.equal(presidentResults.answered, 2);
  assert.equal(presidentResults.official, 'irv');
  assert.deepEqual(presidentResults.results.irv.winners, [name(president, 'Ada')]);
  assert.equal(venueResults.answered, 1);
  assert.deepEqual(venueResults.results.borda.winners, [name(venue, 'Hall')]);
  assert.equal(venueResults.results.borda.standings[0].points, 3);
});

test('opening clamps ranks and seats per question and allows returning to setup', async (t) => {
  const { request } = await startServer(t);

  const created = await request('/api/elections', {
    method: 'POST',
    body: {
      title: 'Committee seats',
      questions: [{ prompt: '', method: 'stv', numRanks: 10, numWinners: 5, candidates: ['A', 'B', 'C'] }],
    },
  });
  assert.equal(created.status, 201);
  const admin = created.data.adminToken;
  const id = created.data.election.id;

  const solo = await request('/api/elections', {
    method: 'POST',
    body: { title: 'Lonely', numRanks: 1, candidates: ['Only'] },
  });
  const openSolo = await request(`/api/admin/${solo.data.adminToken}/status`, {
    method: 'POST',
    body: { status: 'open' },
  });
  assert.equal(openSolo.status, 409);

  const open = await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'open' } });
  assert.equal(open.status, 200);
  const pub = await request(`/api/elections/${id}`);
  assert.equal(pub.data.questions[0].numRanks, 3);
  assert.equal(pub.data.questions[0].numWinners, 2);

  // Question rules are locked while voting is open.
  const patch = await request(`/api/admin/${admin}/questions/${pub.data.questions[0].id}`, {
    method: 'PATCH',
    body: { method: 'irv' },
  });
  assert.equal(patch.status, 409);

  // No ballots cast yet, so the admin can go back to setup and edit.
  const back = await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'draft' } });
  assert.equal(back.status, 200);
  const add = await request(`/api/admin/${admin}/questions/${pub.data.questions[0].id}/candidates`, {
    method: 'POST',
    body: { name: 'Z' },
  });
  assert.equal(add.status, 201);
});

test('open-ballot elections require signatures and publish them', async (t) => {
  const { request } = await startServer(t);

  const created = await request('/api/elections', {
    method: 'POST',
    body: {
      title: 'Board vote',
      numRanks: 2,
      method: 'irv',
      ballotPrivacy: 'open',
      candidates: ['Approve', 'Reject'],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.election.ballotPrivacy, 'open');
  const admin = created.data.adminToken;
  const id = created.data.election.id;

  const pub = await request(`/api/elections/${id}`);
  assert.equal(pub.data.election.ballotPrivacy, 'open');
  const question = pub.data.questions[0];
  const approve = question.candidates.find((c) => c.name === 'Approve').id;

  await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'open' } });

  const unsigned = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [approve] },
  });
  assert.equal(unsigned.status, 400);
  assert.match(unsigned.data.error, /open ballots/);

  const signed = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [approve], voterName: 'Ada' },
  });
  assert.equal(signed.status, 201);

  const patch = await request(`/api/admin/${admin}`, {
    method: 'PATCH',
    body: { ballotPrivacy: 'anonymous' },
  });
  assert.equal(patch.status, 409);

  const adminView = await request(`/api/admin/${admin}`);
  assert.equal(adminView.data.ballots.length, 1);
  assert.equal(adminView.data.ballots[0].name, 'Ada');
  assert.deepEqual(adminView.data.ballots[0].answers, { [question.id]: [approve] });

  await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'closed' } });
  const results = await request(`/api/elections/${id}/results`);
  assert.equal(results.data.ballots.length, 1);
  assert.deepEqual(results.data.ballots[0].answers, { [question.id]: [approve] });
});

test('code-secured elections enforce one ballot per code', async (t) => {
  const { request } = await startServer(t);

  const created = await request('/api/elections', {
    method: 'POST',
    body: { title: 'Secure vote', numRanks: 2, security: 'code', candidates: ['A', 'B'] },
  });
  assert.equal(created.data.election.security, 'code');
  const admin = created.data.adminToken;
  const id = created.data.election.id;

  const generated = await request(`/api/admin/${admin}/codes`, { method: 'POST', body: { count: 2 } });
  assert.equal(generated.status, 201);
  const named = await request(`/api/admin/${admin}/codes`, {
    method: 'POST',
    body: { labels: ['Priya', 'Marcus'] },
  });
  assert.equal(named.data.codes.length, 4);

  await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'open' } });

  const pub = await request(`/api/elections/${id}`);
  const optionA = pub.data.questions[0].candidates[0].id;
  const priya = named.data.codes.find((c) => c.label === 'Priya');
  const [blankOne, blankTwo] = named.data.codes.filter((c) => !c.label);

  const fresh = await request(`/api/elections/${id}/codes/${priya.code}`);
  assert.deepEqual(fresh.data, { ok: true, label: 'Priya' });

  const noCode = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [optionA] },
  });
  assert.equal(noCode.status, 400);

  const decorated = `${blankOne.code.slice(0, 3)}-${blankOne.code.slice(3, 6)}-${blankOne.code.slice(6)}`.toUpperCase();
  const voted = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [optionA], code: decorated },
  });
  assert.equal(voted.status, 201);

  const reuse = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [optionA], code: blankOne.code },
  });
  assert.equal(reuse.status, 409);
  assert.match(reuse.data.error, /already been used/);

  // A second person on the same browser (voted cookie set) can still vote
  // with their own code.
  const sharedDevice = await request(`/api/elections/${id}/ballots`, {
    method: 'POST',
    body: { rankings: [optionA], code: blankTwo.code },
    cookie: `rcv_voted_${id}=1`,
  });
  assert.equal(sharedDevice.status, 201);

  const revokeUsed = await request(`/api/admin/${admin}/codes/${blankOne.id}`, { method: 'DELETE' });
  assert.equal(revokeUsed.status, 409);
  const revokeFresh = await request(`/api/admin/${admin}/codes/${priya.id}`, { method: 'DELETE' });
  assert.equal(revokeFresh.status, 200);

  await request(`/api/admin/${admin}/status`, { method: 'POST', body: { status: 'closed' } });
  const results = await request(`/api/elections/${id}/results`);
  assert.deepEqual(results.data.turnout, { total: 3, used: 2 });
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
