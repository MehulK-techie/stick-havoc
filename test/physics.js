// The simulation alone: slow motion, launcher and juggle, wall bounce,
// ledge grab, dash invulnerability.  node test/physics.js
'use strict';
const P = require('../public/physics.js');
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
function world(mode = 'koth') { const w = P.createWorld(mode); w.events = []; return w; }
function fighter(w, id, x, y = 820) { const f = P.makeFighter(id, 'f' + id, '#fff', x, y); f.shield = 0; f.ground = y === 820; w.fighters.push(f); return f; }
function run(w, frames, inputs) { const ev = []; for (let i = 0; i < frames; i++) { w.events = []; P.step(w, typeof inputs === 'function' ? inputs(i) : inputs, 1 / 30); ev.push(...w.events); } return ev; }
{   // both under 25 %, both swinging, close: slow motion
    const w = world(); const a = fighter(w, 1, 800), b = fighter(w, 2, 860);
    a.hp = b.hp = 20; a.face = 1; b.face = -1;
    const ev = run(w, 3, i => i === 0 ? {1: {k: P.IN.LIGHT}, 2: {k: P.IN.LIGHT}} : {});
    check('slow motion when both are low and trading blows', ev.some(e => e.type === 'slowmo') && w.timeScale < 1);
}
{   // the launcher sends them up; light hits keep them there (a juggle)
    const w = world(); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1;
    run(w, 1, {1: {k: P.IN.HEAVY}}); const ev = run(w, 10, {1: {k: 0}});
    check('the launcher pops them into the air', b.vy < 0 && !b.ground && ev.some(e => e.type === 'hit' && e.kind === 'heavy'));
    while (a.atk) run(w, 1, {1: {k: 0}});   // the launcher's own swing finishes first
    let pops = 0;
    for (let i = 0; i < 30 && !b.ground; i++) {
        a.x = b.x - 40; a.y = b.y; a.face = 1; a.ground = true;   // keep the attacker under them
        const e = [...run(w, 1, {1: {k: i % 4 === 0 ? P.IN.LIGHT : 0}}), ...run(w, 1, {1: {k: 0}})];   // a punch lands a frame or two after the press
        if (e.some(x => x.type === 'hit')) pops++;
    }
    check('juggled: two or more hits before they land', pops >= 2);
}
{   // a drop kick into the wall: it bounces them back
    const w = world(); const b = fighter(w, 2, 1500); b.vx = 1000; b.st = 'tumble'; b.ground = false; b.y = 700;
    const ev = run(w, 10, {});
    check('wall bounce', ev.some(e => e.type === 'wallbounce') && b.vx < 0);
}
{   // falling past a ledge: grabbed, and invulnerable for a second
    const w = world(); const f = fighter(w, 1, 222, 650); f.ground = false; f.vy = 300; f.st = 'air';
    const ev = run(w, 8, {});
    check('ledge grab with invulnerability', ev.some(e => e.type === 'ledge') && f.st === 'ledge' && f.inv > 0.5);
}
{   // dash: 12 frames (0.2 s) where nothing lands
    const w = world(); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    run(w, 1, {2: {k: P.IN.DASH}});
    const ev = run(w, 3, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('dash dodges a punch', !ev.some(e => e.type === 'hit') && b.inv >= 0);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
