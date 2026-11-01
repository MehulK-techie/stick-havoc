// Stick Havoc: Tournament Edition — the LAN host.
//   node server.js            (PORT=3000 by default)
// Serves the game to any browser on the network and runs the one true
// game state at 30 ticks a second; browsers send their keys and draw.
//
// Everyone arrives in the lobby: a room to walk around in, with a
// wardrobe, a punching dummy and the host's console. The host picks a
// mode and a map there and starts the match; afterwards, back to the lobby.
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const {WebSocketServer} = require('ws');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const P = require('./public/physics.js');
const Bot = require('./public/bot.js');
const VERSION = require('./package.json').version;

const PORT = Number(process.env.PORT) || 3000;
// players' bug reports and ideas, kept on the host's computer (not in git)
const FEEDBACK_FILE = process.env.FEEDBACK_FILE || path.join(__dirname, 'feedback.json');
const FEEDBACK = {bug: 'Bug Report', feature: 'Feature Request', general: 'General Feedback'};
const FEEDBACK_MAX = 5000;            // entries kept in the file; past that, new ones are turned away
const TPS = 30;
const MAX_PLAYERS = 15;
const VOTE_EVERY = Number(process.env.VOTE_EVERY) || 45, VOTE_FOR = 5, HAZARD_FOR = 15;   // seconds
const GET_READY = 0.5;                // seconds of GET READY before the 3, 2, 1
const BOMB_FUSE = Number(process.env.BOMB_FUSE) || 20;
const EMOJIS = ['🔥', '💀', '🤡', '🚀'];
const COLOR_VALUES = P.COLORS.map(c => c[1]);
const STATION_REACH = 90;

// ---------------------------------------------------------------- LAN addresses
function lanUrls() {
    const urls = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal)
                urls.push({name, url: `http://${a.address}:${PORT}`});
        }
    }
    return urls;
}

function qrMatrix(text) {
    const q = new QRCode(-1, QRLevel.M);
    q.addData(text);
    q.make();
    const n = q.getModuleCount(), rows = [];
    for (let r = 0; r < n; r++) {
        let row = '';
        for (let c = 0; c < n; c++)
            row += q.isDark(r, c) ? '1' : '0';
        rows.push(row);
    }
    return rows;
}

// ---------------------------------------------------------------- web
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), {maxAge: 0}));
app.get('/info', (_req, res) => {
    const urls = lanUrls();
    const main = (urls[0] || {url: `http://localhost:${PORT}`}).url;
    res.json({urls, main, qr: qrMatrix(main)});
});
const server = http.createServer(app);
const wss = new WebSocketServer({server, maxPayload: 8192});   // (room for a 1000-character feedback note)

// ---------------------------------------------------------------- the room
let nextId = 1;
const players = new Map();      // id -> {id, ws, name, color, gear, wins, joined, input, bot}
// the room's settings: the host changes them at the console
const sel = {mode: 'koth', map: 'rooftops', target: 5, timer: 0, weapons: true, limit: MAX_PLAYERS};
const CHOICES = {mode: ['koth', 'rumble', 'bomb', 'lava', 'random', 'shuffle'], map: [...P.ARENAS, 'random', 'shuffle'],
    target: [3, 5, 7], timer: [45, 60, 90, 0], weapons: [true, false],
    limit: Array.from({length: MAX_PLAYERS - 1}, (_, i) => i + 2)};
// Banger Shuffle: weighted picks; never the last mode again, never one of the last 2 maps
const SHUFFLE_WEIGHTS = {koth: 3, rumble: 3, bomb: 2, lava: 2};
const history = [];                   // the last 2 matches, [{mode, map}], newest last
// the 1P sandbox: any map, a mode against 1-3 bots, how hard they are, how often crates fall
const SANDBOX = {
    mode: {duel: 'koth', rumble: 'rumble', bomb: 'bomb', lava: 'lava'},
    level: {easy: ['rookie', 'acrobat', 'training'], medium: ['brawler', 'acrobat', 'training'],
        hard: ['sparHard', 'ninja', 'brawler'], demon: ['demon', 'demon', 'demon']},
    crates: {off: 0, normal: 1, frequent: 3},
};
let lastHost = null;
let lobbyGoals = 0;                   // the lobby's football score, kept for the whole session
let climbBoard = [];                  // the parkour tower's leaderboard: each climber's best, [{t, name}], fastest first
let scene = 'lobby';            // lobby | match
let lobby = newLobby();
let match = null;               // {mode, map, world, phase, phaseT, queue, active, roundWins, bomb, ...}
let pendingEvents = [];

function newLobby() {
    const w = P.createWorld('lobby');
    w.noDamage = true;           // the lobby is for practice: hits throw people about, nothing more
    const st = P.MAPS.lobby.stations;
    w.fighters.push(P.makeDummy(st.dummy.x, st.dummy.y));
    return w;
}

function hostId() {
    let best = null;
    for (const p of players.values()) {
        if (!p.bot && (!best || p.joined < best.joined))
            best = p;
    }
    return best ? best.id : null;
}

const humans = () => [...players.values()].filter(p => !p.bot);

function send(ws, msg) {
    if (ws && ws.readyState === 1)
        ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of players.values()) {
        if (p.ws && p.ws.readyState === 1)
            p.ws.send(s);
    }
}

