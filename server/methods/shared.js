import { createHash } from 'node:crypto';

export function seededIndex(seedString, n) {
  const digest = createHash('sha256').update(seedString).digest();
  return digest.readUInt32BE(0) % n;
}

/**
 * Resolve an elimination tie: narrow by earlier-round tallies (most recent
 * first), then fall back to a draw seeded from the election id so recounts
 * are deterministic. Works for integer and fractional (STV) tallies.
 *
 * @returns {{ pick: string, tieBreak: null | 'prior-round' | 'random' }}
 */
export function breakElimTie(tied, rounds, seed, roundNumber) {
  let tieBreak = null;
  let pool = [...tied];
  if (pool.length > 1) {
    for (let r = rounds.length - 2; r >= 0 && pool.length > 1; r -= 1) {
      const prev = rounds[r].tallies;
      const min = Math.min(...pool.map((id) => prev[id] ?? 0));
      const narrowed = pool.filter((id) => (prev[id] ?? 0) <= min + 1e-9);
      if (narrowed.length < pool.length) tieBreak = 'prior-round';
      pool = narrowed;
    }
  }
  if (pool.length > 1) {
    tieBreak = 'random';
    const sorted = [...pool].sort();
    pool = [sorted[seededIndex(`${seed}|${roundNumber}|${sorted.join(',')}`, sorted.length)]];
  }
  return { pick: pool[0], tieBreak };
}
