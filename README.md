# Stick Havoc: Tournament Edition

An offline LAN stick-figure brawler for 2 to 10 players. One computer hosts;
everyone else plays in a browser (Chrome, Firefox, Safari, Edge; Windows,
macOS, Linux, Android, iOS). No internet, no installs on the players' side.

## Host a game

```sh
npm install      # once (express, ws, qrcode-terminal: plain JavaScript)
npm start        # or: node server.js   (PORT=4000 npm start for another port)
```

The terminal prints the address to join (`http://192.168.x.x:3000`) and a QR
code; the lobby's wall screen shows them too. Everyone must be on the same
Wi-Fi or phone hotspot. If nobody can connect, the host's firewall is
blocking the port: on Fedora, `sudo firewall-cmd --add-port=3000/tcp`.

## The lobby

You arrive in a locker room you can walk around in, with everyone else who
has joined (their names over their heads). Three stations:

- **Wardrobe** (left): stand at it and press `E`. Name, ten colours,
  headgear (Ninja Bandana with trailing ribbons, Cyber Visor, Samurai Kasa,
  Golden Crown, Bandit Eyepatch) and a dash trail (ghost afterimages, neon
  sparkles, shadow smoke). Everyone sees the change at once; your look is
  remembered on that device.
- **Host console** (middle): the wall screen shows the mode, the map,
  `PLAYERS READY` and the join QR. The host (👑, the first to join) stands at
  it: `Q` changes the mode, `Tab` the map, `E` starts: 3, 2, 1, and everyone
  is on the stage.
- **Training dummy** (right): it springs back from every hit and pops the
  damage (`5 DMG`, `BOOM!`, `CRIT!`). Players can knock each other about in
  the lobby too, but nobody loses health there.

## Controls

| | Keyboard | Phone |
|---|---|---|
| Move | `A` `D` or `←` `→` | ◀ ▶ |
| Jump, double jump, wall kick | `W`, `Space` or `↑` | ⤒ |
| Punch string: jab, body hook, straight | `J` or `Z` (press again for the next) | J |
| Uppercut launcher | `K`, or `↑` + `J` | K |
| Flying kick (air) / 45° dive kick (air) | `K` / `↓` + `K` | K / ▼ + K |
| Dash: 10 frames invulnerable, cancels a punch's recovery | `L` or `C` | L |
| Drop through a ledge | `↓` + jump | ▼ + ⤒ |
| Use a station | `E` | E |
| Punch where you point | left click | |
| Emojis 🔥 💀 🤡 🚀 · vote | `5`–`8` · `1` `2` | the buttons |

The bar along the bottom lists the keys; the feed at bottom left shows your
last four inputs (`↑ + J  LAUNCH`, `L  DASH`, …). Attacks turn you to face the
nearest opponent close by, as in Tekken.

## Fighting

- The jab comes out on frame 4; the hook pulls them in; the straight
  launches them a little. The uppercut sends them up for a juggle: two or
  three punches keep them there. The dive spikes someone in the air, or
  bounces off someone standing.
- Heavy hits freeze both fighters for 60 ms, shake the screen along the
  blow, and ragdoll the victim until they land. Hard hits bounce off walls.
- Fall just past a ledge and you catch it (a second of invulnerability).
- Both fighters under 25 % and swinging at each other close up: 0.2x speed
  for 1.2 s, the camera closes in. The K.O. freezes, flashes and shakes.

## Modes and maps

| Mode | |
|---|---|
| **King of the Hill** | Two fight, the rest queue (and vote on hazards, and send emojis). The loser goes to the back; the next comes in with a 2.5 s shield. First to 5 wins takes the match. Alone, you spar with a training bot. |
| **Royal Rumble** | Everyone at once; last one standing wins the round; first to 3 rounds wins. |
| **Bomb Tag** | One player carries a ticking bomb (20 s). Punch someone to pass it on. At zero it explodes: the carrier is out and everyone near is blown away. A new bomb goes to a survivor, until one is left. No health in this mode, only the bomb and the pit. |

| Map | |
|---|---|
| **Neon Rooftops** | Three rooftops over a drop. The middle bridge gives way after 4 s stood on, and comes back after 8. |
| **The Reactor Core** | Tiers above a floor that a beam sweeps every 18 s: three beeps and red stripes first. Get off the floor. |
| **Low-Gravity Asteroid** | 0.55x gravity, big floaty jumps, bumpers on both edges that fling you back across. A drop below. |
| **The Colosseum** | Flat and fair, with a stone pillar each side to bounce people off. Each pillar breaks after three bounces (and is rebuilt after 14 s). |

In King of the Hill and Royal Rumble the crowd votes every 45 s on a hazard
for the next 15 s: Slippery Ice, Anvil Rain, Low Gravity or Giant Boxing
Gloves. When a match ends, everyone goes back to the lobby; the host can
also end it early (Back to lobby).

## How it's built

| File | Does |
|---|---|
| `server.js` | Express serves `public/`; a `ws` hub runs the game at 30 ticks a second (the only authority: browsers send keys) and sends every browser a snapshot each tick. The lobby and its stations, matches and rounds, the queue, Bomb Tag, the vote, the training bot. Binds `0.0.0.0:3000`, prints the LAN addresses and a QR code. |
| `public/physics.js` | The simulation, shared with the browser: the maps, movement, platforms (one-way, crumbling, solid pillars), the moves and their frame data, juggles, wall bounces, ledges, hit-stop and slow motion, the reactor beam, bumpers, explosions; and the stick-figure rig with its headgear. |
| `public/engine.js` | The browser: draws at 60 fps, interpolating between snapshots; the camera; particles, trails, ribbons, banners; keyboard, mouse and touch input. |
| `public/lobby.js` | The lobby room and its stations, the console's wall screen, the dummy's damage pops. |
| `public/hud.js`, `public/style.css` | The command bar, the input feed, the wardrobe drawer, the match panels, the vote. |
| `public/audio.js` | Every sound made with the Web Audio API: no audio files. |

Nothing is loaded from the internet: the QR code is made by the server.

## Tests

```sh
npm test                    # the simulation, then a whole session over WebSockets
node test/shot.js OUT_DIR   # screenshots in headless Firefox, driven with real key presses
```
