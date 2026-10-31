// Plays the whole thing against a real server: the lobby (walking, the
// wardrobe, the dummy, the host's console), a King of the Hill match (hits,
// a K.O., the queue turning over, emojis, the crowd vote), back to the
// lobby, then Bomb Tag.  npm test
'use strict';
const {spawn} = require('child_process');
const WebSocket = require('ws');
const P = require('../public/physics.js');
const PORT = 3999;
const srv = spawn(process.execPath, [require.resolve('../server.js')],
    {env: {...process.env, PORT, VOTE_EVERY: 4, BOMB_FUSE: 3}});
let out = '';
srv.stdout.on('data', d => out += d);
srv.stderr.on('data', d => process.stderr.write(d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seen = new Set(), last = null, failures = 0;

function client(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = {ws, id: null, name, roster: null, near: null};
    ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'welcome') c.id = m.id;
        if (m.type === 'roster') c.roster = m;
        if (m.type === 'near') c.near = m.station;
        if (m.type === 's') {
            last = m;
            for (const e of m.ev) seen.add(e.type);
        }
    });
    c.send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
    c.me = () => last && last.f.find(f => f[0] === c.id);
    return new Promise(r => ws.on('open', () => setTimeout(() => r(c), 200)));
}

function check(what, ok) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures++;
}

async function until(cond, ms = 8000) {
    for (let t = 0; t < ms && !cond(); t += 50) await sleep(50);
    return cond();
}

// walk c to x (in the lobby), then stop
async function walkTo(c, x) {
    for (let t = 0; t < 8000; t += 50) {
        const me = c.me();
        if (me && Math.abs(me[1] - x) < 25) break;
        c.send({t: 'in', k: me && me[1] < x ? P.IN.RIGHT : P.IN.LEFT});
        await sleep(50);
    }
    c.send({t: 'in', k: 0});
    await sleep(300);
}

// two fighters walk at each other and swing until someone is knocked out
async function brawl(fighters, ms) {
    for (let t = 0; t < ms && !seen.has('ko'); t += 50) {
        for (const f of fighters) {
            const me = f.me(), foe = last.f.find(o => o[0] !== f.id && last.act.includes(o[0]));
            if (!me || !foe) continue;
            const dir = foe[1] > me[1] ? P.IN.RIGHT : P.IN.LEFT, dy = foe[2] - me[2];
            const swing = (t / 100) % 2 < 1 ? ((t / 200) % 4 < 3 ? P.IN.LIGHT : P.IN.HEAVY) : 0;
            let k = Math.abs(foe[1] - me[1]) > 60 ? dir : swing | dir;
            if (dy < -80 && (t / 50) % 6 === 0) k |= P.IN.JUMP;
            if (dy > 80 && (t / 50) % 6 === 0) k |= P.IN.DOWN | P.IN.JUMP;
            f.send({t: 'in', k});
        }
        await sleep(50);
    }
}

