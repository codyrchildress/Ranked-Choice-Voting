import express from 'express';
import { adminToken, sha256 } from './ids.js';
import { createStore } from './store.js';
import { METHOD_KEYS, tallyAll } from './tabulate.js';

const LIMITS = {
  title: 120,
  description: 2000,
  candidateName: 100,
  voterName: 80,
  maxCandidates: 50,
  maxRanks: 20,
  maxWinners: 20,
};

const PRIVACY_MODES = ['anonymous', 'open'];
const SECURITY_MODES = ['link', 'code'];
const MAX_CODES = 500;

// Codes are entered by hand sometimes; be forgiving about case, dashes,
// and spaces.
function normalizeCode(raw) {
  return typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

export function createApiRouter({ db, rateLimits = {} }) {
  const store = createStore(db);
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  const limiter = (name, defaults) => {
    if (rateLimits === false) return (req, res, next) => next();
    return rateLimit({ ...defaults, ...(rateLimits?.[name] ?? {}) });
  };
  const createLimiter = limiter('create', { windowMs: 60 * 60 * 1000, max: 30 });
  const voteLimiter = limiter('vote', { windowMs: 10 * 60 * 1000, max: 60 });

  const votedCookie = (electionId) => `rcv_voted_${electionId}`;

  function publicElection(el) {
    const { adminTokenHash, ...pub } = el;
    return pub;
  }

  // Sends the 404 itself so handlers can bail with a bare `return`.
  async function requireAdmin(req, res) {
    const election = await store.getElectionByAdminHash(sha256(req.params.token));
    if (!election) res.status(404).json({ error: 'That admin link is not recognized.' });
    return election;
  }

  async function liveResults(election) {
    const ballots = await store.listBallotRankings(election.id);
    if (ballots.length === 0) return null;
    const candidates = await store.listCandidates(election.id);
    return tallyAll(candidates.map((c) => c.id), ballots, {
      numRanks: election.numRanks,
      numWinners: election.numWinners,
      seed: election.id,
    });
  }

  // ---- elections ----

  router.post('/elections', createLimiter, async (req, res) => {
    const body = req.body ?? {};

    const title = cleanLine(body.title);
    if (!title) return res.status(400).json({ error: 'Give your election a title.' });
    if (title.length > LIMITS.title) {
      return res.status(400).json({ error: `Titles are capped at ${LIMITS.title} characters.` });
    }

    const description = cleanBlock(body.description);
    if (description.length > LIMITS.description) {
      return res.status(400).json({ error: `Descriptions are capped at ${LIMITS.description} characters.` });
    }

    const numRanks = body.numRanks;
    if (!Number.isInteger(numRanks) || numRanks < 1 || numRanks > LIMITS.maxRanks) {
      return res.status(400).json({ error: `Ranked choices per voter must be a whole number from 1 to ${LIMITS.maxRanks}.` });
    }

    const method = body.method === undefined ? 'borda' : body.method;
    if (!METHOD_KEYS.includes(method)) {
      return res.status(400).json({ error: 'Unknown counting method.' });
    }

    const numWinners = body.numWinners === undefined ? 1 : body.numWinners;
    if (!Number.isInteger(numWinners) || numWinners < 1 || numWinners > LIMITS.maxWinners) {
      return res.status(400).json({ error: `Seats to fill must be a whole number from 1 to ${LIMITS.maxWinners}.` });
    }

    const ballotPrivacy = body.ballotPrivacy === undefined ? 'anonymous' : body.ballotPrivacy;
    if (!PRIVACY_MODES.includes(ballotPrivacy)) {
      return res.status(400).json({ error: 'Ballot privacy must be "anonymous" or "open".' });
    }

    const security = body.security === undefined ? 'link' : body.security;
    if (!SECURITY_MODES.includes(security)) {
      return res.status(400).json({ error: 'Voter check must be "link" or "code".' });
    }

    const names = (Array.isArray(body.candidates) ? body.candidates : []).map(cleanLine).filter(Boolean);
    const problem = candidateListProblem(names);
    if (problem) return res.status(400).json({ error: problem });

    const token = adminToken();
    const election = await store.createElection({
      title,
      description,
      numRanks,
      method,
      numWinners: method === 'stv' ? numWinners : 1,
      ballotPrivacy,
      security,
      candidateNames: names,
      adminTokenHash: sha256(token),
    });
    res.status(201).json({ election: publicElection(election), adminToken: token });
  });

  router.get('/elections/:id', async (req, res) => {
    const election = await store.getElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found.' });
    res.set('Cache-Control', 'no-store');
    const cookies = parseCookies(req.headers.cookie);
    res.json({
      election: publicElection(election),
      candidates: await store.listCandidates(election.id),
      ballotCount: await store.countBallots(election.id),
      hasVoted: Boolean(cookies[votedCookie(election.id)]),
    });
  });

  router.get('/elections/:id/results', async (req, res) => {
    const election = await store.getElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found.' });
    res.set('Cache-Control', 'no-store');
    if (election.status !== 'closed') {
      return res.status(403).json({
        error: 'Results are sealed until the organizer closes voting.',
        status: election.status,
        ballotCount: await store.countBallots(election.id),
      });
    }
    const candidates = await store.listCandidates(election.id);
    const ballots = await store.listBallotRankings(election.id);
    res.json({
      election: publicElection(election),
      candidates,
      totalBallots: ballots.length,
      official: election.method,
      results: tallyAll(candidates.map((c) => c.id), ballots, {
        numRanks: election.numRanks,
        numWinners: election.numWinners,
        seed: election.id,
      }),
      // Open-ballot elections publish the signed ballots with the results.
      ...(election.ballotPrivacy === 'open'
        ? { ballots: await store.listSignedBallots(election.id) }
        : {}),
      ...(election.security === 'code' ? { turnout: await store.countCodes(election.id) } : {}),
    });
  });

  router.post('/elections/:id/ballots', voteLimiter, async (req, res) => {
    const election = await store.getElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found.' });
    if (election.status === 'draft') {
      return res.status(409).json({ error: 'This election has not opened voting yet.' });
    }
    if (election.status === 'closed') {
      return res.status(409).json({ error: 'Voting has closed for this election.' });
    }

    // Code-secured elections are gated by the one-time code instead of the
    // browser cookie (two people may legitimately share a device).
    const cookies = parseCookies(req.headers.cookie);
    if (election.security !== 'code' && cookies[votedCookie(election.id)]) {
      return res.status(409).json({ error: 'A ballot has already been cast from this browser.', alreadyVoted: true });
    }

    const rankings = req.body?.rankings;
    if (!Array.isArray(rankings) || rankings.length === 0) {
      return res.status(400).json({ error: 'Rank at least one option.' });
    }
    if (rankings.length > election.numRanks) {
      return res.status(400).json({ error: `You can rank at most ${election.numRanks} options.` });
    }
    const validIds = new Set((await store.listCandidates(election.id)).map((c) => c.id));
    if (new Set(rankings).size !== rankings.length || !rankings.every((id) => validIds.has(id))) {
      return res.status(400).json({ error: 'That ballot contains invalid or duplicate options.' });
    }

    const voterName = cleanLine(req.body?.voterName).slice(0, LIMITS.voterName) || null;
    if (election.ballotPrivacy === 'open' && !voterName) {
      return res.status(400).json({ error: 'This election uses open ballots — sign yours with your name to vote.' });
    }

    // Everything else is valid — now claim the one-time code, if required.
    if (election.security === 'code') {
      const code = normalizeCode(req.body?.code);
      if (!code) {
        return res.status(400).json({ error: 'This election requires a one-time ballot code.' });
      }
      const row = await store.findCode(election.id, code);
      if (!row) {
        return res.status(400).json({ error: 'That ballot code isn’t valid for this election.' });
      }
      if (!(await store.claimCode(row.id))) {
        return res.status(409).json({ error: 'That ballot code has already been used.' });
      }
    }

    const ballotId = await store.insertBallot({ electionId: election.id, voterName, rankings });
    res.cookie(votedCookie(election.id), '1', {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      path: '/',
    });
    res.status(201).json({ ok: true, ballotId });
  });

  // Lets a voter check their code before filling out the ballot. Knowing the
  // code is the credential, so no other auth is needed.
  router.get('/elections/:id/codes/:code', voteLimiter, async (req, res) => {
    const election = await store.getElection(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found.' });
    res.set('Cache-Control', 'no-store');
    if (election.security !== 'code') {
      return res.status(404).json({ error: 'This election does not use ballot codes.' });
    }
    const row = await store.findCode(election.id, normalizeCode(req.params.code));
    if (!row) return res.json({ ok: false, reason: 'invalid' });
    if (row.usedAt) return res.json({ ok: false, reason: 'used' });
    res.json({ ok: true, label: row.label });
  });

  // ---- admin ----

  router.get('/admin/:token', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    res.set('Cache-Control', 'no-store');
    res.json({
      election: publicElection(election),
      candidates: await store.listCandidates(election.id),
      ballotCount: await store.countBallots(election.id),
      voters: await store.listVoters(election.id),
      results: await liveResults(election),
      ...(election.ballotPrivacy === 'open'
        ? { ballots: await store.listSignedBallots(election.id) }
        : {}),
      ...(election.security === 'code' ? { codes: await store.listCodes(election.id) } : {}),
    });
  });

  router.post('/admin/:token/codes', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    if (election.security !== 'code') {
      return res.status(409).json({ error: 'This election is open to anyone with the link — switch it to ballot codes in setup first.' });
    }

    const rawLabels = Array.isArray(req.body?.labels) ? req.body.labels.map(cleanLine).filter(Boolean) : [];
    const labels = rawLabels.map((label) => label.slice(0, LIMITS.voterName));
    const count = req.body?.count;
    if (labels.length === 0) {
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        return res.status(400).json({ error: 'Generate between 1 and 100 codes at a time, or provide a list of names.' });
      }
    } else if (labels.length > 100) {
      return res.status(400).json({ error: 'Generate at most 100 codes at a time.' });
    }

    const entries = labels.length > 0 ? labels : Array(count).fill(null);
    const existing = await store.countCodes(election.id);
    if (existing.total + entries.length > MAX_CODES) {
      return res.status(409).json({ error: `Elections are capped at ${MAX_CODES} ballot codes.` });
    }

    await store.createCodes(election.id, entries);
    res.status(201).json({ codes: await store.listCodes(election.id) });
  });

  router.delete('/admin/:token/codes/:codeId', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    if (!(await store.revokeCode(election.id, req.params.codeId))) {
      return res.status(409).json({ error: 'Only unused codes can be revoked.' });
    }
    res.json({ codes: await store.listCodes(election.id) });
  });

  router.patch('/admin/:token', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    const body = req.body ?? {};

    if (body.title !== undefined) {
      const title = cleanLine(body.title);
      if (!title) return res.status(400).json({ error: 'Give your election a title.' });
      if (title.length > LIMITS.title) {
        return res.status(400).json({ error: `Titles are capped at ${LIMITS.title} characters.` });
      }
      election.title = title;
    }
    if (body.description !== undefined) {
      const description = cleanBlock(body.description);
      if (description.length > LIMITS.description) {
        return res.status(400).json({ error: `Descriptions are capped at ${LIMITS.description} characters.` });
      }
      election.description = description;
    }
    if (body.numRanks !== undefined) {
      if (election.status !== 'draft') {
        return res.status(409).json({ error: 'Ballot rules can only change during setup.' });
      }
      if (!Number.isInteger(body.numRanks) || body.numRanks < 1 || body.numRanks > LIMITS.maxRanks) {
        return res.status(400).json({ error: `Ranked choices per voter must be a whole number from 1 to ${LIMITS.maxRanks}.` });
      }
      election.numRanks = body.numRanks;
    }
    if (body.method !== undefined) {
      if (election.status !== 'draft') {
        return res.status(409).json({ error: 'Ballot rules can only change during setup.' });
      }
      if (!METHOD_KEYS.includes(body.method)) {
        return res.status(400).json({ error: 'Unknown counting method.' });
      }
      election.method = body.method;
    }
    if (body.numWinners !== undefined) {
      if (election.status !== 'draft') {
        return res.status(409).json({ error: 'Ballot rules can only change during setup.' });
      }
      if (!Number.isInteger(body.numWinners) || body.numWinners < 1 || body.numWinners > LIMITS.maxWinners) {
        return res.status(400).json({ error: `Seats to fill must be a whole number from 1 to ${LIMITS.maxWinners}.` });
      }
      election.numWinners = body.numWinners;
    }
    if (body.ballotPrivacy !== undefined) {
      if (election.status !== 'draft') {
        return res.status(409).json({ error: 'Ballot rules can only change during setup.' });
      }
      if (!PRIVACY_MODES.includes(body.ballotPrivacy)) {
        return res.status(400).json({ error: 'Ballot privacy must be "anonymous" or "open".' });
      }
      election.ballotPrivacy = body.ballotPrivacy;
    }
    if (body.security !== undefined) {
      if (election.status !== 'draft') {
        return res.status(409).json({ error: 'Ballot rules can only change during setup.' });
      }
      if (!SECURITY_MODES.includes(body.security)) {
        return res.status(400).json({ error: 'Voter check must be "link" or "code".' });
      }
      election.security = body.security;
    }

    await store.saveElection(election);
    res.json({ election: publicElection(election) });
  });

  router.post('/admin/:token/status', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    const target = req.body?.status;
    const now = Date.now();

    if (target === 'open') {
      if (election.status === 'open') {
        return res.status(409).json({ error: 'Voting is already open.' });
      }
      const candidates = await store.listCandidates(election.id);
      if (candidates.length < 2) {
        return res.status(409).json({ error: 'Add at least two options before opening voting.' });
      }
      // A voter can never rank more options than exist, and STV needs at
      // least one non-winner; other methods elect exactly one.
      election.numRanks = Math.min(election.numRanks, candidates.length);
      election.numWinners =
        election.method === 'stv'
          ? Math.min(election.numWinners, Math.max(1, candidates.length - 1))
          : 1;
      election.status = 'open';
      election.openedAt = election.openedAt ?? now;
      election.closedAt = null;
    } else if (target === 'closed') {
      if (election.status !== 'open') {
        return res.status(409).json({ error: 'Voting is not open.' });
      }
      election.status = 'closed';
      election.closedAt = now;
    } else if (target === 'draft') {
      if (election.status !== 'open' || (await store.countBallots(election.id)) > 0) {
        return res.status(409).json({ error: 'You can only return to setup while voting is open and no ballots have been cast.' });
      }
      election.status = 'draft';
      election.openedAt = null;
    } else {
      return res.status(400).json({ error: 'Unknown status.' });
    }

    await store.saveElection(election);
    res.json({ election: publicElection(election) });
  });

  router.post('/admin/:token/candidates', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    if (election.status !== 'draft') {
      return res.status(409).json({ error: 'Options can only change during setup.' });
    }
    const name = cleanLine(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Give the option a name.' });
    const existing = (await store.listCandidates(election.id)).map((c) => c.name);
    const problem = candidateListProblem([name], existing);
    if (problem) return res.status(400).json({ error: problem });
    await store.addCandidate(election.id, name);
    res.status(201).json({ candidates: await store.listCandidates(election.id) });
  });

  router.delete('/admin/:token/candidates/:candidateId', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    if (election.status !== 'draft') {
      return res.status(409).json({ error: 'Options can only change during setup.' });
    }
    if (!(await store.removeCandidate(election.id, req.params.candidateId))) {
      return res.status(404).json({ error: 'Option not found.' });
    }
    res.json({ candidates: await store.listCandidates(election.id) });
  });

  router.delete('/admin/:token', async (req, res) => {
    const election = await requireAdmin(req, res);
    if (!election) return;
    await store.deleteElection(election.id);
    res.json({ ok: true });
  });

  router.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request body.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our end.' });
  });

  return router;
}

function cleanLine(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanBlock(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

function candidateListProblem(names, existing = []) {
  if (names.length + existing.length > LIMITS.maxCandidates) {
    return `Elections are capped at ${LIMITS.maxCandidates} options.`;
  }
  if (names.some((name) => name.length > LIMITS.candidateName)) {
    return `Option names are capped at ${LIMITS.candidateName} characters.`;
  }
  const seen = new Set(existing.map((name) => name.toLowerCase()));
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) return `"${name}" appears more than once — options must be unique.`;
    seen.add(key);
  }
  return null;
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

// Minimal fixed-window limiter, keyed by client IP. Enough to blunt casual
// abuse without pulling in a dependency. Note that on serverless hosts each
// warm instance has its own window, so this is best-effort there; set
// TRUST_PROXY=1 behind a self-hosted reverse proxy so req.ip is the client.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Too many requests — try again in a little while.' });
    }
    recent.push(now);
    hits.set(req.ip, recent);
    if (hits.size > 5000) {
      for (const [key, times] of hits) {
        if (times.every((t) => now - t >= windowMs)) hits.delete(key);
      }
    }
    next();
  };
}
