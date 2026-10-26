import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, join, disconnect, act, viewFor, makeBoard, canStart, checkClue, parseCustomWords, newCode, normaliseCode, snapshot, restore, HOST } from '../js/game.js';
import { PACKS } from '../js/words.js';

const rng = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const T0 = 1000;

/** host = red spymaster, ann = red operative, bob = blue spymaster, cy = blue operative */
function ready(seed = 7, settings = {}) {
  const room = createRoom({ code: 'ABCDE', name: 'Test', hostNick: 'Hana' });
  join(room, 'ann', 'Ann'); join(room, 'bob', 'Bob'); join(room, 'cy', 'Cy');
  act(room, HOST, { type: 'seat', team: 'red', role: 'spy' }); act(room, 'ann', { type: 'seat', team: 'red', role: 'op' });
  act(room, 'bob', { type: 'seat', team: 'blue', role: 'spy' }); act(room, 'cy', { type: 'seat', team: 'blue', role: 'op' });
  if (Object.keys(settings).length) act(room, HOST, { type: 'settings', ...settings });
  return { room, random: rng(seed) };
}
function started(seed = 7, settings = {}) {
  const ctx = ready(seed, settings);
  assert.equal(act(ctx.room, HOST, { type: 'start' }, T0, ctx.random).ok, true);
  return ctx;
}
const spyToken = (room, team) => Object.entries(room.players).find(([, p]) => p.team === team && p.role === 'spy')[0];
const opToken = (room, team) => Object.entries(room.players).find(([, p]) => p.team === team && p.role === 'op')[0];
const keyIdx = (room, owner) => room.game.board.key.map((o, i) => (o === owner ? i : -1)).filter((i) => i >= 0);
const giveClue = (room, word = 'harbour', num = 2) => act(room, spyToken(room, room.game.turn), { type: 'clue', word, num }, T0);

test('codes are 5 readable characters', () => {
  assert.match(newCode(), /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(normaliseCode(' ab-c d1 2 '), 'ABCD1');
});

test('every pack has plenty of unique, lowercase words', () => {
  for (const [id, p] of Object.entries(PACKS)) {
    assert.ok(p.words.length >= 60, id);
    assert.equal(new Set(p.words).size, p.words.length, `${id} has duplicates`);
    assert.ok(p.words.every((w) => w === w.toLowerCase() && w.length >= 2), id);
  }
});

test('a board has 25 unique words and the right mix of cards for either starting team', () => {
  for (const start of ['red', 'blue']) {
    const { cards, key } = makeBoard(PACKS.classic.words, start, rng(3));
    assert.equal(cards.length, 25); assert.equal(new Set(cards.map((c) => c.word)).size, 25);
    const n = (o) => key.filter((k) => k === o).length;
    assert.equal(n(start), 9); assert.equal(n(start === 'red' ? 'blue' : 'red'), 8); assert.equal(n('neutral'), 7); assert.equal(n('assassin'), 1);
  }
});

test('custom words are cleaned, de-duplicated and counted', () => {
  assert.deepEqual(parseCustomWords('Apple, banana\nAPPLE;  cherry ,, <b>x</b>'), ['apple', 'banana', 'cherry', 'b x /b']);
});

test('seats: one spymaster per team, and no seat changes during a game', () => {
  const room = createRoom({ name: 'x' }); join(room, 'a', 'A'); join(room, 'b', 'B');
  assert.equal(act(room, 'a', { type: 'seat', team: 'red', role: 'spy' }).ok, true);
  assert.equal(act(room, 'b', { type: 'seat', team: 'red', role: 'spy' }).error, 'spy-taken');
  assert.equal(act(room, 'b', { type: 'seat', team: 'green', role: 'op' }).error, 'bad-seat');
  assert.equal(act(room, 'a', { type: 'seat', team: 'red', role: 'spy' }).ok, true);        // same person again is fine
  const { room: r2, random } = started();
  assert.equal(act(r2, 'ann', { type: 'seat', team: 'blue', role: 'op' }).error, 'game-running');
});

test('starting needs a spymaster and an operative on both teams, and the host', () => {
  const room = createRoom({ name: 'x' }); join(room, 'a', 'A');
  assert.equal(canStart(room), false);
  assert.equal(act(room, HOST, { type: 'start' }).error, 'need-players');
  const { room: r } = ready();
  assert.equal(act(r, 'ann', { type: 'start' }).error, 'host-only');
  assert.equal(act(r, HOST, { type: 'settings', pack: 'custom', custom: 'one, two' }).ok, true);
  assert.equal(act(r, HOST, { type: 'start' }).error, 'few-words');
});

test('the start team alternates between games and gets 9 cards', () => {
  const { room, random } = started(11);
  const first = room.game.startTeam;
  assert.equal(keyIdx(room, first).length, 9); assert.equal(room.game.turn, first);
  const spy = spyToken(room, first);
  giveClue(room, 'harbour', 1);
  // blow the game up so we can restart: hit the assassin
  const op = opToken(room, first);
  act(room, op, { type: 'guess', idx: keyIdx(room, 'assassin')[0] }, T0);
  assert.equal(room.phase, 'over'); assert.equal(act(room, HOST, { type: 'again' }).ok, true);
  assert.equal(act(room, HOST, { type: 'start' }, T0, random).ok, true);
  assert.notEqual(room.game.startTeam, first);
});

test('clues: only the current spymaster, once, one word, a sensible number', () => {
  const { room } = started();
  const team = room.game.turn, other = team === 'red' ? 'blue' : 'red';
  assert.equal(act(room, spyToken(room, other), { type: 'clue', word: 'sea', num: 1 }).error, 'not-your-turn');
  assert.equal(act(room, opToken(room, team), { type: 'clue', word: 'sea', num: 1 }).error, 'not-your-turn');
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: 'two words', num: 1 }).error, 'clue-one-word');
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: '', num: 1 }).error, 'clue-empty');
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: 'sea', num: 10 }).error, 'bad-number');
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: 'sea', num: 1.5 }).error, 'bad-number');
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: 'sea', num: 3 }).ok, true);
  assert.equal(room.game.guessesLeft, 4);                                                   // number + 1
  assert.equal(act(room, spyToken(room, team), { type: 'clue', word: 'more', num: 1 }).error, 'clue-given');
});

