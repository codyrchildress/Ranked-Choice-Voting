import { METHODS, methodByKey } from './methods.js';
import { api, el, statusStamp, storage, toast } from './util.js';

const form = document.getElementById('create-form');
const questionBlocks = document.getElementById('question-blocks');
const addQuestionBtn = document.getElementById('add-question');

// ---- question builder ----

function addOptionRow(container, placeholder = 'Add an option') {
  const input = el('input', { type: 'text', maxlength: '100', placeholder });
  const row = el(
    'div',
    { class: 'option-row' },
    input,
    el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Remove this option',
      onclick: () => {
        if (container.children.length <= 2) {
          toast('A question needs at least two options.', 'error');
          return;
        }
        row.remove();
      },
    }, '✕'),
  );
  container.append(row);
  return input;
}

function addQuestionBlock() {
  const optionRows = el('div', { class: 'option-rows' });
  addOptionRow(optionRows, 'e.g. First option');
  addOptionRow(optionRows, 'e.g. Second option');
  addOptionRow(optionRows, 'e.g. Third option');

  const methodSelect = el(
    'select',
    { class: 'q-method', onchange: () => updateMethodExtras() },
    METHODS.map((m, i) => el('option', { value: m.key, selected: i === 0 }, m.name)),
  );
  const methodHint = el('span', { class: 'hint' });
  const ranksSelect = el(
    'select',
    { class: 'q-ranks' },
    Array.from({ length: 10 }, (_, i) =>
      el('option', { value: String(i + 1), selected: i + 1 === 3 }, i === 0 ? 'Just one choice' : `Top ${i + 1}`),
    ),
  );
  const seatsSelect = el(
    'select',
    { class: 'q-seats' },
    Array.from({ length: 10 }, (_, i) => el('option', { value: String(i + 1), selected: i + 1 === 2 }, `Elect ${i + 1}`)),
  );
  const seatsField = el(
    'label',
    { class: 'field' },
    el('span', { text: 'Seats to fill' }),
    seatsSelect,
    el('span', { class: 'hint', text: 'STV elects this many options.' }),
  );
  function updateMethodExtras() {
    methodHint.textContent = methodByKey[methodSelect.value].explain;
    seatsField.hidden = methodSelect.value !== 'stv';
  }
  updateMethodExtras();

  const block = el(
    'div',
    { class: 'question-block' },
    el(
      'div',
      { class: 'question-block-head' },
      el('strong', { class: 'question-block-title' }),
      el('button', {
        class: 'icon-btn q-remove',
        type: 'button',
        'aria-label': 'Remove this question',
        onclick: () => {
          if (questionBlocks.children.length <= 1) {
            toast('An election needs at least one question.', 'error');
            return;
          }
          block.remove();
          renumberQuestions();
        },
      }, '✕'),
    ),
    el(
      'label',
      { class: 'field' },
      el('span', {}, 'Prompt ', el('small', { class: 'muted', text: '(optional for a single question)' })),
      el('input', { class: 'q-prompt', type: 'text', maxlength: '200', placeholder: 'e.g. Who should be treasurer?' }),
    ),
    el('div', { class: 'field' }, el('span', { text: 'Options' }), optionRows,
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        onclick: () => addOptionRow(optionRows).focus(),
      }, '+ Add option'),
    ),
    el('label', { class: 'field' }, el('span', { text: 'Counting method' }), methodSelect, methodHint),
    seatsField,
    el('label', { class: 'field' }, el('span', { text: 'Ranked choices per voter' }), ranksSelect),
  );
  questionBlocks.append(block);
  renumberQuestions();
  return block;
}

function renumberQuestions() {
  const blocks = [...questionBlocks.children];
  blocks.forEach((block, index) => {
    block.querySelector('.question-block-title').textContent = `Question ${index + 1}`;
    block.querySelector('.q-remove').hidden = blocks.length <= 1;
  });
}

addQuestionBlock();

addQuestionBtn.addEventListener('click', () => {
  if (questionBlocks.children.length >= 20) {
    toast('Elections are capped at 20 questions.', 'error');
    return;
  }
  const block = addQuestionBlock();
  block.querySelector('.q-prompt').focus();
});

// ---- create ----

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = form.elements.namedItem('title').value.trim();
  const description = form.elements.namedItem('description').value.trim();
  if (!title) {
    toast('Give your election a title.', 'error');
    return;
  }

  const questions = [];
  const blocks = [...questionBlocks.children];
  for (const [index, block] of blocks.entries()) {
    const candidates = [...block.querySelectorAll('.option-rows input')]
      .map((input) => input.value.trim())
      .filter(Boolean);
    if (candidates.length < 2) {
      toast(`Question ${index + 1} needs at least two options.`, 'error');
      return;
    }
    questions.push({
      prompt: block.querySelector('.q-prompt').value.trim(),
      method: block.querySelector('.q-method').value,
      numRanks: Number(block.querySelector('.q-ranks').value),
      numWinners: Number(block.querySelector('.q-seats').value),
      candidates,
    });
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await api('/api/elections', {
      method: 'POST',
      body: {
        title,
        description,
        ballotPrivacy: form.elements.namedItem('ballotPrivacy').value,
        security: form.elements.namedItem('security').value,
        questions,
      },
    });
    storage.saveMine({
      id: res.election.id,
      adminToken: res.adminToken,
      title: res.election.title,
      createdAt: Date.now(),
    });
    location.href = `/a/${res.adminToken}`;
  } catch (err) {
    toast(err.message, 'error');
    submitBtn.disabled = false;
  }
});

// ---- your elections ----

async function renderMine() {
  const section = document.getElementById('mine-section');
  const grid = document.getElementById('mine-grid');
  const mine = storage.mine();
  const voted = Object.entries(storage.voted()).filter(([id]) => !mine.some((m) => m.id === id));

  if (mine.length === 0 && voted.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  grid.replaceChildren();

  const cards = [
    ...mine.map((entry) => ({ id: entry.id, kind: 'mine', href: `/a/${entry.adminToken}`, title: entry.title, role: 'organizer' })),
    ...voted.map(([id, info]) => ({ id, kind: 'voted', href: `/e/${id}`, title: info?.title ?? 'Election', role: 'voted' })),
  ].map((item) => {
    const card = el(
      'a',
      { class: 'mine-card', href: item.href },
      el('h3', { text: item.title }),
      el('div', { class: 'meta' }, el('span', { text: item.role }), el('span', { class: 'status-slot' })),
    );
    grid.append(card);
    return { ...item, card };
  });

  await Promise.allSettled(
    cards.map(async ({ id, kind, card }) => {
      try {
        const info = await api(`/api/elections/${id}`);
        card.querySelector('.status-slot').replaceWith(statusStamp(info.election.status));
      } catch (err) {
        if (err.status === 404) {
          if (kind === 'mine') storage.removeMine(id);
          else storage.removeVoted(id);
          card.remove();
        }
      }
    }),
  );

  if (grid.children.length === 0) section.hidden = true;
}

renderMine();

// ---- method explainers ----

const methodsGrid = document.getElementById('methods-grid');
const sealedCard = document.getElementById('sealed-card');
for (const method of METHODS) {
  methodsGrid.insertBefore(
    el(
      'div',
      { class: 'card' },
      el('h3', {}, method.name),
      el('p', { class: 'muted', style: 'font-size:0.8rem; margin:0 0 0.5rem;', text: method.tag }),
      el('p', { text: method.explain }),
    ),
    sealedCard,
  );
}
