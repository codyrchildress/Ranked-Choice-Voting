/**
 * Condorcet method.
 *
 * Every pair of candidates goes head-to-head: on each ballot, whichever of
 * the two is ranked higher takes that ballot's vote (a ballot ranking one
 * and not the other prefers the ranked one; ranking neither expresses no
 * preference). A candidate who beats every other candidate one-on-one is
 * the Condorcet winner.
 *
 * When no such candidate exists (a paradox cycle: A beats B, B beats C,
 * C beats A), the winner is decided by best head-to-head record — Copeland's
 * rule (wins count 1, ties ½), with total vote margin as the second sort.
 * Candidates identical on both truly tie.
 */
export function tallyCondorcet(candidateIds, ballots) {
  const totalBallots = ballots.length;
  const n = candidateIds.length;

  const pairwise = {};
  for (const a of candidateIds) {
    pairwise[a] = {};
    for (const b of candidateIds) if (a !== b) pairwise[a][b] = 0;
  }

  for (const rankings of ballots) {
    const position = new Map(rankings.map((id, i) => [id, i]));
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = candidateIds[i];
        const b = candidateIds[j];
        const pa = position.has(a) ? position.get(a) : Infinity;
        const pb = position.has(b) ? position.get(b) : Infinity;
        if (pa < pb) pairwise[a][b] += 1;
        else if (pb < pa) pairwise[b][a] += 1;
      }
    }
  }

  const records = new Map(
    candidateIds.map((id) => [id, { id, wins: 0, losses: 0, ties: 0, margin: 0 }]),
  );
  const matchups = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const a = candidateIds[i];
      const b = candidateIds[j];
      const aVotes = pairwise[a][b];
      const bVotes = pairwise[b][a];
      const winner = aVotes > bVotes ? a : bVotes > aVotes ? b : null;
      matchups.push({ a, b, aVotes, bVotes, winner });
      records.get(a).margin += aVotes - bVotes;
      records.get(b).margin += bVotes - aVotes;
      if (winner === a) {
        records.get(a).wins += 1;
        records.get(b).losses += 1;
      } else if (winner === b) {
        records.get(b).wins += 1;
        records.get(a).losses += 1;
      } else {
        records.get(a).ties += 1;
        records.get(b).ties += 1;
      }
    }
  }

  const standings = candidateIds.map((id) => {
    const record = records.get(id);
    return { ...record, copeland: record.wins + record.ties * 0.5 };
  });
  // Stable sort keeps ballot-paper order for identical records.
  standings.sort((a, b) => b.copeland - a.copeland || b.margin - a.margin);

  const condorcetWinner = totalBallots > 0 ? standings.find((s) => s.wins === n - 1) : undefined;
  const cycle = totalBallots > 0 && !condorcetWinner;
  const winners =
    totalBallots === 0
      ? []
      : condorcetWinner
        ? [condorcetWinner.id]
        : standings
            .filter((s) => s.copeland === standings[0].copeland && s.margin === standings[0].margin)
            .map((s) => s.id);

  return { method: 'condorcet', totalBallots, standings, matchups, pairwise, winners, cycle };
}