function roster() {
    broadcast({type: 'roster', host: hostId(),
        list: [...players.values()].map(p => ({id: p.id, name: p.name, color: p.color, gear: p.gear,
            ghost: !!p.ghost, spar: !!p.spar,
            wins: match ? (match.roundWins.get(p.id) || 0) : 0, bot: !!p.bot}))});
}

// a fighter in the lobby for player p (at a free spawn spot)
function lobbySpawn(p) {
    const spots = P.MAPS.lobby.spawns;
    const [x, y] = spots[(p.id - 1) % spots.length];
    const f = P.makeFighter(p.id, p.name, p.color, x + (p.id % 3) * 20, y - 40, p.gear);
    f.shield = 0;
    f.ghost = !!(p.ghost || p.spar);
    lobby.fighters.push(f);
}

// ---------------------------------------------------------------- bots
// a computer fighter (bot.js plays it): the training bot, or an arcade opponent
function addBot(style, name) {
    const S = Bot.STYLES[style], id = nextId++;
    players.set(id, {id, name: name || S.name, color: S.color, gear: {hat: S.hat, eyes: !!S.eyes}, joined: Date.now(),
        input: {k: 0, aim: null}, bot: {style, mem: {}}});
    return id;
}

// alone in King of the Hill, you spar with the training bot until a second person is in
function ensureBot() {
    if (match && match.sandbox)              // (the sandbox brought its own)
        return;
    const bots = [...players.values()].filter(p => p.bot && p.bot.style === 'training');
    const want = scene === 'match' && match.mode === 'koth' && humans().length === 1;
    if (want && !bots.length) {
        match.queue.push(addBot('training'));
        roster();
    } else if (!want && bots.length) {
        for (const b of bots)
            removePlayer(b.id);
    }
}

// ---------------------------------------------------------------- matches
const pick = list => list[Math.floor(Math.random() * list.length)];

function weighted(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(weights)) {
        if ((r -= v) < 0)
            return k;
    }
    return Object.keys(weights)[0];
}

// the settings as a real mode and map: Random and Banger Shuffle are picked here, on the server, before anyone
// is told, so no client is ever handed 'shuffle' to look up
function resolvePick(want = sel) {
    const last = history[history.length - 1] || {};
    const recentMaps = history.map(h => h.map);
    const modes = Object.fromEntries(Object.entries(SHUFFLE_WEIGHTS).filter(([k]) => k !== last.mode));
    const mode = want.mode === 'random' ? pick(Object.keys(P.MODES)) : want.mode === 'shuffle' ? weighted(modes) : want.mode;
    const fresh = P.ARENAS.filter(m => !recentMaps.includes(m));
    const map = want.map === 'random' ? pick(P.ARENAS) : want.map === 'shuffle' ? pick(fresh.length ? fresh : P.ARENAS) : want.map;
    return {mode: P.MODES[mode] ? mode : 'koth', map: P.MAPS[map] && map !== 'lobby' ? map : P.ARENAS[0]};
}

function newMatch(mode, map, extra) {
    history.push({mode, map});
    if (history.length > 2)
        history.shift();
    return Object.assign({mode, map, world: null, phase: 'countdown', phaseT: 0, queue: [], active: [], target: sel.target,
        timeLimit: sel.timer, clock: 0, weapons: sel.weapons,
        roundWins: new Map(), bomb: null, voteClock: 0, vote: null, round: 0, winner: null, champion: null,
        bestCombo: new Map(), finisher: null}, extra);
}

function startMatch(picked) {
    const ids = humans().map(p => p.id);
    const {mode, map} = picked || resolvePick();
    match = newMatch(mode, map);
    if (match.mode === 'koth')
        match.queue = ids.slice();
    scene = 'match';
    ensureBot();
    startRound();
    pendingEvents.push({type: 'match', mode: match.mode, map: match.map, name: P.MAPS[match.map].name});
}

// 1P sandbox: the one person here picks a map and a mode, and bots fill the arena
function startSandbox(playerId, o) {
    const {map} = resolvePick({mode: 'koth', map: o.map});
    const styles = SANDBOX.level[o.level].slice(0, o.mode === 'duel' ? 1 : o.bots);
    match = newMatch(SANDBOX.mode[o.mode], map, {target: o.target, weapons: SANDBOX.crates[o.crates] > 0,
        sandbox: {player: playerId, crates: SANDBOX.crates[o.crates]}});
    // (two of the same style get a number: Demon, Demon 2)
    const bots = styles.map((style, i) => {
        const n = styles.slice(0, i).filter(s => s === style).length;
        return addBot(style, n ? `${Bot.STYLES[style].name} ${n + 1}` : null);
    });
    if (match.mode === 'koth')
        match.queue = [playerId, ...bots];
    scene = 'match';
    startRound();
    pendingEvents.push({type: 'match', mode: match.mode, map: match.map, name: P.MAPS[match.map].name});
}

