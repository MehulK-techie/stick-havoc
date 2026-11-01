// Plays the whole thing against a real server: the lobby (walking, the
// wardrobe, the dummy, the host's console), a King of the Hill match (hits,
// a K.O., the queue turning over, emojis, the crowd vote), back to the
// lobby, then Bomb Tag.  npm test
'use strict';
const {spawn} = require('child_process');
const WebSocket = require('ws');
const P = require('../public/physics.js');
const PORT = 3999;
const fs = require('fs'), os = require('os'), path = require('path');
const FEEDBACK_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-fb-')), 'feedback.json');
const srv = spawn(process.execPath, [require.resolve('../server.js')],
    {env: {...process.env, PORT, VOTE_EVERY: 4, BOMB_FUSE: 3, FEEDBACK_FILE}});
let out = '';
srv.stdout.on('data', d => out += d);
srv.stderr.on('data', d => process.stderr.write(d));
process.on('exit', () => {                            // never leave a server holding the port
    srv.kill();
    fs.rmSync(path.dirname(FEEDBACK_FILE), {recursive: true, force: true});
});
process.on('uncaughtException', e => { console.error(e); srv.kill(); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seen = new Set(), last = null, failures = 0, evs = [];

function client(name) {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const c = {ws, id: null, name, roster: null, near: null, got: []};
    ws.on('message', d => {
        const m = JSON.parse(d);
        if (m.type !== 's') c.got.push(m);
        if (m.type === 'welcome') c.id = m.id;
        if (m.type === 'roster') c.roster = m;
        if (m.type === 'near') c.near = m.station;
        if (m.type === 's') {
            last = m;
            for (const e of m.ev) {
                seen.add(e.type);
                evs.push(e);
            }
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
    // feedback: saved to feedback.json on the host, logged; empty notes and floods turned away
    a.send({t: 'feedback', category: 'bug', text: '  The ball \u0007got stuck\nin the net  '});
    await sleep(300);
    a.send({t: 'feedback', category: 'feature', text: 'and another'});
    c.send({t: 'feedback', category: 'general', text: '   '});
    c.send({t: 'feedback', category: 'toString', text: 'sneaky'});
    await sleep(300);
    const nm = a.roster.list.find(p => p.id === a.id).name;
    let saved = [];
    try { saved = JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf8')); } catch { /* checked below */ }
    check('feedback is written to feedback.json, cleaned, with author and time', saved.length === 1 &&
        saved[0].author === nm && saved[0].category === 'Bug Report' && saved[0].text === 'The ball got stuck\nin the net' &&
        !isNaN(Date.parse(saved[0].timestamp)) && a.got.some(m => m.type === 'feedbackSaved'));
    check('the host terminal shows it', out.includes(`[Feedback] Received Bug Report from ${nm}: The ball got stuck in the net`));
    check('a second note within 15 s, and an empty one, are turned away', a.got.some(m => m.type === 'feedbackRefused') &&
        c.got.some(m => m.type === 'feedbackRefused'));
    // a second tab restoring a saved colour someone already wears: given a free one, and told
    const mine = a.roster.list.find(p => p.id === a.id).color;
    c.send({t: 'look', color: mine, restore: true});
    await sleep(300);
    const cy = c.roster.list.find(p => p.id === c.id).color;
    check('a saved colour already taken: a free one instead, with a notice', cy !== mine &&
        c.got.some(m => m.type === 'colorAssigned' && m.remapped && m.color === cy));
    const x0 = a.me()[1];
    a.send({t: 'in', k: P.IN.RIGHT}); await sleep(500); a.send({t: 'in', k: 0}); await sleep(200);
    check('you can walk around the lobby', a.me()[1] > x0 + 50);
    a.send({t: 'look', name: 'Ana', color: '#2dd4bf', hat: 'kasa', trail: 'sparkle'});
    await sleep(200);
    const ana = a.roster.list.find(p => p.id === a.id);
    check('the wardrobe changes your look for everyone', b.roster.list.find(p => p.id === a.id).gear.hat === 'kasa' &&
        ana.color === '#2dd4bf' && ana.name === 'Ana');
    await walkTo(b, P.MAPS.lobby.stations.wardrobe.x);
    check('standing at the wardrobe says so', b.near === 'wardrobe');
    // colours: one per player; changing frees the old one
    const bColor = b.roster.list.find(p => p.id === b.id).color;
    let refused = false;
    c.ws.on('message', m => { if (JSON.parse(m).type === 'colorTaken') refused = true; });
    c.send({t: 'look', color: bColor}); await sleep(250);
    check('a colour someone wears cannot be taken', refused && c.roster.list.find(p => p.id === c.id).color !== bColor);
    b.send({t: 'look', color: '#818cf8'}); await sleep(200);
    c.send({t: 'look', color: bColor}); await sleep(250);
    check('changing colour frees the old one', c.roster.list.find(p => p.id === c.id).color === bColor);
    // the wardrobe's ghost: untouchable
    b.send({t: 'ghost', on: true}); await sleep(150);
    check('in the wardrobe you are a ghost', b.roster.list.find(p => p.id === b.id).ghost && last.f.find(f => f[0] === b.id)[18] === 1);
    b.send({t: 'ghost', on: false}); await sleep(150);
    await walkTo(a, P.MAPS.lobby.stations.dummy.x - 50);
    seen = new Set();
    for (let i = 0; i < 6; i++) {
        a.send({t: 'in', k: i % 2 ? 0 : P.IN.LIGHT}); await sleep(120);
    }
    check('the dummy pops damage numbers', seen.has('pop'));
    check('a lobby hit costs nobody health', last.f.every(f => f[6] === 100));
    // ---------------- lobby football: the goal against the right wall
    seen = new Set();
    for (let t = 0; t < 40000 && !seen.has('goal'); t += 60) {
        const me = a.me(), ball = last.ball;
        if (me && ball && !last.ballOut) {
            const target = ball[0] - 50;              // stand just behind it, facing the goal, and punch
            let k = 0;
            if (Math.abs(me[1] - target) > 14) k = me[1] < target ? P.IN.RIGHT : P.IN.LEFT;
            else if (me[5] < 0) k = P.IN.RIGHT;
            else if ((t / 60) % 3 === 0) k = P.IN.LIGHT;
            a.send({t: 'in', k});
        }
        await sleep(60);
    }
    a.send({t: 'in', k: 0});
    check('the ball goes in: GOAL!, and the lobby score counts it', seen.has('goal') && last.goals >= 1);
    // ---------------- the host's console
    await walkTo(b, P.MAPS.lobby.stations.console.x);
    b.send({t: 'console', do: 'start'}); await sleep(300);
    check('only the host can start', last.scene === 'lobby' && last.starting === null);
    await walkTo(a, P.MAPS.lobby.stations.console.x);
    check('the host at the console', a.near === 'console' && a.roster.host === a.id);
    a.send({t: 'console', do: 'mode'}); await sleep(150);
    check('Q cycles the mode', last.sel.mode === 'rumble');
    for (let i = 0; i < 7; i++) a.send({t: 'console', do: 'mode'});   // round the eight modes, back to King of the Hill
    a.send({t: 'console', do: 'map'}); await sleep(150);
    check('Tab cycles the map', last.sel.mode === 'koth' && last.sel.map === 'reactor');
    // the match settings: the host sets them, everyone sees them, nobody else can
    a.send({t: 'settings', key: 'target', value: 3}); a.send({t: 'settings', key: 'timer', value: 90});
    b.send({t: 'settings', key: 'weapons', value: false});
    await sleep(200);
    check('the host settings reach everyone', last.sel.target === 3 && last.sel.timer === 90);
    check('a non-host cannot change them', last.sel.weapons === true);
    a.send({t: 'settings', key: 'limit', value: 3}); await sleep(150);
    const d = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const full = await new Promise(r => { d.on('message', m => JSON.parse(m).type === 'full' && r(true)); setTimeout(() => r(false), 1500); });
    check('the player limit turns a 4th player away', full);
    a.send({t: 'settings', key: 'limit', value: 10}); await sleep(150);
    evs = [];
    a.send({t: 'console', do: 'start'});
    await sleep(300);
    check('start: straight onto the chosen map', await until(() => last.scene === 'match') && last.map === 'reactor');
    await until(() => last.ph === 'fight', 6000);
    // (every client logs every event: three of each, in order)
    const counts = evs.filter(x => x.type === 'count').map(x => x.n).filter((n, i, all) => i === 0 || n !== all[i - 1]);
    check('one countdown, from the server: GET READY, 3, 2, 1, FIGHT!', evs.some(x => x.type === 'getReady') &&
        counts.join() === '3,2,1,0');
    check('two in the ring, one queued', last.act.length === 2 && last.q.length === 1);
    await until(() => last.ph === 'fight');
    a.send({t: 'pause', on: true});
    await sleep(300);
    check('with others in the room, nobody can pause the match', !last.paused);
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
    check('weapon crates parachute in', seen.has('crate'));
    check('the round clock runs', typeof last.tl === 'number' && last.tl <= 90);
    await until(() => last.ph === 'ko', 4000);              // the K.O. plays out, then the next round
    await until(() => last.ph === 'countdown' || last.ph === 'fight', 6000);
    check('the loser went to the back, the next one came in', last.act.includes(queued.id) && last.q.length === 1);
    // ---------------- Banger Shuffle: never the same mode or map twice running
    a.send({t: 'lobby'});
    await until(() => last.scene === 'lobby', 2000);
    a.send({t: 'settings', key: 'mode', value: 'shuffle'});
    a.send({t: 'settings', key: 'limit', value: 15}); await sleep(150);
    check('15 players allowed', last.sel.limit === 15);
    const picks = [];
    for (let i = 0; i < 4; i++) {
        a.send({t: 'console', do: 'start'});
        await until(() => last.scene === 'match', 6000);
        picks.push(`${last.mode}/${last.map}`);
        a.send({t: 'lobby'});
        await until(() => last.scene === 'lobby', 2000);
    }
    check('Banger Shuffle never repeats a mode or a map back to back', picks.every((p, i) => i === 0 ||
        (p.split('/')[0] !== picks[i - 1].split('/')[0] && p.split('/')[1] !== picks[i - 1].split('/')[1])));
    a.send({t: 'settings', key: 'mode', value: 'koth'}); a.send({t: 'settings', key: 'map', value: 'reactor'});
    await sleep(150);
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
    // ---------------- Team Brawl: three players, two teams; the smaller one gets Overdrive
    a.send({t: 'lobby'});
    await until(() => last.scene === 'lobby', 2000);
    a.send({t: 'settings', key: 'mode', value: 'team'});
    await sleep(150);
    evs = [];
    a.send({t: 'console', do: 'start'});
    await until(() => last.scene === 'match' && last.ph === 'fight', 6000);
    const teams = last.f.filter(f => f[0] !== 0).map(f => f[20]);
    const od = last.f.filter(f => f[21] & 2).map(f => f[20]);
    check('Team Brawl: 2 red, 1 blue', teams.filter(t => t === 'red').length === 2 && teams.filter(t => t === 'blue').length === 1);
    check('the lone blue is in Overdrive', evs.some(x => x.type === 'overdrive' && x.team === 'blue') && od.join() === 'blue');
    // ---------------- the 1P arcade ladder
    a.send({t: 'lobby'});
    await until(() => last.scene === 'lobby', 2000);
    a.send({t: 'arcade'});
    check('the arcade ladder starts', await until(() => last.scene === 'match' && last.mode === 'arcade', 3000) &&
        last.arcade.stage === 1 && last.act.includes(a.id) && last.act.length === 2);
    check('stage 1 is the Rookie', a.roster.list.some(p => p.bot && p.name === 'Rookie Stick'));
    await until(() => last.ph === 'fight');
    seen = new Set();
    await brawl([a], 60000);
    await until(() => seen.has('stageClear') || seen.has('gameOver'), 6000);
    check('a stage ends in STAGE CLEAR or GAME OVER', seen.has('stageClear') || seen.has('gameOver'));
    // ---------------- robustness
    a.ws.send('not json');
    for (let i = 0; i < 500; i++) a.ws.send(JSON.stringify({t: 'in', k: 999999}));
    await sleep(500);
    check('still running after junk and a flood', srv.exitCode === null && last !== null);
    // hostile messages: an inherited key, and the arcade player leaving mid-run
    b.send({t: 'settings', key: 'toString', value: 1});
    a.send({t: 'settings', key: 'toString', value: 1}); a.send({t: 'settings', key: '__proto__', value: 1});
    await sleep(300);
    check('a "toString" settings key is ignored', srv.exitCode === null);
    if (last.scene !== 'match') {
        await until(() => last.scene === 'lobby', 8000);
        a.send({t: 'arcade'});
        await until(() => last.mode === 'arcade', 3000);
    }
    const e = await client('Eve');
    await sleep(300);
    // (a stands in for the arcade player only when it is a's run; make sure it is)
    check('the arcade is running', last.mode === 'arcade' && last.arcade.player === a.id);
    // the host leaves: the next one in becomes host, and everyone is told
    seen = new Set();
    a.ws.close();
    check('the host leaving hands the room on', await until(() => seen.has('host') && b.roster.host === b.id, 3000));
    check('the arcade player leaving mid-run ends it, server still up', await until(() => last.scene === 'lobby', 3000) &&
        srv.exitCode === null);
    await sleep(1500);
    check('and the room keeps running', srv.exitCode === null && last.scene === 'lobby');
    e.ws.close();
    // ---------------- Banger Shuffle: settled on the server before anyone is told
    b.send({t: 'settings', key: 'mode', value: 'shuffle'});
    await sleep(200);
    evs = [];
    b.send({t: 'console', do: 'start'});
    await until(() => evs.some(x => x.type === 'match'), 6000);
    const st = evs.find(x => x.type === 'starting'), mt = evs.find(x => x.type === 'match');
    check('Banger Shuffle: the countdown names a real mode and map', st && P.MODES[st.mode] && P.ARENAS.includes(st.map));
    check('and the match is that one', mt && last.scene === 'match' && mt.mode === st.mode && mt.map === st.map &&
        last.map === st.map);
    b.send({t: 'lobby'});
    await until(() => last.scene === 'lobby', 3000);
    // ---------------- the 1P sandbox: only for someone alone in the room
    const solo = {t: 'sandbox', mode: 'rumble', level: 'hard', crates: 'frequent', map: 'random', target: 3, bots: 3};
    b.send(solo);
    await sleep(400);
    check('the sandbox is refused with two in the room', last.scene === 'lobby');
    c.ws.close();
    await sleep(400);
    b.send(solo);
    check('alone: the sandbox starts, FFA against 3 bots on a real map', await until(() => last.scene === 'match' &&
        last.sandbox, 3000) && P.ARENAS.includes(last.map) && last.act.length === 4 &&
        b.roster.list.filter(p => p.bot).length === 3);
    await until(() => last.ph === 'fight', 6000);
    b.send({t: 'pause', on: true});
    await sleep(200);
    const frozen = JSON.stringify(last.f), pt = last.pt;
    await sleep(600);
    check('Esc in 1P pauses: the match holds still', last.paused && last.pt === pt && JSON.stringify(last.f) === frozen);
    b.send({t: 'pause', on: false});
    check('and resumes', await until(() => !last.paused && last.pt !== pt, 2000));
    evs = [];
    b.send({t: 'restart'});
    check('R: the round restarts at once, with its countdown', await until(() => evs.some(x => x.type === 'restart') &&
        last.ph === 'countdown', 2000) && last.scene === 'match' && last.act.length === 4);
    b.send({t: 'lobby'});
    await until(() => last.scene === 'lobby', 3000);
    b.send({t: 'sandbox', mode: 'rumble', level: 'demon', crates: 'off', map: 'colosseum', target: 3, bots: 2,
        names: ['<b>Kazuya</b>', '']});
    check('Demon, two of them: the host\'s name for one (cleaned), the other numbered', await until(() => last.scene === 'match' &&
        last.act.length === 3, 3000) && last.map === 'colosseum' &&
        ['bKazuyab', 'Demon 2'].every(n => b.roster.list.some(p => p.bot && p.name === n)));
    b.send({t: 'lobby'});
    check('Esc / the corner button: back to the lobby, the bots gone', await until(() => last.scene === 'lobby' &&
        !b.roster.list.some(p => p.bot), 3000));
    console.log(failures ? `\n${failures} failed` : '\nall passed');
    b.ws.close();
    srv.kill();
    process.exit(failures ? 1 : 0);
})();
