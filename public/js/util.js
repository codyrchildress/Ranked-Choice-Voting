// Shared helpers: DOM building, API calls, local storage, formatting.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response body
  }
  if (!res.ok) {
    const error = new Error(data?.error ?? `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

let toastTimer;
export function toast(message, kind = 'info') {
  document.querySelector('.toast')?.remove();
  const node = el('div', {
    class: kind === 'error' ? 'toast error' : 'toast',
    role: 'status',
    text: message,
  });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 4000);
}

const MINE_KEY = 'runoff.mine';
const VOTED_KEY = 'runoff.voted';

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode); features degrade gracefully
  }
}

export const storage = {
  mine() {
    return readJson(MINE_KEY, []);
  },
  saveMine(entry) {
    const rest = this.mine().filter((item) => item.id !== entry.id);
    writeJson(MINE_KEY, [entry, ...rest].slice(0, 50));
  },
  removeMine(id) {
    writeJson(MINE_KEY, this.mine().filter((item) => item.id !== id));
  },
  voted() {
    return readJson(VOTED_KEY, {});
  },
  markVoted(id, title) {
    const all = this.voted();
    all[id] = { title, at: Date.now() };
    writeJson(VOTED_KEY, all);
  },
  removeVoted(id) {
    const all = this.voted();
    delete all[id];
    writeJson(VOTED_KEY, all);
  },
};

export function ordinal(n) {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

export function plural(n, noun, plured = `${noun}s`) {
  return `${n} ${n === 1 ? noun : plured}`;
}

export function pct(n, total) {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
}

export function timeString(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const STATUS_LABEL = { draft: 'In setup', open: 'Voting open', closed: 'Voting closed' };

export function statusStamp(status, extraClass = '') {
  return el('span', {
    class: `stamp ${status}${extraClass ? ` ${extraClass}` : ''}`,
    text: STATUS_LABEL[status] ?? status,
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