function startRound() {
    const m = match;
    const keep = m.world && m.world.hazard ? {hazard: m.world.hazard, hazardT: m.world.hazardT} : {};
    m.world = Object.assign(P.createWorld(m.map), keep);
    m.world.noDamage = m.mode === 'bomb';
    m.world.floorLava = m.world.airReset = m.mode === 'lava';
    m.world.weapons = m.weapons || (m.mode === 'arcade' && m.arcade.stage >= 3);
    m.world.crateRate = m.sandbox ? m.sandbox.crates : 1;
    m.round++;
    m.clock = 0;
    m.winner = null;
    if (m.mode === 'arcade') {
        m.active = [m.arcade.player, m.arcade.bot].filter(id => players.has(id));
        m.queue = humans().map(p => p.id).filter(id => id !== m.arcade.player);
    } else if (m.mode === 'koth') {
        m.queue = m.queue.filter(id => players.has(id));
        m.active = m.active.filter(id => players.has(id));
        while (m.active.length < 2 && m.queue.length)
            m.active.push(m.queue.shift());
    } else {
        m.active = [...players.keys()];
        m.queue = [];
    }
    const spots = P.MAPS[m.map].spawns;
    m.active = m.active.filter(id => players.has(id));     // (someone may have just left)
    m.active.forEach((id, i) => {
        const p = players.get(id);
        const [x, y] = spots[i % spots.length];
        const nudge = Math.floor(i / spots.length) * 36 * (i % 2 ? 1 : -1);
        m.world.fighters.push(P.makeFighter(id, p.name, p.color, x + nudge, y, p.gear));
    });
    if (m.mode === 'bomb')
        m.bomb = null;
    // match point for both of the two in the ring: the climax clash comes in at half health
    m.world.matchPoint = m.active.length === 2 && m.mode !== 'bomb' &&
        m.active.every(id => (m.roundWins.get(id) || 0) >= m.target - 1);
    setPhase(m.active.length >= 2 ? 'countdown' : 'waiting');
    if (m.phase === 'countdown')
        pendingEvents.push({type: 'getReady', round: m.round});
    roster();
}

function setPhase(phase) {
    match.phase = phase;
    match.phaseT = 0;
    match.count = null;
}

function endRound(forced) {
    const m = match;
    const standing = m.world.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone' && f.hp > 0);
    m.winner = forced !== undefined ? forced : standing.length === 1 ? standing[0].id : null;
    if (m.mode === 'arcade')
        return arcadeRoundEnd();
    if (m.winner)
        m.roundWins.set(m.winner, (m.roundWins.get(m.winner) || 0) + 1);
    const champ = m.world.fighters.find(f => f.id === m.winner);
    if (champ && champ.hp >= P.C.HP && m.mode !== 'bomb')      // not a scratch on them
        pendingEvents.push({type: 'callout', x: Math.round(champ.x), y: Math.round(champ.y - 130), text: 'PERFECT!'});
    if (m.mode === 'koth') {   // the loser goes to the back of the line; the winner stays
        const losers = m.active.filter(id => id !== m.winner);
        m.active = m.active.filter(id => id === m.winner);
        m.queue.push(...losers.filter(id => players.has(id)));
    }
    if (m.winner && m.roundWins.get(m.winner) >= m.target)
        m.champion = m.winner;
    pendingEvents.push({type: 'roundEnd', winner: m.winner, champion: m.champion, round: m.round,
        stats: m.champion ? championStats(m) : null});
    setPhase(m.champion ? 'end' : 'ko');
    roster();
}

// ---------------------------------------------------------------- 1P arcade
// five opponents in a row, each harder; one round each; lose and it's over
function startArcade(playerId) {
    match = {mode: 'arcade', map: P.ARENAS[0], world: null, phase: 'countdown', phaseT: 0, queue: [], active: [],
        target: 1, timeLimit: 0, clock: 0, weapons: sel.weapons, roundWins: new Map(), bomb: null, voteClock: 0,
        vote: null, round: 0, winner: null, champion: null, bestCombo: new Map(), finisher: null,
        arcade: {player: playerId, stage: 0, bot: addBot(Bot.LADDER[0]), t0: Date.now()}};
    scene = 'match';
    startRound();
    pendingEvents.push({type: 'match', mode: 'arcade', map: match.map,
        name: `STAGE 1 · ${Bot.STYLES[Bot.LADDER[0]].name.toUpperCase()}`});
}

function arcadeRoundEnd() {
    const m = match, a = m.arcade;
    const secs = Math.round((Date.now() - a.t0) / 1000);
    if (m.winner === a.player) {
        a.stage++;
        if (a.stage >= Bot.LADDER.length) {
            m.champion = a.player;
            pendingEvents.push({type: 'arcadeWin', time: secs});
            pendingEvents.push({type: 'roundEnd', winner: a.player, champion: a.player, stats: championStats(m)});
            return setPhase('end');
        }
        pendingEvents.push({type: 'stageClear', stage: a.stage, time: secs,
            next: Bot.STYLES[Bot.LADDER[a.stage]].name});
        return setPhase('clear');
    }
    const by = Bot.STYLES[Bot.LADDER[Math.min(a.stage, Bot.LADDER.length - 1)]].name;
    pendingEvents.push({type: 'gameOver', stage: a.stage + 1, by});
    setPhase('end');
}

function nextArcadeStage() {
    const m = match, a = m.arcade;
    players.delete(a.bot);
    a.bot = addBot(Bot.LADDER[a.stage]);
    a.t0 = Date.now();
    m.map = P.ARENAS[a.stage % P.ARENAS.length];
    m.world = null;                       // a new arena, health restored
    startRound();
    pendingEvents.push({type: 'match', mode: 'arcade', map: m.map,
        name: `STAGE ${a.stage + 1} · ${Bot.STYLES[Bot.LADDER[a.stage]].name.toUpperCase()}`});
}

