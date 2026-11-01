# Stick Havoc: Tournament Edition

**Created by Mehul** · [github.com/MehulK-techie/stick-havoc](https://github.com/MehulK-techie/stick-havoc) ·
v1.2.0-tournament · MIT License

Built as a zero-dependency LAN entertainment module for the
[Fedora Workstation Config](https://github.com/MehulK-techie/fedora-workstation-config) ecosystem
(🐧 MK Linux Workstation). The lobby's creator badge links both repos.

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
  that device. If your remembered colour is already being worn when you
  come back (a second tab, or someone took it), you keep the free colour
  you were given and get a notice (`Notice: Saved color was taken,
  assigned Lime!`); that becomes your remembered colour.
- **Dojo** (right of the console), or `P` anywhere in the lobby: spar the
  practice bot, alone, in your own browser (nothing anyone else does is
  affected; to the room you're a ghost meanwhile). It guards your strings
  and rolls away before its guard breaks, jumps grabs and projectiles, and
  strings J, J, uppercut into a dive spike. `B` switches Medium / Hard
  (Hard reacts in about 60 ms and parries). `Esc` or `P` stops. When the
  host starts a match, sparring ends at once and you're in.
- **The ball**: punch it, kick it, dash into it: lobby football, with a
  goal against the right wall. A punch drives it low and hard; a kick or a
  launcher lofts it; it bounces lively off floors and walls. A goal sets off
  confetti, fireworks over the net, an air horn and a chime, `GOAL!`, and counts on `LOBBY BALL: X GOALS` (for the session); the ball
  drops back in the middle 1.5 s later.
- **Parkour tower** (top right): step on `START ▲ CLIMB` and a clock runs at
  the top right of your screen (`CLIMB: 0.00s`); reach `FINISH` for gold
  fireworks and your time. The best run is on a plaque by the finish
  (`RECORD: X.XXs by Name`). Drop back to the floor and the clock resets.
- **Host console** (middle): the stadium screen high on the wall shows the
  room's settings, `PLAYERS READY` (up to 15) and the join QR. The room host (a lit
  `👑 ROOM HOST` badge and a gold ring at their feet; the first to join, and
  if they leave the next one, with a notice to everyone) presses `E` here for
  the **match settings**: game mode (King of the Hill, Royal Rumble, Bomb Tag,
  Floor Is Lava, Random, or **Banger Shuffle**: weighted picks that never
  repeat the last mode, nor either of the last 2 maps), first to 3, 5 or 7, a round timer (45, 60, 90 s or none),
  weapons on or off, a player limit (2-15) and the map (or Random, or
  Banger Shuffle). Changes
  show on everyone's screen at once; anyone else at the console sees them
  read-only ("Waiting for Host to start..."). `Enter` starts: everyone is on
  the stage at once (`GET READY` for half a second while it loads), then one
  countdown, run by the server: `3`, `2`, `1` (a rising chime each), `FIGHT!`
  (a gong). Every browser plays them on the same server tick, and nobody can
  move until `FIGHT!`. Every round starts the same way. Random and Banger
  Shuffle are settled by the server the moment the host presses start. (`Q` / `Tab` cycle mode and map without the
  drawer.)
- **1P Arcade** (the settings drawer's button, the host): a ladder of five computer opponents, one
  round each, on the four arenas in turn: Rookie Stick (slow, basic),
  Acrobat (jumps and dive kicks), Brawler (relentless strings, dash
  cancels), Ninja (guards and parries, wall kicks, picks up weapons) and the
  boss, **Shadow Mehul** (a dark figure with red eyes: juggles, grabs,
  parries). `STAGE CLEAR! Time: XXs` between stages, with your health
  restored; lose once and it's over. Anyone else in the room watches.
- **1P Solo Match / Map Sandbox** (the settings drawer, when you're the only
  one in the room): any map (or Random / Banger Shuffle) and match length
  from the settings above, then a mode against bots: 1v1 Duel, FFA with 3
  bots, Bomb Tag or Floor Is Lava; bots Easy, Normal or Hard; weapon crates
  Off, Normal or Frequent (three times as often). `Esc`, or Back to lobby in
  the corner, leaves at any time.
- **Training dummy** (right): it springs back from every hit and pops the
  damage (`5 DMG`, `BOOM!`, `CRIT!`); three hits into a combo it starts
  talking back (`OOF!`, `NICE COMBO!`, `OKAY, OKAY!`, `I YIELD!`). Players can knock each other about in
  the lobby too, but nobody loses health there.

## Controls

| | Keyboard | Phone |
|---|---|---|
| Move | `A` `D` or `←` `→` | ◀ ▶ |
| Jump, double jump, wall kick | `W`, `Space` or `↑` | ⤒ |
| Punch string: jab, body hook, straight | `J` or `Z` (press again for the next) | J |
| Uppercut launcher | `K`, or `↑` + `J` | K |
| Lunging straight (opens the string; long reach) | `→` (towards them) + `J` | stick forward + J |
| Low sweep: knocks them down | `↓` + `J` | stick down + J |
| Flying kick (air) · 45° dive kick (air) · ground pound (air) | `K` · `↓`+`→`+`K` · `↓`+`K` | K · stick down-forward + K · stick down + K |
| Breakfall: tap just before you hit the floor after a launch or throw | `L` | L |
| Dash: 10 frames invulnerable, cancels a punch's recovery | `L` or `C` | L |
| Drop through a ledge | `↓` + jump | ▼ + ⤒ |
| Hanging from a ledge: climb · hop kick · let go | `W`/`↑` · `J` · `S`/`↓` | ⤒ · J · ▼ |
| Guard (hold; just in time: parry) | `S` or `↓` | joystick down |
| Grab & throw (goes through a guard) | `G` | G |
| Use a station · pick up / throw a weapon | `E` | E |
| Move list | `Shift` (or ? Moves) | ? (top right) |
| Practice bot (lobby) · its difficulty | `P` · `B` | |
| Punch where you point | left click | |
| Emojis 🔥 💀 🤡 🚀 · vote | `5`–`8` · `1` `2` | the buttons |

**Rebinding**: `⌨️ Controls` (top right; in a match, beside `? Moves`) lists
every action with its keys. Click one and press the new key; `+` adds a
second or third key, right-click removes one, `Reset to defaults` puts them
back. A key moves to its new action (unless it's another action's only key),
and the game keeps `Esc`, `Shift`, `Enter`, `Tab`, `P`, `B`, `Q`, `R` and the
number keys for its own menus. The bar along the bottom and the input feed
show your own keys. Saved in this browser (`localStorage`,
`stick_havoc_keys`), with your name and look (`sh-look`).

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
  A ragdoll lands flat on the top of whatever it meets (the highest
  platform it crosses, moving ones included), with no bounce: a 120 ms
  landing crouch, then back on its feet.
- Fall just past a ledge and you catch it (a second of invulnerability),
  your hands gripping the corner and your body swinging gently below them.
  Jump or up: a 220 ms mantle (chest up to the lip, a knee hooked over,
  weight forward, standing). `J`: a **ledge hop kick**, up over the lip boot
  first (16 damage to whoever is standing there), landing on top. Down: let
  go, with a small push, and that ledge won't catch you again until you
  land. Jump while holding away from the wall: leap off backwards.
- Hanging is no place to stall: once the second of invulnerability is up, a
  hit on the hands (a punch, a sweep, a stomp) does 1.3x damage
  (`LEDGE PUNISH!`) and knocks you off and down.
- The ground pound lands with a shockwave that pops up anyone standing
  close. The breakfall rolls you up with 8 invulnerable frames instead of
  bouncing on the floor.
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
  No need to wait for it to land: jump up to a falling crate and press `E`,
  or hit it with an aerial attack, and the parachute pops, the weapon is in
  your hands and you bounce up a little.
  Katana (5 fast, long slashes), Home-Run Bat (3 slow swings that send them
  across the arena), Laser Blaster (3 shots, with recoil), Bouncy Bomb
  (thrown: bounces twice, then blows everyone back).
- **The climax clash**: both fighters under 25 % (or under 50 % when both
  are at match point), facing each other close up, attacking within 80 ms
  of each other: the game drops to 0.15x and the camera closes in. The
  first blow to connect wins it (the one whose hitbox went live first, not
  the one pressed first): a 100 ms freeze, a gold starburst and a deep
  stinger, and the loser flies backwards into the K.O. at full speed. If
  neither lands within 1.6 s, the moment passes.
- **The knockout**, in order and never on top of each other: a 120 ms
  freeze with sparks, a second at 0.25x while the loser crumples (one
  bounce, dust, then lying still), letterbox bars slide in and the HUD
  steps aside, `K.O.!` springs onto the screen, then the round's result.
  When it ends the match: the **winner's card**, their figure in a victory
  loop, their name in their colour, `Rounds`, `Highest combo` and
  `Finishing move`, and `Returning to lobby in 3s...`.

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
| `server.js` | Express serves `public/`; a `ws` hub runs the game at 30 ticks a second (the only authority: browsers send keys) and sends every browser a snapshot each tick. The lobby and its stations, matches and rounds, the queue, Bomb Tag, the vote, the training bot, the 1P arcade and sandbox; Random and Banger Shuffle are settled here. Binds `0.0.0.0:3000`, prints the LAN addresses and a QR code. |
| `public/physics.js` | The simulation, shared with the browser: the maps, movement, platforms (one-way, crumbling, solid pillars), the moves and their frame data, juggles, wall bounces, ledges (the grip, the mantle, the hop kick), landing clamps, hit-stop, the climax clash, crates, the reactor beam, bumpers, explosions; and the stick-figure rig with its headgear. |
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
npm test                    # the simulation, the key bindings, then a whole session over WebSockets
node test/shot.js OUT_DIR   # screenshots in headless Firefox, driven with real key presses
```
