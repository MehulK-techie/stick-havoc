// Stick Havoc: Tournament Edition — the LAN host.
//   node server.js            (PORT=3000 by default)
// Serves the game to any browser on the network and runs the one true
// game state at 30 ticks a second; browsers send their keys and draw.
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
const EMOJIS = ['🔥', '💀', '🤡', '🚀'];

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

// ---------------------------------------------------------------- room state
let nextId = 1;
const players = new Map();      // id -> {id, ws, name, color, wins, joined, input, bot}
let mode = 'koth';
let world = P.createWorld(mode);
let phase = 'waiting', phaseT = 0;   // waiting | countdown | fight | ko
let queue = [];                       // King of the Hill: who's next, in order
let active = [];                      // ids in the ring
let voteClock = 0, vote = null;
let winnerId = null;
let pendingEvents = [];

function hostId() {
    let best = null;
    for (const p of players.values()) {
        if (!p.bot && (!best || p.joined < best.joined))
            best = p;
    }
    return best ? best.id : null;
}

function humans() {
    return [...players.values()].filter(p => !p.bot);
}

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
    for (const ws of watchers) {
        if (ws.readyState === 1)
            ws.send(s);
    }
}
const watchers = new Set();     // connected but not joined (the join screen)

function roster() {
    broadcast({type: 'roster', host: hostId(), mode,
        list: [...players.values()].map(p => ({id: p.id, name: p.name, color: p.color, wins: p.wins, bot: !!p.bot}))});
}

// ---------------------------------------------------------------- the training bot
// Alone in King of the Hill, you spar with a bot until a second person joins.
function ensureBot() {
    const bots = [...players.values()].filter(p => p.bot);
    const want = mode === 'koth' && humans().length === 1;
    if (want && !bots.length) {
        const id = nextId++;
        players.set(id, {id, name: 'Training Bot', color: '#94a3b8', wins: 0, joined: Date.now(), input: {k: 0, aim: null},
            bot: {t: 0, think: 0, k: 0}});
        queue.push(id);
        roster();
    } else if (!want && bots.length) {
        for (const b of bots)
            removePlayer(b.id);
    }
}

function botThink(p, f, dt) {
    const b = p.bot;
    b.think -= dt;
    if (b.think > 0)
        return;
    b.think = 0.12 + Math.random() * 0.12;
    const foes = world.fighters.filter(o => o.id !== f.id && o.st !== 'ko' && o.st !== 'gone');
    if (!foes.length) {
        p.input.k = 0;
        return;
    }
    const foe = foes.reduce((a, o) => Math.abs(o.x - f.x) < Math.abs(a.x - f.x) ? o : a);
    const dx = foe.x - f.x, dy = foe.y - f.y;
    let k = 0;
    if (Math.abs(dx) > 70)
        k |= dx > 0 ? P.IN.RIGHT : P.IN.LEFT;
    if (dy < -120 && Math.random() < 0.5)
        k |= P.IN.JUMP;
    if (Math.abs(dx) < 90 && Math.abs(dy) < 80) {
        const r = Math.random();
        k |= r < 0.6 ? P.IN.LIGHT : r < 0.8 ? P.IN.HEAVY : P.IN.DASH;
        if (dy < -40)
            k |= P.IN.UP;
    } else if (Math.random() < 0.05) {
        k |= P.IN.JUMP;
    }
    // release the buttons now and then, so presses register as new presses
    p.input.k = (b.k & (P.IN.LIGHT | P.IN.HEAVY | P.IN.JUMP | P.IN.DASH)) ? k & ~(P.IN.LIGHT | P.IN.HEAVY | P.IN.JUMP | P.IN.DASH) : k;
    b.k = p.input.k;
}

// ---------------------------------------------------------------- rounds
function spawnPoints(n) {
    if (mode === 'rumble') {
        const spots = [[200, 790], [420, 790], [700, 810], [900, 810], [1140, 790], [1380, 790], [360, 600], [1100, 600],
            [720, 420], [880, 420]];
        return spots.slice(0, n);
    }
    return [[400, 820], [1200, 820]];
}

function setPhase(p) {
    phase = p;
    phaseT = 0;
    broadcast({type: 'phase', phase, mode, winner: winnerId});
}

