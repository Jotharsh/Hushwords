// The game, as the host's device keeps it. Pure rules, no browser, so they can be tested.
// Nobody but the host holds the secret key: each player is sent only the view their role may see (see viewFor).
import { CODE_ALPHABET, CODE_LENGTH, MAX_PLAYERS, MAX_NICK, MAX_ROOM_NAME, BOARD, TIMERS } from './config.js';
import { PACKS } from './words.js';

export const HOST = 'host';
export const other = (team) => (team === 'red' ? 'blue' : 'red');
const TEAMS = ['red', 'blue'];

export function newCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}
export const normaliseCode = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
export const cleanText = (t, max, fallback = '') => String(t ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Turns pasted text (commas, new lines) into a clean, unique list of words. */
export function parseCustomWords(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text ?? '').split(/[\n,;]+/)) {
    const w = cleanText(raw, 24).toLowerCase();
    if (w && !seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

export function createRoom({ code = newCode(), name, hostNick = 'Host' } = {}) {
  return {
    code, name: cleanText(name, MAX_ROOM_NAME, 'Hushwords room'),
    settings: { pack: 'classic', custom: '', timer: 0, strict: true },
    phase: 'lobby',
    players: { [HOST]: { nick: cleanText(hostNick, MAX_NICK, 'Host'), team: null, role: null, online: true } },
    game: null, wins: { red: 0, blue: 0 }, nextStart: null, rev: 0,
  };
}

export function join(room, token, nick) {
  const have = room.players[token];
  if (have) { have.nick = uniqueNick(room, cleanText(nick, MAX_NICK, 'Player'), token); have.online = true; room.rev++; return { ok: true }; }
  if (Object.keys(room.players).length >= MAX_PLAYERS) return { ok: false, error: 'full' };
  room.players[token] = { nick: uniqueNick(room, cleanText(nick, MAX_NICK, 'Player'), token), team: null, role: null, online: true };
  room.rev++;
  return { ok: true };
}
function uniqueNick(room, wanted, token) {
  const taken = new Set(Object.entries(room.players).filter(([k]) => k !== token).map(([, p]) => p.nick.toLowerCase()));
  let nick = wanted, n = 2;
  while (taken.has(nick.toLowerCase())) nick = `${wanted.slice(0, MAX_NICK - 3)} ${n++}`;
  return nick;
}

/** Someone's connection dropped. They keep their seat so they can come back; in the lobby it is freed. */
export function disconnect(room, token) {
  const p = room.players[token];
  if (!p || token === HOST) return false;
  if (room.phase === 'lobby') delete room.players[token]; else p.online = false;
  room.rev++;
  return true;
}

export function makeBoard(words, startTeam, random = Math.random) {
  const picked = shuffle(words, random).slice(0, BOARD);
  const owners = [...Array(startTeam === 'red' ? 9 : 8).fill('red'), ...Array(startTeam === 'blue' ? 9 : 8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'];
  const key = shuffle(owners, random);
  return { cards: picked.map((word) => ({ word, revealed: false })), key };
}

export function wordPool(settings) {
  if (settings.pack === 'custom') return parseCustomWords(settings.custom);
  return PACKS[settings.pack]?.words ?? [];
}

const spyOf = (room, team) => Object.entries(room.players).find(([, p]) => p.team === team && p.role === 'spy')?.[0] ?? null;
const opsOf = (room, team) => Object.entries(room.players).filter(([, p]) => p.team === team && p.role === 'op');
export const canStart = (room) => TEAMS.every((t) => spyOf(room, t) && opsOf(room, t).length >= 1);

function beginTurn(room, team, now) {
  const g = room.game;
  g.turn = team; g.clue = null; g.guessesLeft = 0; g.pending = null;
  g.deadline = room.settings.timer ? now + room.settings.timer * 1000 : null;
}

function remaining(game) {
  const left = { red: 0, blue: 0 };
  game.board.cards.forEach((c, i) => { if (!c.revealed && (game.board.key[i] === 'red' || game.board.key[i] === 'blue')) left[game.board.key[i]]++; });
  return left;
}

function startGame(room, now, random) {
  const start = room.nextStart ?? (random() < 0.5 ? 'red' : 'blue');
  room.nextStart = other(start);
  const board = makeBoard(wordPool(room.settings), start, random);
  room.game = { board, startTeam: start, turn: start, clue: null, guessesLeft: 0, pending: null, winner: null, over: false, log: [], deadline: null, endedBy: null };
  room.phase = 'play';
  beginTurn(room, start, now);
}

/** A clue is one word and may not be a word that is still on the board. */
export function checkClue(room, raw) {
  const word = cleanText(raw, 24);
  if (!word) return { ok: false, error: 'clue-empty' };
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(word)) return { ok: false, error: 'clue-one-word' };
  if (room.settings.strict) {
    const w = word.toLowerCase();
    for (const [i, c] of room.game.board.cards.entries()) {
      if (c.revealed) continue;
      const b = c.word.toLowerCase();
      if (w === b || (Math.min(w.length, b.length) >= 3 && (w.includes(b) || b.includes(w)))) return { ok: false, error: 'clue-on-board' };
    }
  }
  return { ok: true, word };
}

function endTurn(room, now, how) {
  const g = room.game;
  g.log.push({ t: how, team: g.turn });
  beginTurn(room, other(g.turn), now);
}

function finish(room, winner, why) {
  const g = room.game;
  g.over = true; g.winner = winner; g.endedBy = why; g.pending = null; g.deadline = null;
  room.phase = 'over'; room.wins[winner]++;
}

/** Applies one request from a player. Returns { ok, error? }. */
export function act(room, token, msg, now = Date.now(), random = Math.random) {
  const me = room.players[token];
  if (!me) return { ok: false, error: 'not-in-room' };
  const g = room.game, isHost = token === HOST;
  const done = () => { room.rev++; return { ok: true }; };

  switch (msg?.type) {
    case 'seat': {                                          // choose a team and a role (lobby only)
      if (room.phase !== 'lobby') return { ok: false, error: 'game-running' };
      if (msg.team === null) { me.team = null; me.role = null; return done(); }
      if (!TEAMS.includes(msg.team) || !['spy', 'op'].includes(msg.role)) return { ok: false, error: 'bad-seat' };
      if (msg.role === 'spy' && spyOf(room, msg.team) && spyOf(room, msg.team) !== token) return { ok: false, error: 'spy-taken' };
      me.team = msg.team; me.role = msg.role; return done();
    }
    case 'assign': {                                        // the host can seat anyone, even mid-game, if a connection dropped
      if (!isHost) return { ok: false, error: 'host-only' };
      const p = room.players[msg.token];
      if (!p) return { ok: false, error: 'gone' };
      if (msg.team === null) { p.team = null; p.role = null; return done(); }
      if (!TEAMS.includes(msg.team) || !['spy', 'op'].includes(msg.role)) return { ok: false, error: 'bad-seat' };
      if (msg.role === 'spy') { const cur = spyOf(room, msg.team); if (cur && cur !== msg.token) return { ok: false, error: 'spy-taken' }; }
      p.team = msg.team; p.role = msg.role; return done();
    }
    case 'settings': {
      if (!isHost) return { ok: false, error: 'host-only' };
      if (room.phase === 'play') return { ok: false, error: 'game-running' };
      const s = room.settings;
      if (msg.pack !== undefined) { if (msg.pack !== 'custom' && !PACKS[msg.pack]) return { ok: false, error: 'bad-pack' }; s.pack = msg.pack; }
      if (msg.custom !== undefined) s.custom = String(msg.custom).slice(0, 6000);
      if (msg.timer !== undefined) { if (!TIMERS.includes(msg.timer)) return { ok: false, error: 'bad-timer' }; s.timer = msg.timer; }
      if (typeof msg.strict === 'boolean') s.strict = msg.strict;
      return done();
    }
    case 'start': {
      if (!isHost) return { ok: false, error: 'host-only' };
      if (room.phase === 'play') return { ok: false, error: 'game-running' };
      if (!canStart(room)) return { ok: false, error: 'need-players' };
      if (wordPool(room.settings).length < BOARD) return { ok: false, error: 'few-words' };
      startGame(room, now, random); return done();
    }
    case 'clue': {
      if (room.phase !== 'play' || g.over) return { ok: false, error: 'not-playing' };
      if (me.role !== 'spy' || me.team !== g.turn) return { ok: false, error: 'not-your-turn' };
      if (g.clue) return { ok: false, error: 'clue-given' };
      const c = checkClue(room, msg.word); if (!c.ok) return c;
      const num = Number(msg.num);
      if (!Number.isInteger(num) || num < 0 || num > 9) return { ok: false, error: 'bad-number' };
      g.clue = { word: c.word, num, by: me.nick, team: g.turn };
      g.guessesLeft = num === 0 ? -1 : num + 1;             // 0 means as many guesses as the team likes
      g.log.push({ t: 'clue', team: g.turn, word: c.word, num, by: me.nick });
      return done();
    }
    case 'select': {                                        // a pointer the whole team can see before anyone commits
      if (room.phase !== 'play' || g.over || !g.clue) return { ok: false, error: 'not-playing' };
      if (me.role !== 'op' || me.team !== g.turn) return { ok: false, error: 'not-your-turn' };
      const i = msg.idx;
      if (!Number.isInteger(i) || i < 0 || i >= BOARD || g.board.cards[i].revealed) return { ok: false, error: 'bad-card' };
      if (g.pending?.idx === i) { if (g.pending.by !== me.nick) { g.pending = { idx: i, by: me.nick }; return done(); } return { ok: true }; }   // always sets, never toggles: a repeated or laggy tap must not undo the pointer
      g.pending = { idx: i, by: me.nick };
      return done();
    }
    case 'deselect': {
      if (room.phase !== 'play' || g.over) return { ok: false, error: 'not-playing' };
      if (me.role !== 'op' || me.team !== g.turn) return { ok: false, error: 'not-your-turn' };
      if (!g.pending) return { ok: true };
      g.pending = null; return done();
    }
    case 'guess': {
      if (room.phase !== 'play' || g.over || !g.clue) return { ok: false, error: 'not-playing' };
      if (me.role !== 'op' || me.team !== g.turn) return { ok: false, error: 'not-your-turn' };
      const i = msg.idx;
      if (!Number.isInteger(i) || i < 0 || i >= BOARD || g.board.cards[i].revealed) return { ok: false, error: 'bad-card' };
      const card = g.board.cards[i], owner = g.board.key[i];
      card.revealed = true; g.pending = null;
      g.log.push({ t: 'guess', team: g.turn, word: card.word, owner, by: me.nick });
      if (owner === 'assassin') { finish(room, other(g.turn), 'assassin'); return done(); }
      const left = remaining(g);
      if (left.red === 0) { finish(room, 'red', 'cleared'); return done(); }
      if (left.blue === 0) { finish(room, 'blue', 'cleared'); return done(); }
      if (owner !== g.turn) { beginTurn(room, other(g.turn), now); return done(); }   // wrong card ends the turn
      if (g.guessesLeft > 0 && --g.guessesLeft === 0) beginTurn(room, other(g.turn), now);
      return done();
    }
    case 'end': {                                           // the operatives stop guessing
      if (room.phase !== 'play' || g.over) return { ok: false, error: 'not-playing' };
      if (me.role !== 'op' || me.team !== g.turn || !g.clue) return { ok: false, error: 'not-your-turn' };
      endTurn(room, now, 'end'); return done();
    }
    case 'timeout': {                                       // sent by the host's own clock only
      if (!isHost || room.phase !== 'play' || g.over || !g.deadline || now < g.deadline) return { ok: false, error: 'no-timeout' };
      endTurn(room, now, 'timeout'); return done();
    }
    case 'again': {
      if (!isHost) return { ok: false, error: 'host-only' };
      if (room.phase !== 'over') return { ok: false, error: 'not-over' };
      room.phase = 'lobby'; room.game = null; return done();
    }
    case 'kick': {
      if (!isHost) return { ok: false, error: 'host-only' };
      if (!room.players[msg.token] || msg.token === HOST) return { ok: false, error: 'gone' };
      delete room.players[msg.token]; return { ...done(), kick: msg.token };
    }
    default: return { ok: false, error: 'unknown' };
  }
}

/**
 * What one player may see. The key (who owns each card) is only included for spymasters,
 * for revealed cards, and once the game is over, so an operative's device never holds it.
 */
export function viewFor(room, token, now = Date.now()) {
  const me = room.players[token] ?? null, g = room.game;
  const seeKey = Boolean(g && (g.over || me?.role === 'spy'));
  return {
    code: room.code, name: room.name, settings: room.settings, phase: room.phase, rev: room.rev, hostNow: now,
    wins: room.wins, canStart: canStart(room),
    me: me ? { token, nick: me.nick, team: me.team, role: me.role, host: token === HOST } : null,
    players: Object.entries(room.players).map(([t, p]) => ({ token: t, nick: p.nick, team: p.team, role: p.role, online: p.online, host: t === HOST })),
    game: g ? {
      cards: g.board.cards.map((c, i) => ({ word: c.word, revealed: c.revealed, owner: c.revealed || seeKey ? g.board.key[i] : null })),
      turn: g.turn, clue: g.clue, guessesLeft: g.guessesLeft, pending: g.pending, winner: g.winner, over: g.over, endedBy: g.endedBy,
      left: remaining(g), startTeam: g.startTeam, log: g.log.slice(-40), deadline: g.deadline,
    } : null,
  };
}

export const snapshot = (room) => ({ code: room.code, name: room.name, settings: room.settings, nick: room.players[HOST].nick, wins: room.wins });
export function restore(saved) {
  const r = createRoom({ code: saved.code, name: saved.name, hostNick: saved.nick });
  r.settings = { ...r.settings, ...(saved.settings ?? {}) }; r.wins = saved.wins ?? r.wins; return r;
}
