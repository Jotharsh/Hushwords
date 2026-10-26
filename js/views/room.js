import { h, toast, icon, sheet, confirmDialog } from '../ui.js';
import { HostSession, GuestSession, restore } from '../net.js';
import { normaliseCode, cleanText, snapshot, newCode, parseCustomWords, HOST } from '../game.js';
import { PACKS } from '../words.js';
import { sfx, isMuted, setMuted } from '../sound.js';
import { confetti } from '../confetti.js';
import * as store from '../store.js';
import { CODE_LENGTH, MAX_NICK, TIMERS, BOARD } from '../config.js';

const TEAM_NAME = { red: 'Red', blue: 'Blue' };
const SHAPE = { red: '▲', blue: '●', neutral: '—', assassin: '✕' };
const REJECTIONS = {
  'spy-taken': 'That team already has a spymaster.', 'clue-one-word': 'A clue has to be a single word.', 'clue-on-board': 'That word is on the board, or part of one.',
  'clue-empty': 'Type a clue first.', 'bad-number': 'Pick a number from 0 to 9.', 'not-your-turn': 'It is not your turn to do that.',
  'need-players': 'Each team needs a spymaster and at least one operative.', 'few-words': 'That word pack needs at least 25 words.',
  'game-running': 'You can not change that during a game.', 'host-only': 'Only the host can do that.', 'bad-card': 'That card is already open.',
};
const JOIN_ERRORS = {
  notfound: 'No room has that code. Check it, and ask the host to keep Hushwords open: a room only exists while the host\'s page is open.',
  full: 'This room is full.', offline: 'Could not connect. Check your internet and try again.',
};
const initial = (nick) => (nick.trim()[0] ?? '?').toUpperCase();