function startRound(keepPlatforms) {
    if (!keepPlatforms || mode === 'rumble')
        world = Object.assign(P.createWorld(mode), {hazard: world.hazard, hazardT: world.hazardT});
    world.fighters = [];
    winnerId = null;
    if (mode === 'koth') {
        queue = queue.filter(id => players.has(id));
        active = active.filter(id => players.has(id));
        while (active.length < 2 && queue.length)
            active.push(queue.shift());
    } else {
        active = [...players.keys()];
        queue = [];
    }
    const spots = spawnPoints(active.length);
    active.forEach((id, i) => {
        const p = players.get(id);
        const [x, y] = spots[i % spots.length];
        const f = P.makeFighter(id, p.name, p.color, x, y);
        f.shield = P.C.SPAWN_SHIELD;
        world.fighters.push(f);
    });
    setPhase(active.length >= 2 ? 'countdown' : 'waiting');
    roster();
}

function removePlayer(id) {
    players.delete(id);
    queue = queue.filter(q => q !== id);
    const wasActive = active.includes(id);
    active = active.filter(a => a !== id);
    world.fighters = world.fighters.filter(f => f.id !== id);
    if (wasActive && (phase === 'fight' || phase === 'countdown'))
        endRound();
    roster();
}

function endRound() {
    const standing = world.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone' && f.hp > 0);
    winnerId = standing.length === 1 ? standing[0].id : null;
    if (winnerId && players.has(winnerId))
        players.get(winnerId).wins++;
    if (mode === 'koth') {   // the loser goes to the back of the line; the winner stays
        const losers = active.filter(id => id !== winnerId);
        active = active.filter(id => id === winnerId);
        queue.push(...losers.filter(id => players.has(id)));
    }
    setPhase('ko');
    roster();
}

function tick(dt) {
    phaseT += dt;
    ensureBot();
    if (phase === 'waiting') {
        const want = mode === 'koth' ? (active.length + queue.length) : players.size;
        if (want >= 2 && phaseT > 0.5)
            startRound();
    } else if (phase === 'countdown') {
        if (phaseT >= 3)
            setPhase('fight');
    } else if (phase === 'ko') {
        if (phaseT >= 3)
            startRound(true);
    }
    // the bots press their buttons
    for (const f of world.fighters) {
        const p = players.get(f.id);
        if (p && p.bot)
            botThink(p, f, dt);
    }
    const inputs = {};
    for (const p of players.values())
        inputs[p.id] = phase === 'fight' ? p.input : {k: 0, aim: null};
    world.events = [];
    P.step(world, inputs, dt);
    if (phase === 'fight') {
        const standing = world.fighters.filter(f => f.st !== 'ko' && f.st !== 'gone');
        if (standing.length <= 1 && world.fighters.length >= 2 && !world.koWait)
            world.koWait = 1.2;              // let the K.O. play out before the round ends
        if (world.koWait) {
            world.koWait -= dt;
            if (world.koWait <= 0) {
                world.koWait = 0;
                endRound();
            }
        }
        hazards(dt);
    }
    pendingEvents.push(...world.events);
    broadcast(snapshot());
    pendingEvents = [];
}

// ---------------------------------------------------------------- the crowd's vote
function voters() {
    return mode === 'koth' ? queue.filter(id => players.has(id) && !players.get(id).bot) : humans().map(p => p.id);
}

function hazards(dt) {
    if (vote) {
        vote.t -= dt;
        if (vote.t <= 0) {
            const [a, b] = vote.options;
            const ca = vote.ballots.filter(v => v === 0).length, cb = vote.ballots.length - ca;
            const pick = ca === cb ? (Math.random() < 0.5 ? a : b) : ca > cb ? a : b;
            world.hazard = pick;
            world.hazardT = HAZARD_FOR;
            world.anvilT = 0;
            pendingEvents.push({type: 'hazard', hazard: pick, name: P.HAZARDS[pick], votes: [ca, cb]});
            vote = null;
            voteClock = 0;
        }
        return;
    }
    if (world.hazard)
        return;
    voteClock += dt;
    if (voteClock >= VOTE_EVERY) {
        const options = P.VOTE_PAIRS[Math.floor(Math.random() * P.VOTE_PAIRS.length)];
        vote = {options, t: VOTE_FOR, ballots: [], by: new Map(), voters: voters()};
        pendingEvents.push({type: 'vote', options, names: options.map(o => P.HAZARDS[o])});
    }
}

