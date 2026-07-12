// Tally registry: one election, five ways to count it. The election's own
// method is the official result; the rest are computed alongside for the
// "what if?" view on the results page.
import { tallyBorda } from './methods/borda.js';
import { tallyCondorcet } from './methods/condorcet.js';
import { tallyContingent } from './methods/contingent.js';
import { tallyIrv } from './methods/irv.js';
import { tallyStv } from './methods/stv.js';

export const METHOD_KEYS = ['irv', 'stv', 'borda', 'condorcet', 'contingent'];

export function tallyAll(candidateIds, ballots, { numRanks, numWinners, seed }) {
  return {
    irv: tallyIrv(candidateIds, ballots, { seed }),
    stv: tallyStv(candidateIds, ballots, { numWinners, seed }),
    borda: tallyBorda(candidateIds, ballots, { numRanks }),
    condorcet: tallyCondorcet(candidateIds, ballots),
    contingent: tallyContingent(candidateIds, ballots, { seed }),
  };
}
