import { h, icon, logo, openDialog } from '../ui.js';
import { installMode, promptInstall, dismissInstall, onInstallChange } from '../install.js';
import { newCode, normaliseCode, cleanText, createRoom, snapshot } from '../game.js';
import { CODE_LENGTH, MAX_NICK } from '../config.js';
import * as store from '../store.js';

/** A decorative board that keeps flipping its cards, so the first screen already shows what the game feels like. */
function demoBoard() {
  const kinds = ['red', 'blue', 'neutral', 'red', 'blue', 'red', 'neutral', 'blue', 'red', 'blue', 'red', 'neutral', 'blue', 'red', 'blue', 'neutral', 'red', 'blue', 'red', 'neutral', 'blue', 'red', 'blue', 'neutral', 'assassin'];
  const cells = kinds.map((k, i) => h('i', { class: `mini k-${k}`, style: `--r:${((i * 37) % 9 - 4) / 6}deg;--d:${i * 38}ms` }));
  const wrap = h('div', { class: 'demo', 'aria-hidden': 'true' }, cells);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const flip = () => { const c = cells[Math.floor(Math.random() * 24)]; c.classList.toggle('up'); };
    cells.slice(0, 7).forEach((c, i) => setTimeout(() => c.classList.add('up'), 500 + i * 220));
    wrap._t = setInterval(flip, 700);
  }
  return wrap;
}

function installBox() {
  const box = h('div');
  const draw = () => {
    box.replaceChildren();
    const mode = installMode(); if (!mode) return;
    const text = { prompt: 'Install Hushwords so it opens like any other app.', ios: 'To install: tap the Share button, then "Add to Home Screen".', mac: 'To install: in Safari, choose File, then "Add to Dock".' }[mode];
    box.append(h('div', { class: 'installbox', role: 'note' }, h('p', {}, text), h('div', { class: 'row' },
      mode === 'prompt' && h('button', { class: 'btn primary', onclick: promptInstall }, 'Install'),
      h('button', { class: 'btn ghost', onclick: dismissInstall }, 'Not now'))));
  };
  draw();
  return { node: box, stop: onInstallChange(draw) };
}

function startDialog() {
  return openDialog(() => {
    const nick = h('input', { type: 'text', value: store.nick.get() || '', placeholder: 'Your name', maxLength: MAX_NICK, autocomplete: 'nickname', 'aria-label': 'Your name', required: true });
    return h('form', { onsubmit: (e) => {
      e.preventDefault();
      const who = cleanText(nick.value, MAX_NICK); if (!who) { nick.focus(); return; }
      e.target.closest('dialog').close(who);
    } },
      h('h2', {}, 'Open a room'),
      h('p', { class: 'muted' }, 'You will host it. Friends join with a short code. The room stays open while this page does.'),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), nick),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary big', type: 'submit' }, 'Open the room'),
        h('button', { class: 'btn ghost', type: 'button', onclick: (e) => e.target.closest('dialog').close('') }, 'Cancel')));
  });
}

export async function home(screen, _args, { go }) {
  const install = installBox(), demo = demoBoard();
  const hosting = store.hostRecord.get();
  const code = h('input', { class: 'code-input', type: 'text', placeholder: 'ROOM CODE', maxLength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Room code', oninput: (e) => { e.target.value = normaliseCode(e.target.value); } });
  const err = h('p', { class: 'error', role: 'alert' });
  const start = async () => {
    const who = await startDialog(); if (!who) return;
    store.nick.set(who);
    const room = createRoom({ name: `${who}'s table`, hostNick: who });
    store.hostRecord.set({ ...snapshot(room), fresh: true });
    go(`/r/${room.code}`);
  };
  const recents = store.recent.list();
  screen.replaceChildren(...[
    h('header', { class: 'topbar' }, h('span', { class: 'brand' }, logo(30), 'Hushwords'), h('a', { class: 'toplink', href: '#/help' }, 'How to play')),
    h('section', { class: 'hero' },
      h('p', { class: 'eyebrow' }, h('i', { class: 'dot' }), 'A word game for 4 to 16'),
      h('h1', {}, 'Whisper a clue.', h('br'), h('span', {}, 'Win the table.')),
      h('p', { class: 'lead' }, 'Two teams. One secret grid. Your spymaster gives a single word that links several cards, and your team has to find them before the other side does.'),
      demo),
    install.node,
    hosting && h('div', { class: 'resume' }, h('div', {}, h('span', { class: 'eyebrow' }, 'Your open room'), h('b', {}, hosting.name), h('small', {}, hosting.code)), h('a', { class: 'btn primary', href: `#/r/${hosting.code}` }, 'Resume')),
    h('div', { class: 'deal' },
      h('div', { class: 'module host' }, h('p', { class: 'eyebrow' }, 'Host'), h('button', { class: 'btn primary big', onclick: start }, icon('play', 18), 'Start a room'), h('p', { class: 'muted small' }, 'No account. Free. Nothing is uploaded.')),
      h('form', { class: 'module', onsubmit: (e) => {
        e.preventDefault(); const c = normaliseCode(code.value);
        if (c.length !== CODE_LENGTH) { err.textContent = `A room code has ${CODE_LENGTH} letters and numbers.`; code.focus(); return; }
        go(`/r/${c}`);
      } }, h('p', { class: 'eyebrow' }, 'Join'), h('div', { class: 'joinrow' }, code, h('button', { class: 'btn big', type: 'submit' }, 'Join')), err)),
    recents.length > 0 && h('section', { class: 'recent' }, h('h2', { class: 'eyebrow' }, 'Recent rooms'),
      h('ul', {}, recents.map((r) => h('li', {}, h('a', { href: `#/r/${r.code}` }, h('b', {}, r.name), h('small', {}, r.host ? `${r.code} · yours` : r.code), icon('back', 16)))))),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Split into two teams.'), ' Each team picks a spymaster. Everyone else is an operative.'),
      h('li', {}, h('b', {}, 'The spymaster whispers one word and a number.'), ' Only the spymaster can see which cards belong to whom.'),
      h('li', {}, h('b', {}, 'Operatives guess.'), ' Find all your cards first, and never touch the assassin.')),
    h('footer', { class: 'foot' }, h('a', { href: '#/help' }, 'Rules'), h('a', { href: '#/privacy' }, 'Privacy'),
      h('span', {}, 'An independent word game. Not affiliated with any commercial board game.')),
  ].filter(Boolean));
  return () => { install.stop(); clearInterval(demo._t); };
}
