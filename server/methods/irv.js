import { breakElimTie } from './shared.js';

/**
 * Instant-runoff voting (IRV).
 *
 * Each round, every ballot counts for its highest-ranked candidate still in
 * the race; ballots whose ranked candidates are all eliminated are
 * "exhausted" and sit out the rest of the count. A candidate wins by taking
 * a majority of the round's active (non-exhausted) ballots. Otherwise the
 * last-place candidate is eliminated and their ballots transfer to each
 * ballot's next surviving choice.
 *
 * Elimination ties are broken by earlier-round totals, then a draw seeded
 * from the election id (deterministic recounts). Candidates with zero votes
 * are eliminated together since they have no ballots to transfer.
 */
export function tallyIrv(candidateIds, ballots, { seed = '' } = {}) {
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
      const lowest = continuing.filter((id) => tallies[id] === bottom);
      const { pick, tieBreak } = breakElimTie(lowest, rounds, seed, round.number);
      round.tieBreak = tieBreak;
      eliminated = [pick];
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

  return { method: 'irv', totalBallots, rounds, winners };
}
