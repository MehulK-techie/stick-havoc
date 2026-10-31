# Stick Havoc: Tournament Edition

**Created by Mehul** · [github.com/MehulK-techie/stick-havoc](https://github.com/MehulK-techie/stick-havoc) ·
v1.2.0-tournament · MIT License

An offline LAN stick-figure brawler for 2 to 15 players. One computer hosts;
everyone else plays in a browser (Chrome, Firefox, Safari, Edge; Windows,
macOS, Linux, Android, iOS). No internet, no installs on the players' side.

## Host a game

The easy way: double-click **`run.sh`** (Linux, macOS) or **`run.bat`**
(Windows). It checks for Node.js 18+, installs what's missing the first time,
starts the server and opens the game in your browser.

Or by hand:

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

- **Wardrobe** (left): stand at it and press `E`. While the drawer is open
  you're a see-through ghost: nobody can hit, grab or push you, and any
  number of people can customize at once. Name; sixteen colours, one per
  player, like Among Us (a colour someone wears is locked, with their
  initial on it; change or leave and it's free again); headgear (Ninja
  Bandana with trailing ribbons, Cyber Visor, Samurai Kasa, Golden Crown,
  Bandit Eyepatch, Chef Hat, Cat Ears, Cyber Beanie, Viking Horns) and a
  dash trail (ghost afterimages, neon sparkles, shadow smoke, rainbow prism,
  pixel dust). Everyone sees the change at once; your look is remembered on
  that device.
- **Dojo** (right of the console), or `P` anywhere in the lobby: spar the
  practice bot, alone, in your own browser (nothing anyone else does is
  affected; to the room you're a ghost meanwhile). It guards your strings
  and rolls away before its guard breaks, jumps grabs and projectiles, and
  strings J, J, uppercut into a dive spike. `B` switches Medium / Hard
  (Hard reacts in about 60 ms and parries). `Esc` or `P` stops. When the
  host starts a match, sparring ends at once and you're in.
- **The ball**: punch it, kick it, dash into it: lobby football.
- **Parkour tower** (top right): start on the lit step and climb to the
  finish pad at the ceiling: `CLIMB TIME: X.Xs`.
- **Host console** (middle): the stadium screen high on the wall shows the
  room's settings, `PLAYERS READY` (up to 15) and the join QR. The room host (a lit
  `👑 ROOM HOST` badge and a gold ring at their feet; the first to join, and
  if they leave the next one, with a notice to everyone) presses `E` here for
  the **match settings**: game mode (King of the Hill, Royal Rumble, Bomb Tag,
  Floor Is Lava, Random, or **Banger Shuffle**: weighted picks that never
  repeat the last mode or map, nor a mode-and-map pair from the last 3
  matches), first to 3, 5 or 7, a round timer (45, 60, 90 s or none),
  weapons on or off, a player limit (2-15) and the map (or Random, or
  Banger Shuffle). Changes
  show on everyone's screen at once; anyone else at the console sees them
  read-only ("Waiting for Host to start..."). `Enter` starts: 3, 2, 1, and
  everyone is on the stage. (`Q` / `Tab` cycle mode and map without the
  drawer.)
- **1P Arcade** (the settings drawer's button, the host): a ladder of five computer opponents, one
  round each, on the four arenas in turn: Rookie Stick (slow, basic),
  Acrobat (jumps and dive kicks), Brawler (relentless strings, dash
  cancels), Ninja (guards and parries, wall kicks, picks up weapons) and the
  boss, **Shadow Mehul** (a dark figure with red eyes: juggles, grabs,
  parries). `STAGE CLEAR! Time: XXs` between stages, with your health
  restored; lose once and it's over. Anyone else in the room watches.
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
| Guard (hold; just in time: parry) | `S` or `↓` | joystick down |
| Grab & throw (goes through a guard) | `G` | G |
| Use a station · pick up / throw a weapon | `E` | E |
| Move list | `Shift` (or ? Moves) | ? (top right) |
| Practice bot (lobby) · its difficulty | `P` · `B` | |
| Punch where you point | left click | |
| Emojis 🔥 💀 🤡 🚀 · vote | `5`–`8` · `1` `2` | the buttons |

On a phone: a joystick appears wherever your left thumb lands (sideways
moves, down guards, up aims the launcher); J, K, L and W sit on the right
thumb's arc with E and G beside them, and every press gives a short buzz
(where the browser allows vibration). Held upright, the game asks you to turn
the phone sideways.

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
- **Guard** (hold down on the ground): a fifth of the damage and no launch;
  the third blocked hit in a row breaks the guard. Raise it just as a punch
  lands and it's a **PARRY**: the attacker reels. A **grab** goes straight
  through a guard and throws them the other way.
- Hitting someone in the middle of their own attack is a **COUNTER** (+25%).
  The combo counter at the left edge counts your hits and damage; callouts
  pop over the fighters: `UPPERCUT!`, `PARRY!`, `GUARD BREAK!`, `THROW!`,
  `3x COMBO!`, and `CLUTCH REVERSAL!` when a fighter under 25% lands the K.O.
- **Weapons** (when on): every 14-20 s a crate parachutes onto a platform.
  Walk over it (or `E`) to take the weapon; `J` uses it, `E` throws it.
  Katana (5 fast, long slashes), Home-Run Bat (3 slow swings that send them
  across the arena), Laser Blaster (3 shots, with recoil), Bouncy Bomb
  (thrown: bounces twice, then blows everyone back).
- Both fighters under 25 % and swinging at each other close up: 0.2x speed
  for 1.2 s, the camera closes in. The K.O. freezes, flashes and shakes.

## Modes and maps

| Mode | |
|---|---|
| **King of the Hill** | Two fight, the rest queue (and vote on hazards, and send emojis). The loser goes to the back; the next comes in with a 2.5 s shield. First to 5 wins takes the match. Alone, you spar with a training bot. |
| **Royal Rumble** | Everyone at once; last one standing wins the round. |
| **Floor Is Lava** | Everyone at once; every 30 s (3 s warning) every platform glows hot for 8 s: touch it and you're thrown up and burned. Stay up: double jumps, wall kicks, and landing a hit in the air gives your jump and air dash back. |
| **Bomb Tag** | One player carries a ticking bomb (20 s). Punch someone to pass it on. At zero it explodes: the carrier is out and everyone near is blown away. A new bomb goes to a survivor, until one is left. No health in this mode, only the bomb and the pit. |

| Map | |
|---|---|
| **Neon Rooftops** | Three rooftops over a drop. The middle bridge gives way after 4 s stood on, and comes back after 8. |
| **The Reactor Core** | Tiers above a floor that a beam sweeps every 18 s: three beeps and red stripes first. Get off the floor. |
| **Low-Gravity Asteroid** | 0.55x gravity, big floaty jumps, bumpers on both edges that fling you back across. A drop below. |
| **The Magma Foundry** | Two hover plates (one sliding, one rising and falling) over a pool of lava that rises and sinks; touch it and it throws you up, burning. |
| **Cyber Sky Train** | The roof of a speeding train: in the air the slipstream drags you backwards, and every 15 s (a flashing signal first) a tunnel mouth sweeps the roof at head height: guard (duck) under it or be knocked off. |
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
| `public/weapons.js` | The weapons: what each does, and how crates, weapons and shots look. |
| `public/bot.js` | The computer fighters: one brain, five styles (the arcade ladder, the training bot). |
| `public/touch.js` | The phone controls: the floating joystick, the thumb-arc buttons, vibration. |
| `public/audio.js` | Every sound made with the Web Audio API: no audio files. |
| `run.sh`, `run.bat` | One-click start for Linux/macOS and Windows. |

Nothing is loaded from the internet: the QR code is made by the server.

## Tests

```sh
npm test                    # the simulation, then a whole session over WebSockets
node test/shot.js OUT_DIR   # screenshots in headless Firefox, driven with real key presses
```