// R in 1P: the round again, straight away (after the last round: the whole match, or the arcade stage)
function restartSolo() {
    const m = match, fresh = m.phase === 'end' && !!m.arcade;
    if (fresh) {             // the run is over (won or lost): the ladder from the bottom
        players.delete(m.arcade.bot);
        Object.assign(m.arcade, {stage: 0, bot: addBot(Bot.LADDER[0]), t0: Date.now()});
        m.map = P.ARENAS[0];
        m.roundWins = new Map(); m.champion = null; m.round = 0;
        m.bestCombo = new Map(); m.finisher = null;
    } else if (m.phase === 'end') {
        m.roundWins = new Map(); m.champion = null; m.round = 0;
        m.bestCombo = new Map(); m.finisher = null;
    } else {
        m.round--;
    }
    if (m.mode === 'koth') {                         // (the one player and their bot, back in the ring)
        const all = [...new Set([...m.active, ...m.queue])].filter(id => players.has(id));
        m.active = all.slice(0, 2);
        m.queue = all.slice(2);
    }
    m.world = null;
    pendingEvents.push({type: 'restart'});
    startRound();
    if (fresh)
        pendingEvents.push({type: 'match', mode: 'arcade', map: m.map, name: `STAGE 1 · ${Bot.STYLES[Bot.LADDER[0]].name.toUpperCase()}`});
}

// the winner's card: rounds won and the best of the rest, the longest combo, the move that ended it
const MOVE_NAMES = {jab: 'Jab', hook: 'Body Hook', straight: 'Straight', uppercut: 'Uppercut', airkick: 'Flying Kick',
    dive: 'Dive Kick', lunge: 'Lunging Straight', sweep: 'Low Sweep', pound: 'Ground Pound', grab: 'Throw',
    ledgekick: 'Ledge Hop Kick',
    katana: 'Katana', bat: 'Home-Run Bat', laser: 'Laser Blaster', grenade: 'Bouncy Bomb', thrown: 'Thrown Weapon'};

function championStats(m) {
    const wins = m.roundWins.get(m.champion) || (m.mode === 'arcade' ? m.arcade.stage : 0);
    const others = [...m.roundWins].filter(([id]) => id !== m.champion).map(([, n]) => n);
    const finisher = m.finisher && m.finisher.by === m.champion ? MOVE_NAMES[m.finisher.kind] || 'Knockout' : 'Knockout';
    return {rounds: `${wins}-${others.length ? Math.max(...others) : 0}`, combo: m.bestCombo.get(m.champion) || 1,
        finisher};
}

function backToLobby() {
    scene = 'lobby';
    match = null;
    lobby = newLobby();
    for (const p of players.values()) {
        if (p.bot) {
            players.delete(p.id);
        } else {
            p.near = undefined;           // (so they're told afresh which station they're at)
            lobbySpawn(p);
        }
    }
    pendingEvents.push({type: 'lobby'});
    roster();
}

// Bomb Tag: a bomb on someone; a punch passes it on; at zero it goes off
function bombTick(dt) {
    const m = match, w = m.world;
    const alive = w.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone');
    if (!m.bomb) {
        if (alive.length < 2)
            return;
        const carrier = alive[Math.floor(Math.random() * alive.length)];
        m.bomb = {id: carrier.id, t: BOMB_FUSE, passCd: 0};
        pendingEvents.push({type: 'bomb', id: carrier.id});
    }
    const b = m.bomb;
    b.t -= dt * w.timeScale;
    b.passCd = Math.max(0, b.passCd - dt);
    for (const e of w.events) {
        if (e.type === 'hit' && e.by === b.id && e.on !== b.id && b.passCd <= 0) {
            b.id = e.on;
            b.passCd = 0.6;          // no passing straight back
            pendingEvents.push({type: 'bombpass', from: e.by, to: e.on});
        }
    }
    const carrier = w.fighters.find(f => f.id === b.id);
    if (!carrier || carrier.st === 'ko' || carrier.st === 'gone') {
        m.bomb = null;
        return;
    }
    if (Math.floor(b.t) !== Math.floor(b.t + dt))
        pendingEvents.push({type: 'tick', t: Math.ceil(b.t)});
    if (b.t <= 0) {
        P.explode(w, carrier.x, carrier.y - 50, 300, 1300, carrier);
        P.knockOut(w, carrier, null);
        m.bomb = null;
    }
}

// ---------------------------------------------------------------- the crowd's vote
function hazards(dt) {
    const m = match, w = m.world;
    if (m.mode === 'bomb')
        return;
    if (m.vote) {
        m.vote.t -= dt;
        if (m.vote.t <= 0) {
            const [a, b] = m.vote.options;
            const ca = m.vote.ballots.filter(v => v === 0).length, cb = m.vote.ballots.length - ca;
            const pick = ca === cb ? (Math.random() < 0.5 ? a : b) : ca > cb ? a : b;
            w.hazard = pick;
            w.hazardT = HAZARD_FOR;
            w.anvilT = 0;
            pendingEvents.push({type: 'hazard', hazard: pick, name: P.HAZARDS[pick], votes: [ca, cb]});
            m.vote = null;
            m.voteClock = 0;
        }
        return;
    }
    if (w.hazard)
        return;
    m.voteClock += dt;
    if (m.voteClock >= VOTE_EVERY) {
        const options = P.VOTE_PAIRS[Math.floor(Math.random() * P.VOTE_PAIRS.length)];
        const voters = m.mode === 'koth' ? m.queue.filter(id => players.has(id) && !players.get(id).bot) :
            humans().map(p => p.id);
        m.vote = {options, t: VOTE_FOR, ballots: [], by: new Map(), voters};
        pendingEvents.push({type: 'vote', options, names: options.map(o => P.HAZARDS[o])});
    }
}

