// Plays a few real rounds against the server: hits, a K.O., the queue
// turning over, Royal Rumble, emojis and the crowd vote.  npm test
'use strict';
const {spawn} = require('child_process');
const WebSocket = require('ws');
const P = require('../public/physics.js');
const PORT = 3999;
const srv = spawn(process.execPath, [require.resolve('../server.js')], {env: {...process.env, PORT, VOTE_EVERY: 4}});
let out = '';
srv.stdout.on('data', d => out += d);
srv.stderr.on('data', d => process.stderr.write(d));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seen = new Set(), phases = [];
let last = null, failures = 0;
function client(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = {ws, id: null, name, roster: null};
    ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'welcome') c.id = m.id;
        if (m.type === 'roster') c.roster = m;
        if (m.type === 's') {
            last = m;
            for (const e of m.ev) seen.add(e.type);
            if (phases[phases.length - 1] !== m.ph) phases.push(m.ph);
        }
    });
    c.send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
    return new Promise(r => ws.on('open', () => { c.send({t: 'join', name, color: P.COLORS[0]}); setTimeout(() => r(c), 150); }));
}
function check(what, ok) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures++;
}
(async () => {
    await sleep(700);
    check('server prints a LAN or localhost address', /http:\/\//.test(out));
    const a = await client('Ana');
    await sleep(300);
    check('alone: a training bot joins', a.roster && a.roster.list.some(p => p.bot));
    const b = await client('Ben');
    await sleep(400);
    check('two people: the bot leaves', !a.roster.list.some(p => p.bot));
    const c = await client('Cy');
    for (let i = 0; i < 160 && last.ph !== 'fight'; i++) await sleep(50);   // the bot leaving ends a round first
    check('countdown then fight', phases.includes('countdown') && last.ph === 'fight');
    check('two in the ring, one queued', last.act.length === 2 && last.q.length === 1);
    // the two in the ring walk at each other and swing; the queued one sends emojis
    const fighters = [a, b, c].filter(x => last.act.includes(x.id));
    const queued = [a, b, c].find(x => last.q.includes(x.id));
    let t = 0;
    while (t < 40000 && !seen.has('ko')) {
        for (const f of fighters) {
            const me = last.f.find(o => o[0] === f.id), foe = last.f.find(o => o[0] !== f.id && last.act.includes(o[0]));
            if (!me || !foe) continue;
            const dir = foe[1] > me[1] ? P.IN.RIGHT : P.IN.LEFT;
            const swing = (t / 100) % 2 < 1 ? ((t / 200) % 4 < 3 ? P.IN.LIGHT : P.IN.HEAVY) : 0;
            const dy = foe[2] - me[2];
            let k = Math.abs(foe[1] - me[1]) > 60 ? dir : swing | dir;
            if (dy < -80 && (t / 50) % 6 === 0) k |= P.IN.JUMP;                      // they're above: jump up
            if (dy > 80 && (t / 50) % 6 === 0) k |= P.IN.DOWN | P.IN.JUMP;          // below: drop through
            f.send({t: 'in', k});
        }
        if (t % 1000 === 0) queued.send({t: 'emoji', e: '🔥'});
        if (last.vote && last.vote.v.includes(queued.id)) queued.send({t: 'vote', o: 1});
        await sleep(50); t += 50;
    }
    check('hits land', seen.has('hit'));
    check('a knockout', seen.has('ko'));
    if (!seen.has('ko')) console.log('   state:', last.ph, last.f.map(o => `${o[0]} hp${o[6]} ${o[7]} @${o[1]},${o[2]}`).join(' | '));
    check('emojis reach everyone', seen.has('emoji'));
    check('the crowd voted a hazard in', seen.has('vote') && seen.has('hazard'));
    const before = last.q.slice();
    await sleep(5000);   // the K.O. plays out (1.2 s), the winner is shown (3 s), the next round starts
    check('the loser went to the back, the next one came in', last.act.includes(queued.id) && last.q.length === 1 &&
        before.length === 1 && !last.q.includes(queued.id));
    // the host switches to Royal Rumble
    a.send({t: 'mode', m: 'rumble'});
    await sleep(1500);
    check('Royal Rumble: everyone in', last.mode === 'rumble' && last.act.length === 3 && last.q.length === 0);
    // garbage and floods are ignored
    a.ws.send('not json'); for (let i = 0; i < 500; i++) a.ws.send(JSON.stringify({t: 'in', k: 999999}));
    await sleep(500);
    check('still running after junk and a flood', last && Date.now() && srv.exitCode === null);
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    for (const x of [a, b, c]) x.ws.close();
    srv.kill();
    process.exit(failures ? 1 : 0);
})();
