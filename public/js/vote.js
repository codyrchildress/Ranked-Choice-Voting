import { methodByKey } from './methods.js';
import { api, el, ordinal, plural, statusStamp, storage, toast } from './util.js';

const electionId = location.pathname.split('/')[2];
const app = document.getElementById('app');

let data = null; // { election, candidates, ballotCount, hasVoted }
let ranked = []; // candidate ids, best first
let submittedNames = null; // recap of the ballot just cast
let voterName = '';
let ballotCode = new URLSearchParams(location.search).get('code') ?? '';
let codeStatus = null; // pre-checked {ok, label?/reason?} for the code above
let forceBallot = false; // "vote with a different code" on a shared device
let pollTimer = null;
let pendingFocus = null;
let dragFrom = null;

init();

async function init() {
  try {
    data = await api(`/api/elections/${electionId}`);
  } catch (err) {
    renderError(err);
    return;
  }
  document.title = `${data.election.title} · Runoff`;
  if (data.election.security === 'code' && ballotCode) {
    try {
      codeStatus = await api(`/api/elections/${electionId}/codes/${encodeURIComponent(ballotCode)}`);
    } catch {
      codeStatus = null;
    }
  }
  render();
}

function nameOf(id) {
  return data.candidates.find((c) => c.id === id)?.name ?? '—';
}

function render() {
  clearTimeout(pollTimer);
  app.replaceChildren();
  renderHead();

  const { status } = data.election;
  if (status === 'draft') renderNotOpen();
  else if (submittedNames) renderCast(true);
  else if (data.hasVoted && !forceBallot) renderCast(false);
  else if (status === 'closed') renderClosed();
  else renderBallot();

  schedulePoll();

  if (pendingFocus) {
    app.querySelector(`[data-focus="${pendingFocus}"]`)?.focus();
    pendingFocus = null;
  }
}

function schedulePoll() {
  const { status } = data.election;
  const waiting = status === 'draft' || (status === 'open' && (data.hasVoted || submittedNames));
  if (!waiting) return;
  pollTimer = setTimeout(async () => {
    try {
      const fresh = await api(`/api/elections/${electionId}`);
      const changed =
        fresh.election.status !== data.election.status || fresh.ballotCount !== data.ballotCount;
      data = { ...fresh, hasVoted: data.hasVoted || fresh.hasVoted };
      if (changed) render();
      else schedulePoll();
    } catch {
      schedulePoll();
    }
  }, 12000);
}

function renderHead() {
  const { election, ballotCount } = data;
  const methodName = methodByKey[election.method]?.name ?? election.method;
  const seats = election.method === 'stv' ? ` · electing ${election.numWinners}` : '';
  const privacy = election.ballotPrivacy === 'open' ? 'open ballots' : 'secret ballot';
  const security = election.security === 'code' ? ' · ballot codes required' : '';
  app.append(
    el(
      'div',
      { class: 'page-head rise' },
      el('div', {}, el('h1', { text: election.title }), statusStamp(election.status)),
      election.description && el('p', { class: 'desc', text: election.description }),
      el('p', {
        class: 'count-line',
        text: `Counted by ${methodName}${seats} · ${privacy}${security} · ${plural(ballotCount, 'ballot')} cast so far`,
      }),
    ),
  );
}

// ---- the ballot ----

