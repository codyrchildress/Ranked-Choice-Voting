// Renders election results for all five counting methods, with a switcher:
// the election's official method first, the rest as "what if?" views over
// the same ballots. Used by the public results page and the admin tally.

import { el, ordinal, pct, plural, timeString } from './util.js';
import { METHODS, methodByKey } from './methods.js';

export function renderResults(payload, { live = false } = {}) {
  const names = new Map(payload.candidates.map((c) => [c.id, c.name]));
  const container = el('div', { class: 'results-view' });
  const chips = el('div', { class: 'method-chips' });
  const body = el('div', { class: 'method-body' });
  let current = payload.official;

  const ordered = [
    ...METHODS.filter((m) => m.key === payload.official),
    ...METHODS.filter((m) => m.key !== payload.official),
  ];
  for (const method of ordered) {
    const chip = el(
      'button',
      {
        type: 'button',
        class: `method-chip${method.key === current ? ' active' : ''}`,
        onclick: () => {
          current = method.key;
          for (const node of chips.children) node.classList.toggle('active', node === chip);
          renderBody();
        },
      },
      method.name,
      method.key === payload.official && el('span', { class: 'official-mark', text: '★ official' }),
    );
    chips.append(chip);
  }

  function renderBody() {
    const data = payload.results[current];
    const info = methodByKey[current];
    const official = current === payload.official;
    const opts = { live, official };

    body.replaceChildren(
      el(
        'p',
        { class: 'method-blurb' },
        !official && el('span', { class: 'tag hypo-tag', text: 'what if?' }),
        info.explain,
        !official &&
          el('em', {
            text: ` This election is officially decided by ${methodByKey[payload.official].name} — this view recounts the same ballots just for fun.`,
          }),
      ),
      renderBanner(current, data, names, opts),
      renderMethodBody(current, data, names, opts),
      el('p', { class: 'results-foot', text: footText(current, data) }),
    );
    animateBars(body);
  }

  container.append(chips, body);
  renderBody();
  return container;
}

// ---- banners ----

function winnerTag({ live, official }) {
  if (!official) return 'would win';
  return live ? 'leading' : '✓ elected';
}

function renderBanner(key, data, names, { live, official }) {
  const stamp = official
    ? el('span', { class: `stamp big ${live ? 'open' : 'elected'}`, text: live ? 'Leading' : 'Elected' })
    : el('span', { class: 'stamp big hypo-stamp', text: 'What if?' });

  if (data.winners.length === 0) {
    return el(
      'section',
      { class: `winner-banner card tie${official ? '' : ' hypo'}` },
      official ? el('span', { class: 'stamp big tie-stamp', text: 'No result' }) : stamp,
      el('div', { class: 'winner-name', text: '—' }),
      el('p', { class: 'winner-sub', text: 'No ballots ranked any option, so there is nothing to count.' }),
    );
  }

  const isTie = key !== 'stv' && data.winners.length > 1;
  const nameText = data.winners.map((id) => names.get(id) ?? '—').join('  &  ');

  if (isTie) {
    return el(
      'section',
      { class: `winner-banner card tie${official ? '' : ' hypo'}` },
      official ? el('span', { class: 'stamp big tie-stamp', text: 'Exact tie' }) : stamp,
      el('div', { class: 'winner-name', text: nameText }),
      el('p', {
        class: 'winner-sub',
        text: `Dead even under this method — settle it over coffee, or run a tiebreaker election.`,
      }),
    );
  }

  return el(
    'section',
    { class: `winner-banner card${official ? '' : ' hypo'}` },
    stamp,
    el('div', { class: 'winner-name', text: nameText }),
    el('p', { class: 'winner-sub', text: bannerSub(key, data, names) }),
  );
}

function bannerSub(key, data, names) {
  if (key === 'borda') {
    const top = data.standings[0];
    const runnerUp = data.standings.find((s) => !data.winners.includes(s.id));
    const margin = runnerUp
      ? ` · ${top.points - runnerUp.points} ${top.points - runnerUp.points === 1 ? 'point' : 'points'} clear of ${names.get(runnerUp.id) ?? '—'}`
      : '';
    return `${top.points} points from ${plural(data.totalBallots, 'ballot')}${margin}`;
  }
  if (key === 'condorcet') {
    const top = data.standings[0];
    return data.cycle
      ? `Best head-to-head record (${top.wins}–${top.losses}${top.ties ? `–${top.ties}` : ''}) — no option beat every other`
      : `Won every head-to-head matchup (${top.wins}–0)`;
  }
  if (key === 'stv') {
    return `Fills ${plural(data.seats, 'seat')} · quota ${plural(data.quota, 'vote')} · ${plural(data.totalBallots, 'ballot')} cast`;
  }
  const finalRound = data.rounds[data.rounds.length - 1];
  const id = data.winners[0];
  const votes = finalRound.tallies[id] ?? 0;
  if (key === 'contingent' && data.rounds.length === 1) {
    return `An outright majority of first choices — ${votes} of ${plural(data.totalBallots, 'ballot')} (${pct(votes, data.totalBallots)})`;
  }
  const label = key === 'contingent' ? 'runoff votes' : 'final-round votes';
  return `${votes} of ${finalRound.active} ${label} (${pct(votes, finalRound.active)}) after ${plural(data.rounds.length, 'round')}`;
}

