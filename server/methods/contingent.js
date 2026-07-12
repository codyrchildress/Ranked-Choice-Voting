import { seededIndex } from './shared.js';

/**
 * Contingent vote: an instant top-two runoff.
 *
 * If a candidate takes more than half of the first-choice votes, they win
 * outright. Otherwise every candidate except the top two is eliminated at
 * once, and each remaining ballot counts for whichever finalist it ranks
 * higher (ballots ranking neither finalist are exhausted). Most runoff votes
 * wins; an equal split is an exact tie.
 *
 * Ties for a finalist spot are broken by a draw seeded from the election id,
 * so recounts are deterministic.
 */
export function tallyContingent(candidateIds, ballots, { seed = '' } = {}) {
  const totalBallots = ballots.length;
  const result = { method: 'contingent', totalBallots, finalists: [], rounds: [], winners: [] };

  const firstCount = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  for (const rankings of ballots) firstCount[rankings[0]] += 1;

  const round1 = {
    number: 1,
    label: 'First count',
    tallies: { ...firstCount },
    active: totalBallots,
    exhausted: 0,
    majority: totalBallots > 0 ? Math.floor(totalBallots / 2) + 1 : null,
    eliminated: [],
    transfers: [],
    winners: [],
    tieBreak: null,
  };
  result.rounds.push(round1);
  if (totalBallots === 0) return result;

  const top = Math.max(...candidateIds.map((id) => firstCount[id]));
  const leaders = candidateIds.filter((id) => firstCount[id] === top);

  // An outright majority (or a two-candidate field) decides it immediately.
  if (top * 2 > totalBallots || candidateIds.length <= 2) {
    round1.winners = leaders;
    result.winners = leaders;
    return result;
  }

  // Pick the two finalists: anyone strictly above second place is locked in;
  // ties for the remaining spot(s) are drawn by seed.
  const sorted = [...candidateIds].sort((a, b) => firstCount[b] - firstCount[a]);
  const cutoff = firstCount[sorted[1]];
  const finalists = candidateIds.filter((id) => firstCount[id] > cutoff);
  let pool = candidateIds.filter((id) => firstCount[id] === cutoff);
  if (finalists.length + pool.length > 2) round1.tieBreak = 'random';
  while (finalists.length < 2) {
    if (finalists.length + pool.length <= 2) {
      finalists.push(...pool);
      pool = [];
    } else {
      const sortedPool = [...pool].sort();
      const pick = sortedPool[seededIndex(`${seed}|finalists|${sortedPool.join(',')}`, sortedPool.length)];
      finalists.push(pick);
      pool = pool.filter((id) => id !== pick);
    }
  }
  result.finalists = finalists;
  round1.eliminated = candidateIds.filter((id) => !finalists.includes(id));

  // Transfers from each eliminated candidate to the finalists.
  const finalistSet = new Set(finalists);
  for (const gone of round1.eliminated) {
    const to = {};
    let toExhausted = 0;
    let count = 0;
    for (const rankings of ballots) {
      if (rankings[0] !== gone) continue;
      count += 1;
      const next = rankings.find((id) => finalistSet.has(id));
      if (next === undefined) toExhausted += 1;
      else to[next] = (to[next] ?? 0) + 1;
    }
    if (count > 0) round1.transfers.push({ from: gone, to, exhausted: toExhausted, count });
  }

  // The runoff: every ballot counts for whichever finalist it ranks higher.
  const tallies = Object.fromEntries(finalists.map((id) => [id, 0]));
  let exhausted = 0;
  for (const rankings of ballots) {
    const choice = rankings.find((id) => finalistSet.has(id));
    if (choice === undefined) exhausted += 1;
    else tallies[choice] += 1;
  }
  const active = totalBallots - exhausted;
  const runoffTop = Math.max(...finalists.map((id) => tallies[id]));
  const winners = active > 0 ? finalists.filter((id) => tallies[id] === runoffTop) : [];

  result.rounds.push({
    number: 2,
    label: 'Top-two runoff',
    tallies,
    active,
    exhausted,
    majority: active > 0 ? Math.floor(active / 2) + 1 : null,
    eliminated: [],
    transfers: [],
    winners,
    tieBreak: null,
  });
  result.winners = winners;
  return result;
}