function renderBallot() {
  const { election, candidates } = data;
  const max = Math.min(election.numRanks, candidates.length);
  const unranked = candidates.filter((c) => !ranked.includes(c.id));

  const slots = el('ol', { class: 'slots', 'aria-label': 'Your ranking' });
  for (let i = 0; i < max; i += 1) {
    slots.append(ranked[i] ? filledSlot(i) : emptySlot(i));
  }

  const chips = el(
    'div',
    { class: 'chips' },
    unranked.map((c) =>
      el(
        'button',
        {
          class: 'chip',
          type: 'button',
          disabled: ranked.length >= max,
          onclick: () => {
            if (ranked.length < max) {
              ranked.push(c.id);
              render();
            }
          },
        },
        c.name,
      ),
    ),
  );

  const isOpen = election.ballotPrivacy === 'open';
  const needsCode = election.security === 'code';
  const nameInput = el('input', {
    type: 'text',
    maxlength: '80',
    placeholder: isOpen ? 'Your name' : 'Anonymous',
    value: voterName,
    oninput: (e) => {
      voterName = e.target.value;
      updateSubmit();
    },
  });

  const codeNote = el('span', { class: 'hint' });
  const codeInput = el('input', {
    type: 'text',
    maxlength: '24',
    placeholder: 'e.g. abc-def-ghj',
    value: ballotCode,
    oninput: (e) => {
      ballotCode = e.target.value;
      codeStatus = null;
      renderCodeNote();
      updateSubmit();
    },
  });
  function renderCodeNote() {
    if (codeStatus) {
      codeNote.className = `hint ${codeStatus.ok ? 'code-ok' : 'code-bad'}`;
      codeNote.textContent = codeStatus.ok
        ? `✓ Code accepted${codeStatus.label ? ` — issued to ${codeStatus.label}` : ''}`
        : codeStatus.reason === 'used'
          ? '✗ This code has already been used.'
          : '✗ This code isn’t valid for this election.';
    } else {
      codeNote.className = 'hint';
      codeNote.textContent = 'One ballot per code. Yours came from the organizer — as a link or a short code.';
    }
  }
  renderCodeNote();

  const submitBtn = el('button', { class: 'btn accent', type: 'button', onclick: submit });
  function updateSubmit() {
    const missingCode = needsCode && !ballotCode.trim();
    const unsigned = isOpen && !voterName.trim();
    submitBtn.disabled = ranked.length === 0 || missingCode || unsigned;
    submitBtn.textContent =
      ranked.length === 0
        ? 'Rank at least one option'
        : missingCode
          ? 'Enter your ballot code'
          : unsigned
            ? 'Sign your ballot to cast it'
            : 'Cast my ballot';
  }
  updateSubmit();

  app.append(
    el(
      'section',
      { class: 'card ballot rise', style: '--i:1' },
      el(
        'div',
        { class: 'ballot-head' },
        el('span', { class: 'official', text: 'Official ballot' }),
        el('p', {
          class: `ballot-privacy${isOpen ? ' open' : ''}`,
          text: isOpen
            ? 'Open ballot — votes are on the record'
            : 'Secret ballot — rankings are anonymous',
        }),
      ),
      el(
        'div',
        { class: 'ballot-body' },
        el('p', {
          class: 'ballot-instruction',
          text: `${
            max === 1
              ? 'Pick your one choice by tapping it below.'
              : `Rank up to ${max} of the ${candidates.length} options — tap to add, drag or use the arrows to reorder.`
          } ${methodByKey[election.method]?.voterLine({ numRanks: max, numWinners: election.numWinners }) ?? ''}`,
        }),
        slots,
        unranked.length > 0
          ? chips
          : el('p', { class: 'ballot-instruction', text: 'All options ranked — remove one if you want to swap.' }),
        el(
          'div',
          { class: 'ballot-foot' },
          needsCode &&
            el(
              'label',
              { class: 'field' },
              el('span', {}, 'Ballot code (required)'),
              codeInput,
              codeNote,
            ),
          el(
            'label',
            { class: 'field' },
            el('span', {}, isOpen ? 'Your name (required)' : 'Your name '),
            nameInput,
            el('span', {
              class: 'hint',
              text: isOpen
                ? 'Open ballot: your name and your full ranking are published with the results.'
                : 'Optional. Only the organizer sees who voted — rankings stay anonymous.',
            }),
          ),
          submitBtn,
          el('span', { class: 'hint', text: 'One ballot per browser. Results stay sealed until the organizer closes voting.' }),
        ),
      ),
    ),
  );
}