test('strict clues refuse words on the board, or inside them; loose mode allows them', () => {
  const { room } = started();
  const w = room.game.board.cards[0].word;
  assert.equal(checkClue(room, w).error, 'clue-on-board');
  assert.equal(checkClue(room, w.toUpperCase()).error, 'clue-on-board');
  assert.equal(checkClue(room, w + 's').error, 'clue-on-board');
  room.game.board.cards[0].revealed = true;                                                  // a revealed word is fair game
  assert.equal(checkClue(room, w).ok, true);
  room.settings.strict = false; room.game.board.cards[1].revealed = false;
  assert.equal(checkClue(room, room.game.board.cards[1].word).ok, true);
});

test('guesses need a clue, the right team, and an unrevealed card', () => {
  const { room } = started();
  const team = room.game.turn, op = opToken(room, team), other = opToken(room, team === 'red' ? 'blue' : 'red');
  assert.equal(act(room, op, { type: 'guess', idx: 0 }).error, 'not-playing');              // no clue yet
  giveClue(room, 'harbour', 2);
  assert.equal(act(room, other, { type: 'guess', idx: 0 }).error, 'not-your-turn');
  assert.equal(act(room, spyToken(room, team), { type: 'guess', idx: 0 }).error, 'not-your-turn');
  assert.equal(act(room, op, { type: 'guess', idx: 99 }).error, 'bad-card');
  const mine = keyIdx(room, team)[0];
  assert.equal(act(room, op, { type: 'guess', idx: mine }).ok, true);
  assert.equal(act(room, op, { type: 'guess', idx: mine }).error, 'bad-card');
});

test('a correct guess keeps the turn, a wrong one ends it', () => {
  const { room } = started();
  const team = room.game.turn, op = opToken(room, team), foe = team === 'red' ? 'blue' : 'red';
  giveClue(room, 'harbour', 3);
  act(room, op, { type: 'guess', idx: keyIdx(room, team)[0] });
  assert.equal(room.game.turn, team); assert.equal(room.game.guessesLeft, 3);
  act(room, op, { type: 'guess', idx: keyIdx(room, 'neutral')[0] });
  assert.equal(room.game.turn, foe); assert.equal(room.game.clue, null);
});

test('guessing an opponent card ends the turn and helps them', () => {
  const { room } = started();
  const team = room.game.turn, foe = team === 'red' ? 'blue' : 'red';
  giveClue(room, 'harbour', 2);
  const before = viewFor(room, HOST).game.left[foe];
  act(room, opToken(room, team), { type: 'guess', idx: keyIdx(room, foe)[0] });
  assert.equal(viewFor(room, HOST).game.left[foe], before - 1); assert.equal(room.game.turn, foe);
});

