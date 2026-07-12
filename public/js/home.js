import { api, el, statusStamp, storage, toast } from './util.js';

const form = document.getElementById('create-form');
const optionRows = document.getElementById('option-rows');
const addOptionBtn = document.getElementById('add-option');
const ranksSelect = document.getElementById('num-ranks');

// ---- create form ----

for (let i = 1; i <= 10; i += 1) {
  ranksSelect.append(
    el('option', { value: String(i), selected: i === 3 }, i === 1 ? 'Just one choice' : `Top ${i}`),
  );
}

function addOptionRow(placeholder = 'Add an option') {
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
        if (optionRows.children.length <= 2) {
          toast('An election needs at least two options.', 'error');
          return;
        }
        row.remove();
      },
    }, '✕'),
  );
  optionRows.append(row);
  return input;
}

addOptionRow('e.g. Tacos');
addOptionRow('e.g. Sushi');
addOptionRow('e.g. That Thai place');

addOptionBtn.addEventListener('click', () => {
  if (optionRows.children.length >= 50) {
    toast('Elections are capped at 50 options.', 'error');
    return;
  }
  addOptionRow().focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = form.elements.namedItem('title').value.trim();
  const description = form.elements.namedItem('description').value.trim();
  const candidates = [...optionRows.querySelectorAll('input')]
    .map((input) => input.value.trim())
    .filter(Boolean);

  if (!title) {
    toast('Give your election a title.', 'error');
    return;
  }
  if (candidates.length < 2) {
    toast('Add at least two options.', 'error');
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await api('/api/elections', {
      method: 'POST',
      body: { title, description, numRanks: Number(ranksSelect.value), candidates },
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
