import { METHODS, methodByKey } from './methods.js';
import { api, copyText, el, plural, statusStamp, storage, timeString, toast } from './util.js';
import { animateBars, renderResults, renderSignedBallots } from './results-render.js';

const token = location.pathname.split('/')[2];
const app = document.getElementById('app');

let data = null; // { election, candidates, ballotCount, voters, results }
let pollTimer = null;
let deleteArmed = false;
let pendingFocus = null;

init();

async function init() {
  try {
    data = await api(`/api/admin/${token}`);
  } catch (err) {
    renderError(err);
    return;
  }
  document.title = `Admin: ${data.election.title} · Runoff`;
  storage.saveMine({
    id: data.election.id,
    adminToken: token,
    title: data.election.title,
    createdAt: data.election.createdAt,
  });
  render();
}

async function refresh() {
  try {
    data = await api(`/api/admin/${token}`);
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (data?.election.status !== 'open') return;
  pollTimer = setTimeout(async () => {
    try {
      data = await api(`/api/admin/${token}`);
      render();
    } catch {
      schedulePoll();
    }
  }, 15000);
}

function render() {
  clearTimeout(pollTimer);
  deleteArmed = false;
  app.replaceChildren();

  const { election, ballotCount } = data;
  app.append(
    el(
      'div',
      { class: 'page-head rise' },
      el('div', {}, el('h1', { text: election.title }), statusStamp(election.status)),
      election.description && el('p', { class: 'desc', text: election.description }),
      el('p', {
        class: 'count-line',
        text: `${plural(ballotCount, 'ballot')} cast · bookmark this page — the admin link is the only key to this election`,
      }),
    ),
  );

  const left = el('div', { class: 'admin-col' });
  const right = el('div', { class: 'admin-col' });

  left.append(statusCard());
  if (election.security === 'code') left.append(codesCard());
  if (election.status === 'draft') left.append(setupCard());
  if (data.results) left.append(tallyCard());

  right.append(shareCard());
  if (ballotCount > 0) {
    right.append(
      election.ballotPrivacy === 'open' && data.ballots
        ? renderSignedBallots(data.ballots, data.candidates, {
            title: 'Ballots',
            sub: 'Open ballot — these names and rankings are published with the results.',
          })
        : votersCard(),
    );
  }
  right.append(dangerCard());

  app.append(el('div', { class: 'admin-grid rise', style: '--i:1' }, left, right));
  if (data.results) animateBars(app);
  schedulePoll();

  if (pendingFocus) {
    app.querySelector(`[data-focus="${pendingFocus}"]`)?.focus();
    pendingFocus = null;
  }
}

// ---- cards ----

function statusCard() {
  const { election, candidates, ballotCount } = data;
  const card = el('section', { class: 'card' }, el('h2', { text: 'Voting controls' }));

  if (election.status === 'draft') {
    card.append(
      el('p', {
        class: 'card-sub',
        text:
          candidates.length < 2
            ? 'Add at least two options below, then open voting to share the ballot.'
            : `The ballot is ready with ${plural(candidates.length, 'option')}. Voters will rank up to ${Math.min(election.numRanks, candidates.length)}.`,
      }),
      el(
        'div',
        { class: 'btn-row' },
        el(
          'button',
          {
            class: 'btn accent',
            disabled: candidates.length < 2,
            onclick: () => setStatus('open', 'Voting is open — share the voter link!'),
          },
          'Open voting',
        ),
      ),
    );
  } else if (election.status === 'open') {
    card.append(
      el('p', { class: 'card-sub' }, el('span', { class: 'live-note', text: 'Accepting ballots' })),
      el('p', {
        class: 'card-sub',
        text: 'Closing the election publishes the results to everyone with the link. You can reopen it later if you have to.',
      }),
      el(
        'div',
        { class: 'btn-row' },
        el(
          'button',
          { class: 'btn accent', onclick: () => setStatus('closed', 'Voting closed — results are public.') },
          'Close voting & publish results',
        ),
        ballotCount === 0 &&
          el(
            'button',
            { class: 'btn ghost', onclick: () => setStatus('draft', 'Back in setup — the ballot is hidden again.') },
            'Back to setup',
          ),
      ),
    );
  } else {
    card.append(
      el('p', { class: 'card-sub', text: 'Voting is closed and the results are public at the results link.' }),
      el(
        'div',
        { class: 'btn-row' },
        el('a', { class: 'btn', href: `/e/${election.id}/results`, text: 'View public results' }),
        el(
          'button',
          {
            class: 'btn ghost',
            onclick: () => setStatus('open', 'Voting reopened — results are sealed again.'),
          },
          'Reopen voting',
        ),
      ),
    );
  }
  return card;
}

async function setStatus(status, message) {
  try {
    await api(`/api/admin/${token}/status`, { method: 'POST', body: { status } });
    toast(message);
    await refresh();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function setupCard() {
  const { election, candidates } = data;

  const titleInput = el('input', { type: 'text', maxlength: '120', value: election.title });
  const descInput = el('textarea', { maxlength: '2000' });
  descInput.value = election.description;
  const ranksSelect = el(
    'select',
    {},
    Array.from({ length: 10 }, (_, i) =>
      el('option', { value: String(i + 1), selected: election.numRanks === i + 1 },
        i === 0 ? 'Just one choice' : `Top ${i + 1}`),
    ),
  );
  const methodSelect = el(
    'select',
    { onchange: () => updateMethodExtras() },
    METHODS.map((m) => el('option', { value: m.key, selected: election.method === m.key }, m.name)),
  );
  const methodHint = el('span', { class: 'hint' });
  const seatsSelect = el(
    'select',
    {},
    Array.from({ length: 10 }, (_, i) =>
      el('option', { value: String(i + 1), selected: election.numWinners === i + 1 }, `Elect ${i + 1}`),
    ),
  );
  const seatsField = el(
    'label',
    { class: 'field' },
    el('span', { text: 'Seats to fill' }),
    seatsSelect,
    el('span', { class: 'hint', text: 'STV elects this many options. Capped below the number of options when voting opens.' }),
  );
  const privacySelect = el(
    'select',
    {},
    el('option', { value: 'anonymous', selected: election.ballotPrivacy === 'anonymous' }, 'Secret ballot — rankings stay anonymous'),
    el('option', { value: 'open', selected: election.ballotPrivacy === 'open' }, 'Open ballot — votes on the record'),
  );
  const securitySelect = el(
    'select',
    {},
    el('option', { value: 'link', selected: election.security === 'link' }, 'Anyone with the link — one ballot per browser'),
    el('option', { value: 'code', selected: election.security === 'code' }, 'One-time ballot codes — one ballot per code'),
  );
  function updateMethodExtras() {
    methodHint.textContent = methodByKey[methodSelect.value].explain;
    seatsField.hidden = methodSelect.value !== 'stv';
  }
  updateMethodExtras();
  const addInput = el('input', {
    type: 'text',
    maxlength: '100',
    placeholder: 'Add an option…',
    dataset: { focus: 'add-option' },
  });

  return el(
    'section',
    { class: 'card' },
    el('h2', { text: 'Ballot setup' }),
    el('p', { class: 'card-sub', text: 'Options and ballot rules lock while voting is open.' }),
    el(
      'ul',
      { class: 'option-list' },
      candidates.map((c) =>
        el(
          'li',
          {},
          c.name,
          el('span', { class: 'spacer' }),
          el(
            'button',
            { class: 'icon-btn', 'aria-label': `Remove ${c.name}`, onclick: () => removeOption(c) },
            '✕',
          ),
        ),
      ),
    ),
    el(
      'form',
      {
        class: 'copy-row',
        onsubmit: (e) => {
          e.preventDefault();
          addOption(addInput.value);
        },
      },
      addInput,
      el('button', { class: 'btn small', type: 'submit' }, 'Add'),
    ),
    el('div', { style: 'margin-top:1.3rem' },
      el('label', { class: 'field' }, el('span', { text: 'Title' }), titleInput),
      el('label', { class: 'field' }, el('span', { text: 'Description' }), descInput),
      el('label', { class: 'field' }, el('span', { text: 'Counting method' }), methodSelect, methodHint),
      seatsField,
      el('label', { class: 'field' }, el('span', { text: 'Ranked choices per voter' }), ranksSelect),
      el(
        'label',
        { class: 'field' },
        el('span', { text: 'Ballot privacy' }),
        privacySelect,
        el('span', { class: 'hint', text: 'Open ballots require voters to sign, and publish names with rankings in the results.' }),
      ),
      el(
        'label',
        { class: 'field' },
        el('span', { text: 'Voter check' }),
        securitySelect,
        el('span', { class: 'hint', text: 'Ballot codes make voting invite-only: generate single-use codes and hand them out.' }),
      ),
      el(
        'div',
        { class: 'btn-row' },
        el(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              try {
                const res = await api(`/api/admin/${token}`, {
                  method: 'PATCH',
                  body: {
                    title: titleInput.value,
                    description: descInput.value,
                    numRanks: Number(ranksSelect.value),
                    method: methodSelect.value,
                    numWinners: Number(seatsSelect.value),
                    ballotPrivacy: privacySelect.value,
                    security: securitySelect.value,
                  },
                });
                data.election = res.election;
                toast('Details saved.');
                render();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          'Save details',
        ),
      ),
    ),
  );
}

async function addOption(name) {
  if (!name.trim()) return;
  try {
    const res = await api(`/api/admin/${token}/candidates`, {
      method: 'POST',
      body: { name },
    });
    data.candidates = res.candidates;
    pendingFocus = 'add-option';
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeOption(candidate) {
  try {
    const res = await api(`/api/admin/${token}/candidates/${candidate.id}`, { method: 'DELETE' });
    data.candidates = res.candidates;
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function formatCode(code) {
  return `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6)}`;
}

function codesCard() {
  const codes = data.codes ?? [];
  const used = codes.filter((c) => c.usedAt).length;
  const countInput = el('input', { type: 'number', min: '1', max: '100', value: '5' });
  const namesArea = el('textarea', { rows: '3', placeholder: 'Priya\nMarcus\n…' });

  async function generate(body) {
    try {
      const res = await api(`/api/admin/${token}/codes`, { method: 'POST', body });
      data.codes = res.codes;
      toast('Codes generated.');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function revoke(codeId) {
    try {
      const res = await api(`/api/admin/${token}/codes/${codeId}`, { method: 'DELETE' });
      data.codes = res.codes;
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return el(
    'section',
    { class: 'card' },
    el('h2', { text: `Ballot codes (${used} of ${codes.length} used)` }),
    el('p', {
      class: 'card-sub',
      text: 'Each code casts exactly one ballot. Hand them out as personal links or short codes — and keep this list to yourself.',
    }),
    el(
      'form',
      {
        class: 'copy-row',
        onsubmit: (e) => {
          e.preventDefault();
          generate({ count: Number(countInput.value) });
        },
      },
      countInput,
      el('button', { class: 'btn small', type: 'submit' }, 'Generate codes'),
    ),
    el(
      'details',
      { style: 'margin-top:0.6rem' },
      el('summary', { class: 'hint', style: 'cursor:pointer', text: 'Or generate labeled codes — one name per line' }),
      namesArea,
      el(
        'div',
        { class: 'btn-row', style: 'margin-top:0.5rem' },
        el(
          'button',
          {
            class: 'btn small ghost',
            type: 'button',
            onclick: () => {
              const labels = namesArea.value.split('\n').map((line) => line.trim()).filter(Boolean);
              if (labels.length === 0) {
                toast('Add at least one name.', 'error');
                return;
              }
              generate({ labels });
            },
          },
          'Generate labeled codes',
        ),
      ),
    ),
    codes.length === 0
      ? el('p', { class: 'card-sub', style: 'margin-top:0.9rem', text: 'No codes yet — voters can’t get in until you make some.' })
      : el(
          'ul',
          { class: 'code-list' },
          codes.map((code) =>
            el(
              'li',
              { class: code.usedAt ? 'used' : '' },
              el('span', { class: 'code', text: formatCode(code.code) }),
              code.label && el('span', { class: 'label', text: code.label }),
              el('span', { class: 'meta', text: code.usedAt ? `used ${timeString(code.usedAt)}` : 'unused' }),
              !code.usedAt &&
                el(
                  'button',
                  {
                    class: 'btn small ghost',
                    type: 'button',
                    onclick: async () => {
                      const link = `${location.origin}/e/${data.election.id}?code=${formatCode(code.code)}`;
                      if (await copyText(link)) toast('Voting link copied.');
                      else toast('Copy failed — select the code instead.', 'error');
                    },
                  },
                  'Copy link',
                ),
              !code.usedAt &&
                el(
                  'button',
                  { class: 'icon-btn', 'aria-label': `Revoke code ${code.code}`, onclick: () => revoke(code.id) },
                  '✕',
                ),
            ),
          ),
        ),
  );
}

function shareCard() {
  const origin = location.origin;
  const rows = [
    { label: 'Voter link', hint: 'share this one', value: `${origin}/e/${data.election.id}` },
    { label: 'Results link', hint: 'public once closed', value: `${origin}/e/${data.election.id}/results` },
    { label: 'Admin link', hint: 'keep this private', value: `${origin}/a/${token}` },
  ];
  return el(
    'section',
    { class: 'card' },
    el('h2', { text: 'Share' }),
    el('p', { class: 'card-sub', text: 'Anyone with the voter link can cast one ballot per browser — no accounts.' }),
    rows.map(({ label, hint, value }) =>
      el(
        'div',
        {},
        el('div', { class: 'copy-label' }, label, el('small', { text: hint })),
        el(
          'div',
          { class: 'copy-row' },
          el('input', { type: 'text', value, readonly: true, onclick: (e) => e.target.select() }),
          el(
            'button',
            {
              class: 'btn small ghost',
              onclick: async () => {
                if (await copyText(value)) toast('Copied to clipboard.');
                else toast('Copy failed — select the text and copy it manually.', 'error');
              },
            },
            'Copy',
          ),
        ),
      ),
    ),
  );
}

function tallyCard() {
  const live = data.election.status === 'open';
  const holder = el('div', {});
  holder.append(
    renderResults(
      {
        official: data.election.method,
        results: data.results,
        candidates: data.candidates,
        totalBallots: data.ballotCount,
        election: data.election,
      },
      { live },
    ),
  );
  return el(
    'section',
    { class: 'card' },
    el('h2', { text: live ? 'Live tally' : 'Final tally' }),
    live &&
      el('p', { class: 'card-sub', text: 'Only you can see this until you close voting. Refreshes every 15 seconds.' }),
    holder,
  );
}

function votersCard() {
  return el(
    'section',
    { class: 'card' },
    el('h2', { text: `Ballots (${data.ballotCount})` }),
    el('p', { class: 'card-sub', text: 'Names are optional and visible only to you. Rankings stay anonymous.' }),
    el(
      'ul',
      { class: 'voter-list' },
      data.voters.map((v) =>
        el(
          'li',
          {},
          v.name ? el('span', { text: v.name }) : el('span', { class: 'anon', text: 'anonymous' }),
          el('span', { class: 'when', text: timeString(v.createdAt) }),
        ),
      ),
    ),
  );
}

function dangerCard() {
  const btn = el(
    'button',
    {
      class: 'btn danger',
      onclick: async () => {
        if (!deleteArmed) {
          deleteArmed = true;
          btn.textContent = 'Click again to delete forever';
          return;
        }
        try {
          await api(`/api/admin/${token}`, { method: 'DELETE' });
          storage.removeMine(data.election.id);
          location.href = '/';
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
    'Delete this election',
  );
  return el(
    'section',
    { class: 'card danger-zone' },
    el('h2', { text: 'Danger zone' }),
    el('p', { class: 'card-sub', text: 'Deleting removes the election, its options, and every ballot. There is no undo.' }),
    btn,
  );
}

function renderError(err) {
  if (err.status === 404) {
    for (const entry of storage.mine()) {
      if (entry.adminToken === token) storage.removeMine(entry.id);
    }
  }
  app.replaceChildren(
    el(
      'section',
      { class: 'card panel rise' },
      el('span', { class: 'stamp closed', text: 'Not found' }),
      el('h2', { text: 'That admin link isn’t recognized.' }),
      el('p', {
        text:
          err.status === 404
            ? 'The link may be mistyped, or this election was deleted. Admin links are unrecoverable — if it’s lost, create a fresh election.'
            : err.message,
      }),
      el('div', { class: 'btn-row' }, el('a', { class: 'btn', href: '/', text: 'Go home' })),
    ),
  );
}
