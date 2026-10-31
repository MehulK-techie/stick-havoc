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
{   // guard: a fifth of the damage, no launch; three in a row break it
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    const hold = {2: {k: P.IN.DOWN}};
    run(w, 8, hold);                                  // (long enough that it isn't a parry)
    const ev = [];
    for (let i = 0; i < 3; i++) {
        ev.push(...run(w, 1, {1: {k: P.IN.LIGHT}, 2: {k: P.IN.DOWN}}), ...run(w, 9, {1: {k: 0}, 2: {k: P.IN.DOWN}}));
        a.x = b.x - 50; a.comboT = 0;
    }
    check('guarding takes a fifth of the damage', b.hp >= 97 && b.hp < 100 && ev.filter(e => e.type === 'block').length === 2);
    check('three blocked hits break the guard', ev.some(e => e.type === 'guardbreak') && b.stun > 0);
}
{   // a guard raised just in time: a parry, and the attacker reels
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    run(w, 1, {1: {k: P.IN.LIGHT}});
    const ev = run(w, 3, {1: {k: 0}, 2: {k: P.IN.DOWN}});
    check('a just-in-time guard parries', ev.some(e => e.type === 'parry') && a.stun > 0 && b.hp === 100);
}
{   // a grab goes through a guard and throws them the other way
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    run(w, 8, {2: {k: P.IN.DOWN}});
    const ev = run(w, 4, i => ({1: {k: i === 0 ? P.IN.GRAB : 0}, 2: {k: P.IN.DOWN}}));
    check('a grab throws through a guard', ev.some(e => e.type === 'hit' && e.kind === 'throw') && b.vx < -500 && b.hp === 90);
}
{   // the uppercut reaches a standing opponent close up, every time
    let ok = 0;
    for (const gap of [20, 35, 50, 65]) {
        const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 800 + gap); a.face = 1;
        run(w, 10, i => ({1: {k: i === 0 ? P.IN.HEAVY : 0}}));
        if (b.vy < -500)
            ok++;
    }
    check('the uppercut launches at 20, 35, 50 and 65 units', ok === 4);
}
{   // a counter hit (caught mid-attack) and the combo counter
    const w = world('reactor'); const a = fighter(w, 1, 800), b = fighter(w, 2, 850); a.face = 1; b.face = -1;
    const ev = run(w, 4, i => ({1: {k: i === 1 ? P.IN.LIGHT : 0}, 2: {k: i === 0 ? P.IN.HEAVY : 0}}));
    check('hitting someone mid-attack is a COUNTER', ev.some(e => e.type === 'callout' && e.text === 'COUNTER!'));
    const w2 = world('reactor'); const c = fighter(w2, 1, 800), d = fighter(w2, 2, 848); c.face = 1;
    const ev2 = [];
    for (let i = 0; i < 12; i++) {
        ev2.push(...run(w2, 1, {1: {k: i % 4 === 0 ? P.IN.LIGHT : 0}}));
        c.x = d.x - 48;
    }
    check('the string counts as a combo', ev2.some(e => e.type === 'combo' && e.n >= 2 && e.dmg > 0));
}
{   // a crate parachutes down, lands, and walking over it picks the weapon up
    const w = world('colosseum'); w.weapons = true; w.crateT = 0; const f = fighter(w, 1, 800);
    const ev = run(w, 1, {});
    check('a crate is dropped', ev.some(e => e.type === 'crate') && w.crates.length === 1);
    const c = w.crates[0]; c.y = 700; c.x = 800;
    const ev2 = run(w, 30, {});
    check('it lands and walking over it picks it up', ev2.some(e => e.type === 'pickup') && f.weapon && !w.crates.length);
}
{   // each weapon: uses, damage, throws
    const w = world('colosseum'); const a = fighter(w, 1, 700), b = fighter(w, 2, 760); a.face = 1;
    a.weapon = {kind: 'katana', uses: 5};
    run(w, 6, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('the katana hits at range and uses a swing', b.hp < 100 && a.weapon.uses === 4);
    a.atk = null; a.weapon = {kind: 'blaster', uses: 3}; b.x = 1100; b.hp = 100; b.stun = 0; b.st = 'idle';
    run(w, 1, {1: {k: P.IN.LIGHT}});
    check('the blaster fires a shot, with recoil', w.shots.length === 1 && a.vx < 0);
    run(w, 10, {});
    check('the laser hits across the arena', b.hp < 100 && !w.shots.length);
    a.atk = null; a.weapon = {kind: 'grenade', uses: 1}; b.x = 1200;
    run(w, 1, {1: {k: P.IN.LIGHT}});
    const ev = run(w, 90, {});
    check('the bouncy bomb bounces, then goes off', ev.filter(e => e.type === 'bounce').length >= 1 &&
        ev.some(e => e.type === 'boom') && !a.weapon);
    a.atk = null; a.weapon = {kind: 'bat', uses: 3}; b.x = 900; b.y = 820; b.ground = true; b.st = 'idle';
    run(w, 1, {1: {k: P.IN.USE}});
    check('E throws the weapon you hold', !a.weapon && w.shots.some(s => s.kind === 'thrown'));
}
{   // the wardrobe's ghost: nobody can hit or throw you
    const w = world('lobby'); w.noDamage = true; const a = fighter(w, 1, 700, 800), b = fighter(w, 2, 750, 800);
    a.face = 1; b.ghost = true;
    const ev = [...run(w, 6, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}})), ...run(w, 6, i => ({1: {k: i === 0 ? P.IN.GRAB : 0}}))];
    check('a ghost can\'t be hit or grabbed', !ev.some(e => e.on === 2) && b.vx === 0);
}
{   // the lobby ball flies off a punch
    const w = world('lobby'); const a = fighter(w, 1, 470, 800); a.face = 1; w.ball.x = 515; w.ball.y = 742;
    const ev = run(w, 6, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('the ball flies off a punch', ev.some(e => e.type === 'kick') && w.ball.vx > 500);
}
{   // the parkour tower: the clock starts on the first step and stops at the top
    const w = world('lobby'); const f = fighter(w, 1, 1480, 440); f.ground = false;
    run(w, 3, {});
    Object.assign(f, {x: 1470, y: 60, vy: 100, ground: false});
    const ev = run(w, 3, {});
    check('the climb is timed', ev.some(e => e.type === 'climb' && e.id === 1 && e.t >= 0));
}
{   // the Magma Foundry: lava throws you up; a moving plate carries you
    const w = world('magma'); const f = fighter(w, 1, 300, 870); f.ground = false;
    const ev = run(w, 2, {});
    check('lava launches you upwards', ev.some(e => e.type === 'lava') && f.vy < -800 && f.hp < 100);
    const w2 = world('magma'); const g = fighter(w2, 1, 0, 0);
    run(w2, 1, {});
    const plate = w2.plats[2]; Object.assign(g, {x: plate.x + 100, y: plate.y, ground: true, plat: plate, vy: 0});
    const x0 = g.x;
    run(w2, 10, {});
    check('a hover plate carries whoever stands on it', g.ground && Math.abs(g.x - x0) > 5);
}
{   // the Sky Train: wind pushes you back in the air; the tunnel hits you standing, not ducking
    const w = world('skytrain'); const f = fighter(w, 1, 800, 600); f.ground = false;
    run(w, 6, {});
    check('the slipstream pushes airborne fighters back', f.vx < -30);
    const w2 = world('skytrain'); const up = fighter(w2, 1, 600, 720), down = fighter(w2, 2, 1000, 720);
    run(w2, 3, {2: {k: P.IN.DOWN}});
    w2.tunnel.next = 0.05;
    const ev = run(w2, 40, {2: {k: P.IN.DOWN}});
    check('the tunnel hits a standing fighter, a ducking one goes under', ev.some(e => e.kind === 'tunnel' && e.on === 1) &&
        !ev.some(e => e.kind === 'tunnel' && e.on === 2));
}
{   // Floor Is Lava: the floor burns; a hit in the air gives your jumps back
    const w = world('reactor'); w.floorLava = w.airReset = true; w.hotT = 0;
    const f = fighter(w, 1, 800);
    const ev = run(w, 2, {});
    check('a hot floor burns whoever stands on it', ev.some(e => e.type === 'hot') && ev.some(e => e.type === 'lava'));
    const w2 = world('reactor'); w2.airReset = true; const a = fighter(w2, 1, 800, 600), b = fighter(w2, 2, 850, 600);
    a.ground = b.ground = false; a.jumps = 0; a.face = 1; a.st = b.st = 'air';
    run(w2, 3, i => ({1: {k: i === 0 ? P.IN.HEAVY : 0}}));
    check('landing a hit in the air gives a jump back', a.jumps >= 1 && b.hp < 100);
    void f;
}
{   // the practice bot: strings J J K at a passive opponent, guards or parries one who attacks
    const Bot = require('../public/bot.js');
    const w = world('colosseum'); const me = fighter(w, 1, 700), bot = fighter(w, -1, 760); const mem = {};
    const kinds = new Set();
    for (let i = 0; i < 300; i++) {
        w.events = [];
        P.step(w, {[-1]: {k: Bot.think(bot, w, 'sparHard', mem, 1 / 30)}, 1: {k: 0}}, 1 / 30);
        for (const e of w.events) if (e.type === 'hit' && e.by === -1) kinds.add(e.kind);
        if (me.st === 'ko' || me.hp < 30) Object.assign(me, {hp: 100, x: bot.x + 60, st: 'idle', vx: 0, vy: 0, y: 820});
    }
    check('the practice bot lands jab, hook and uppercut', kinds.has('jab') && kinds.has('hook') && kinds.has('uppercut'));
    const w2 = world('colosseum'); const att = fighter(w2, 1, 700), def = fighter(w2, -1, 750); att.face = 1;
    const mem2 = {}, seen = new Set();
    for (let i = 0; i < 240; i++) {
        w2.events = [];
        P.step(w2, {1: {k: i % 12 === 0 ? P.IN.LIGHT : 0}, [-1]: {k: Bot.think(def, w2, 'sparHard', mem2, 1 / 30)}}, 1 / 30);   // (a jab every 0.4 s: room to react)
        for (const e of w2.events) seen.add(e.type);
        att.x = def.x - 50; att.face = 1;
        Object.assign(att, {stun: 0, st: att.st === 'hurt' ? 'idle' : att.st, hp: 100});   // a relentless attacker
        if (def.hp < 40) def.hp = 100;
    }
    check('it guards or parries an attacker', seen.has('block') || seen.has('parry'));
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
