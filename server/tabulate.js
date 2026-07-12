import { createHash } from 'node:crypto';

/**
 * Instant-runoff voting (IRV) tabulation.
 *
 * Each round, every ballot counts for its highest-ranked candidate still in
 * the race; ballots whose ranked candidates are all eliminated are
 * "exhausted" and sit out the rest of the count. A candidate wins by taking
 * a majority of the round's active (non-exhausted) ballots. Otherwise the
 * last-place candidate is eliminated and their ballots transfer to each
 * ballot's next surviving choice.
 *
 * Elimination ties are broken by comparing tallies in earlier rounds (most
 * recent first); a tie across all rounds is broken by a random draw seeded
 * from the election id, so recounting the same election always yields the
 * same result. Candidates with zero votes are eliminated together in one
 * round since they have no ballots to transfer.
 *
 * @param {string[]} candidateIds  candidates in ballot-paper order
 * @param {string[][]} ballots     each ballot is candidate ids, best first
 * @param {{seed?: string}} opts   seed for deterministic tie-breaking
 * @returns {{totalBallots: number, rounds: object[], winners: string[]}}
 *   winners has one entry normally, several on an exact final tie, and none
 *   only when no ballot ranked anyone.
 */
export function tabulate(candidateIds, ballots, { seed = '' } = {}) {
  const totalBallots = ballots.length;
  let continuing = [...candidateIds];
  const rounds = [];
  let winners = [];

  while (continuing.length > 0) {
    const stillIn = new Set(continuing);
    const tallies = Object.fromEntries(continuing.map((id) => [id, 0]));
    const assignment = new Array(totalBallots).fill(null);
    let exhausted = 0;

    ballots.forEach((rankings, i) => {
      const choice = rankings.find((id) => stillIn.has(id));
      if (choice === undefined) {
        exhausted += 1;
      } else {
        tallies[choice] += 1;
        assignment[i] = choice;
      }
    });

    const active = totalBallots - exhausted;
    const round = {
      number: rounds.length + 1,
      tallies,
      active,
      exhausted,
      majority: active > 0 ? Math.floor(active / 2) + 1 : null,
      eliminated: [],
      transfers: [],
      winners: [],
      tieBreak: null,
    };
    rounds.push(round);

    if (active === 0) break;

    const top = Math.max(...continuing.map((id) => tallies[id]));
    const leaders = continuing.filter((id) => tallies[id] === top);

    // Majority of active ballots wins outright. With two candidates left
    // nobody else can be eliminated, so the round is decisive either way —
    // equal tallies there are an exact tie.
    if (top * 2 > active || continuing.length <= 2) {
      round.winners = leaders;
      winners = leaders;
      break;
    }

    let eliminated;
    const zeroVotes = continuing.filter((id) => tallies[id] === 0);
    if (zeroVotes.length > 0) {
      eliminated = zeroVotes;
    } else {
      const bottom = Math.min(...continuing.map((id) => tallies[id]));
      let lowest = continuing.filter((id) => tallies[id] === bottom);
      if (lowest.length > 1) {
        for (let r = rounds.length - 2; r >= 0 && lowest.length > 1; r -= 1) {
          const prev = rounds[r].tallies;
          const prevMin = Math.min(...lowest.map((id) => prev[id] ?? 0));
          const narrowed = lowest.filter((id) => (prev[id] ?? 0) === prevMin);
          if (narrowed.length < lowest.length) round.tieBreak = 'prior-round';
          lowest = narrowed;
        }
      }
      if (lowest.length > 1) {
        round.tieBreak = 'random';
        const sorted = [...lowest].sort();
        const pick = seededIndex(`${seed}|${round.number}|${sorted.join(',')}`, sorted.length);
        lowest = [sorted[pick]];
      }
      eliminated = lowest;
    }

    const survivors = new Set(continuing.filter((id) => !eliminated.includes(id)));
    for (const gone of eliminated) {
      const to = {};
      let toExhausted = 0;
      let count = 0;
      ballots.forEach((rankings, i) => {
        if (assignment[i] !== gone) return;
        count += 1;
        const next = rankings.find((id) => survivors.has(id));
        if (next === undefined) toExhausted += 1;
        else to[next] = (to[next] ?? 0) + 1;
      });
      if (count > 0) {
        round.transfers.push({ from: gone, to, exhausted: toExhausted, count });
      }
    }

    round.eliminated = eliminated;
    continuing = continuing.filter((id) => !eliminated.includes(id));
  }

  return { totalBallots, rounds, winners };
}

function seededIndex(seedString, n) {
  const digest = createHash('sha256').update(seedString).digest();
  return digest.readUInt32BE(0) % n;
}