function filledSlot(i) {
  const id = ranked[i];
  const name = nameOf(id);
  const li = el(
    'li',
    { class: 'slot filled', draggable: 'true', dataset: { index: String(i) } },
    el('span', { class: 'rank-badge', 'aria-hidden': 'true', text: String(i + 1) }),
    el('span', { class: 'slot-name', text: name }),
    el(
      'span',
      { class: 'slot-controls' },
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Move ${name} up`,
          disabled: i === 0,
          dataset: { focus: `up-${id}` },
          onclick: () => {
            pendingFocus = `up-${id}`;
            move(i, i - 1);
          },
        },
        '↑',
      ),
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Move ${name} down`,
          disabled: i === ranked.length - 1,
          dataset: { focus: `down-${id}` },
          onclick: () => {
            pendingFocus = `down-${id}`;
            move(i, i + 1);
          },
        },
        '↓',
      ),
      el(
        'button',
        {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Remove ${name} from your ranking`,
          onclick: () => {
            ranked.splice(i, 1);
            render();
          },
        },
        '✕',
      ),
    ),
  );

  li.addEventListener('dragstart', (e) => {
    dragFrom = i;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  });
  li.addEventListener('dragend', () => {
    dragFrom = null;
    for (const n of app.querySelectorAll('.drop-target, .dragging')) {
      n.classList.remove('drop-target', 'dragging');
    }
  });
  attachDropTarget(li);
  return li;
}

function emptySlot(i) {
  const li = el(
    'li',
    { class: 'slot', dataset: { index: String(i) } },
    el('span', { class: 'rank-badge', 'aria-hidden': 'true', text: String(i + 1) }),
    el('span', {}, `${ordinal(i + 1)} choice`),
  );
  attachDropTarget(li);
  return li;
}

function attachDropTarget(li) {
  li.addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragFrom == null) return;
    const to = Math.min(Number(li.dataset.index), ranked.length - 1);
    move(dragFrom, to);
  });
}

function move(from, to) {
  if (to < 0 || to >= ranked.length || from === to) {
    render();
    return;
  }
  const [id] = ranked.splice(from, 1);
  ranked.splice(to, 0, id);
  render();
}

async function submit(event) {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await api(`/api/elections/${electionId}/ballots`, {
      method: 'POST',
      body: {
        rankings: ranked,
        voterName: voterName.trim() || undefined,
        ...(data.election.security === 'code' ? { code: ballotCode } : {}),
      },
    });
    submittedNames = ranked.map(nameOf);
    storage.markVoted(electionId, data.election.title);
    data.hasVoted = true;
    data.ballotCount += 1;
    forceBallot = false;
    render();
  } catch (err) {
    toast(err.message, 'error');
    if (err.data?.alreadyVoted) {
      data.hasVoted = true;
      render();
    } else {
      btn.disabled = false;
    }
  }
}

// ---- status panels ----

function renderCast(withRecap) {
  const closed = data.election.status === 'closed';
  app.append(
    el(
      'section',
      { class: 'card panel rise', style: '--i:1' },
      el('span', { class: 'stamp open', text: 'Ballot cast' }),
      el('h2', { text: withRecap ? 'Your ballot is in.' : 'You already voted here.' }),
      el('p', {
        text: closed
          ? 'Voting has ended — the results are public now.'
          : 'Results stay sealed until the organizer closes voting. Keep this page open and it will update on its own.',
      }),
      data.election.ballotPrivacy === 'open' &&
        el('p', { text: 'This was an open ballot — your name and ranking appear on the public record with the results.' }),
      withRecap && submittedNames
        ? el(
            'ol',
            { class: 'recap', 'aria-label': 'Your ranking' },
            submittedNames.map((name, i) =>
              el('li', {}, el('span', { class: 'rank-badge', text: String(i + 1) }), name),
            ),
          )
        : null,
      el(
        'div',
        { class: 'btn-row' },
        el('a', {
          class: closed ? 'btn accent' : 'btn ghost',
          href: `/e/${electionId}/results`,
          text: closed ? 'See the results' : 'Results page',
        }),
        !closed &&
          data.election.security === 'code' &&
          el(
            'button',
            {
              class: 'btn ghost',
              type: 'button',
              onclick: () => {
                forceBallot = true;
                submittedNames = null;
                ranked = [];
                ballotCode = '';
                codeStatus = null;
                voterName = '';
                render();
              },
            },
            'Vote with a different code',
          ),
      ),
    ),
  );
}

function renderNotOpen() {
  app.append(
    el(
      'section',
      { class: 'card panel rise', style: '--i:1' },
      el('span', { class: 'stamp draft', text: 'In setup' }),
      el('h2', { text: 'This election isn’t open yet.' }),
      el('p', { text: 'The organizer is still preparing the ballot. Keep this page open — it will switch over the moment voting begins.' }),
    ),
  );
}

function renderClosed() {
  app.append(
    el(
      'section',
      { class: 'card panel rise', style: '--i:1' },
      el('span', { class: 'stamp closed', text: 'Voting closed' }),
      el('h2', { text: 'Voting has ended.' }),
      el('p', { text: 'This election is decided — head over to see how the runoff played out.' }),
      el('div', { class: 'btn-row' }, el('a', { class: 'btn accent', href: `/e/${electionId}/results`, text: 'See the results' })),
    ),
  );
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