test('the guess allowance runs out after number + 1 right answers, and zero means unlimited', () => {
  const { room } = started(21);
  const team = room.game.turn, op = opToken(room, team), mine = keyIdx(room, team);
  giveClue(room, 'harbour', 1);
  act(room, op, { type: 'guess', idx: mine[0] }); assert.equal(room.game.turn, team);
  act(room, op, { type: 'guess', idx: mine[1] }); assert.notEqual(room.game.turn, team);   // 1 + 1 = two guesses
  const { room: r2 } = started(21);
  const t2 = r2.game.turn, o2 = opToken(r2, t2), m2 = keyIdx(r2, t2);
  giveClue(r2, 'harbour', 0); assert.equal(r2.game.guessesLeft, -1);
  for (let i = 0; i < 5; i++) act(r2, o2, { type: 'guess', idx: m2[i] });
  assert.equal(r2.game.turn, t2);
});

test('the assassin loses the game for the team that touched it', () => {
  const { room } = started();
  const team = room.game.turn;
  giveClue(room, 'harbour', 2);
  act(room, opToken(room, team), { type: 'guess', idx: keyIdx(room, 'assassin')[0] });
  assert.equal(room.game.over, true); assert.equal(room.game.winner, team === 'red' ? 'blue' : 'red');
  assert.equal(room.game.endedBy, 'assassin'); assert.equal(room.phase, 'over');
  assert.equal(room.wins[room.game.winner], 1);
  assert.equal(act(room, opToken(room, team), { type: 'guess', idx: 0 }).error, 'not-playing');
});

test('finding every card of your colour wins, even if the other team revealed the last one', () => {
  const { room } = started(5);
  const team = room.game.turn, foe = team === 'red' ? 'blue' : 'red';
  giveClue(room, 'harbour', 0);
  const mine = keyIdx(room, team);
  mine.slice(0, -1).forEach((i) => { room.game.board.cards[i].revealed = true; });         // all but one already found
  act(room, opToken(room, team), { type: 'guess', idx: mine.at(-1) });
  assert.equal(room.game.winner, team); assert.equal(room.game.endedBy, 'cleared');
  // the other way: the guessing team uncovers the opponent's last card
  const { room: r2 } = started(5);
  const t2 = r2.game.turn, f2 = t2 === 'red' ? 'blue' : 'red';
  giveClue(r2, 'harbour', 0);
  const theirs = keyIdx(r2, f2); theirs.slice(0, -1).forEach((i) => { r2.game.board.cards[i].revealed = true; });
  act(r2, opToken(r2, t2), { type: 'guess', idx: theirs.at(-1) });
  assert.equal(r2.game.winner, f2);
});

test('the pointer is shared and never toggles; deselect clears it; ending the turn passes play on', () => {
  const { room } = started();
  const team = room.game.turn, op = opToken(room, team);
  assert.equal(act(room, op, { type: 'select', idx: 3 }).error, 'not-playing');            // needs a clue first
  giveClue(room, 'harbour', 2);
  act(room, op, { type: 'select', idx: 3 }); assert.deepEqual(room.game.pending, { idx: 3, by: room.players[op].nick });
  const rev = room.rev;
  assert.equal(act(room, op, { type: 'select', idx: 3 }).ok, true);                        // a repeated tap (slow connection) keeps it
  assert.deepEqual(room.game.pending, { idx: 3, by: room.players[op].nick }); assert.equal(room.rev, rev);
  act(room, op, { type: 'select', idx: 4 }); assert.equal(room.game.pending.idx, 4);
  assert.equal(act(room, spyToken(room, team), { type: 'deselect' }).error, 'not-your-turn');
  act(room, op, { type: 'deselect' }); assert.equal(room.game.pending, null);
  act(room, op, { type: 'select', idx: 4 });
  assert.equal(act(room, spyToken(room, team), { type: 'end' }).error, 'not-your-turn');
  assert.equal(act(room, op, { type: 'end' }).ok, true);
  assert.notEqual(room.game.turn, team); assert.equal(room.game.pending, null);
});

test('the turn timer: only the host clock can end a turn, and only after the deadline', () => {
  const { room } = started(7, { timer: 60 });
  const team = room.game.turn;
  assert.equal(room.game.deadline, T0 + 60000);
  assert.equal(act(room, 'ann', { type: 'timeout' }, T0 + 99999).error, 'no-timeout');
  assert.equal(act(room, HOST, { type: 'timeout' }, T0 + 1000).error, 'no-timeout');
  assert.equal(act(room, HOST, { type: 'timeout' }, T0 + 60001).ok, true);
  assert.notEqual(room.game.turn, team); assert.equal(room.game.deadline, T0 + 60001 + 60000);
  assert.equal(act(room, HOST, { type: 'settings', timer: 45 }).error, 'game-running');
});

