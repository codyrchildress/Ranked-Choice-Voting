// The five counting methods, with the copy used to explain them on the
// create form, the ballot, and the results page. One source of truth.

export const METHODS = [
  {
    key: 'irv',
    name: 'Instant-Runoff',
    tag: 'Eliminate last place until someone holds a majority',
    explain:
      'Everyone’s first choices are counted; if nothing clears half, the last-place option is eliminated and its ballots move to their next surviving pick — round after round until one option holds a true majority of the ballots still in play.',
    voterLine: () => 'Your later choices only come into play if your earlier ones are eliminated.',
  },
  {
    key: 'stv',
    name: 'Single Transferable Vote',
    tag: 'Fill several seats with few wasted votes',
    explain:
      'A multi-winner count. An option is elected once it reaches the quota — enough votes that it can’t be caught. Votes beyond the quota aren’t wasted: they transfer onward at reduced weight to each voter’s next pick, and when nobody reaches the quota, last place is eliminated as in instant-runoff, until every seat is filled.',
    voterLine: ({ numWinners }) =>
      `Electing ${numWinners} — support beyond what a favorite needs flows on to your next choices.`,
  },
  {
    key: 'borda',
    name: 'Borda Count',
    tag: 'Every rank earns points',
    explain:
      'On a top-K ballot a 1st-place vote earns K points, 2nd earns K−1, and so on down to 1; unranked options earn nothing. The highest total wins — it rewards options that are broadly liked and produces a clear full running order.',
    voterLine: ({ numRanks }) =>
      numRanks > 1
        ? `Your 1st choice earns ${numRanks} points, your 2nd ${numRanks - 1}, and so on.`
        : 'Your choice earns 1 point.',
  },
  {
    key: 'condorcet',
    name: 'Condorcet Method',
    tag: 'Beat every rival head-to-head',
    explain:
      'Every option is compared against every other, pair by pair: on each ballot, whichever of the two is ranked higher takes that ballot’s vote. An option that beats all others one-on-one wins. If a paradox cycle appears (A beats B, B beats C, C beats A), the best overall win–loss record decides.',
    voterLine: () => 'Your full order matters — it decides every head-to-head matchup.',
  },
  {
    key: 'contingent',
    name: 'Contingent Vote',
    tag: 'An instant top-two runoff',
    explain:
      'If an option takes more than half of the first-choice votes, it wins outright. Otherwise every option except the top two is eliminated at once, and each ballot counts for whichever finalist it ranks higher. One transfer round, done.',
    voterLine: () => 'With no outright majority, your ballot backs whichever finalist you ranked higher.',
  },
];

export const methodByKey = Object.fromEntries(METHODS.map((m) => [m.key, m]));