(async () => {
    await sleep(700);
    check('server prints a LAN or localhost address', /http:\/\//.test(out));
    const a = await client('Ana'), b = await client('Ben'), c = await client('Cy');
    await until(() => last && last.f.length >= 4);
    // ---------------- the lobby
    check('everyone arrives in the lobby, with the dummy', last.scene === 'lobby' && last.f.length === 4 &&
        last.f.some(f => f[0] === 0));
    const x0 = a.me()[1];
    a.send({t: 'in', k: P.IN.RIGHT}); await sleep(500); a.send({t: 'in', k: 0}); await sleep(200);
    check('you can walk around the lobby', a.me()[1] > x0 + 50);
    a.send({t: 'look', name: 'Ana', color: '#f472b6', hat: 'kasa', trail: 'sparkle'});
    await sleep(200);
    const ana = a.roster.list.find(p => p.id === a.id);
    check('the wardrobe changes your look for everyone', b.roster.list.find(p => p.id === a.id).gear.hat === 'kasa' &&
        ana.color === '#f472b6' && ana.name === 'Ana');
    await walkTo(b, P.MAPS.lobby.stations.wardrobe.x);
    check('standing at the wardrobe says so', b.near === 'wardrobe');
    await walkTo(a, P.MAPS.lobby.stations.dummy.x - 50);
    seen = new Set();
    for (let i = 0; i < 6; i++) {
        a.send({t: 'in', k: i % 2 ? 0 : P.IN.LIGHT}); await sleep(120);
    }
    check('the dummy pops damage numbers', seen.has('pop'));
    check('a lobby hit costs nobody health', last.f.every(f => f[6] === 100));
    // ---------------- the host's console
    await walkTo(b, P.MAPS.lobby.stations.console.x);
    b.send({t: 'console', do: 'start'}); await sleep(300);
    check('only the host can start', last.scene === 'lobby' && last.starting === null);
    await walkTo(a, P.MAPS.lobby.stations.console.x);
    check('the host at the console', a.near === 'console' && a.roster.host === a.id);
    a.send({t: 'console', do: 'mode'}); await sleep(150);
    check('Q cycles the mode', last.sel.mode === 'rumble');
    a.send({t: 'console', do: 'mode'}); a.send({t: 'console', do: 'mode'});
    a.send({t: 'console', do: 'map'}); await sleep(150);
    check('Tab cycles the map', last.sel.mode === 'koth' && last.sel.map === 'reactor');
    a.send({t: 'console', do: 'start'});
    await sleep(300);
    check('start: a countdown in the lobby', last.starting !== null);
    check('then the match, on the chosen map', await until(() => last.scene === 'match') && last.map === 'reactor');
    check('two in the ring, one queued', last.act.length === 2 && last.q.length === 1);
    await until(() => last.ph === 'fight');
    // ---------------- King of the Hill
    seen = new Set();
    const fighters = [a, b, c].filter(x => last.act.includes(x.id));
    const queued = [a, b, c].find(x => last.q.includes(x.id));
    const emojis = setInterval(() => queued.send({t: 'emoji', e: '🔥'}), 1000);
    const votes = setInterval(() => last.vote && queued.send({t: 'vote', o: 1}), 100);
    await brawl(fighters, 60000);
    clearInterval(emojis); clearInterval(votes);
    check('hits land', seen.has('hit'));
    check('a knockout', seen.has('ko'));
    check('emojis reach everyone', seen.has('emoji'));
    check('the crowd voted a hazard in', seen.has('vote') && seen.has('hazard'));
    await until(() => last.ph === 'ko', 4000);              // the K.O. plays out, then the next round
    await until(() => last.ph === 'countdown' || last.ph === 'fight', 6000);
    check('the loser went to the back, the next one came in', last.act.includes(queued.id) && last.q.length === 1);
    // ---------------- back to the lobby, then Bomb Tag
    a.send({t: 'lobby'});
    check('the host takes everyone back to the lobby', await until(() => last.scene === 'lobby', 2000));
    await walkTo(a, P.MAPS.lobby.stations.console.x);
    a.send({t: 'console', do: 'mode'}); a.send({t: 'console', do: 'mode'});
    await sleep(150);
    check('Bomb Tag picked', last.sel.mode === 'bomb');
    a.send({t: 'console', do: 'start'});
    await until(() => last.scene === 'match' && last.ph === 'fight', 9000);
    seen = new Set();
    check('Bomb Tag: someone has the bomb', await until(() => last.bomb !== null, 3000));
    check('it goes off', await until(() => seen.has('boom'), 6000));
    // ---------------- robustness
    a.ws.send('not json');
    for (let i = 0; i < 500; i++) a.ws.send(JSON.stringify({t: 'in', k: 999999}));
    await sleep(500);
    check('still running after junk and a flood', srv.exitCode === null && last !== null);
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    for (const x of [a, b, c]) x.ws.close();
    srv.kill();
    process.exit(failures ? 1 : 0);
})();
