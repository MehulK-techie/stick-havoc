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

const PORT = Number(process.env.PORT) || 3000;
const TPS = 30;
const MAX_PLAYERS = 10;
const VOTE_EVERY = Number(process.env.VOTE_EVERY) || 45, VOTE_FOR = 5, HAZARD_FOR = 15;   // seconds
const BOMB_FUSE = Number(process.env.BOMB_FUSE) || 20;
const KOTH_TARGET = 5, RUMBLE_TARGET = 3;                // wins that end a match
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
const sel = {mode: 'koth', map: 'rooftops'};    // what the host has picked
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

// ---------------------------------------------------------------- the training bot
// Alone in King of the Hill, you spar with a bot until a second person is in.
function ensureBot() {
    const bots = [...players.values()].filter(p => p.bot);
    const want = scene === 'match' && match.mode === 'koth' && humans().length === 1;
    if (want && !bots.length) {
        const id = nextId++;
        players.set(id, {id, name: 'Training Bot', color: '#94a3b8', gear: {hat: 'visor'}, joined: Date.now(),
            input: {k: 0, aim: null}, bot: {think: 0, k: 0}});
        match.queue.push(id);
        roster();
    } else if (!want && bots.length) {
        for (const b of bots)
            removePlayer(b.id);
    }
}

function botThink(p, f, w, dt) {
    const b = p.bot;
    b.think -= dt;
    if (b.think > 0)
        return;
    b.think = 0.1 + Math.random() * 0.12;
    const foes = w.fighters.filter(o => o.id !== f.id && o.st !== 'ko' && o.st !== 'gone' && !o.dummy);
    if (!foes.length) {
        p.input.k = 0;
        return;
    }
    const foe = foes.reduce((a, o) => Math.abs(o.x - f.x) < Math.abs(a.x - f.x) ? o : a);
    const dx = foe.x - f.x, dy = foe.y - f.y;
    let k = 0;
    if (Math.abs(dx) > 70)
        k |= dx > 0 ? P.IN.RIGHT : P.IN.LEFT;
    if (dy < -100 && Math.random() < 0.5)
        k |= P.IN.JUMP;
    if (dy > 100 && Math.random() < 0.3)
        k |= P.IN.DOWN | P.IN.JUMP;
    if (Math.abs(dx) < 90 && Math.abs(dy) < 80) {
        const r = Math.random();
        k |= r < 0.65 ? P.IN.LIGHT : r < 0.85 ? P.IN.HEAVY : P.IN.DASH;
    }
    // stay out of the pit: don't walk off an edge; falling with nothing below, get back
    if (w.pit) {
        const under = x => w.plats.some(q => q.alive && x >= q.x && x <= q.x + q.w && q.y >= f.y - 4);
        const ahead = f.x + (k & P.IN.RIGHT ? 60 : k & P.IN.LEFT ? -60 : 0);
        if (f.ground && !under(ahead)) {
            const dir = k & P.IN.RIGHT ? 1 : -1;
            const reachable = w.plats.some(q => q.alive && q.y > f.y - 260 &&
                (dir > 0 ? q.x > f.x && q.x - f.x < 340 : f.x > q.x + q.w && f.x - (q.x + q.w) < 340));
            if (reachable && (k & (P.IN.LEFT | P.IN.RIGHT)))
                k |= P.IN.JUMP;                     // another platform in reach: jump the gap
            else
                k &= ~(P.IN.LEFT | P.IN.RIGHT);
        } else if (!f.ground && f.vy > 0 && !under(f.x)) {
            const home = w.plats.filter(q => q.alive).reduce((a, q) =>
                Math.abs(q.x + q.w / 2 - f.x) < Math.abs(a.x + a.w / 2 - f.x) ? q : a);
            k = (k & ~(P.IN.LEFT | P.IN.RIGHT)) | (home.x + home.w / 2 > f.x ? P.IN.RIGHT : P.IN.LEFT);
            k |= f.jumps > 0 ? P.IN.JUMP : P.IN.DASH;
        }
    }
    const taps = P.IN.LIGHT | P.IN.HEAVY | P.IN.JUMP | P.IN.DASH;
    p.input.k = (b.k & taps) ? k & ~taps : k;      // let go now and then, so taps are taps
    b.k = p.input.k;
}

// ---------------------------------------------------------------- matches
function startMatch() {
    const ids = humans().map(p => p.id);
    match = {mode: sel.mode, map: sel.map, world: null, phase: 'countdown', phaseT: 0, queue: [], active: [],
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
    m.round++;
    m.winner = null;
    if (m.mode === 'koth') {
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

function endRound() {
    const m = match;
    const standing = m.world.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone' && f.hp > 0);
    m.winner = standing.length === 1 ? standing[0].id : null;
    if (m.winner)
        m.roundWins.set(m.winner, (m.roundWins.get(m.winner) || 0) + 1);
    if (m.mode === 'koth') {   // the loser goes to the back of the line; the winner stays
        const losers = m.active.filter(id => id !== m.winner);
        m.active = m.active.filter(id => id === m.winner);
        m.queue.push(...losers.filter(id => players.has(id)));
    }
    const target = m.mode === 'koth' ? KOTH_TARGET : m.mode === 'rumble' ? RUMBLE_TARGET : 1;
    if (m.winner && m.roundWins.get(m.winner) >= target)
        m.champion = m.winner;
    pendingEvents.push({type: 'roundEnd', winner: m.winner, champion: m.champion});
    setPhase(m.champion ? 'end' : 'ko');
    roster();
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
    } else if (m.phase === 'end') {
        if (m.phaseT >= 5)
            return backToLobby();
    }
    const w = m.world;
    for (const f of w.fighters) {
        const p = players.get(f.id);
        if (p && p.bot)
            botThink(p, f, w, dt);
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
            f.atk && f.atk.dir ? r1(f.atk.dir.y) : 0]),
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
    if (humans().length >= MAX_PLAYERS) {
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
        maps: P.ARENAS.map(k => [k, P.MAPS[k].name])});
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
            me.input.k = (m.k | 0) & 511;
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
        } else if (m.t === 'console' && isHost && scene === 'lobby' && me.near === 'console') {
            // the host's console: Q cycles the mode, Tab the map, E starts
            if (m.do === 'mode') {
                const keys = Object.keys(P.MODES);
                sel.mode = keys[(keys.indexOf(sel.mode) + 1) % keys.length];
            } else if (m.do === 'map') {
                sel.map = P.ARENAS[(P.ARENAS.indexOf(sel.map) + 1) % P.ARENAS.length];
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
