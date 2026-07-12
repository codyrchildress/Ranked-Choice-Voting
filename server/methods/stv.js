import { breakElimTie, seededIndex } from './shared.js';

const EPS = 1e-9;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Single transferable vote (STV) — multi-winner.
 *
 * Elects `numWinners` candidates using the Droop quota:
 * floor(ballots / (seats + 1)) + 1. Each round, ballots count (at their
 * current weight) for their highest-ranked continuing candidate. Anyone
 * reaching the quota is elected; their surplus transfers onward by scaling
 * every one of their ballots to `surplus / total` of its weight (the Gregory
 * method), flowing to each ballot's next continuing choice. When nobody
 * reaches the quota, last place is eliminated and their ballots transfer at
 * full current weight — ties broken by earlier rounds, then a seeded draw.
 * Once the field is no larger than the seats left, everyone remaining is
 * elected.
 */
export function tallyStv(candidateIds, ballots, { numWinners = 1, seed = '' } = {}) {
  const totalBallots = ballots.length;
  const seats = Math.min(Math.max(1, numWinners), Math.max(1, candidateIds.length));
  const quota = Math.floor(totalBallots / (seats + 1)) + 1;
  const result = { method: 'stv', totalBallots, seats, quota, rounds: [], winners: [] };
  if (totalBallots === 0) return result;

  const weights = ballots.map(() => 1);
  let continuing = [...candidateIds];
  const elected = [];
  const rounds = result.rounds;

  while (elected.length < seats && continuing.length > 0) {
    const stillIn = new Set(continuing);
    const tallies = Object.fromEntries(continuing.map((id) => [id, 0]));
    const assignment = new Array(totalBallots).fill(null);
    let exhausted = 0;

    ballots.forEach((rankings, i) => {
      if (weights[i] <= EPS) return;
      const choice = rankings.find((id) => stillIn.has(id));
      if (choice === undefined) {
        exhausted += weights[i];
      } else {
        tallies[choice] += weights[i];
        assignment[i] = choice;
      }
    });
    for (const id of continuing) tallies[id] = round6(tallies[id]);

    const round = {
      number: rounds.length + 1,
      tallies,
      quota,
      exhausted: round6(exhausted),
      elected: [],
      eliminated: [],
      transfers: [],
      tieBreak: null,
      defaultElected: false,
    };
    rounds.push(round);

    // Field no bigger than the open seats: everyone left is elected.
    if (continuing.length + elected.length <= seats) {
      round.elected = [...continuing].sort((a, b) => tallies[b] - tallies[a]);
      round.defaultElected = true;
      elected.push(...round.elected);
      break;
    }

    const reachers = continuing
      .filter((id) => tallies[id] >= quota - EPS)
      .sort((a, b) => tallies[b] - tallies[a]);

    if (reachers.length > 0) {
      const open = seats - elected.length;
      let electedNow;
      if (reachers.length <= open) {
        electedNow = reachers;
      } else {
        // More quota-reachers than open seats: highest tallies get the seats;
        // an exact tie at the boundary is drawn by seed.
        const cutTally = tallies[reachers[open - 1]];
        electedNow = reachers.filter((id) => tallies[id] > cutTally + EPS);
        let pool = reachers.filter((id) => Math.abs(tallies[id] - cutTally) <= EPS);
        while (electedNow.length < open) {
          if (electedNow.length + pool.length <= open) {
            electedNow.push(...pool);
            pool = [];
          } else {
            round.tieBreak = 'random';
            const sortedPool = [...pool].sort();
            const pick =
              sortedPool[seededIndex(`${seed}|seat|${round.number}|${sortedPool.join(',')}`, sortedPool.length)];
            electedNow.push(pick);
            pool = pool.filter((id) => id !== pick);
          }
        }
      }

      round.elected = electedNow;
      elected.push(...electedNow);
      continuing = continuing.filter((id) => !electedNow.includes(id));
      const survivors = new Set(continuing);

      for (const id of electedNow) {
        const surplus = tallies[id] - quota;
        const factor = surplus > EPS ? surplus / tallies[id] : 0;
        const to = {};
        let toExhausted = 0;
        ballots.forEach((rankings, i) => {
          if (assignment[i] !== id) return;
          weights[i] *= factor;
          if (weights[i] <= EPS) return;
          const next = rankings.find((c) => survivors.has(c));
          if (next === undefined) toExhausted += weights[i];
          else to[next] = (to[next] ?? 0) + weights[i];
        });
        if (surplus > EPS) {
          round.transfers.push({
            from: id,
            to: roundValues(to),
            exhausted: round6(toExhausted),
            count: round6(surplus),
          });
        }
      }
    } else {
      const bottom = Math.min(...continuing.map((id) => tallies[id]));
      const lowest = continuing.filter((id) => tallies[id] <= bottom + EPS);
      const { pick, tieBreak } = breakElimTie(lowest, rounds, seed, round.number);
      round.tieBreak = tieBreak;
      round.eliminated = [pick];
      continuing = continuing.filter((id) => id !== pick);
      const survivors = new Set(continuing);

      const to = {};
      let toExhausted = 0;
      let count = 0;
      ballots.forEach((rankings, i) => {
        if (assignment[i] !== pick || weights[i] <= EPS) return;
        count += weights[i];
        const next = rankings.find((c) => survivors.has(c));
        if (next === undefined) toExhausted += weights[i];
        else to[next] = (to[next] ?? 0) + weights[i];
      });
      if (count > EPS) {
        round.transfers.push({
          from: pick,
          to: roundValues(to),
          exhausted: round6(toExhausted),
          count: round6(count),
        });
      }
    }
  }

  result.winners = elected;
  return result;
}

function roundValues(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, round6(value)]));
}
