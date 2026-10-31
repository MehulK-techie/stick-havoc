# Stick Havoc: Tournament Edition

An offline LAN stick-figure brawler for 2 to 10 players. One computer hosts;
everyone else plays in a browser (Chrome, Firefox, Safari, Edge; Windows,
macOS, Linux, Android, iOS). No internet, no installs on the players' side.

## Host a game

```sh
npm install      # once (express, ws, qrcode-terminal: plain JavaScript)
npm start        # or: node server.js   (PORT=4000 npm start for another port)
```

The terminal prints the addresses to join (`http://192.168.x.x:3000`) and a
QR code; the join screen shows the same QR. Everyone must be on the same
Wi-Fi or phone hotspot (no internet needed). If nobody can connect, the
host's firewall is blocking port 3000: on Fedora,
`sudo firewall-cmd --add-port=3000/tcp` (for this session).

## Controls

| | Keyboard | Phone |
|---|---|---|
| Move | `A` `D` or `←` `→` | ◀ ▶ |
| Jump, double jump, wall kick | `W`, `Space` or `↑` | ⤒ |
| Punch combo (3 hits; hold `↑` to aim up) | `J` or `Z` | J |
| Launcher (ground) / drop kick (air) | `K` or `X` | K |
| Dash: 12 frames invulnerable | `L` or `C` | L |
| Drop through a ledge | `↓` + jump | ▼ + ⤒ |
| Punch where you point | left click (mouse) | |
| Emojis 🔥 💀 🤡 🚀 | `5` `6` `7` `8` | the buttons |
| Vote | `1` `2` | the buttons |

Attacks turn you to face the nearest opponent close by, as in Tekken.

## What happens

- **King of the Hill** (default): two fight, everyone else queues ("Next
  up"). The loser goes to the back; the next in line comes in with a
  3-second spawn shield; the winner stays. Alone, you spar with a training
  bot until someone joins.
- **Royal Rumble**: everyone at once on three tiers of platforms that crumble
  when stood on (they come back after 7 seconds). Fall into the pit or lose
  your health and you're out; last one standing wins.
- The host (👑, the first to join) switches modes.
- **Launch and juggle**: the launcher sends them up; punches keep them there
  for two or three hits. Heavy hits ragdoll them (they tumble until they
  land), and a hard hit into the side walls bounces them back.
- **Ledge grab**: fall just past a platform's edge and you catch it (a second
  of invulnerability); jump to climb, down to let go.
- **The Tekken moment**: both fighters under 25 % and swinging at each other
  close up: the game drops to 0.2x for 1.2 s and the camera closes in. The
  knockout blow freezes the screen for 80 ms, shakes it, throws sparks and
  shows K.O.!
- **The crowd**: emojis float up everyone's screen. Every 45 seconds of
  fighting, the people waiting (everyone, in Royal Rumble) get 5 seconds to
  vote between two hazards (Slippery Ice, Anvil Rain, Low Gravity, Giant
  Boxing Gloves); the winner runs for 15 seconds.

## How it's built

| File | Does |
|---|---|
| `server.js` | Express serves `public/`; a `ws` WebSocket hub runs the game at 30 ticks a second (the only authority: browsers send keys) and sends every browser a snapshot each tick. Rounds, the queue, the vote, emojis, the bot. Binds `0.0.0.0:3000`, prints the LAN addresses and a QR code. |
| `public/physics.js` | The simulation (shared with the browser): movement, platforms (one-way, crumbling), attacks and hitboxes, juggles, wall bounces, ledges, hit-stop and slow motion, hazards; and the stick-figure rig drawing. |
| `public/engine.js` | The browser: draws at 60 fps, interpolating between snapshots; the camera (follows the fight, zooms in for slow motion); particles, motion-blur ghosts, headband ribbons, banners; keyboard, mouse and touch input; the crowd panels. |
| `public/audio.js` | Every sound made with the Web Audio API (oscillators and filtered noise): no audio files. |
| `public/index.html` | The page: join screen with the QR code, panels, touch pads. |

Nothing is loaded from the internet: the QR code is made by the server and
drawn by the page.

## Tests

```sh
npm test                    # the simulation, then real rounds over WebSockets
node test/shot.js OUT_DIR   # screenshots in headless Firefox (join, fight, phone)
```