test('an operative never receives the key; a spymaster does; everyone sees it at the end', () => {
  const { room } = started(13);
  const team = room.game.turn;
  const opView = viewFor(room, opToken(room, team)), spyView = viewFor(room, spyToken(room, team));
  assert.ok(opView.game.cards.every((c) => c.owner === null), 'operative sees owners');
  assert.ok(!JSON.stringify(opView).includes('assassin'));
  assert.equal(spyView.game.cards.filter((c) => c.owner).length, 25);
  assert.equal(viewFor(room, 'ann').game.cards.filter((c) => c.owner).length, room.players.ann.role === 'spy' ? 25 : 0);
  giveClue(room, 'harbour', 1);
  act(room, opToken(room, team), { type: 'guess', idx: keyIdx(room, team)[0] });
  assert.equal(viewFor(room, opToken(room, team)).game.cards.filter((c) => c.owner).length, 1);   // only the revealed card
  act(room, opToken(room, team), { type: 'guess', idx: keyIdx(room, 'assassin')[0] });
  assert.equal(viewFor(room, opToken(room, team)).game.cards.filter((c) => c.owner).length, 25);
});

test('spectators and strangers see no key either', () => {
  const { room } = started();
  join(room, 'watcher', 'Watcher');
  assert.ok(viewFor(room, 'watcher').game.cards.every((c) => c.owner === null));
  assert.equal(viewFor(room, 'nobody').me, null);
  assert.ok(viewFor(room, 'nobody').game.cards.every((c) => c.owner === null));
});

test('reconnecting keeps your seat; leaving the lobby frees it', () => {
  const { room } = started();
  assert.equal(disconnect(room, 'ann'), true);
  assert.equal(room.players.ann.online, false); assert.equal(room.players.ann.role, 'op');
  join(room, 'ann', 'Ann');
  assert.equal(room.players.ann.online, true); assert.equal(room.players.ann.team, 'red');
  const lobby = createRoom({ name: 'x' }); join(lobby, 'z', 'Z'); disconnect(lobby, 'z');
  assert.equal(lobby.players.z, undefined);
});

test('the host can reseat players mid-game, remove them, and nobody else can', () => {
  const { room } = started();
  assert.equal(act(room, 'ann', { type: 'assign', token: 'cy', team: 'red', role: 'op' }).error, 'host-only');
  assert.equal(act(room, HOST, { type: 'assign', token: 'bob', team: 'blue', role: 'op' }).ok, true);
  assert.equal(act(room, HOST, { type: 'assign', token: 'cy', team: 'blue', role: 'spy' }).ok, true);
  assert.equal(act(room, HOST, { type: 'assign', token: 'ann', team: 'red', role: 'spy' }).error, 'spy-taken');
  assert.equal(act(room, 'ann', { type: 'kick', token: 'cy' }).error, 'host-only');
  assert.equal(act(room, HOST, { type: 'kick', token: HOST }).error, 'gone');
  assert.equal(act(room, HOST, { type: 'kick', token: 'cy' }).kick, 'cy');
});

test('the room fills up, and duplicate nicknames get a number', () => {
  const room = createRoom({ name: 'x', hostNick: 'Sam' });
  for (let i = 0; i < 15; i++) assert.equal(join(room, `p${i}`, 'Sam').ok, true);
  assert.equal(join(room, 'late', 'Sam').error, 'full');
  assert.equal(new Set(Object.values(room.players).map((p) => p.nick.toLowerCase())).size, 16);
});

test('play again returns to the lobby and keeps the score and the seats', () => {
  const { room } = started();
  const team = room.game.turn; giveClue(room, 'harbour', 1);
  act(room, opToken(room, team), { type: 'guess', idx: keyIdx(room, 'assassin')[0] });
  assert.equal(act(room, 'ann', { type: 'again' }).error, 'host-only');
  act(room, HOST, { type: 'again' });
  assert.equal(room.phase, 'lobby'); assert.equal(room.game, null);
  assert.equal(room.players.ann.role, 'op'); assert.equal(room.wins[team === 'red' ? 'blue' : 'red'], 1);
});

test('a refresh keeps the code, name and settings', () => {
  const { room } = ready(1, { pack: 'desi', timer: 90 });
  const back = restore(JSON.parse(JSON.stringify(snapshot(room))));
  assert.equal(back.code, 'ABCDE'); assert.equal(back.settings.pack, 'desi'); assert.equal(back.settings.timer, 90);
});