// ---------------------------------------------------------------- snapshots
const r1 = v => Math.round(v * 10) / 10;

function snapshot() {
    return {
        type: 's',
        ph: phase, pt: r1(phaseT), mode, ts: r1(world.timeScale), host: hostId(),
        hz: world.hazard, hzT: r1(world.hazardT),
        vote: vote ? {o: vote.options, t: r1(vote.t), c: [vote.ballots.filter(v => v === 0).length,
            vote.ballots.filter(v => v === 1).length], v: vote.voters} : null,
        pl: world.plats.map(p => [p.alive ? 1 : 0, p.breaking > 0 ? 1 : 0]),
        f: world.fighters.filter(f => f.st !== 'gone').map(f => [
            f.id, Math.round(f.x), Math.round(f.y), Math.round(f.vx), Math.round(f.vy), f.face, Math.ceil(f.hp), f.st,
            f.atk ? f.atk.kind : 0, f.atk ? r1(f.atk.t / f.atk.move.dur) : 0, f.combo,
            f.inv > 0 ? 1 : 0, f.shield > 0 ? 1 : 0, r1(f.spin), f.ground ? 1 : 0,
            f.atk && f.atk.dir ? r1(f.atk.dir.y) : 0]),
        an: world.anvils.map(a => [Math.round(a.x), Math.round(a.y)]),
        q: queue, act: active,
        ev: pendingEvents,
    };
}

// ---------------------------------------------------------------- sockets
const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.\-!?]/gu, '').trim().slice(0, 16);

wss.on('connection', ws => {
    let me = null;
    let budget = 120, last = Date.now();
    watchers.add(ws);
    send(ws, {type: 'hello', mode, colors: P.COLORS, full: players.size >= MAX_PLAYERS});
    roster();
    ws.on('message', raw => {
        // at most ~120 messages a second from anyone
        const now = Date.now();
        budget = Math.min(120, budget + (now - last) * 0.12);
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
        if (m.t === 'join' && !me) {
            if (humans().length >= MAX_PLAYERS)
                return send(ws, {type: 'full'});
            const id = nextId++;
            const color = P.COLORS.includes(m.color) ? m.color : P.COLORS[(id - 1) % P.COLORS.length];
            me = {id, ws, name: clean(m.name) || `Player ${id}`, color, wins: 0, joined: Date.now(), input: {k: 0, aim: null}};
            players.set(id, me);
            watchers.delete(ws);
            if (mode === 'koth')
                queue.push(id);
            send(ws, {type: 'welcome', id});
            ensureBot();
            if (mode === 'rumble' && phase !== 'waiting')
                pendingEvents.push({type: 'joined', name: me.name});
            roster();
        } else if (!me) {
            return;
        } else if (m.t === 'in') {
            me.input.k = (m.k | 0) & 255;
            me.input.aim = typeof m.aim === 'number' && isFinite(m.aim) ? m.aim : null;
        } else if (m.t === 'emoji' && EMOJIS.includes(m.e)) {
            if (now - (me.lastEmoji || 0) > 250) {
                me.lastEmoji = now;
                pendingEvents.push({type: 'emoji', e: m.e, color: me.color});
            }
        } else if (m.t === 'vote' && vote && (m.o === 0 || m.o === 1) && vote.voters.includes(me.id) && !vote.by.has(me.id)) {
            vote.by.set(me.id, m.o);
            vote.ballots.push(m.o);
        } else if (m.t === 'mode' && me.id === hostId() && (m.m === 'koth' || m.m === 'rumble') && m.m !== mode) {
            mode = m.m;
            queue = mode === 'koth' ? [...active, ...queue, ...[...players.keys()].filter(id =>
                !active.includes(id) && !queue.includes(id))] : [];
            active = [];
            world = P.createWorld(mode);
            pendingEvents.push({type: 'mode', mode});
            ensureBot();
            setPhase('waiting');
            roster();
        }
    });
    ws.on('close', () => {
        watchers.delete(ws);
        if (me)
            removePlayer(me.id);
    });
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