// ---------------------------------------------------------------- the tick
function tick(dt) {
    const host = hostId();
    if (host !== lastHost) {
        if (lastHost !== null && host !== null)
            pendingEvents.push({type: 'host', id: host});
        lastHost = host;
    }
    if (scene === 'lobby')
        lobbyTick(dt);
    else
        matchTick(dt);
    broadcast(snapshot());
    pendingEvents = [];
}

function lobbyTick(dt) {
    const inputs = {};
    for (const p of players.values())
        inputs[p.id] = p.input;
    lobby.events = [];
    P.step(lobby, inputs, dt);
    pendingEvents.push(...lobby.events);
    for (const e of lobby.events) {
        if (e.type === 'climb') {
            const name = (players.get(e.id) || {}).name || '?', mine = climbBoard.find(r => r.name === name);
            if (!mine || e.t < mine.t) {
                climbBoard = [...climbBoard.filter(r => r.name !== name), {t: e.t, name}].sort((a, b) => a.t - b.t).slice(0, 5);
                if (climbBoard[0].name === name && climbBoard[0].t === e.t)
                    pendingEvents.push({type: 'record', t: e.t, name});
            }
        }
    }
    // the goal against the right wall: the ball over the line scores, then comes back after 1.5 s
    const b = lobby.ball;
    if (b && b.goalT !== undefined) {
        b.goalT -= dt;
        Object.assign(b, {x: 1570, y: 760, vx: 0, vy: 0});
        if (b.goalT <= 0) {
            delete b.goalT;
            Object.assign(b, {x: P.W / 2 - 120, y: 360, vx: 0, vy: 0});     // a soft drop in the middle
        }
    } else if (b && b.x >= 1540 && b.y >= 650) {
        lobbyGoals++;
        b.goalT = 1.5;
        pendingEvents.push({type: 'goal', x: 1560, y: 720, goals: lobbyGoals, by: b.by || null});
    }
    // the stations: each player is told which one they stand at (the page shows its prompt)
    const st = P.MAPS.lobby.stations;
    for (const f of lobby.fighters) {
        const p = players.get(f.id);
        if (!p)
            continue;
        const near = Object.keys(st).find(k => k !== 'dummy' && Math.abs(f.x - st[k].x) < STATION_REACH &&
            Math.abs(f.y - st[k].y) < 120) || null;
        if (near !== p.near) {
            p.near = near;
            send(p.ws, {type: 'near', station: near});
        }
    }
}

function matchTick(dt) {
    const m = match;
    if (m.paused)                         // 1P, menu open: the whole match holds still
        return;
    m.phaseT += dt;
    ensureBot();
    if (m.phase === 'waiting') {
        if ((m.mode === 'koth' ? m.active.length + m.queue.length : players.size) >= 2 && m.phaseT > 0.5)
            startRound();
    } else if (m.phase === 'countdown') {
        // the one countdown: GET READY while the stage loads (0.5 s), then 3, 2, 1, FIGHT!, each announced
        // from here, so every browser plays the same chime on the same tick
        const n = m.phaseT < GET_READY ? 4 : 3 - Math.floor(m.phaseT - GET_READY);
        if (n <= 0) {
            setPhase('fight');
            pendingEvents.push({type: 'count', n: 0, text: 'FIGHT!'});
        } else if (n <= 3 && n !== m.count) {
            m.count = n;
            pendingEvents.push({type: 'count', n});
        }
    } else if (m.phase === 'ko') {
        if (m.phaseT >= 3)
            startRound();
    } else if (m.phase === 'clear') {
        if (m.phaseT >= 3.5)
            nextArcadeStage();
    } else if (m.phase === 'end') {
        if (m.phaseT >= 7.5)                 // the K.O., then the winner's card with its countdown
            return backToLobby();
    }
    const w = m.world;
    for (const f of w.fighters) {
        const p = players.get(f.id);
        if (p && p.bot)
            p.input.k = m.phase === 'fight' ? Bot.think(f, w, p.bot.style, p.bot.mem, dt) : 0;
    }
    const inputs = {};
    for (const p of players.values())
        inputs[p.id] = m.phase === 'fight' ? p.input : {k: 0, aim: null};
    w.events = [];
    P.step(w, inputs, dt);
    for (const e of w.events) {           // for the winner's card: the best combo, the finishing blow
        if (e.type === 'combo')
            m.bestCombo.set(e.by, Math.max(m.bestCombo.get(e.by) || 0, e.n));
        if (e.type === 'ko' && e.by !== null && e.by !== undefined)
            m.finisher = {by: e.by, kind: e.kind};
    }
    if (m.phase === 'fight') {
        if (m.mode === 'bomb')
            bombTick(dt);
        const standing = w.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone');
        if (standing.length <= 1 && w.fighters.length >= 2 && !w.koWait)
            w.koWait = 1.2;              // let the K.O. play out before the round ends
        if (w.koWait) {
            w.koWait -= dt;
            if (w.koWait <= 0) {
                w.koWait = 0;
                endRound();
            }
        }
        // the round timer: at zero, the most health wins
        m.clock += dt;
        if (m.timeLimit && m.clock >= m.timeLimit && m.phase === 'fight' && !w.koWait && m.mode !== 'bomb') {
            const standing = w.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone').sort((a, b) => b.hp - a.hp);
            const best = standing.length && (standing.length === 1 || standing[0].hp > standing[1].hp) ? standing[0].id : null;
            pendingEvents.push({type: 'timeup'});
            endRound(best);
        }
        if (m.mode !== 'arcade')
            hazards(dt);
    }
    pendingEvents.push(...w.events);
}

