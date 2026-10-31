// Stick Havoc: Tournament Edition — the LAN host.
//   node server.js            (PORT=3000 by default)
// Serves the game to any browser on the network and runs the one true
// game state at 30 ticks a second; browsers send their keys and draw.
//
// Everyone arrives in the lobby: a room to walk around in, with a
// wardrobe, a punching dummy and the host's console. The host picks a
// mode and a map there and starts the match; afterwards, back to the lobby.
'use strict';
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
const TPS = 30;
const MAX_PLAYERS = 10;
const VOTE_EVERY = Number(process.env.VOTE_EVERY) || 45, VOTE_FOR = 5, HAZARD_FOR = 15;   // seconds
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
const wss = new WebSocketServer({server, maxPayload: 2048});

// ---------------------------------------------------------------- the room
let nextId = 1;
const players = new Map();      // id -> {id, ws, name, color, gear, wins, joined, input, bot}
// the room's settings: the host changes them at the console
const sel = {mode: 'koth', map: 'rooftops', target: 5, timer: 0, weapons: true, limit: MAX_PLAYERS};
const CHOICES = {mode: ['koth', 'rumble', 'bomb', 'random'], map: [...P.ARENAS, 'random'], target: [3, 5, 7],
    timer: [45, 60, 90, 0], weapons: [true, false], limit: [2, 3, 4, 5, 6, 7, 8, 9, 10]};
let lastHost = null;
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
            wins: match ? (match.roundWins.get(p.id) || 0) : 0, bot: !!p.bot}))});
}

// a fighter in the lobby for player p (at a free spawn spot)
function lobbySpawn(p) {
    const spots = P.MAPS.lobby.spawns;
    const [x, y] = spots[(p.id - 1) % spots.length];
    const f = P.makeFighter(p.id, p.name, p.color, x, y - 40, p.gear);
    f.shield = 0;
    lobby.fighters.push(f);
}

// ---------------------------------------------------------------- bots
// a computer fighter (bot.js plays it): the training bot, or an arcade opponent
function addBot(style) {
    const S = Bot.STYLES[style], id = nextId++;
    players.set(id, {id, name: S.name, color: S.color, gear: {hat: S.hat, eyes: !!S.eyes}, joined: Date.now(),
        input: {k: 0, aim: null}, bot: {style, mem: {}}});
    return id;
}

