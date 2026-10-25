// Tiny helpers so every screen is plain DOM, with no framework and no build step.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && key !== 'list' && key !== 'form') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function toast(message, ms = 2800) {
  const host = document.getElementById('toasts');
  const node = h('div', { class: 'toast' }, message);
  host.append(node);
  setTimeout(() => node.remove(), ms);
}

export function openDialog(content) {
  return new Promise((resolve) => {
    const dialog = h('dialog', {}, content(resolve));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue || null); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** A yes/no question. Resolves true only if the user chose the main button. */
export async function confirmDialog({ title, message = '', confirmText = 'Yes', cancelText = 'Cancel', danger = false }) {
  const result = await openDialog(() => [
    h('h2', {}, title),
    message && h('p', {}, message),
    h('div', { class: 'actions' },
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: (e) => e.target.closest('dialog').close('yes') }, confirmText),
      h('button', { class: 'btn', onclick: (e) => e.target.closest('dialog').close('no'), autofocus: true }, cancelText)),
  ]);
  return result === 'yes';
}

/** A list of big buttons. Resolves with the chosen action's id, or null if dismissed. */
export function sheet({ title, message = '', actions }) {
  return openDialog(() => [
    h('h2', {}, title),
    message && h('p', { class: 'muted' }, message),
    h('div', { class: 'actions' },
      actions.map((a) => h('button', { class: `btn ${a.danger ? 'danger' : a.primary ? 'primary' : ''}${a.selected ? ' selected' : ''}`, onclick: (e) => e.target.closest('dialog').close(a.id), disabled: a.disabled },
        a.label, a.detail && h('span', { class: 'detail' }, a.detail))),
      h('button', { class: 'btn ghost', onclick: (e) => e.target.closest('dialog').close('') }, 'Close')),
  ]);
}

/** Asks for some text. Resolves with the text, or null if cancelled. `validate` returns an error message or ''. */
export function promptDialog({ title, message = '', label, value = '', placeholder = '', confirmText = 'Save', validate }) {
  return openDialog(() => {
    const input = h('input', { type: 'text', value, placeholder, 'aria-label': label, autocomplete: 'off', autofocus: true });
    const error = h('p', { class: 'error', role: 'alert' });
    const submit = (e) => {
      e.preventDefault();
      const problem = validate?.(input.value) ?? '';
      if (problem) { error.textContent = problem; input.focus(); return; }
      e.target.closest('dialog').close(`ok:${input.value}`);
    };
    return h('form', { onsubmit: submit },
      h('h2', {}, title), message && h('p', { class: 'muted' }, message),
      h('label', { class: 'field' }, h('span', {}, label), input), error,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'submit' }, confirmText),
        h('button', { class: 'btn', type: 'button', onclick: (e) => e.target.closest('dialog').close('') }, 'Cancel')));
  }).then((r) => (r && r.startsWith('ok:') ? r.slice(3) : null));
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  volume: '<path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3.2 3.2 0 0 1 0 5.6M18.5 19a5.5 5.5 0 0 0-2.6-4.7"/>',
  spy: '<path d="M3 11.5h18M5.5 11.5l1.4-5.3a1.5 1.5 0 0 1 1.4-1.2h7.4a1.5 1.5 0 0 1 1.4 1.2l1.4 5.3"/><circle cx="8.5" cy="15.5" r="2.6"/><circle cx="15.5" cy="15.5" r="2.6"/><path d="M11.1 15.2h1.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor"/>',
  send: '<path d="M4 12l16-7-6 15-2.5-6z"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  shuffle: '<path d="M4 7h3c4 0 5 10 9 10h4M4 17h3c1.4 0 2.4-1.1 3.2-2.5M20 7h-4c-1.4 0-2.4 1.1-3.2 2.5"/><path d="M18 5l2 2-2 2M18 15l2 2-2 2"/>',
};

/** A small line icon. The shapes above are fixed text written in this file, never user input. */
export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}
export const backLabel = (text) => [icon('back', 20), text];


/** The Hushwords mark: a finger to the lips is hard to draw small, so it is two cards and a whisper. Fixed markup. */
export function logo(size = 28) {
  const span = document.createElement('span');
  span.className = 'logo';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none"><g transform="rotate(-9 28 36)"><rect x="9" y="14" width="34" height="42" rx="6" fill="#d9cdb3" stroke="#0b0e1a" stroke-width="2.5"/></g><g transform="rotate(8 38 32)"><rect x="19" y="8" width="34" height="42" rx="6" fill="#f3ead6" stroke="#0b0e1a" stroke-width="2.5"/><path d="M28 37l6-11 6 11z" fill="#e8453c"/><circle cx="44" cy="40" r="3.6" fill="#3a7bfd"/></g></svg>`;
  return span;
}
