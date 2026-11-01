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
{   // the climax: both under 25 %, facing, swinging 33 ms apart: 0.15x, and the first blow to connect wins it
    const w = world(); const a = fighter(w, 1, 800), b = fighter(w, 2, 860);
    a.hp = b.hp = 20; a.face = 1; b.face = -1;
    // a throws the slow uppercut first; b's jab, 33 ms later, is live sooner
    const ev = run(w, 2, i => i === 0 ? {1: {k: P.IN.HEAVY}} : {2: {k: P.IN.LIGHT}});
    check('a clash drops to 0.15x', ev.some(e => e.type === 'clash') && w.timeScale === 0.15 && w.clash);
    const ev2 = run(w, 40, {});
    check('the first blow to connect wins: the other is knocked out, game speed back to 1x',
        ev2.some(e => e.type === 'clashWin' && e.by === 2) && a.st === 'ko' && b.st !== 'ko' && w.timeScale === 1 && !w.clash);
    const w2 = world(); const c = fighter(w2, 1, 800), d = fighter(w2, 2, 860);
    c.face = 1; d.face = -1;
    const ev3 = run(w2, 2, i => i === 0 ? {1: {k: P.IN.LIGHT}} : {2: {k: P.IN.LIGHT}});
    check('no clash at full health', !ev3.some(e => e.type === 'clash') && w2.timeScale === 1);
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
{   // Down + forward + K in the air: a 45-degree dive; it spikes someone airborne
    const w = world('reactor'); const a = fighter(w, 1, 700, 500), b = fighter(w, 2, 760, 560);
    a.ground = b.ground = false; a.st = b.st = 'air'; a.face = 1; b.vy = -100;
    const first = run(w, 1, {1: {k: P.IN.DOWN | P.IN.RIGHT | P.IN.HEAVY}});   // (2 frames of startup: it can land at once)
    check('the dive goes down at 45 degrees', a.atk && a.atk.kind === 'dive' && Math.abs(a.vx) === Math.abs(a.vy));
    const ev = [...first, ...run(w, 6, {})];
    check('a dive spikes an airborne opponent downwards', ev.some(e => e.type === 'hit' && e.kind === 'dive') && b.vy > 500);
}
{   // ... and ricochets off a standing one
    const w = world('reactor'); const a = fighter(w, 1, 760, 760); fighter(w, 2, 800);
    a.ground = false; a.st = 'air'; a.face = 1;
    run(w, 1, {1: {k: P.IN.DOWN | P.IN.RIGHT | P.IN.HEAVY}});
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
    Object.assign(f, {x: 1470, y: 85, vy: 100, ground: false});   // (just above the FINISH pad)
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
{   // the ledge: hang, then a smooth mantle onto the top; down lets go without re-grabbing
    const w = world('reactor'); const f = fighter(w, 1, 162, 700); f.ground = false; f.vy = 300; f.st = 'air';
    run(w, 8, {});
    const p = w.plats[f.ledge.p];
    run(w, 1, {1: {k: P.IN.UP}});
    const ys = [];
    for (let i = 0; i < 8; i++) {
        run(w, 1, {1: {k: 0}});
        ys.push(f.y);
    }
    check('the mantle rises smoothly (never down) and ends standing on top', ys.every((y, i) => i === 0 || y <= ys[i - 1] + 0.01) &&
        f.ground && f.plat === p && f.st === 'idle' && f.x > p.x);
    const w2 = world('reactor'); const g = fighter(w2, 1, 162, 700); g.ground = false; g.vy = 300; g.st = 'air';
    run(w2, 8, {});
    const ev = run(w2, 4, i => ({1: {k: i === 0 ? P.IN.DOWN : 0}}));   // (falling, not yet landed)
    check('down lets go with a push and no re-grab', !g.ledge && g.vy > 0 && ev.filter(e => e.type === 'ledge').length === 0);
}
{   // forward + J: the lunge; down + J: the sweep; down + K in the air: the ground pound
    const w = world('reactor'); const a = fighter(w, 1, 700), b = fighter(w, 2, 790); a.face = 1;
    const ev = run(w, 8, i => ({1: {k: i === 0 ? P.IN.RIGHT | P.IN.LIGHT : 0}}));
    check('forward + J lunges in and lands from further out', ev.some(e => e.type === 'hit' && e.kind === 'lunge'));
    const w2 = world('reactor'); const c = fighter(w2, 1, 700), d = fighter(w2, 2, 750); c.face = 1;
    const ev2 = run(w2, 8, i => ({1: {k: i === 0 ? P.IN.DOWN | P.IN.LIGHT : 0}}));
    check('down + J sweeps them off their feet', ev2.some(e => e.type === 'hit' && e.kind === 'sweep') && d.st === 'tumble');
    const w3 = world('reactor'); const e = fighter(w3, 1, 800, 600), o = fighter(w3, 2, 880); e.ground = false; e.st = 'air';
    let lifted = 0;
    const ev3 = [];
    for (let i = 0; i < 12; i++) {
        ev3.push(...run(w3, 1, {1: {k: i === 0 ? P.IN.DOWN | P.IN.HEAVY : 0}}));
        lifted = Math.min(lifted, o.vy);
    }
    check('the ground pound drops straight down and sends a shockwave', ev3.some(x => x.type === 'pound') && lifted < -200 &&
        Math.abs(e.x - 800) < 2);
}
{   // breakfall: dash just before landing from a tumble: a roll, invulnerable
    const w = world('reactor'); const f = fighter(w, 1, 800, 700); Object.assign(f, {ground: false, st: 'tumble', vy: 400, stun: 0.5});
    const ev = run(w, 12, i => ({1: {k: i === 2 ? P.IN.DASH : 0}}));
    check('a breakfall rolls you up, invulnerable', ev.some(e => e.type === 'tech') && f.st !== 'tumble');
}
{   // the knockout: frozen, then a second at quarter speed; the body bounces once and lies still
    const w = world('colosseum'); const a = fighter(w, 1, 700), b = fighter(w, 2, 750); a.face = 1; b.hp = 3;
    run(w, 9, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));      // (the 120 ms freeze first)
    check('a knockout freezes, then runs at 0.25x', w.koSlow > 0 && w.timeScale < 0.6);
    const ev = run(w, 120, {});
    check('the body bounces once and settles', ev.filter(e => e.type === 'thud' && e.id === 2).length === 1 && b.rest);
}
{   // a launched ragdoll lands flat on the top: clamped, a short crouch, back up; never into or through a floor
    const w = world('reactor'); const f = fighter(w, 1, 800, 300);
    Object.assign(f, {ground: false, st: 'tumble', vy: 1500, vx: 200, stun: 0.6, spinV: 13});
    let deepest = -Infinity, landed = null;
    for (let i = 0; i < 40; i++) {
        run(w, 1, {});
        if (f.ground && !landed) landed = {y: f.y, vy: f.vy, st: f.st, plat: f.plat};
        if (landed) deepest = Math.max(deepest, f.y - landed.plat.y);
    }
    check('a ragdoll lands clamped to the top, in a crouch', landed && landed.vy === 0 && landed.st === 'land' && deepest <= 0);
    check('and is back on its feet after the crouch', f.st === 'idle' && f.spin === 0);
    let through = 0;                               // the foundry's moving plates: rising into falling bodies
    for (let n = 0; n < 300; n++) {
        const m = world('magma'); m.time = n * 0.037;
        run(m, 1, {});                             // (the plate moves to where this moment puts it)
        const plate = m.plats.find(p => p.move && p.move.axis === 'y');
        const g = fighter(m, 1, plate.x + 30 + (n % 7) * 25, plate.y - 60 - (n % 5) * 40);
        Object.assign(g, {ground: false, st: 'tumble', vy: (n % 9) * 180, stun: 0.6});
        for (let i = 0; i < 60; i++) {
            const above = g.y <= plate.y + 1, inside = g.x > plate.x + 8 && g.x < plate.x + plate.w - 8;
            run(m, 1, {});
            if (above && inside && g.x > plate.x + 8 && g.x < plate.x + plate.w - 8 && g.y > plate.y + 4 && !g.ledge) {
                through++;
                break;
            }
        }
    }
    check('a moving plate catches a falling body (no phasing through)', through === 0);
}
{   // hanging: the hands on the corner; J: a hop kick over the lip; hit while hanging: punished and knocked off
    const hang = () => {
        const w = world('reactor'); const f = fighter(w, 1, 162, 700); f.ground = false; f.vy = 300; f.st = 'air';
        run(w, 8, {});
        return {w, f, p: w.plats[f.ledge.p], side: f.ledge.side};
    };
    const {w, f, p, side} = hang(), edge = side < 0 ? p.x : p.x + p.w;
    check('the hang puts the hands on the corner', f.st === 'ledge' && f.x === edge + side * P.GRIP && f.y === p.y + P.HANG);
    const o = fighter(w, 2, edge - side * 26, p.y); o.face = side;
    const ev = run(w, 10, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('J: the ledge hop kick hits whoever is on the lip, and lands on top', ev.some(e => e.type === 'hit' &&
        e.kind === 'ledgekick' && e.power === 16) && o.st === 'tumble' && f.ground && f.plat === p);
    const h = hang(); h.f.inv = 0;
    const ed = h.side < 0 ? h.p.x : h.p.x + h.p.w;
    const q = fighter(h.w, 2, ed - h.side * 10, h.p.y); q.face = h.side;
    const ev2 = run(h.w, 2, i => ({2: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('a hit on a hanging player: 1.3x damage, knocked off and down', ev2.some(e => e.type === 'callout' &&
        e.text === 'LEDGE PUNISH!') && h.f.hp === 100 - Math.round(P.MOVES.jab.dmg * 1.3) && !h.f.ledge && h.f.st === 'tumble');
}
{   // a falling crate: E or an aerial strike takes it out of the air
    const w = world('colosseum'); const f = fighter(w, 1, 800, 560); f.ground = false; f.st = 'air'; f.vy = 0;
    w.crates.push({x: 800, y: 500, kind: 'bat', landed: false, life: 20});
    const ev = run(w, 1, {1: {k: P.IN.USE}});
    check('E in mid-air: the crate pops and the weapon is in hand, with a bounce', f.weapon && f.weapon.kind === 'bat' &&
        !w.crates.length && f.vy < 0 && ev.some(e => e.type === 'pickup' && e.air));
    const w2 = world('colosseum'); const g = fighter(w2, 1, 770, 560); g.ground = false; g.st = 'air'; g.vy = 0; g.face = 1;
    w2.crates.push({x: 810, y: 530, kind: 'katana', landed: false, life: 20});
    run(w2, 6, i => ({1: {k: i === 0 ? P.IN.HEAVY : 0}}));
    check('a flying kick smashes it open: weapon in hand', g.weapon && g.weapon.kind === 'katana' && !w2.crates.length);
}
{   // the Colosseum: a hard hit into the wall, falling onto the floor in the same step: lands on top, upright
    const w = world('colosseum'); const floor = w.plats.find(p => p.floor) || w.plats.reduce((a, p) => p.y > a.y ? p : a);
    const f = fighter(w, 1, 40, floor.y - 20);
    Object.assign(f, {ground: false, st: 'tumble', vx: -1400, vy: 1200, stun: 0.6, spin: 9, spinV: 13});
    let deepest = -Infinity;
    for (let i = 0; i < 30; i++) {
        run(w, 1, {});
        if (f.x > floor.x && f.x < floor.x + floor.w) deepest = Math.max(deepest, f.y - floor.y);
    }
    check('a wall bounce never sinks a body into the floor', deepest <= 0 && f.ground && f.y === floor.y);
    check('and it ends upright', f.st === 'idle' && f.spin === 0);
}
{   // two bodies in one spot are eased apart sideways, never pushed down
    const w = world('colosseum'); const a = fighter(w, 1, 800), b = fighter(w, 2, 802);
    run(w, 12, {});
    check('overlapping fighters separate sideways, feet still on the floor', Math.abs(b.x - a.x) >= 29 && a.y === 820 &&
        b.y === 820 && a.ground && b.ground);
}
{   // the parkour tower: up to four on the clock at once, each their own; off the tower, your clock resets
    const w = world('lobby'); w.noDamage = true;
    const start = w.plats.find(p => p.parkour === 'start');
    const fs = [0, 1, 2, 3, 4].map(i => {
        const f = fighter(w, i + 1, start.x + 8 + i * 18, start.y - 30); f.ground = false; f.st = 'air'; f.vy = 100; return f;
    });
    const ev = run(w, 4, {});
    const on = fs.filter(f => f.climbStart !== undefined);
    check('four climbers on the clock, the fifth told the tower is full', on.length === 4 &&
        ev.filter(e => e.type === 'climbFull').length === 1);
    on[0].x = P.MAPS.lobby.climbZone - 40;          // one wanders off the tower
    const ev2 = run(w, 1, {});
    check("leaving the tower resets that climber's clock only", on[0].climbStart === undefined &&
        ev2.some(e => e.type === 'climbReset' && e.id === on[0].id) && on.slice(1).every(f => f.climbStart !== undefined));
}
{   // a K.O. lying still stays on top of the floor (it used to keep falling, a little each tick)
    const w = world('reactor'); const a = fighter(w, 1, 700), b = fighter(w, 2, 750); a.face = 1; b.hp = 3;
    run(w, 9, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    run(w, 200, {});
    check('a K.O. at rest stays on the floor for good', b.rest && b.y === 820);
}
{   // a pillar knocked down doesn't grow back around someone standing in its spot
    const w = world('colosseum'); const pillar = w.plats.find(p => p.solid);
    pillar.alive = false; pillar.respawn = 0.01;
    const f = fighter(w, 1, pillar.x + pillar.w / 2);
    run(w, 10, {});
    const waited = !pillar.alive;
    f.x = pillar.x - 200;
    run(w, 3, {});
    check('a pillar waits for its spot to clear before it comes back', waited && pillar.alive);
}
{   // a K.O. with others still fighting: no slow motion, no world freeze; only the deciding one is cinematic
    const w = world('colosseum');
    const a = fighter(w, 1, 700), b = fighter(w, 2, 750), c = fighter(w, 3, 1200), d = fighter(w, 4, 1300);
    a.face = 1; b.hp = 3; c.vx = 300;
    const ev = run(w, 3, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}, 3: {k: P.IN.RIGHT}}));
    const ko = ev.find(e => e.type === 'ko');
    check('a mid-match K.O. (3 still up): not final, no slow motion, no world freeze', ko && !ko.final && !(w.koSlow > 0) &&
        w.timeScale === 1 && w.hitstop <= 0);
    const x0 = c.x;
    run(w, 1, {3: {k: P.IN.RIGHT}});
    check('and the others keep moving through it', c.x > x0);
    const w2 = world('colosseum'); const e = fighter(w2, 1, 700), g = fighter(w2, 2, 750); e.face = 1; g.hp = 3;
    w2.clinch = [];                                    // (nobody at match point)
    const ev2 = run(w2, 3, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('1v1, not match point: the round ends without the cinematic', ev2.some(x => x.type === 'ko' && !x.final) &&
        !(w2.koSlow > 0));
    const w3 = world('colosseum'); const h = fighter(w3, 1, 700), j = fighter(w3, 2, 750); h.face = 1; j.hp = 3;
    w3.clinch = [1];
    run(w3, 9, i => ({1: {k: i === 0 ? P.IN.LIGHT : 0}}));
    check('1v1 at match point: the deciding K.O. goes to 0.2x', w3.koSlow > 0 && w3.timeScale < 0.5);
}
{   // the foundry's magma: launched high and in control, you steer back to a platform without falling in again
    let back = 0, burns = 0;
    for (let n = 0; n < 20; n++) {
        const w = world('magma'); w.time = n * 0.37; run(w, 1, {});
        const f = fighter(w, 1, 200 + n * 60, w.lavaY + 10); f.ground = false; f.st = 'air';
        let landed = false;
        for (let i = 0; i < 600 && !landed; i++) {
            const plat = w.plats.filter(p => p.alive && p.y < w.lavaY - 20)
                .reduce((a, p) => Math.abs(p.x + p.w / 2 - f.x) < Math.abs(a.x + a.w / 2 - f.x) ? p : a);
            const dir = plat.x + plat.w / 2 > f.x ? P.IN.RIGHT : P.IN.LEFT;
            f.hp = 100;                                // (testing the steering, not the damage)
            burns += run(w, 1, {1: {k: dir | (f.vy > 200 && i % 6 === 0 ? P.IN.JUMP : 0)}}).filter(e => e.type === 'lava').length;
            landed = f.ground && f.plat && f.plat.y < w.lavaY - 20;
        }
        back += landed ? 1 : 0;
    }
    check(`off the magma: back on a platform every time, burned once (${back}/20, ${(burns / 20).toFixed(2)} burns)`,
        back === 20 && burns / 20 <= 1.1);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