// ---- method bodies ----

function renderMethodBody(key, data, names, opts) {
  if (key === 'borda') return renderStandings(data, names, opts);
  if (key === 'condorcet') return renderCondorcet(data, names, opts);
  return renderRounds(key, data, names, opts);
}

// Rounds view: IRV, STV, and the contingent vote's two-step count.
function renderRounds(key, data, names, opts) {
  const cards = data.rounds.map((round) => {
    const denominator =
      key === 'stv'
        ? Math.max(...Object.values(round.tallies), round.quota, 1)
        : Math.max(round.active, 1);

    const entries = Object.entries(round.tallies).sort(
      (a, b) => b[1] - a[1] || (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''),
    );

    const rows = entries.map(([id, votes]) => {
      const won = key === 'stv' ? round.elected.includes(id) : round.winners.includes(id);
      const out = round.eliminated.includes(id);
      const width = (votes / denominator) * 100;

      const bar = el(
        'div',
        { class: `bar${won ? ' won' : ''}${out ? ' out' : ''}` },
        el('i', { dataset: { w: `${width}%` } }),
      );
      const markAt = key === 'stv' ? round.quota : round.majority;
      if (markAt && markAt / denominator <= 1) {
        bar.append(
          el('span', {
            class: 'majority-mark',
            style: `left:${(markAt / denominator) * 100}%`,
            title: key === 'stv' ? `Quota: ${fmtV(markAt)} votes` : `Majority: ${markAt} votes`,
          }),
        );
      }

      const transfer = round.transfers.find((t) => t.from === id);
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
            won && el('span', { class: 'tag won', text: winnerTag(opts) }),
            out && el('span', { class: 'tag out', text: 'eliminated' }),
          ),
          el('span', { class: 'leader-dots' }),
          el(
            'span',
            { class: 'figures' },
            fmtV(votes),
            key !== 'stv' && el('span', { class: 'pct', text: pct(votes, round.active) }),
          ),
        ),
        bar,
        transfer &&
          el('p', {
            class: 'transfer-note',
            text: transferText(transfer, names, key === 'stv' && round.elected.includes(id)),
          }),
      );
    });

    const meta =
      key === 'stv'
        ? `quota ≥ ${fmtV(round.quota)}`
        : round.active > 0
          ? `${fmtV(round.active)} active · majority ≥ ${round.majority}`
          : 'no active ballots';

    return el(
      'section',
      { class: 'card round-card' },
      el(
        'div',
        { class: 'round-head' },
        el('h3', { text: round.label ?? (data.rounds.length === 1 ? 'The count' : `Round ${round.number}`) }),
        el('span', { class: 'round-meta mono', text: meta }),
        round.tieBreak === 'prior-round' &&
          el('span', { class: 'tie-note', text: 'A tie was broken by earlier-round totals.' }),
        round.tieBreak === 'random' &&
          el('span', { class: 'tie-note', text: 'A tie was broken by a random draw seeded from this election, so recounts always agree.' }),
        round.defaultElected &&
          el('span', { class: 'tie-note', text: 'The remaining options fill the last open seats.' }),
      ),
      el('div', { class: 'tally-rows' }, rows),
      round.exhausted > 0 &&
        el('p', {
          class: 'exhausted-note',
          text: `${fmtV(round.exhausted)} exhausted ${round.exhausted === 1 ? 'ballot' : 'ballots'} — every option they ranked is out of the running`,
        }),
    );
  });

  return el('div', { class: 'rounds' }, cards);
}

