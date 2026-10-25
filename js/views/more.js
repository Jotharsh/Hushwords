import { h, icon } from '../ui.js';
const page = (screen, title, ...body) => screen.replaceChildren(
  h('header', { class: 'topbar' }, h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back' }, icon('back')), h('span', { class: 'brand' }, title)),
  h('article', { class: 'prose' }, ...body));

export function help(screen) {
  page(screen, 'How to play',
    h('h1', {}, 'Find your agents. Avoid the assassin.'),
    h('p', {}, 'Hushwords is a team word game. 25 word cards sit on the table. Secretly, 9 belong to one team, 8 to the other, 7 are bystanders, and 1 is the assassin.'),
    h('h2', {}, 'Setting up'),
    h('ol', {},
      h('li', {}, 'One person opens a room and shares the code. Everyone joins from their own phone or laptop.'),
      h('li', {}, 'Pick a side. Each team needs one spymaster and at least one operative.'),
      h('li', {}, 'The host picks a word pack and starts the game.')),
    h('h2', {}, 'On your turn'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Spymaster: '), 'you can see which cards are yours. Give one word and a number: the word links some of your cards and the number says how many. The word cannot be on the board.'),
      h('li', {}, h('b', {}, 'Operatives: '), 'talk it over, tap a card to point at it (your team sees the pointer), then tap again or press Reveal to commit.'),
      h('li', {}, 'Your own card: keep guessing, up to the number plus one. A bystander or the other team\'s card: your turn ends. The assassin: your team loses at once.'),
      h('li', {}, 'A clue number of 0 means as many guesses as your team likes.')),
    h('h2', {}, 'Winning'),
    h('p', {}, 'The first team to reveal all of its cards wins, or the other team wins if you reveal the assassin.'),
    h('h2', {}, 'Good to know'),
    h('ul', {},
      h('li', {}, 'The room lives on the host\'s device and ends when they close the page. A refresh brings it back.'),
      h('li', {}, 'The secret key is only sent to spymasters. The host\'s own device holds the whole game, so the host should play fair.'),
      h('li', {}, 'Talk over any call app you like. Hushwords is only the table.')),
    h('p', {}, h('a', { class: 'btn primary', href: '#/' }, 'Play now')));
}
export function privacy(screen) {
  page(screen, 'Privacy',
    h('h1', {}, 'Privacy'),
    h('p', {}, 'Hushwords has no server of its own and no accounts. We do not collect, store or sell anything.'),
    h('h2', {}, 'What other players see'),
    h('ul', {}, h('li', {}, 'Your name and your seat are visible to everyone in the room.'),
      h('li', {}, 'Devices connect directly to each other (WebRTC), so players can technically see each other\'s network address. Only play with people you trust.')),
    h('h2', {}, 'Third parties'),
    h('p', {}, 'PeerJS\'s free public broker introduces devices to each other when they connect. It sees connection details, not your game.'),
    h('h2', {}, 'On your device'),
    h('p', {}, 'Your name, a random player ID (so a refresh keeps your seat), your sound setting, recent room codes and, if you host, the room settings are kept in this browser.'));
}
