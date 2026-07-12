/**
 * Borda count (points).
 *
 * On a ballot with K ranked choices, a voter's 1st choice earns K points,
 * their 2nd K-1, and so on down to 1 point for their Kth choice. Options a
 * voter leaves unranked earn nothing from that ballot. Ranking fewer than K
 * options doesn't dilute anything: the 1st choice is always worth K points.
 *
 * Standings order (and the winner) is total points, with ties broken by
 * placements: more 1st-choice votes wins, then more 2nd-choice votes, and so
 * on. Only candidates with completely identical profiles tie for real.
 */
export function tallyBorda(candidateIds, ballots, { numRanks } = {}) {
  const standings = candidateIds.map((id) => ({
    id,
    points: 0,
    rankCounts: Array(numRanks).fill(0),
    ballotsRanking: 0,
  }));
  const byId = new Map(standings.map((entry) => [entry.id, entry]));

  for (const rankings of ballots) {
    rankings.forEach((candidateId, index) => {
      const entry = byId.get(candidateId);
      if (!entry || index >= numRanks) return; // defensive: API validates ballots
      entry.points += numRanks - index;
      entry.rankCounts[index] += 1;
      entry.ballotsRanking += 1;
    });
  }

  // Stable sort keeps ballot-paper order for identical profiles.
  standings.sort((a, b) => compareProfiles(b, a));

  const winners =
    ballots.length === 0
      ? []
      : standings.filter((entry) => compareProfiles(entry, standings[0]) === 0).map((entry) => entry.id);

  return { method: 'borda', totalBallots: ballots.length, numRanks, standings, winners };
}

function compareProfiles(a, b) {
  if (a.points !== b.points) return a.points - b.points;
  for (let r = 0; r < a.rankCounts.length; r += 1) {
    if (a.rankCounts[r] !== b.rankCounts[r]) return a.rankCounts[r] - b.rankCounts[r];
  }
  return 0;
}
