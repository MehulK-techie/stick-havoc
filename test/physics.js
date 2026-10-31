// The simulation alone: moves, frame data, maps and their hazards.
//   node test/physics.js
'use strict';
const P = require('../public/physics.js');
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
function world(map = 'colosseum') { const w = P.createWorld(map); w.events = []; return w; }
function fighter(w, id, x, y = 820) {
    const f = P.makeFighter(id, 'f' + id, '#fff', x, y); f.shield = 0; f.ground = true; w.fighters.push(f); return f;
}
function run(w, frames, inputs) {
    const ev = [];
    for (let i = 0; i < frames; i++) {
        w.events = [];
        P.step(w, typeof inputs === 'function' ? inputs(i) : inputs, 1 / 30);
        ev.push(...w.events);
    }
    return ev;
}

{   // the 3-hit string: jab, hook (pulls in), straight (launches a little)
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1;
    const kinds = [];
    for (let i = 0; i < 24; i++) {
        const ev = run(w, 1, {1: {k: i % 4 === 0 ? P.IN.LIGHT : 0}});
        for (const e of ev) if (e.type === 'hit') kinds.push(e.kind);
        a.x = b.x - 48; a.face = 1;
    }
    check('jab, hook, straight in order', kinds.slice(0, 3).join() === 'jab,hook,straight');
    check('the jab starts on frame 4', Math.abs(P.MOVES.jab.from - 4 / 60) < 1e-9);
}
{   // both under 25 %, both swinging, close: slow motion
    const w = world(); const a = fighter(w, 1, 800), b = fighter(w, 2, 860);
    a.hp = b.hp = 20; a.face = 1; b.face = -1;
    const ev = run(w, 3, i => i === 0 ? {1: {k: P.IN.LIGHT}, 2: {k: P.IN.LIGHT}} : {});
    check('slow motion when both are low and trading blows', ev.some(e => e.type === 'slowmo') && w.timeScale < 1);
}
{   // the uppercut (K, or Up+J) launches; punches keep them up (a juggle)
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1;
    run(w, 1, {1: {k: P.IN.UP | P.IN.LIGHT}}); const ev = run(w, 10, {1: {k: 0}});
    check('Up + J launches', b.vy < 0 && !b.ground && ev.some(e => e.type === 'hit' && e.kind === 'uppercut'));
    while (a.atk) run(w, 1, {1: {k: 0}});
    let pops = 0;
    for (let i = 0; i < 30 && !b.ground; i++) {
        a.x = b.x - 40; a.y = b.y; a.face = 1; a.ground = true;   // keep the attacker under them
        const e = [...run(w, 1, {1: {k: i % 4 === 0 ? P.IN.LIGHT : 0}}), ...run(w, 1, {1: {k: 0}})];
        if (e.some(x => x.type === 'hit')) pops++;
    }
    check('juggled: two or more hits before they land', pops >= 2);
}
{   // Down + K in the air: a 45-degree dive; it spikes someone airborne
    const w = world('reactor'); const a = fighter(w, 1, 700, 500), b = fighter(w, 2, 760, 560);
    a.ground = b.ground = false; a.st = b.st = 'air'; a.face = 1; b.vy = -100;
    const first = run(w, 1, {1: {k: P.IN.DOWN | P.IN.HEAVY}});   // (2 frames of startup: it can land at once)
    check('the dive goes down at 45 degrees', a.atk && a.atk.kind === 'dive' && Math.abs(a.vx) === Math.abs(a.vy));
    const ev = [...first, ...run(w, 6, {})];
    check('a dive spikes an airborne opponent downwards', ev.some(e => e.type === 'hit' && e.kind === 'dive') && b.vy > 500);
}
{   // ... and ricochets off a standing one
    const w = world('reactor'); const a = fighter(w, 1, 760, 760); fighter(w, 2, 800);
    a.ground = false; a.st = 'air'; a.face = 1;
    run(w, 1, {1: {k: P.IN.DOWN | P.IN.HEAVY}});
    run(w, 5, {});
    check('a dive ricochets off a standing opponent', a.vy < 0 && !a.atk);
}
{   // a dash cancels a punch's recovery: 10 frames of invulnerability
    const w = world('reactor'); const a = fighter(w, 1, 800); fighter(w, 2, 900); a.face = 1;
    run(w, 1, {1: {k: P.IN.LIGHT}}); run(w, 2, {1: {k: 0}});
    const ev = run(w, 1, {1: {k: P.IN.DASH}});
    check('dash cancels the jab', ev.some(e => e.type === 'dash' && e.cancel) && !a.atk && a.inv > 0);
    check('the dash lasts 10 frames', Math.abs(P.C.DASH_T - 10 / 60) < 1e-9);
}
{   // dashing through a punch
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    run(w, 1, {2: {k: P.IN.DASH}});
    const ev = run(w, 3, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('dash dodges a punch', !ev.some(e => e.type === 'hit'));
}
{   // into the side wall hard: a bounce
    const w = world('reactor'); const b = fighter(w, 2, 1500); b.vx = 1000; b.st = 'tumble'; b.ground = false; b.y = 700;
    const ev = run(w, 10, {});
    check('wall bounce', ev.some(e => e.type === 'wallbounce') && b.vx < 0);
}
{   // the Colosseum's pillars: you bounce off them, and they break after 3
    const w = world('colosseum'); const b = fighter(w, 2, 300); let breaks = 0;
    for (let i = 0; i < 3; i++) {
        Object.assign(b, {x: 300, y: 760, vx: -1000, vy: 0, st: 'tumble', ground: false});
        const ev = run(w, 10, {});
        if (ev.some(e => e.type === 'pillar')) breaks++;
    }
    check('pillar breaks on the third bounce', breaks === 1 && !w.plats[1].alive);
}
{   // falling past a ledge: grabbed, and invulnerable for a second
    const w = world('reactor'); const f = fighter(w, 1, 162, 700); f.ground = false; f.vy = 300; f.st = 'air';
    const ev = run(w, 8, {});
    check('ledge grab with invulnerability', ev.some(e => e.type === 'ledge') && f.st === 'ledge' && f.inv > 0.5);
}
{   // Neon Rooftops: the bridge goes after 4 s stood on, back after 8
    const w = world('rooftops'); fighter(w, 1, 800, 640);
    const ev = run(w, 30 * 5, {});
    check('the bridge crumbles after 4 s', ev.some(e => e.type === 'crumble'));
    const back = run(w, 30 * 9, {});
    check('and comes back', back.some(e => e.type === 'restore') && w.plats[2].alive);
}
{   // the Reactor: three beeps, then the beam sweeps the floor
    const w = world('reactor'); const f = fighter(w, 1, 800); w.beam.next = 3.5;
    const ev = run(w, 30 * 6, {});
    check('three beeps before the beam', ev.filter(e => e.type === 'beep').length === 3 && ev.some(e => e.type === 'beam'));
    check('the beam hits whoever is on the floor', ev.some(e => e.type === 'hit' && e.kind === 'beam') && f.hp < 100);
}
{   // the asteroid: low gravity, and bumpers on the edges
    const w = world('asteroid'); const f = fighter(w, 1, 60, 500); f.ground = false; f.vx = -600; f.st = 'air';
    const ev = run(w, 5, {});
    check('a bumper throws you back across', ev.some(e => e.type === 'bumper') && f.vx > 1000);
    check('the asteroid floats (0.55 gravity)', w.gravity === 0.55);
}
{   // a bomb: everyone near is thrown, the carrier is out
    const w = world('colosseum'); const c = fighter(w, 1, 800), o = fighter(w, 2, 900);
    P.explode(w, c.x, c.y - 50, 300, 1300, c); P.knockOut(w, c, null);
    check('the shockwave throws the others', o.vx > 300 && o.st === 'tumble' && c.st === 'ko');
}
{   // the lobby: the dummy pops numbers, players take no damage
    const w = world('lobby'); w.noDamage = true; const d = P.makeDummy(900, 800); w.fighters.push(d);
    const a = fighter(w, 1, 850, 800), b = fighter(w, 2, 950, 800); a.face = 1;
    const ev = run(w, 6, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('the dummy pops its damage', ev.some(e => e.type === 'pop'));
    b.face = -1; b.x = 900; d.x = 2000; d.anchor = 2000;
    run(w, 6, i => ({2: {k: i === 0 ? P.IN.HEAVY : 0}}));
    check('nobody loses health in the lobby', a.hp === 100);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
