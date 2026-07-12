// Renders instant-runoff results: winner banner + round-by-round tally sheet.
// Used by the public results page and the admin live tally.

import { el, pct, plural } from './util.js';

export function renderResults(data, { live = false } = {}) {
  const names = new Map(data.candidates.map((c) => [c.id, c.name]));
  const finalRound = data.rounds[data.rounds.length - 1];
  const frag = document.createDocumentFragment();

  frag.append(renderBanner(data, names, finalRound, live));

  const rounds = el('div', { class: 'rounds' });
  for (const round of data.rounds) {
    rounds.append(renderRound(round, names, data.rounds.length, live));
  }
  frag.append(rounds);

  frag.append(
    el('p', {
      class: 'results-foot',
      text: `${plural(data.totalBallots, 'ballot')} cast · ${plural(data.rounds.length, 'round')} · a majority is more than half of the ballots still active in a round`,
    }),
  );
  return frag;
}

function renderBanner(data, names, finalRound, live) {
  if (data.winners.length === 1) {
    const id = data.winners[0];
    const votes = finalRound.tallies[id] ?? 0;
    return el(
      'section',
      { class: 'winner-banner card' },
      el('span', { class: 'stamp big elected', text: live ? 'Leading' : 'Elected' }),
      el('div', { class: 'winner-name', text: names.get(id) ?? '—' }),
      el('p', {
        class: 'winner-sub',
        text: `${votes} of ${finalRound.active} final-round votes (${pct(votes, finalRound.active)}) after ${plural(data.rounds.length, 'round')}`,
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
        text: `Tied at ${finalRound.tallies[data.winners[0]] ?? 0} votes in the final round — settle it over coffee, or run a tiebreaker election.`,
      }),
    );
  }

  return el(
    'section',
    { class: 'winner-banner card tie' },
    el('span', { class: 'stamp big tie-stamp', text: 'No result' }),
    el('div', { class: 'winner-name', text: '—' }),
    el('p', { class: 'winner-sub', text: 'No ballots ranked any option, so there is nothing to count.' }),
  );
}

function renderRound(round, names, totalRounds, live) {
  const entries = Object.entries(round.tallies).sort(
    (a, b) => b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''),
  );

  const rows = entries.map(([id, votes]) => {
    const won = round.winners.includes(id);
    const out = round.eliminated.includes(id);
    const width = round.active > 0 ? (votes / round.active) * 100 : 0;
    const transfer = round.transfers.find((t) => t.from === id);

    const bar = el(
      'div',
      { class: `bar${won ? ' won' : ''}${out ? ' out' : ''}` },
      el('i', { dataset: { w: `${width}%` } }),
    );
    if (round.majority && round.active > 0) {
      bar.append(
        el('span', {
          class: 'majority-mark',
          style: `left:${(round.majority / round.active) * 100}%`,
          title: `Majority: ${round.majority} votes`,
        }),
      );
    }

    return el(
      'div',
      { class: 'tally-row' },
      el(
        'div',
        { class: 'tally-line' },
        el(
          'span',
          { class: 'name' },
          names.get(id) ?? '—',
          won && el('span', { class: 'tag won', text: live ? 'leading' : '✓ elected' }),
          out && el('span', { class: 'tag out', text: 'eliminated' }),
        ),
        el('span', { class: 'leader-dots' }),
        el(
          'span',
          { class: 'figures' },
          String(votes),
          el('span', { class: 'pct', text: pct(votes, round.active) }),
        ),
      ),
      bar,
      transfer && el('p', { class: 'transfer-note', text: transferText(transfer, names) }),
    );
  });

  const meta = round.active > 0
    ? `${round.active} active · majority ≥ ${round.majority}`
    : 'no active ballots';

  return el(
    'section',
    { class: 'card round-card' },
    el(
      'div',
      { class: 'round-head' },
      el('h3', { text: totalRounds === 1 ? 'The count' : `Round ${round.number}` }),
      el('span', { class: 'round-meta mono', text: meta }),
      round.tieBreak === 'prior-round' &&
        el('span', { class: 'tie-note', text: 'Last place was tied — broken by earlier-round totals.' }),
      round.tieBreak === 'random' &&
        el('span', { class: 'tie-note', text: 'Last place was tied in every round — broken by a seeded random draw.' }),
    ),
    el('div', { class: 'tally-rows' }, rows),
    round.exhausted > 0 &&
      el('p', {
        class: 'exhausted-note',
        text: `${plural(round.exhausted, 'exhausted ballot')} — every option they ranked has been eliminated`,
      }),
  );
}

function transferText(transfer, names) {
  const parts = Object.entries(transfer.to)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${names.get(id) ?? '—'} +${n}`);
  if (transfer.exhausted > 0) parts.push(`${transfer.exhausted} exhausted`);
  return `${plural(transfer.count, 'ballot')} moved → ${parts.join(' · ')}`;
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