// ---------------------------------------------------------------- snapshots
const r1 = v => Math.round(v * 10) / 10;

function snapshot() {
    const w = scene === 'lobby' ? lobby : match.world;
    const m = match;
    const bomb = m && m.bomb;
    return {
        type: 's', scene, map: w.map, host: hostId(), ts: r1(w.timeScale),
        sel, ready: humans().length, max: MAX_PLAYERS, starting: null,
        ph: m ? m.phase : 'lobby', pt: m ? r1(m.phaseT) : 0, mode: m ? m.mode : null, round: m ? m.round : 0,
        winner: m ? m.winner : null, champion: m ? m.champion : null,
        hz: w.hazard, hzT: r1(w.hazardT),
        vote: m && m.vote ? {o: m.vote.options, t: r1(m.vote.t), c: [m.vote.ballots.filter(v => v === 0).length,
            m.vote.ballots.filter(v => v === 1).length], v: m.vote.voters} : null,
        bomb: bomb ? {id: bomb.id, t: r1(bomb.t)} : null,
        beam: w.beam ? {ph: w.beam.phase, x: Math.round(w.beam.x), n: r1(w.beam.next)} : null,
        pl: w.plats.map(p => [p.alive ? 1 : 0, p.breaking > 0 ? 1 : 0, p.load > 0 ? r1(p.load / (p.crumbleAfter || 1.6)) : 0,
            p.solid ? p.hp : 0, Math.round(p.x), Math.round(p.y)]),
        ball: w.ball ? [Math.round(w.ball.x), Math.round(w.ball.y)] : null,
        lavaY: w.lavaY !== null ? Math.round(w.lavaY) : null,
        tunnel: w.tunnel ? {x: w.tunnel.x === null ? null : Math.round(w.tunnel.x), warn: !!w.tunnel.warned} : null,
        heat: w.floorLava ? {hot: r1(w.hot), next: r1(w.hotT)} : null,
        f: w.fighters.filter(f => f.st !== 'gone').map(f => [
            f.id, Math.round(f.x), Math.round(f.y), Math.round(f.vx), Math.round(f.vy), f.face, Math.ceil(f.hp), f.st,
            f.atk ? f.atk.kind : 0, f.atk ? r1(f.atk.t / f.atk.move.dur) : f.mantle ? r1(f.mp || 0) : 0, f.combo,
            f.inv > 0 ? 1 : 0, f.shield > 0 ? 1 : 0, r1(f.spin), f.ground ? 1 : 0,
            f.atk && f.atk.dir ? r1(f.atk.dir.y) : 0, f.weapon ? f.weapon.kind : 0, f.weapon ? f.weapon.uses : 0,
            f.ghost ? 1 : 0, f.climbStart !== undefined ? Math.round((w.time - f.climbStart) * 100) / 100 : -1]),
        goals: lobbyGoals, record: climbBoard[0] || null, board: climbBoard, ballOut: !!(w.ball && w.ball.goalT !== undefined),
        cr: w.crates.map(c => [Math.round(c.x), Math.round(c.y), c.kind, c.landed ? 1 : 0]),
        sh: w.shots.map(s => [Math.round(s.x), Math.round(s.y), s.kind, Math.round(s.vx)]),
        tl: m && m.timeLimit ? Math.max(0, Math.ceil(m.timeLimit - m.clock)) : null,
        arcade: m && m.arcade ? {stage: m.arcade.stage + 1, of: Bot.LADDER.length, player: m.arcade.player,
            t: Math.round((Date.now() - m.arcade.t0) / 1000)} : null,
        target: m ? m.target : sel.target, version: VERSION, sandbox: !!(m && m.sandbox), paused: !!(m && m.paused),
        an: w.anvils.map(a => [Math.round(a.x), Math.round(a.y)]),
        q: m ? m.queue : [], act: m ? m.active : [],
        wins: m ? [...m.roundWins] : [],
        ev: pendingEvents,
    };
}

// ---------------------------------------------------------------- sockets
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.\-!?]/gu, '').trim().slice(0, 16);

function removePlayer(id) {
    players.delete(id);
    if (match && (match.arcade || match.sandbox) && (match.arcade || match.sandbox).player === id) {   // the solo player left
        backToLobby();
        return roster();
    }
    lobby.fighters = lobby.fighters.filter(f => f.id !== id);
    if (match) {
        match.queue = match.queue.filter(q => q !== id);
        const wasActive = match.active.includes(id);
        match.active = match.active.filter(a => a !== id);
        match.world.fighters = match.world.fighters.filter(f => f.id !== id);
        if (match.bomb && match.bomb.id === id)
            match.bomb = null;
        if (wasActive && (match.phase === 'fight' || match.phase === 'countdown'))
            endRound();
        if (!humans().length)
            backToLobby();
    }
    roster();
}

