import { api, el, plural, statusStamp } from './util.js';
import { animateBars, renderResults } from './results-render.js';

const electionId = location.pathname.split('/')[2];
const app = document.getElementById('app');

let pub = null; // public election info, for the header while sealed
let pollTimer = null;

init();

async function init() {
  try {
    pub = await api(`/api/elections/${electionId}`);
  } catch (err) {
    renderError(err);
    return;
  }
  document.title = `Results: ${pub.election.title} · Runoff`;
  load();
}

async function load() {
  clearTimeout(pollTimer);
  try {
    const results = await api(`/api/elections/${electionId}/results`);
    renderFull(results);
  } catch (err) {
    if (err.status === 403) renderSealed(err.data);
    else renderError(err);
  }
}

function head(status, ballotCount) {
  return el(
    'div',
    { class: 'page-head rise' },
    el('div', {}, el('h1', { text: pub.election.title }), statusStamp(status)),
    el('p', { class: 'count-line', text: `${plural(ballotCount, 'ballot')} cast` }),
    el('p', {}, el('a', { href: `/e/${electionId}`, text: '← Back to the ballot' })),
  );
}

function renderSealed(info) {
  app.replaceChildren(
    head(info?.status ?? 'open', info?.ballotCount ?? 0),
    el(
      'section',
      { class: 'card panel rise', style: '--i:1' },
      el('span', { class: 'stamp closed', text: 'Sealed' }),
      el('h2', { text: 'Results are under wraps.' }),
      el('p', {
        text:
          info?.status === 'draft'
            ? 'This election hasn’t opened voting yet. Once ballots are in and the organizer closes voting, the count appears here.'
            : 'Voting is still open. The tally unlocks the moment the organizer closes it — keep this page open and it will refresh on its own.',
      }),
    ),
  );
  pollTimer = setTimeout(load, 15000);
}

function renderFull(results) {
  app.replaceChildren(head(results.election.status, results.totalBallots));
  const body = el('div', { class: 'rise', style: '--i:1' });
  body.append(renderResults(results));
  app.append(body);
  animateBars(app);
}

function renderError(err) {
  app.replaceChildren(
    el(
      'section',
      { class: 'card panel rise' },
      el('span', { class: 'stamp closed', text: 'Not found' }),
      el('h2', { text: 'This election doesn’t exist.' }),
      el('p', { text: err.status === 404 ? 'The link may be mistyped, or the organizer deleted the election.' : err.message }),
      el('div', { class: 'btn-row' }, el('a', { class: 'btn', href: '/', text: 'Go home' })),
    ),
  );
}
