# Hushwords

A team word game for friends, in the browser. Two teams share a grid of 25 word cards. Each team's spymaster knows which cards are theirs and whispers a one-word clue plus a number; the operatives guess. Find all your cards first and never touch the assassin.

No account, no server of ours, free to host. Talk over any call app you like: Hushwords is only the table.

## How it works
- **The host's browser is the game.** It holds the secret key and sends each player only their own view: the owners of the cards go to spymasters, never to operatives, until a card is revealed or the game ends. Guests connect straight to the host over WebRTC through PeerJS's free public broker.
- **Refresh safe.** A random player ID kept in the browser holds your seat, so a refresh or a dropped connection puts you back where you were. The host's room (code, settings) is also kept.
- **Premium to play.** 3D card flips, a turn light that follows the active team, a ticket-style clue, a shared pointer so a team can agree before revealing, synthesized sound effects, haptics, and confetti. Respects reduced-motion.

## Limits (honest)
- The room ends when the host closes the page. Up to 16 players.
- The host's device holds the whole game, including the key, so a determined host could peek. It is a game among friends, not a tournament.
- Free STUN only: on some mobile networks a direct connection is not possible and a guest may not be able to join.
- Word lists are original, written for this game. This is an independent word game, not affiliated with any commercial board game.

## Run
No build step. Serve the folder with any static server (for example `npx serve .`) and open it in two browsers (one in a private window).

## Test
`node --test test/` covers the rules: the key never reaching operatives, clue checks, turn flow, the assassin, win conditions, the timer, reconnecting and reseating. The end-to-end run (four real browsers, real WebRTC) used puppeteer-core and is not part of the repo.

Set in Bricolage Grotesque and Space Mono (SIL OFL, in `fonts/`). PeerJS is MIT licensed (`vendor/`). MIT licensed.