// the feedback list, kept in memory; read from disk only when the file has changed under us (the host
// cleared or edited it), so a stream of notes never means a stream of re-reads
const feedbackCache = {list: null, mtime: null};
function feedbackList() {
    let mtime = null;
    try {
        mtime = fs.statSync(FEEDBACK_FILE).mtimeMs;
    } catch { /* no file yet */ }
    if (feedbackCache.list && mtime === feedbackCache.mtime)
        return feedbackCache.list;
    let list = [];
    if (mtime !== null) {
        try {
            list = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8'));
            if (!Array.isArray(list))
                throw new Error('not a list');
        } catch {                                  // unreadable: set it aside (never overwritten), start a new one
            const aside = FEEDBACK_FILE.replace(/\.json$/, '') + `.unreadable-${Date.now()}.json`;
            fs.renameSync(FEEDBACK_FILE, aside);
            console.log(`[Feedback] ${path.basename(FEEDBACK_FILE)} couldn't be read; kept it as ${path.basename(aside)}`);
            list = [];
            mtime = null;
        }
    }
    Object.assign(feedbackCache, {list, mtime});
    return list;
}

// a feedback entry, appended to feedback.json (written to a temporary file, then renamed over it,
// so a crash mid-write never leaves half a file). Returns null, or why it wasn't kept.
function saveFeedback(p, category, text) {
    const list = feedbackList();
    if (list.length >= FEEDBACK_MAX)
        return 'The feedback box is full: ask the host to clear it.';
    const entry = {author: p.name, category: FEEDBACK[category], text, timestamp: new Date().toISOString()};
    list.push(entry);
    const tmp = `${FEEDBACK_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
    fs.renameSync(tmp, FEEDBACK_FILE);
    feedbackCache.mtime = fs.statSync(FEEDBACK_FILE).mtimeMs;
    const oneLine = text.replace(/\s+/g, ' ');
    console.log(`[Feedback] Received ${entry.category} from ${entry.author}: ` +
        (oneLine.length > 200 ? oneLine.slice(0, 200) + '…' : oneLine));
    return null;
}

// a colour belongs to one player at a time: freed when they change or leave
const colorOwner = color => [...players.values()].find(p => p.color === color && !p.bot);

function applyLook(p, m) {
    if (COLOR_VALUES.includes(m.color) && m.color !== p.color) {
        const owner = colorOwner(m.color);
        if (owner && owner !== p && m.restore) {   // a saved colour someone already wears: keep the free one given
            send(p.ws, {type: 'colorAssigned', color: p.color, remapped: true, wanted: m.color});
        } else if (owner && owner !== p) {
            send(p.ws, {type: 'colorTaken', color: m.color, by: owner.name});
        } else {
            p.color = m.color;
            pendingEvents.push({type: 'colorClaimed', id: p.id, color: m.color});
        }
    }
    const name = clean(m.name);
    if (name)
        p.name = name;
    // only what was sent changes (a name alone keeps your hat)
    if ('hat' in m)
        p.gear = Object.assign({}, p.gear, {hat: m.hat in P.HATS ? m.hat : null});
    if ('trail' in m && m.trail in P.TRAILS)
        p.gear = Object.assign({}, p.gear, {trail: m.trail});
    for (const w of [lobby, match && match.world]) {
        const f = w && w.fighters.find(o => o.id === p.id);
        if (f)
            Object.assign(f, {name: p.name, color: p.color, gear: p.gear});
    }
    roster();
}

const feedbackFrom = new Map();       // address -> when its last note came in
let feedbackAt = 0;                   // when the room's last note came in

wss.on('connection', (ws, req) => {
    const addr = req.socket.remoteAddress || '?';
    if (humans().length >= Math.min(MAX_PLAYERS, sel.limit)) {
        send(ws, {type: 'full'});
        return ws.close();
    }
    // you arrive in the lobby at once, as "Player N" in a free colour
    const id = nextId++;
    const used = new Set(humans().map(p => p.color));
    const color = COLOR_VALUES.find(c => !used.has(c)) || COLOR_VALUES[id % COLOR_VALUES.length];
    const me = {id, ws, name: `Player ${id}`, color, gear: {hat: 'bandana', trail: 'ghost'}, joined: Date.now(),
        input: {k: 0, aim: null}};
    players.set(id, me);
    if (scene === 'lobby')
        lobbySpawn(me);
    else if (match.mode === 'koth')
        match.queue.push(id);
    send(ws, {type: 'welcome', id, colors: P.COLORS, hats: P.HATS, trails: P.TRAILS, modes: P.MODES,
        maps: P.ARENAS.map(k => [k, P.MAPS[k].name]), choices: CHOICES, version: VERSION});
    roster();
    let budget = 120, last = Date.now();
    ws.on('message', raw => {
        try {
            onMessage(raw);
        } catch (e) {
            console.error(`[!] a message from player ${id} failed: ${e.message}`);
        }
    });
    const onMessage = raw => {
        const now = Date.now();
        budget = Math.min(120, budget + (now - last) * 0.12);    // at most ~120 messages a second
        last = now;
        if (--budget < 0)
            return;
        let m;
        try {
            m = JSON.parse(raw);
        } catch {
            return;
        }
        if (!m || typeof m !== 'object')
            return;
        const isHost = id === hostId();
        if (m.t === 'in') {
            me.input.k = (m.k | 0) & 1023;
            me.input.aim = typeof m.aim === 'number' && isFinite(m.aim) ? m.aim : null;
        } else if (m.t === 'look') {
            applyLook(me, m);
        } else if (m.t === 'ghost' || m.t === 'spar') {
            // in the wardrobe, or sparring the practice bot (in their own browser): untouchable in the lobby
            me[m.t] = !!m.on;
            const f = lobby.fighters.find(o => o.id === id);
            if (f)
                f.ghost = !!(me.ghost || me.spar);
            roster();
        } else if (m.t === 'emoji' && EMOJIS.includes(m.e)) {
            if (now - (me.lastEmoji || 0) > 250) {
                me.lastEmoji = now;
                pendingEvents.push({type: 'emoji', e: m.e, color: me.color});
            }
        } else if (m.t === 'vote' && match && match.vote && (m.o === 0 || m.o === 1) &&
            match.vote.voters.includes(id) && !match.vote.by.has(id)) {
            match.vote.by.set(id, m.o);
            match.vote.ballots.push(m.o);
        } else if (m.t === 'settings' && isHost && scene === 'lobby' && typeof m.key === 'string' &&
            Object.hasOwn(CHOICES, m.key) && CHOICES[m.key].includes(m.value)) {   // (own keys only: not "toString")
            sel[m.key] = m.value;                      // everyone's wall screen shows it next tick
            pendingEvents.push({type: 'console'});
        } else if (m.t === 'arcade' && isHost && scene === 'lobby') {
            startArcade(id);
        } else if (m.t === 'sandbox' && isHost && scene === 'lobby' &&
            humans().length === 1 && Object.hasOwn(SANDBOX.mode, m.mode) && Object.hasOwn(SANDBOX.level, m.level) &&
            Object.hasOwn(SANDBOX.crates, m.crates) && CHOICES.map.includes(m.map) && CHOICES.target.includes(m.target) &&
            [1, 2, 3].includes(m.bots)) {
            startSandbox(id, m);
        } else if (m.t === 'pause' && scene === 'match' && (match.sandbox || match.arcade) &&
            (match.sandbox || match.arcade).player === id) {
            match.paused = !!m.on;               // (only a 1P match: with others in the room it goes on)
        } else if (m.t === 'restart' && scene === 'match' && (match.sandbox || match.arcade) &&
            (match.sandbox || match.arcade).player === id && ['countdown', 'fight', 'ko', 'end'].includes(match.phase)) {
            match.paused = false;
            restartSolo();
        } else if (m.t === 'console' && isHost && scene === 'lobby' && (me.near === 'console' || m.do === 'start')) {
            // the host's console: Q cycles the mode, Tab the map, Start starts
            if (m.do === 'mode') {
                sel.mode = CHOICES.mode[(CHOICES.mode.indexOf(sel.mode) + 1) % CHOICES.mode.length];
            } else if (m.do === 'map') {
                sel.map = CHOICES.map[(CHOICES.map.indexOf(sel.map) + 1) % CHOICES.map.length];
            } else if (m.do === 'start') {
                // straight onto the stage: the match's own countdown is the only one. Random and Shuffle are
                // settled here, before anyone is told
                const picked = resolvePick();
                pendingEvents.push({type: 'starting', mode: picked.mode, map: picked.map});
                startMatch(picked);
                return;
            }
            pendingEvents.push({type: 'console'});
        } else if (m.t === 'feedback' && Object.hasOwn(FEEDBACK, m.category) && typeof m.text === 'string') {
            // (control characters out, newlines kept; at most 1000 characters; one every 15 s each)
            const text = m.text.replace(/[^\P{C}\n]/gu, '').trim().slice(0, 1000);
            if (!text)
                return send(ws, {type: 'feedbackRefused', why: 'Write something first.'});
            // one every 15 s from each computer (a new connection doesn't reset it), and one every 2 s for the
            // whole room; the clock starts with the attempt, whatever its outcome
            if (now - (feedbackFrom.get(addr) || 0) < 15000)
                return send(ws, {type: 'feedbackRefused', why: 'One every 15 seconds, please.'});
            if (now - feedbackAt < 2000)
                return send(ws, {type: 'feedbackRefused', why: 'The box is busy: try again in a moment.'});
            feedbackFrom.set(addr, now);
            feedbackAt = now;
            let why;
            try {
                why = saveFeedback(me, m.category, text);
            } catch (e) {
                console.error(`[!] feedback couldn't be saved: ${e.message}`);
                why = "The host's computer couldn't save it.";
            }
            send(ws, why ? {type: 'feedbackRefused', why} : {type: 'feedbackSaved'});
        } else if (m.t === 'lobby' && isHost && scene === 'match') {
            backToLobby();
        }
    };
    ws.on('close', () => removePlayer(id));
});

let lastTick = process.hrtime.bigint();
setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Math.min(0.1, Number(now - lastTick) / 1e9);
    lastTick = now;
    try {
        tick(dt);
    } catch (e) {                         // log it and carry on: the next tick is a fresh chance
        console.error(`[!] tick failed: ${e.stack}`);
    }
}, 1000 / TPS);

server.listen(PORT, '0.0.0.0', () => {
    const urls = lanUrls();
    console.log('\n  STICK HAVOC: Tournament Edition is up. No internet needed.\n');
    if (!urls.length)
        console.log(`  No network found: on this computer, open http://localhost:${PORT}\n`);
    for (const u of urls)
        console.log(`  ${u.name.padEnd(10)} ${u.url}`);
    if (urls.length) {
        console.log('\n  Everyone on the same Wi-Fi or hotspot: open that address, or scan:\n');
        qrcodeTerminal.generate(urls[0].url, {small: true});
    }
    console.log(`  (this computer: http://localhost:${PORT})\n`);
    console.log('  ⚡ Stick Havoc         https://github.com/MehulK-techie/stick-havoc.git');
    console.log('  🐧 Fedora Workstation  https://github.com/MehulK-techie/fedora-workstation-config.git\n');
});