// alone in King of the Hill, you spar with the training bot until a second person is in
function ensureBot() {
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

function startMatch() {
    const ids = humans().map(p => p.id);
    const mode = sel.mode === 'random' ? pick(['koth', 'rumble', 'bomb']) : sel.mode;
    const map = sel.map === 'random' ? pick(P.ARENAS) : sel.map;
    match = {mode, map, world: null, phase: 'countdown', phaseT: 0, queue: [], active: [], target: sel.target,
        timeLimit: sel.timer, clock: 0, weapons: sel.weapons,
        roundWins: new Map(), bomb: null, voteClock: 0, vote: null, round: 0, winner: null, champion: null};
    if (match.mode === 'koth')
        match.queue = ids.slice();
    scene = 'match';
    ensureBot();
    startRound();
    pendingEvents.push({type: 'match', mode: match.mode, map: match.map, name: P.MAPS[match.map].name});
}

function startRound() {
    const m = match;
    const keep = m.world && m.world.hazard ? {hazard: m.world.hazard, hazardT: m.world.hazardT} : {};
    m.world = Object.assign(P.createWorld(m.map), keep);
    m.world.noDamage = m.mode === 'bomb';
    m.world.weapons = m.weapons || (m.mode === 'arcade' && m.arcade.stage >= 3);
    m.round++;
    m.clock = 0;
    m.winner = null;
    if (m.mode === 'arcade') {
        m.active = [m.arcade.player, m.arcade.bot];
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
    m.active.forEach((id, i) => {
        const p = players.get(id);
        const [x, y] = spots[i % spots.length];
        m.world.fighters.push(P.makeFighter(id, p.name, p.color, x, y, p.gear));
    });
    if (m.mode === 'bomb')
        m.bomb = null;
    setPhase(m.active.length >= 2 ? 'countdown' : 'waiting');
    roster();
}

function setPhase(phase) {
    match.phase = phase;
    match.phaseT = 0;
}

function endRound(forced) {
    const m = match;
    const standing = m.world.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone' && f.hp > 0);
    m.winner = forced !== undefined ? forced : standing.length === 1 ? standing[0].id : null;
    if (m.mode === 'arcade')
        return arcadeRoundEnd();
    if (m.winner)
        m.roundWins.set(m.winner, (m.roundWins.get(m.winner) || 0) + 1);
    if (m.mode === 'koth') {   // the loser goes to the back of the line; the winner stays
        const losers = m.active.filter(id => id !== m.winner);
        m.active = m.active.filter(id => id === m.winner);
        m.queue.push(...losers.filter(id => players.has(id)));
    }
    if (m.winner && m.roundWins.get(m.winner) >= m.target)
        m.champion = m.winner;
    pendingEvents.push({type: 'roundEnd', winner: m.winner, champion: m.champion});
    setPhase(m.champion ? 'end' : 'ko');
    roster();
}

// ---------------------------------------------------------------- 1P arcade
// five opponents in a row, each harder; one round each; lose and it's over
function startArcade(playerId) {
    match = {mode: 'arcade', map: P.ARENAS[0], world: null, phase: 'countdown', phaseT: 0, queue: [], active: [],
        target: 1, timeLimit: 0, clock: 0, weapons: sel.weapons, roundWins: new Map(), bomb: null, voteClock: 0,
        vote: null, round: 0, winner: null, champion: null,
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
            return setPhase('end');
        }
        pendingEvents.push({type: 'stageClear', stage: a.stage, time: secs,
            next: Bot.STYLES[Bot.LADDER[a.stage]].name});
        return setPhase('clear');
    }
    pendingEvents.push({type: 'gameOver', stage: a.stage + 1, by: Bot.STYLES[Bot.LADDER[a.stage]].name});
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

function backToLobby() {
    scene = 'lobby';
    match = null;
    lobby = newLobby();
    for (const p of players.values()) {
        if (p.bot)
            players.delete(p.id);
        else
            lobbySpawn(p);
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
    if (lobby.starting !== undefined) {         // the host pressed START: 3, 2, 1
        lobby.starting -= dt;
        if (lobby.starting <= 0) {
            delete lobby.starting;
            if (humans().length >= 1)
                startMatch();
        }
    }
}

function matchTick(dt) {
    const m = match;
    m.phaseT += dt;
    ensureBot();
    if (m.phase === 'waiting') {
        if ((m.mode === 'koth' ? m.active.length + m.queue.length : players.size) >= 2 && m.phaseT > 0.5)
            startRound();
    } else if (m.phase === 'countdown') {
        if (m.phaseT >= 3)
            setPhase('fight');
    } else if (m.phase === 'ko') {
        if (m.phaseT >= 3)
            startRound();
    } else if (m.phase === 'clear') {
        if (m.phaseT >= 3.5)
            nextArcadeStage();
    } else if (m.phase === 'end') {
        if (m.phaseT >= 5)
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
        sel, ready: humans().length, max: MAX_PLAYERS, starting: lobby.starting !== undefined ? r1(lobby.starting) : null,
        ph: m ? m.phase : 'lobby', pt: m ? r1(m.phaseT) : 0, mode: m ? m.mode : null, round: m ? m.round : 0,
        winner: m ? m.winner : null, champion: m ? m.champion : null,
        hz: w.hazard, hzT: r1(w.hazardT),
        vote: m && m.vote ? {o: m.vote.options, t: r1(m.vote.t), c: [m.vote.ballots.filter(v => v === 0).length,
            m.vote.ballots.filter(v => v === 1).length], v: m.vote.voters} : null,
        bomb: bomb ? {id: bomb.id, t: r1(bomb.t)} : null,
        beam: w.beam ? {ph: w.beam.phase, x: Math.round(w.beam.x), n: r1(w.beam.next)} : null,
        pl: w.plats.map(p => [p.alive ? 1 : 0, p.breaking > 0 ? 1 : 0, p.load > 0 ? r1(p.load / (p.crumbleAfter || 1.6)) : 0,
            p.solid ? p.hp : 0]),
        f: w.fighters.filter(f => f.st !== 'gone').map(f => [
            f.id, Math.round(f.x), Math.round(f.y), Math.round(f.vx), Math.round(f.vy), f.face, Math.ceil(f.hp), f.st,
            f.atk ? f.atk.kind : 0, f.atk ? r1(f.atk.t / f.atk.move.dur) : 0, f.combo,
            f.inv > 0 ? 1 : 0, f.shield > 0 ? 1 : 0, r1(f.spin), f.ground ? 1 : 0,
            f.atk && f.atk.dir ? r1(f.atk.dir.y) : 0, f.weapon ? f.weapon.kind : 0, f.weapon ? f.weapon.uses : 0]),
        cr: w.crates.map(c => [Math.round(c.x), Math.round(c.y), c.kind, c.landed ? 1 : 0]),
        sh: w.shots.map(s => [Math.round(s.x), Math.round(s.y), s.kind, Math.round(s.vx)]),
        tl: m && m.timeLimit ? Math.max(0, Math.ceil(m.timeLimit - m.clock)) : null,
        arcade: m && m.arcade ? {stage: m.arcade.stage + 1, of: Bot.LADDER.length, player: m.arcade.player,
            t: Math.round((Date.now() - m.arcade.t0) / 1000)} : null,
        target: m ? m.target : sel.target, version: VERSION,
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

function applyLook(p, m) {
    if (COLOR_VALUES.includes(m.color))
        p.color = m.color;
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

wss.on('connection', ws => {
    if (humans().length >= Math.min(MAX_PLAYERS, sel.limit)) {
        send(ws, {type: 'full'});
        return ws.close();
    }
    // you arrive in the lobby at once, as "Player N" in a free colour
    const id = nextId++;
    const used = new Set([...players.values()].map(p => p.color));
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
        } else if (m.t === 'emoji' && EMOJIS.includes(m.e)) {
            if (now - (me.lastEmoji || 0) > 250) {
                me.lastEmoji = now;
                pendingEvents.push({type: 'emoji', e: m.e, color: me.color});
            }
        } else if (m.t === 'vote' && match && match.vote && (m.o === 0 || m.o === 1) &&
            match.vote.voters.includes(id) && !match.vote.by.has(id)) {
            match.vote.by.set(id, m.o);
            match.vote.ballots.push(m.o);
        } else if (m.t === 'settings' && isHost && scene === 'lobby' && m.key in CHOICES &&
            CHOICES[m.key].includes(m.value)) {
            sel[m.key] = m.value;                      // everyone's wall screen shows it next tick
            pendingEvents.push({type: 'console'});
        } else if (m.t === 'arcade' && isHost && scene === 'lobby' && lobby.starting === undefined) {
            startArcade(id);
        } else if (m.t === 'console' && isHost && scene === 'lobby' && (me.near === 'console' || m.do === 'start')) {
            // the host's console: Q cycles the mode, Tab the map, Start starts
            if (m.do === 'mode') {
                sel.mode = CHOICES.mode[(CHOICES.mode.indexOf(sel.mode) + 1) % CHOICES.mode.length];
            } else if (m.do === 'map') {
                sel.map = CHOICES.map[(CHOICES.map.indexOf(sel.map) + 1) % CHOICES.map.length];
            } else if (m.do === 'start' && lobby.starting === undefined) {
                lobby.starting = 3;
                pendingEvents.push({type: 'starting', mode: sel.mode, map: sel.map});
            }
            pendingEvents.push({type: 'console'});
        } else if (m.t === 'lobby' && isHost && scene === 'match') {
            backToLobby();
        }
    });
    ws.on('close', () => removePlayer(id));
});

let lastTick = process.hrtime.bigint();
setInterval(() => {
    const now = process.hrtime.bigint();
    const dt = Math.min(0.1, Number(now - lastTick) / 1e9);
    lastTick = now;
    tick(dt);
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
});