export async function roomScreen(screen, [rawCode], { go }) {
  const code = normaliseCode(rawCode);
  let cleanup = () => {};
  const result = () => () => cleanup();
  if (code.length !== CODE_LENGTH) {
    screen.append(h('div', { class: 'card-panel center' }, h('h1', {}, 'That code looks wrong'), h('p', { class: 'muted' }, `Room codes have ${CODE_LENGTH} letters and numbers.`), h('a', { class: 'btn primary', href: '#/' }, 'Back to start')));
    return result();
  }
  const saved = store.hostRecord.get();
  if (saved?.code === code) await startHost(saved);
  else { const remembered = store.joined.get(code); if (remembered) await tryJoin(remembered.nick, true); else showJoin(); }
  return result();

  // ---- joining ---------------------------------------------------------------------------------------------------
  function showJoin(message = '') {
    const nick = h('input', { type: 'text', value: store.nick.get() || '', placeholder: 'Your name', maxLength: MAX_NICK, autocomplete: 'nickname', 'aria-label': 'Your name', required: true });
    const note = h('p', { class: 'error', role: 'alert' }, message);
    const submit = h('button', { class: 'btn primary big', type: 'submit' }, 'Take a seat');
    const form = h('form', { class: 'card-panel', onsubmit: async (e) => {
      e.preventDefault(); const who = cleanText(nick.value, MAX_NICK); if (!who) { nick.focus(); return; }
      submit.disabled = true; submit.textContent = 'Connecting…'; note.textContent = '';
      const problem = await tryJoin(who, false);
      if (problem) { submit.disabled = false; submit.textContent = 'Take a seat'; note.textContent = problem; }
    } }, h('p', { class: 'eyebrow' }, 'You are joining'), h('div', { class: 'code-display' }, [...code].map((c) => h('span', {}, c))),
      h('label', { class: 'field' }, h('span', {}, 'Your name'), nick), note, submit, h('a', { class: 'btn ghost', href: '#/' }, 'Cancel'));
    screen.replaceChildren(h('header', { class: 'topbar' }, h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back' }, icon('back')), h('span', { class: 'brand' }, 'Hushwords')), form);
    nick.focus();
  }

  async function tryJoin(nick, silent) {
    if (silent) screen.replaceChildren(h('div', { class: 'card-panel center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Rejoining the table…')));
    const session = new GuestSession({ code, nick, token: store.token.get() });
    try { await session.connect(); }
    catch (error) {
      session.close(); store.joined.clear(code);
      const message = JOIN_ERRORS[error.reason ?? 'offline'];
      if (silent) showJoin(message);
      return message;
    }
    store.nick.set(nick); store.joined.set(code, { nick });
    store.recent.add({ code, name: session.state.name });
    mount(session); return null;
  }

  async function startHost(record) {
    screen.replaceChildren(h('div', { class: 'card-panel center' }, h('div', { class: 'spinner' }), h('p', { class: 'muted' }, 'Setting the table…')));
    const session = new HostSession(restore(record));
    try { await session.start({ retryFor: record.fresh ? 0 : 15000 }); }
    catch (error) {
      if (error.reason === 'taken' && record.fresh) { const next = { ...record, code: newCode() }; store.hostRecord.set(next); go(`/r/${next.code}`); return; }
      screen.replaceChildren(h('div', { class: 'card-panel center' }, h('h1', {}, error.reason === 'taken' ? 'This room is open somewhere else' : 'Could not open the room'),
        h('p', { class: 'muted' }, error.reason === 'taken' ? 'Close the other tab or device that is hosting it, then try again.' : 'Check your internet and try again.'),
        h('button', { class: 'btn primary', onclick: () => startHost(record) }, 'Try again'), h('a', { class: 'btn ghost', href: '#/' }, 'Back to start')));
      return;
    }
    store.hostRecord.set({ ...snapshot(session.room), fresh: false });
    store.recent.add({ code: record.code, name: record.name, host: true });
    mount(session);
  }

  // ---- the table -------------------------------------------------------------------------------------------------
  function mount(session) {
    const isHost = session.isHost;
    let view = session.state, status = 'live', ended = false;
    let boardSig = '', cards = [], lastLog = '', lastPhase = view.phase, lastSecond = null, shownOver = false, seenTiles = false, lastTicket = '', lastLogLen = 0, lastResult = false;
    const off = [];
    const me = () => view.me;
    const myTurn = () => Boolean(view.game && !view.game.over && me()?.team === view.game.turn);

    // elements that must survive re-renders, so typing is never interrupted
    const clueWord = h('input', { type: 'text', placeholder: 'One-word clue', maxLength: 24, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Your clue' });
    let clueNum = 1;
    const numLabel = h('b', {}, '1');
    const stepper = h('div', { class: 'stepper', role: 'group', 'aria-label': 'How many cards' },
      h('button', { type: 'button', 'aria-label': 'Fewer', onclick: () => setNum(clueNum - 1) }, '−'), numLabel, h('button', { type: 'button', 'aria-label': 'More', onclick: () => setNum(clueNum + 1) }, '+'));
    function setNum(n) { clueNum = Math.min(9, Math.max(0, n)); numLabel.textContent = clueNum === 0 ? '∞' : String(clueNum); }
    const clueForm = h('form', { class: 'clueform', onsubmit: (e) => { e.preventDefault(); const word = clueWord.value; session.request({ type: 'clue', word, num: clueNum }); } },
      clueWord, stepper, h('button', { class: 'btn primary', type: 'submit' }, icon('send', 18), 'Send'));
    const customArea = h('textarea', { rows: 4, placeholder: 'Type or paste words, separated by commas or new lines', 'aria-label': 'Your own words', spellcheck: false });
    let customTimer = null;
    customArea.addEventListener('input', () => { clearTimeout(customTimer); customTimer = setTimeout(() => session.request({ type: 'settings', custom: customArea.value }), 450); });

    const roomChip = h('button', { class: 'codechip', 'aria-label': 'Room code, tap to copy', onclick: copyCode });
    const soundBtn = h('button', { class: 'iconbtn', 'aria-label': 'Sound on or off', onclick: () => { setMuted(!isMuted()); drawSound(); if (!isMuted()) sfx.select(); } });
    const drawSound = () => { soundBtn.replaceChildren(icon(isMuted() ? 'mute' : 'volume')); soundBtn.setAttribute('aria-pressed', String(isMuted())); };
    drawSound();
    const banner = h('div', { class: 'banner', hidden: true }, 'Reconnecting to the table…');
    const lobbyEl = h('section', { class: 'lobby' }), gameEl = h('section', { class: 'game', hidden: true });
    const stage = h('div', { class: 'stage' }, lobbyEl, gameEl);
    const flash = h('div', { class: 'flash', 'aria-hidden': 'true' });

    screen.replaceChildren(
      h('header', { class: 'gbar' },
        h('button', { class: 'iconbtn', 'aria-label': 'Leave the room', onclick: leaveRoom }, icon('back')), roomChip,
        h('button', { class: 'iconbtn', 'aria-label': 'Players', onclick: openPlayers }, icon('users')), soundBtn,
        h('button', { class: 'iconbtn', 'aria-label': 'Room menu', onclick: openMenu }, icon('dots'))),
      banner, stage, flash);

    // ---------- lobby ----------
    const chip = (p, extra = '') => h('span', { class: `chip ${p.team ?? ''} ${p.online ? '' : 'away'} ${extra}` },
      h('i', { class: 'av' }, initial(p.nick)), h('span', { class: 'nm' }, p.nick, p.token === me()?.token ? h('em', {}, ' you') : null), p.host ? h('small', { class: 'tag' }, 'host') : null);

    function teamPanel(team) {
      const members = view.players.filter((p) => p.team === team);
      const spy = members.find((p) => p.role === 'spy'), ops = members.filter((p) => p.role === 'op');
      const mine = me(), here = mine?.team === team;
      const sit = (role) => session.request({ type: 'seat', team, role });
      return h('div', { class: `team ${team}` },
        h('div', { class: 'team-h' }, h('i', { class: 'shape' }, SHAPE[team]), h('b', {}, `${TEAM_NAME[team]} team`), h('span', { class: 'wins', title: 'Games won' }, view.wins[team] ? `${view.wins[team]} ${view.wins[team] === 1 ? 'win' : 'wins'}` : '')),
        h('div', { class: 'seat' }, h('span', { class: 'role' }, icon('spy', 18), 'Spymaster'),
          spy ? chip(spy, 'big') : h('button', { class: 'sit', onclick: () => sit('spy') }, '+ Take this seat')),
        h('div', { class: 'seat' }, h('span', { class: 'role' }, icon('eye', 18), 'Operatives'),
          h('div', { class: 'chips' }, ops.map((p) => chip(p)), h('button', { class: 'sit', onclick: () => sit('op') }, ops.length ? '+ Join' : '+ Join as operative'))),
        here ? h('button', { class: 'leave', onclick: () => session.request({ type: 'seat', team: null }) }, 'Leave this team') : null);
    }

    function renderLobby() {
      const s = view.settings, host = view.players.find((p) => p.host);
      const bench = view.players.filter((p) => !p.team);
      const packButtons = [...Object.entries(PACKS).map(([id, p]) => [id, p.label]), ['custom', 'Your own']].map(([id, label]) =>
        h('button', { class: `opt ${s.pack === id ? 'on' : ''}`, disabled: !isHost, 'aria-pressed': String(s.pack === id), onclick: () => session.request({ type: 'settings', pack: id }) }, label));
      const count = parseCustomWords(customArea.value || s.custom).length;
      if (document.activeElement !== customArea && customArea.value !== s.custom) customArea.value = s.custom;
      customArea.disabled = !isHost;
      const timerButtons = TIMERS.map((t) => h('button', { class: `opt ${s.timer === t ? 'on' : ''}`, disabled: !isHost, 'aria-pressed': String(s.timer === t), onclick: () => session.request({ type: 'settings', timer: t }) }, t === 0 ? 'Off' : t < 120 ? `${t}s` : `${t / 60}m`));
      const strict = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.strict, disabled: !isHost, role: 'switch', onchange: (e) => session.request({ type: 'settings', strict: e.target.checked }) }), h('i', {}), h('span', {}, 'Check clues against the board'));
      lobbyEl.replaceChildren(...[
        h('div', { class: 'invite' }, h('p', { class: 'eyebrow' }, 'Room code'),
          h('button', { class: `tiles ${seenTiles ? 'still' : ''}`, 'aria-label': 'Copy the room code', onclick: copyCode }, [...view.code].map((c, i) => h('span', { style: `--i:${i}` }, c))),
          h('div', { class: 'invite-actions' }, h('button', { class: 'btn', onclick: share }, icon('share', 18), 'Invite friends'), h('button', { class: 'btn ghost', onclick: copyCode }, icon('copy', 18), 'Copy code'))),
        h('div', { class: 'teams' }, teamPanel('red'), teamPanel('blue')),
        bench.length ? h('div', { class: 'bench' }, h('p', { class: 'eyebrow' }, 'Watching from the bench'), h('div', { class: 'chips' }, bench.map((p) => chip(p)))) : null,
        h('div', { class: 'settings' },
          h('p', { class: 'eyebrow' }, isHost ? 'Table settings' : `Table settings · set by ${host?.nick ?? 'the host'}`),
          h('div', { class: 'set' }, h('span', {}, 'Words'), h('div', { class: 'opts' }, packButtons)),
          s.pack === 'custom' ? h('div', { class: 'set col' }, customArea, h('small', { class: count >= BOARD ? 'ok' : 'low' }, `${count} words${count >= BOARD ? '' : ` (need ${BOARD})`}`)) : null,
          h('div', { class: 'set' }, h('span', {}, icon('clock', 16), 'Turn timer'), h('div', { class: 'opts' }, timerButtons)),
          h('div', { class: 'set' }, strict)),
        isHost
          ? h('div', { class: 'startbar' }, h('button', { class: 'btn primary big pulse', disabled: !view.canStart, onclick: () => session.request({ type: 'start' }) }, icon('play', 20), 'Start the game'),
              !view.canStart ? h('small', {}, 'Each team needs a spymaster and at least one operative.') : null)
          : h('div', { class: 'startbar' }, h('p', { class: 'wait' }, view.canStart ? `Waiting for ${host?.nick ?? 'the host'} to start…` : 'Pick a team and a seat while you wait.'))].filter(Boolean));
    }

    // ---------- the game ----------
    const hexSeed = (i) => ((i * 53 + 11) % 13 - 6) / 9;     // a small, fixed tilt for each card
    function buildBoard(g) {
      boardSig = g.cards.map((c) => c.word).join('|');
      const grid = h('div', { class: 'board', role: 'grid', 'aria-label': 'Word cards' });
      cards = g.cards.map((c, i) => {
        const el = h('button', { class: 'card deal', role: 'gridcell', style: `--i:${i};--r:${hexSeed(i)}deg`, onclick: () => tapCard(i) },
          h('span', { class: 'flipper' },
            h('span', { class: 'face front' }, h('b', { class: 'w' }, c.word), h('i', { class: 'key' })),
            h('span', { class: 'face back' }, h('i', { class: 'big' }), h('b', { class: 'w' }, c.word))));
        setTimeout(() => el.classList.remove('deal'), 900 + i * 28);
        return el;
      });
      grid.append(...cards); return grid;
    }
    function paintCards(g) {
      const spy = me()?.role === 'spy';
      g.cards.forEach((c, i) => {
        const el = cards[i];
        el.className = ['card', c.revealed ? `revealed o-${c.owner}` : '', !c.revealed && c.owner ? `k-${c.owner}` : '', g.pending?.idx === i ? 'pending' : '', c.word.length >= 9 ? 'long' : '', el.classList.contains('deal') ? 'deal' : ''].filter(Boolean).join(' ');
        if (c.owner) el.dataset.owner = c.owner; else delete el.dataset.owner;
        if (g.pending?.idx === i) el.dataset.by = g.pending.by; else delete el.dataset.by;
        el.querySelector('.w').textContent = c.word.toUpperCase();
        el.querySelector('.back .w').textContent = c.word.toUpperCase();
        el.querySelector('.key').textContent = !c.revealed && c.owner ? SHAPE[c.owner] : '';
        el.querySelector('.big').textContent = c.owner ? SHAPE[c.owner] : '';
        el.setAttribute('aria-label', `${c.word}${c.revealed ? `, ${c.owner}` : spy && c.owner ? `, ${c.owner} (secret)` : ''}`);
        el.disabled = c.revealed;
      });
    }
    // The first tap points; a second, deliberate tap on the same card reveals it. We remember our own pointer locally the
    // instant we tap, so a slow connection can never make the second tap look like a fresh first tap.
    let myPointer = null, pointerAt = 0;
    function tapCard(i) {
      const g = view.game;
      if (!g || g.over || !myTurn() || me().role !== 'op' || !g.clue || g.cards[i].revealed) return;
      const pointed = g.pending?.idx === i || (myPointer === i && Date.now() - pointerAt < 20000);
      if (pointed) {
        if (Date.now() - pointerAt < 450) return;                 // a double-tap is not a confirmation
        myPointer = null; session.request({ type: 'guess', idx: i }); return;
      }
      myPointer = i; pointerAt = Date.now(); sfx.select(); session.request({ type: 'select', idx: i });
    }

    const timerEl = h('span', { class: 'timer' });
    function scorePanel(team, g) {
      const total = team === g.startTeam ? 9 : 8, left = g.left[team];
      return h('div', { class: `score ${team} ${g.turn === team && !g.over ? 'active' : ''}` },
        h('i', { class: 'shape' }, SHAPE[team]), h('b', { class: 'num' }, String(left)),
        h('span', { class: 'pips', 'aria-hidden': 'true' }, Array.from({ length: total }, (_, k) => h('i', { class: k < total - left ? 'gone' : '' }))),
        h('small', {}, `${TEAM_NAME[team]}${view.wins[team] ? ` · ${view.wins[team]} win${view.wins[team] === 1 ? '' : 's'}` : ''}`));
    }
    function renderGame() {
      const g = view.game, m = me();
      if (boardSig && boardSig !== g.cards.map((c) => c.word).join('|')) { lastLog = ''; shownOver = false; }   // a new deal
      const board = boardSig === g.cards.map((c) => c.word).join('|') ? gameEl.querySelector('.board') : null;
      const grid = board ?? buildBoard(g);
      if (!g.pending || g.over || !myTurn()) myPointer = null;
      paintCards(g);

      const ticketKey = g.clue ? `${g.turn}:${g.clue.word}:${g.clue.num}` : `none:${g.turn}:${g.over}`;
      const ticketNew = ticketKey !== lastTicket; lastTicket = ticketKey;
      const resultNew = g.over && !lastResult; lastResult = g.over;
      const logNew = g.log.length !== lastLogLen; lastLogLen = g.log.length;
      const turnText = g.over ? 'Game over' : g.clue ? `${TEAM_NAME[g.turn]} is guessing` : `${TEAM_NAME[g.turn]}'s spymaster is thinking`;
      const ticket = g.clue
        ? h('div', { class: `ticket ${g.clue.team} ${ticketNew ? 'fresh' : ''}` }, h('span', { class: 'cw' }, g.clue.word), h('span', { class: 'cn' }, g.clue.num === 0 ? '∞' : String(g.clue.num)),
            h('small', {}, g.over ? `Clue by ${g.clue.by}` : g.guessesLeft < 0 ? 'Guess as many as you like' : `${g.guessesLeft} guess${g.guessesLeft === 1 ? '' : 'es'} left`))
        : h('div', { class: `ticket empty ${g.over ? '' : g.turn} ${ticketNew ? 'fresh' : ''}` }, h('span', { class: 'cw' }, g.over ? '' : '…'), h('small', {}, turnText));

      let actions;
      const role = m?.role, team = m?.team;
      if (g.over) actions = null;
      else if (!team) actions = h('p', { class: 'hint' }, 'You are watching from the bench.');
      else if (role === 'spy' && myTurn() && !g.clue) actions = h('div', { class: 'act spy' }, h('p', { class: 'hint' }, h('b', {}, 'Your move, spymaster. '), 'One word, and how many cards it links.'), clueForm);
      else if (role === 'spy' && myTurn()) actions = h('p', { class: 'hint' }, 'Clue sent. Keep a straight face while your team guesses.');
      else if (role === 'op' && myTurn() && g.clue) {
        const idx = g.pending?.idx;
        actions = h('div', { class: 'act op' },
          h('button', { class: 'btn primary big', disabled: idx == null, onclick: () => { myPointer = null; session.request({ type: 'guess', idx }); } }, idx != null ? `Reveal ${g.cards[idx].word.toUpperCase()}` : 'Tap a card to point at it'),
          h('div', { class: 'subrow' },
            idx != null ? h('button', { class: 'btn', 'aria-label': 'Cancel the pointer', onclick: () => { myPointer = null; session.request({ type: 'deselect' }); } }, icon('x', 18), 'Cancel') : null,
            h('button', { class: 'btn', onclick: () => session.request({ type: 'end' }) }, icon('flag', 18), 'End turn')));
      } else if (role === 'op' && myTurn()) actions = h('p', { class: 'hint' }, 'Waiting for your spymaster\'s clue…');
      else actions = h('p', { class: 'hint' }, `${TEAM_NAME[g.turn]} is playing. ${role === 'spy' ? 'Watch their guesses.' : 'Stay quiet and watch.'}`);

      const you = m?.team ? `You: ${TEAM_NAME[m.team]} ${m.role === 'spy' ? 'spymaster' : 'operative'}` : 'Spectating';
      const log = h('ol', { class: `log ${logNew ? 'newest' : ''}`, 'aria-label': 'What has happened' }, [...g.log].reverse().slice(0, 8).map((e) => logLine(e)));
      const result = g.over ? resultCard(g, resultNew) : null;

      gameEl.replaceChildren(
        h('div', { class: 'scoreboard' }, scorePanel('red', g), h('div', { class: 'mid' }, h('span', { class: `turnpill ${g.over ? g.winner : g.turn}` }, g.over ? `${TEAM_NAME[g.winner]} wins` : `${TEAM_NAME[g.turn]} to play`), timerEl, h('small', { class: 'you' }, you)), scorePanel('blue', g)),
        ...[result, ticket, grid, actions, log].filter(Boolean));
      gameEl.classList.toggle('is-over', g.over);
      gameEl.classList.toggle('can-pick', Boolean(!g.over && myTurn() && role === 'op' && g.clue));
    }
    function logLine(e) {
      const t = TEAM_NAME[e.team];
      if (e.t === 'clue') return h('li', { class: e.team }, h('i', {}, SHAPE[e.team]), h('span', {}, `${e.by} whispered `, h('b', {}, `${e.word} ${e.num === 0 ? '∞' : e.num}`)));
      if (e.t === 'guess') return h('li', { class: e.owner }, h('i', {}, SHAPE[e.owner]), h('span', {}, `${e.by} opened `, h('b', {}, e.word.toUpperCase()), e.owner === 'assassin' ? ' — the assassin!' : e.owner === 'neutral' ? ' — a bystander' : e.owner === e.team ? '' : ` — ${TEAM_NAME[e.owner]}'s card`));
      return h('li', { class: 'meta' }, h('i', {}, '·'), h('span', {}, e.t === 'timeout' ? `${t} ran out of time` : `${t} ended their turn`));
    }
    function resultCard(g, fresh) {
      const loser = g.winner === 'red' ? 'blue' : 'red';
      return h('div', { class: `result ${g.winner} ${fresh ? 'fresh' : ''}` },
        h('p', { class: 'eyebrow' }, g.endedBy === 'assassin' ? 'The assassin struck' : 'All agents contacted'),
        h('h2', {}, `${TEAM_NAME[g.winner]} team wins`),
        h('p', { class: 'muted' }, g.endedBy === 'assassin' ? `${TEAM_NAME[loser]} opened the assassin.` : `${TEAM_NAME[g.winner]} found every one of its agents.`),
        isHost ? h('button', { class: 'btn primary big', onclick: () => session.request({ type: 'again' }) }, icon('shuffle', 18), 'Play again') : h('p', { class: 'wait' }, 'Waiting for the host to deal again…'));
    }

    // ---------- effects ----------
    function effects(prev, now) {
      const g = now.game;
      if (!g) { lastLog = ''; return; }
      const last = g.log.at(-1), key = last ? `${g.log.length}:${JSON.stringify(last)}` : '';
      if (key && key !== lastLog && lastLog !== '' ) {
        if (last.t === 'guess') {
          if (last.owner === 'assassin') { sfx.boom(); document.body.classList.add('shake'); flash.className = 'flash on'; setTimeout(() => { document.body.classList.remove('shake'); flash.className = 'flash'; }, 900); }
          else if (last.owner === last.team) sfx.good(); else sfx.wrong();
        } else if (last.t === 'clue') sfx.clue(); else sfx.turn();
      }
      lastLog = key || lastLog || ' ';
      if (g.over && !shownOver) {
        shownOver = true;
        const mineWon = now.me?.team === g.winner;
        setTimeout(() => { if (mineWon || !now.me?.team) { sfx.win(); confetti(g.winner === 'red' ? ['#ec4a3f', '#ff8a6a', '#f6eedb', '#f2c25b'] : ['#3b82f6', '#7fb0ff', '#f6eedb', '#f2c25b']); } else sfx.lose(); }, g.endedBy === 'assassin' ? 900 : 350);
      }
    }
    function setGlow(v) {
      const g = v.game;
      if (g && !g.over) document.documentElement.dataset.turn = g.turn;
      else if (g?.over) document.documentElement.dataset.turn = g.winner;
      else document.documentElement.removeAttribute('data-turn');
    }

    function render(v) {
      const prev = view; view = v;
      roomChip.replaceChildren(h('span', { class: 'lbl' }, 'Room'), h('b', {}, v.code));
      const playing = v.phase !== 'lobby' && v.game;
      lobbyEl.hidden = Boolean(playing); gameEl.hidden = !playing;
      if (playing) renderGame(); else { renderLobby(); seenTiles = true; boardSig = ''; lastLog = ''; shownOver = false; lastTicket = ''; lastLogLen = 0; lastResult = false; }
      setGlow(v); effects(prev, v);
      if (isHost) { store.hostRecord.set({ ...snapshot(session.room), fresh: false }); }
    }

    // ---------- menus ----------
    async function copyCode() { try { await navigator.clipboard.writeText(code); toast('Code copied'); } catch { toast(code, 5000); } }
    async function share() {
      const url = `${location.origin}${location.pathname}#/r/${code}`;
      try { if (navigator.share) { await navigator.share({ title: 'Hushwords', text: `Join my Hushwords table: ${view.code}`, url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { toast(url, 6000); }
    }
    async function openMenu() {
      const choice = await sheet({ title: view.name, message: `Room code ${code}`, actions: [
        { id: 'share', label: 'Invite friends', primary: true }, { id: 'code', label: 'Copy the room code' }, { id: 'help', label: 'How to play' },
        isHost ? { id: 'end', label: 'Close the room for everyone', danger: true } : { id: 'leave', label: 'Leave the table', danger: true }] });
      if (choice === 'share') share(); else if (choice === 'code') copyCode(); else if (choice === 'help') go('/help'); else if (choice === 'end' || choice === 'leave') leaveRoom();
    }
    async function openPlayers() {
      const rows = view.players.map((p) => ({ id: p.token, label: `${p.nick}${p.token === me()?.token ? ' (you)' : ''}`, detail: p.team ? `${TEAM_NAME[p.team]} ${p.role === 'spy' ? 'spymaster' : 'operative'}${p.online ? '' : ' · offline'}` : p.online ? 'bench' : 'bench · offline', disabled: !isHost || p.token === HOST }));
      const pick = await sheet({ title: 'Players', message: isHost ? 'Tap a player to move or remove them.' : '', actions: rows });
      if (!pick || !isHost) return;
      const p = view.players.find((x) => x.token === pick); if (!p) return;
      const move = await sheet({ title: p.nick, actions: [
        { id: 'red-spy', label: 'Red spymaster' }, { id: 'red-op', label: 'Red operative' }, { id: 'blue-spy', label: 'Blue spymaster' }, { id: 'blue-op', label: 'Blue operative' },
        { id: 'bench', label: 'Move to the bench' }, { id: 'kick', label: 'Remove from the room', danger: true }] });
      if (!move) return;
      if (move === 'kick') session.request({ type: 'kick', token: pick });
      else if (move === 'bench') session.request({ type: 'assign', token: pick, team: null });
      else { const [team, role] = move.split('-'); session.request({ type: 'assign', token: pick, team, role }); }
    }
    async function leaveRoom() {
      if (isHost) {
        if (!(await confirmDialog({ title: 'Close the room?', message: 'The game ends for everyone. A room only exists while you keep this page open.', confirmText: 'Close room', cancelText: 'Keep playing', danger: true }))) return;
        store.hostRecord.clear(); store.recent.remove(code); session.close();
      } else store.joined.clear(code);
      go('/');
    }

    // ---------- wiring ----------
    off.push(session.on('update', render));
    off.push(session.on('rejected', (d) => toast(REJECTIONS[d.error] ?? 'That did not work.')));
    off.push(session.on('status', (s) => { status = s; banner.hidden = s === 'live'; }));
    off.push(session.on('closed', ({ reason }) => {
      ended = true; store.joined.clear(code); document.documentElement.removeAttribute('data-turn');
      screen.replaceChildren(h('div', { class: 'card-panel center' }, h('h1', {}, reason === 'kicked' ? 'You were removed' : reason === 'lost' ? 'Lost the table' : 'The room has closed'),
        h('p', { class: 'muted' }, reason === 'kicked' ? 'The host removed you from this room.' : reason === 'lost' ? 'We could not reach the host any more. Their connection may have dropped.' : 'The host closed the room.'), h('a', { class: 'btn primary', href: '#/' }, 'Back to start')));
    }));
    // host-only: failed actions come back synchronously, so surface them too
    if (isHost) { const req = session.request.bind(session); session.request = (m) => { const r = req(m); if (!r.ok) toast(REJECTIONS[r.error] ?? 'That did not work.'); return r; }; }
    const timer = setInterval(() => {
      const g = view.game; if (!g || g.over || !g.deadline) { timerEl.textContent = ''; timerEl.className = 'timer'; return; }
      const left = Math.max(0, Math.ceil((g.deadline - session.hostNow()) / 1000));
      timerEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      timerEl.className = `timer ${left <= 10 ? 'warn' : ''}`;
      if (left !== lastSecond) { lastSecond = left; if (left <= 5 && left > 0 && myTurn()) sfx.tick(); }
    }, 250);
    shownOver = Boolean(view.game?.over);        // joining a finished game should not replay the fanfare
    render(view);

    cleanup = () => { clearInterval(timer); clearTimeout(customTimer); off.forEach((f) => f()); ended = true; session.close(); document.body.classList.remove('shake'); };
  }
}
