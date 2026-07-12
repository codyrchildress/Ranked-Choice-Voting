// Renders points-tally results: winner banner + a standings leaderboard.
// Each bar is stacked by rank tier (darkest segment = points from 1st-choice
// votes) so it's visible where every option's total comes from.
// Used by the public results page and the admin live tally.

import { el, ordinal, plural } from './util.js';

export function renderResults(data, { live = false } = {}) {
  const names = new Map(data.candidates.map((c) => [c.id, c.name]));
  const frag = document.createDocumentFragment();

  frag.append(renderBanner(data, names, live));
  frag.append(renderStandings(data, names, live));
  frag.append(
    el('p', { class: 'results-foot', text: `${plural(data.totalBallots, 'ballot')} cast · ${scoringNote(data.numRanks)} Darker bar segments are points from higher choices.` }),
  );
  return frag;
}

function scoringNote(numRanks) {
  if (numRanks === 1) return 'Scoring: each ballot gives its choice 1 point.';
  if (numRanks === 2) return 'Scoring: 1st choice = 2 pts, 2nd = 1 pt; unranked options score 0.';
  return `Scoring: 1st choice = ${numRanks} pts, 2nd = ${numRanks - 1} pts, … ${ordinal(numRanks)} = 1 pt; unranked options score 0.`;
}

function renderBanner(data, names, live) {
  const top = data.standings[0];

  if (data.winners.length === 1) {
    const runnerUp = data.standings[1];
    const margin = runnerUp
      ? ` · ${top.points - runnerUp.points} ${top.points - runnerUp.points === 1 ? 'point' : 'points'} clear of ${names.get(runnerUp.id) ?? '—'}`
      : '';
    return el(
      'section',
      { class: 'winner-banner card' },
      el('span', { class: 'stamp big elected', text: live ? 'Leading' : 'Elected' }),
      el('div', { class: 'winner-name', text: names.get(top.id) ?? '—' }),
      el('p', {
        class: 'winner-sub',
        text: `${top.points} points from ${plural(data.totalBallots, 'ballot')}${margin}`,
      }),
    );
  }

  if (data.winners.length > 1) {
    return el(
      'section',
      { class: 'winner-banner card tie' },
      el('span', { class: 'stamp big tie-stamp', text: 'Exact tie' }),
      el('div', {
        class: 'winner-name',
        text: data.winners.map((id) => names.get(id) ?? '—').join('  &  '),
      }),
      el('p', {
        class: 'winner-sub',
        text: `Dead even at ${top.points} points with identical placements — settle it over coffee, or run a tiebreaker election.`,
      }),
    );
  }

  return el(
    'section',
    { class: 'winner-banner card tie' },
    el('span', { class: 'stamp big tie-stamp', text: 'No result' }),
    el('div', { class: 'winner-name', text: '—' }),
    el('p', { class: 'winner-sub', text: 'No ballots were cast, so there is nothing to count.' }),
  );
}

function renderStandings(data, names, live) {
  const { standings, numRanks, totalBallots } = data;
  const topPoints = standings[0]?.points ?? 0;
  const scale = (points) => (topPoints > 0 ? (points / topPoints) * 100 : 0);

  let place = 0;
  const rows = standings.map((entry, index) => {
    // Candidates with identical profiles share a place number.
    if (index === 0 || !sameProfile(entry, standings[index - 1])) place = index + 1;
    const won = data.winners.includes(entry.id);

    const segments = entry.rankCounts
      .map((count, r) => ({ r, count, points: count * (numRanks - r) }))
      .filter((seg) => seg.points > 0);

    const bar = el(
      'div',
      { class: `bar stacked${won ? ' won' : ''}` },
      segments.map(({ r, count, points }) =>
        el('i', {
          dataset: { w: `${scale(points)}%` },
          style: `opacity:${tierOpacity(r, numRanks)}`,
          title: `${ordinal(r + 1)}-choice points: ${count} × ${numRanks - r} = ${points}`,
        }),
      ),
    );

    const breakdown =
      entry.points === 0
        ? 'not ranked on any ballot'
        : `${segments.map(({ r, count }) => `${count}× ${ordinal(r + 1)}`).join(' · ')} · ranked by ${entry.ballotsRanking} of ${plural(totalBallots, 'voter')}`;

    return el(
      'div',
      { class: `standing-row${won ? ' won' : ''}` },
      el('span', { class: 'rank-badge', 'aria-hidden': 'true', text: String(place) }),
      el(
        'div',
        { class: 'standing-main' },
        el(
          'div',
          { class: 'tally-line' },
          el(
            'span',
            { class: 'name' },
            names.get(entry.id) ?? '—',
            won && el('span', { class: 'tag won', text: live ? 'leading' : '✓ elected' }),
          ),
          el('span', { class: 'leader-dots' }),
          el('span', { class: 'figures' }, String(entry.points), el('span', { class: 'pct', text: 'pts' })),
        ),
        bar,
        el('p', { class: 'standing-breakdown', text: breakdown }),
      ),
    );
  });

  return el('section', { class: 'card standings-card' }, el('div', { class: 'standings' }, rows));
}

function sameProfile(a, b) {
  return a.points === b.points && a.rankCounts.every((count, r) => count === b.rankCounts[r]);
}

// Solid ink for 1st-choice points, fading for lower tiers (floor keeps the
// lightest tier readable).
function tierOpacity(rank, numRanks) {
  return (1 - rank * (0.72 / Math.max(numRanks - 1, 1))).toFixed(3);
}

// Kick off the grow-in animation once rendered bars are in the document.
export function animateBars(container) {
  const apply = () => {
    for (const fill of container.querySelectorAll('.bar > i')) {
      fill.style.setProperty('--w', fill.dataset.w);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
  // rAF never fires in hidden/background tabs — make sure the bars still fill.
  setTimeout(apply, 150);
}