function transferText(transfer, names, isSurplus) {
  const parts = Object.entries(transfer.to)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${names.get(id) ?? '—'} +${fmtV(n)}`);
  if (transfer.exhausted > 0) parts.push(`${fmtV(transfer.exhausted)} exhausted`);
  const what = isSurplus
    ? `${fmtV(transfer.count)} surplus ${transfer.count === 1 ? 'vote' : 'votes'}`
    : `${fmtV(transfer.count)} ${transfer.count === 1 ? 'ballot' : 'ballots'}`;
  return `${what} moved → ${parts.join(' · ')}`;
}

// Standings view: Borda points with rank-tier stacked bars.
function renderStandings(data, names, opts) {
  const { standings, numRanks, totalBallots } = data;
  const topPoints = standings[0]?.points ?? 0;
  const scale = (points) => (topPoints > 0 ? (points / topPoints) * 100 : 0);

  let place = 0;
  const rows = standings.map((entry, index) => {
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
            won && el('span', { class: 'tag won', text: winnerTag(opts) }),
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

function tierOpacity(rank, numRanks) {
  return (1 - rank * (0.72 / Math.max(numRanks - 1, 1))).toFixed(3);
}

// Head-to-head view: Condorcet records plus the full matchup grid.
function renderCondorcet(data, names, opts) {
  const { standings } = data;
  const maxWins = Math.max(1, standings.length - 1);

  let place = 0;
  const rows = standings.map((entry, index) => {
    const prev = standings[index - 1];
    if (index === 0 || entry.copeland !== prev.copeland || entry.margin !== prev.margin) place = index + 1;
    const won = data.winners.includes(entry.id);
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
            won && el('span', { class: 'tag won', text: winnerTag(opts) }),
          ),
          el('span', { class: 'leader-dots' }),
          el('span', {
            class: 'figures',
            text: `${entry.wins}–${entry.losses}${entry.ties ? `–${entry.ties}` : ''}`,
          }),
        ),
        el('div', { class: `bar${won ? ' won' : ''}` }, el('i', { dataset: { w: `${(entry.wins / maxWins) * 100}%` } })),
        el('p', {
          class: 'standing-breakdown',
          text: `beats ${plural(entry.wins, 'rival')}${entry.ties ? ` · ties ${entry.ties}` : ''} · net ${entry.margin >= 0 ? '+' : ''}${entry.margin} votes across matchups`,
        }),
      ),
    );
  });

  const table = el(
    'table',
    { class: 'matchup-table' },
    el(
      'tr',
      {},
      el('th', { class: 'rowhead', text: 'Head-to-head' }),
      standings.map((s, i) => el('th', { text: `#${i + 1}`, title: names.get(s.id) ?? '—' })),
    ),
    standings.map((rowEntry, i) =>
      el(
        'tr',
        {},
        el('th', { class: 'rowhead', text: `#${i + 1} ${names.get(rowEntry.id) ?? '—'}` }),
        standings.map((colEntry, j) => {
          if (i === j) return el('td', { class: 'even', text: '—' });
          const forVotes = data.pairwise[rowEntry.id][colEntry.id];
          const against = data.pairwise[colEntry.id][rowEntry.id];
          const state = forVotes > against ? 'win' : against > forVotes ? 'loss' : 'even';
          return el('td', {
            class: state,
            text: `${forVotes}–${against}`,
            title: `${names.get(rowEntry.id)} vs ${names.get(colEntry.id)}: ${forVotes}–${against}`,
          });
        }),
      ),
    ),
  );

  return el(
    'div',
    {},
    data.cycle &&
      data.totalBallots > 0 &&
      el('p', { class: 'method-blurb', text: 'No option beat every rival outright, so the best overall record wins (Copeland’s rule), with total vote margin as the tiebreaker.' }),
    el('section', { class: 'card standings-card' }, el('div', { class: 'standings' }, rows)),
    el('section', { class: 'card standings-card', style: 'margin-top:1.3rem' },
      el('div', { class: 'matchup-scroll' }, table),
      el('p', { class: 'standing-breakdown', style: 'margin-top:.7rem', text: 'Each cell reads row–column: ballots preferring the row option vs. the column option.' }),
    ),
  );
}

// ---- footers & formatting ----

function footText(key, data) {
  const ballots = plural(data.totalBallots, 'ballot');
  if (key === 'borda') {
    return `${ballots} cast · ${scoringNote(data.numRanks)} Darker bar segments are points from higher choices.`;
  }
  if (key === 'stv') {
    return `${ballots} cast · quota = more votes than can be caught: floor(ballots ÷ (seats + 1)) + 1 = ${data.quota} · surplus votes transfer at reduced weight`;
  }
  if (key === 'condorcet') {
    return `${ballots} cast · ranking one option and not another counts as preferring it; ranking neither expresses no preference`;
  }
  if (key === 'contingent') {
    return `${ballots} cast · with no majority of first choices, only the top two survive to the runoff`;
  }
  return `${ballots} cast · a majority is more than half of the ballots still active in a round`;
}

function scoringNote(numRanks) {
  if (numRanks === 1) return 'Scoring: each ballot gives its choice 1 point.';
  if (numRanks === 2) return 'Scoring: 1st choice = 2 pts, 2nd = 1 pt; unranked options score 0.';
  return `Scoring: 1st choice = ${numRanks} pts, 2nd = ${numRanks - 1} pts, … ${ordinal(numRanks)} = 1 pt; unranked options score 0.`;
}

function fmtV(x) {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

// The public record for open-ballot elections: every signed ballot in full.
export function renderSignedBallots(ballots, candidates, { title = 'The public record', sub } = {}) {
  const names = new Map(candidates.map((c) => [c.id, c.name]));
  return el(
    'section',
    { class: 'card standings-card', style: 'margin-top:1.3rem' },
    el('h2', { text: `${title} (${ballots.length})` }),
    sub && el('p', { class: 'card-sub', text: sub }),
    el(
      'ol',
      { class: 'open-ballots' },
      ballots.map((ballot) =>
        el(
          'li',
          {},
          el(
            'span',
            { class: 'who' },
            el('span', { text: ballot.name ?? '—' }),
            el('span', { class: 'when', text: timeString(ballot.createdAt) }),
          ),
          el('span', {
            class: 'order',
            text: ballot.rankings.map((id, i) => `${i + 1}. ${names.get(id) ?? '—'}`).join('  →  '),
          }),
        ),
      ),
    ),
  );
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
