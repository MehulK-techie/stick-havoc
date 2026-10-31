// Stick Havoc: the shared simulation, the maps and the stick-figure rig.
// The server runs step() 30 times a second (it is the only authority);
// the browser uses the maps, the constants and drawRig().
// Works as a CommonJS module (Node) and as window.Physics (browser).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Physics = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const W = 1600, H = 900;              // every map, in world units (y grows downwards)
    const FPS = 60;                       // frame data below is in 60 fps frames
    const fr = n => n / FPS;
    // the wardrobe: (name, colour)
    const COLORS = [['Cyan', '#22d3ee'], ['Hot Pink', '#f472b6'], ['Lime', '#a3e635'], ['Electric Gold', '#facc15'],
        ['Violet', '#a78bfa'], ['Emerald', '#34d399'], ['Sunset Orange', '#fb923c'], ['White', '#f1f5f9'],
        ['Crimson', '#f43f5e'], ['Ice Blue', '#93c5fd']];
    const HATS = {bandana: 'Ninja Bandana', visor: 'Cyber Visor', kasa: 'Samurai Kasa', crown: 'Golden Crown',
        eyepatch: 'Bandit Eyepatch'};
    const TRAILS = {ghost: 'Ghost Afterimages', sparkle: 'Neon Sparkles', smoke: 'Shadow Smoke'};
    const C = {
        GRAV: 2300, RUN: 440, ACC_GROUND: 5200, ACC_AIR: 2600, ACC_ICE: 650,
        JUMP: 860, JUMP2: 780, FALL_MAX: 1500, HP: 100,
        DASH_V: 980, DASH_T: fr(10), DASH_CD: 0.5,    // 10 frames of invulnerability
        LEDGE_INV: 1.0, SPAWN_SHIELD: 2.5,
    };
    const HAZARDS = {ice: 'Slippery Ice', anvil: 'Anvil Rain', lowgrav: 'Low Gravity', gloves: 'Giant Boxing Gloves'};
    const VOTE_PAIRS = [['ice', 'anvil'], ['lowgrav', 'gloves'], ['ice', 'gloves'], ['anvil', 'lowgrav']];
    const MODES = {koth: 'King of the Hill', rumble: 'Royal Rumble', bomb: 'Bomb Tag'};
    const IN = {LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, JUMP: 16, LIGHT: 32, HEAVY: 64, DASH: 128, USE: 256};

    // ---------------------------------------------------------------- maps
    // plats: {x, y, w, h} tops you land on; oneWay: jump up through it;
    // crumble: gone after `crumbleAfter` s stood on, back after `respawnAfter`;
    // solid: a pillar (blocks from the side, bounces, breaks after `hp` hits).
    const MAPS = {
        lobby: {
            name: 'Locker Room', pit: false,
            plats: [{x: 0, y: 800, w: W, h: 100, floor: true},
                {x: 110, y: 560, w: 330, h: 16, oneWay: true}, {x: 1160, y: 560, w: 330, h: 16, oneWay: true}],
            stations: {wardrobe: {x: 250, y: 800}, console: {x: 800, y: 800}, dummy: {x: 1320, y: 800}},
            spawns: [[600, 800], [1000, 800], [500, 800], [1100, 800], [700, 800], [900, 800], [400, 800],
                [1200, 800], [275, 560], [1325, 560]],
        },
        rooftops: {
            name: 'Neon Rooftops', pit: true,
            plats: [{x: 110, y: 700, w: 430, h: 30}, {x: 1060, y: 700, w: 430, h: 30},
                {x: 600, y: 640, w: 400, h: 22, crumble: true, crumbleAfter: 4, respawnAfter: 8},
                {x: 300, y: 470, w: 230, h: 16, oneWay: true}, {x: 1070, y: 470, w: 230, h: 16, oneWay: true}],
            spawns: [[300, 700], [1300, 700], [200, 700], [1400, 700], [450, 700], [1150, 700], [700, 640], [900, 640],
                [415, 470], [1185, 470]],
        },
        reactor: {
            name: 'The Reactor Core', pit: false, beam: {every: 18, warn: 3, top: 690},
            plats: [{x: 0, y: 820, w: W, h: 80, floor: true},
                {x: 170, y: 640, w: 320, h: 16, oneWay: true}, {x: 1110, y: 640, w: 320, h: 16, oneWay: true},
                {x: 560, y: 480, w: 480, h: 16, oneWay: true},
                {x: 240, y: 320, w: 230, h: 16, oneWay: true}, {x: 1130, y: 320, w: 230, h: 16, oneWay: true}],
            spawns: [[330, 640], [1270, 640], [700, 480], [900, 480], [355, 320], [1245, 320], [300, 820], [1300, 820],
                [600, 820], [1000, 820]],
        },
        asteroid: {
            name: 'Low-Gravity Asteroid', pit: true, gravity: 0.55, bumpers: true,
            plats: [{x: 420, y: 720, w: 760, h: 44}, {x: 130, y: 520, w: 250, h: 16, oneWay: true},
                {x: 1220, y: 520, w: 250, h: 16, oneWay: true}, {x: 660, y: 400, w: 280, h: 16, oneWay: true}],
            spawns: [[550, 720], [1050, 720], [700, 720], [900, 720], [255, 520], [1345, 520], [800, 400], [480, 720],
                [1120, 720], [800, 720]],
        },
        colosseum: {
            name: 'The Colosseum', pit: false,
            plats: [{x: 0, y: 820, w: W, h: 80, floor: true},
                {x: 170, y: 560, w: 70, h: 260, solid: true, hp: 3}, {x: 1360, y: 560, w: 70, h: 260, solid: true, hp: 3}],
            spawns: [[600, 820], [1000, 820], [450, 820], [1150, 820], [700, 820], [900, 820], [330, 820],
                [1270, 820], [205, 560], [1395, 560]],
        },
    };
    const ARENAS = ['rooftops', 'reactor', 'asteroid', 'colosseum'];

    function stage(map) {
        const m = MAPS[map] || MAPS.lobby;
        return m.plats.map(p => Object.assign({alive: true, load: 0, breaking: 0, respawn: 0, maxHp: p.hp || 0}, p));
    }

    function createWorld(map) {
        const m = MAPS[map] || MAPS.lobby;
        return {map, plats: stage(map), fighters: [], anvils: [], time: 0, timeScale: 1, slowmo: 0, slowmoCd: 0,
            hitstop: 0, hazard: null, hazardT: 0, anvilT: 0, events: [], noDamage: false,
            gravity: m.gravity || 1, pit: !!m.pit,
            beam: m.beam ? {next: m.beam.every, phase: 'idle', x: -100, dir: 1, beeps: 0, hit: []} : null};
    }

    function makeFighter(id, name, color, x, y, gear) {
        return {id, name, color, gear: gear || {}, x, y, vx: 0, vy: 0, face: x < W / 2 ? 1 : -1, hp: C.HP,
            ground: false, jumps: 2, st: 'air', atk: null, combo: 0, comboT: 0, stun: 0, inv: 0,
            shield: C.SPAWN_SHIELD, dashT: 0, dashCd: 0, airDash: true, ledge: null, ledgeT: 0, ledgeCd: 0, juggle: 0,
            spin: 0, spinV: 0, drop: 0, wallCd: 0, koT: 0, lastHit: null, prev: 0};
    }

    // the lobby's punching dummy: springs back to where it stands, never falls over for good
    function makeDummy(x, y) {
        const d = makeFighter(0, 'Dummy', '#64748b', x, y);
        Object.assign(d, {dummy: true, anchor: x, shield: 0, face: -1});
        return d;
    }

    // ---------------------------------------------------------------- moves
    // frame data at 60 fps: startup (from), active until (to), total (dur)
    const MOVES = {
        jab: {dur: fr(12), from: fr(4), to: fr(8), reach: 48, r: 32, dmg: 4},
        hook: {dur: fr(15), from: fr(5), to: fr(9), reach: 50, r: 34, dmg: 5},
        straight: {dur: fr(21), from: fr(6), to: fr(11), reach: 58, r: 38, dmg: 9},
        uppercut: {dur: fr(24), from: fr(7), to: fr(14), reach: 46, r: 42, dmg: 12},
        airkick: {dur: fr(25), from: fr(3), to: fr(21), reach: 0, r: 40, dmg: 11},
        dive: {dur: fr(30), from: fr(2), to: fr(27), reach: 0, r: 40, dmg: 10},
    };
    const STRING = ['jab', 'hook', 'straight'];

    function aimOf(f, inp, aim) {
        if (aim !== null && aim !== undefined && isFinite(aim))
            return {x: Math.cos(aim), y: Math.sin(aim)};
        if (inp & IN.UP)
            return {x: f.face * 0.5, y: -0.866};
        return {x: f.face, y: 0};
    }

    function hurt(f) {
        return {x0: f.x - 20, x1: f.x + 20, y0: f.y - 94, y1: f.y};
    }

    function circleHits(cx, cy, r, box) {
        const nx = Math.max(box.x0, Math.min(cx, box.x1)), ny = Math.max(box.y0, Math.min(cy, box.y1));
        return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
    }

    function applyHit(w, a, t, kind) {
        const gloves = w.hazard === 'gloves' ? 1.35 : 1;
        const airborne = !t.ground;
        const m = MOVES[kind];
        let kx, ky, stun, tumble = false;
        switch (kind) {
        case 'jab':                                    // quick, a small stagger
            kx = a.face * 140; ky = -60; stun = 0.18;
            break;
        case 'hook':                                   // to the body: pulls them in a little
            kx = -a.face * 110; ky = -70; stun = 0.26;
            break;
        case 'straight':                               // the finisher: a moderate launch
            kx = a.face * 580; ky = -380; stun = 0.45;
            break;
        case 'uppercut':
            if (airborne) {
                kx = a.face * 620; ky = -560; tumble = true;
            } else {
                kx = a.face * 180; ky = -1100; t.juggle = 1;
            }
            stun = 0.7;
            break;
        case 'airkick':
            kx = a.face * 960; ky = -260; stun = 0.6; tumble = true;
            break;
        case 'dive':
            if (airborne) {                            // a spike, straight down
                kx = a.face * 200; ky = 1150; tumble = true;
            } else {                                   // off a standing opponent: ricochet
                kx = a.face * 420; ky = -300;
                a.vy = -720; a.vx = -a.face * 240; a.atk = null;
            }
            stun = 0.55;
            break;
        }
        // a juggle: light hits keep an airborne, launched opponent up there
        if (airborne && t.juggle > 0 && STRING.includes(kind)) {
            t.juggle++;
            if (t.juggle <= 4) {
                kx = a.face * 130; ky = -520;
            } else {
                kx = a.face * 760; ky = -320; tumble = true; t.juggle = 0;
            }
        }
        let dmg = Math.round(m.dmg * (gloves > 1 ? 1.25 : 1));
        t.vx = kx * gloves;
        t.vy = ky * gloves;
        if (t.vy < 0)
            t.ground = false;
        t.stun = stun;
        t.atk = null;
        t.ledge = null;
        t.dashT = 0;
        t.lastHit = a.id;
        t.st = tumble ? 'tumble' : 'hurt';
        if (tumble)
            t.spinV = (a.face > 0 ? 1 : -1) * 13;
        const heavy = !['jab', 'hook'].includes(kind);
        w.hitstop = Math.max(w.hitstop, heavy ? 0.06 : 0.03);
        const hx = (a.x + t.x) / 2, hy = t.y - 60;
        const len = Math.hypot(kx, ky) || 1;
        const shown = w.noDamage && !t.dummy ? 0 : dmg;
        w.events.push({type: 'hit', x: Math.round(hx), y: Math.round(hy), kind, power: dmg, heavy, color: a.color,
            by: a.id, on: t.id, dx: Math.round(kx / len * 100) / 100, dy: Math.round(ky / len * 100) / 100});
        if (t.dummy) {
            const crit = kind === 'straight' && Math.random() < 0.3;
            w.events.push({type: 'pop', x: Math.round(t.x), y: Math.round(t.y - 110),
                text: heavy && !crit && kind !== 'straight' ? 'BOOM!' : crit ? 'CRIT!' : `${dmg} DMG`, big: heavy || crit});
            return;
        }
        if (shown <= 0)
            return;
        t.hp = Math.max(0, t.hp - shown);
        if (t.hp <= 0)
            knockOut(w, t, a);
    }

    function knockOut(w, t, a) {
        t.hp = 0;
        t.st = 'ko';
        t.koT = 0;
        t.atk = null;
        const face = a ? a.face : (t.x < W / 2 ? 1 : -1);
        t.vx = face * 950;
        t.vy = -760;
        t.spinV = face * 16;
        w.hitstop = 0.08;                             // the knockout freeze
        w.slowmo = 0;
        w.timeScale = 1;
        w.events.push({type: 'ko', x: Math.round(t.x), y: Math.round(t.y - 50), id: t.id, by: a ? a.id : null,
            color: a ? a.color : '#f1f5f9'});
    }

    // a bomb or a shockwave: everyone near is thrown away from (x, y)
    function explode(w, x, y, radius, power, skip) {
        for (const f of w.fighters) {
            if (f === skip || f.st === 'ko' || f.st === 'gone')
                continue;
            const dx = f.x - x, dy = f.y - 50 - y, d = Math.hypot(dx, dy);
            if (d > radius)
                continue;
            const k = power * (1 - d / radius * 0.6);
            f.vx = (dx / (d || 1)) * k;
            f.vy = Math.min(-420, (dy / (d || 1)) * k);
            f.ground = false; f.st = 'tumble'; f.spinV = dx > 0 ? 12 : -12; f.stun = 0.6; f.atk = null; f.ledge = null;
        }
        w.events.push({type: 'boom', x: Math.round(x), y: Math.round(y), r: radius});
    }

    // ---------------------------------------------------------------- the step
    function step(w, inputs, dtReal) {
        if (w.hitstop > 0) {              // everything holds still for a few frames after a hit
            w.hitstop -= dtReal;
            return;
        }
        if (w.slowmo > 0) {
            w.slowmo -= dtReal;
            w.timeScale += (0.2 - w.timeScale) * 0.4;
        } else {
            w.timeScale += (1 - w.timeScale) * 0.3;
        }
        if (Math.abs(1 - w.timeScale) < 0.01)
            w.timeScale = 1;
        const dt = dtReal * w.timeScale;
        w.time += dt;
        w.slowmoCd = Math.max(0, w.slowmoCd - dtReal);
        if (w.hazard) {
            w.hazardT -= dt;
            if (w.hazardT <= 0) {
                w.events.push({type: 'hazardEnd', hazard: w.hazard});
                w.hazard = null;
            }
        }
        const live = w.fighters.filter(f => f.st !== 'gone');
        for (const f of live)
            control(w, f, inputs[f.id] || {k: 0, aim: null}, dt);
        for (const f of live)
            attacks(w, f, live, dt);
        slowmoCheck(w, live);
        for (const f of live)
            move(w, f, dt);
        platforms(w, live, dt);
        beam(w, live, dt);
        anvils(w, live, dt);
    }

    function control(w, f, inp, dt) {
        const k = inp.k | 0, pressed = k & ~f.prev;
        f.prev = k;
        for (const key of ['stun', 'inv', 'shield', 'dashCd', 'comboT', 'drop', 'wallCd', 'ledgeCd'])
            f[key] = Math.max(0, f[key] - dt);
        if (f.st === 'ko') {
            f.koT += dt;
            return;
        }
        if (f.dummy) {                                    // springs back to its spot
            if (f.ground && f.stun <= 0)
                f.vx = (f.anchor - f.x) * 5;
            f.hp = C.HP;
            return;
        }
        if (f.ledge) {                                    // hanging: climb up, or let go
            f.ledgeT += dt;
            if (pressed & (IN.JUMP | IN.UP)) {
                f.ledge = null; f.vy = -C.JUMP; f.st = 'air'; f.jumps = 1; f.ledgeCd = 0.4;
                w.events.push({type: 'jump', id: f.id});
            } else if ((pressed & IN.DOWN) || f.ledgeT > 2.5) {
                f.ledge = null; f.st = 'air'; f.ledgeCd = 0.6;
            }
            return;
        }
        if (f.dashT > 0)
            f.dashT -= dt;
        const free = f.stun <= 0 && f.st !== 'tumble';
        const dir = ((k & IN.RIGHT) ? 1 : 0) - ((k & IN.LEFT) ? 1 : 0);
        if (f.st === 'hurt' && f.stun <= 0)
            f.st = f.ground ? 'idle' : 'air';
        if (!free)
            return;
        const aerial = f.atk && (f.atk.kind === 'airkick' || f.atk.kind === 'dive');
        // run
        if (f.dashT <= 0 && !aerial) {
            const busy = f.atk ? 0.3 : 1;
            const target = dir * C.RUN * busy;
            const acc = f.ground ? (w.hazard === 'ice' ? C.ACC_ICE : C.ACC_GROUND) : C.ACC_AIR;
            f.vx += Math.max(-acc * dt, Math.min(acc * dt, target - f.vx));
            if (dir && !f.atk)
                f.face = dir;
        }
        // jump, double jump, wall kick, drop through a ledge
        if (pressed & IN.JUMP) {
            const plat = f.ground && f.plat;
            if ((k & IN.DOWN) && plat && plat.oneWay) {
                f.drop = 0.25; f.ground = false; f.y += 2;
            } else if (f.ground) {
                f.vy = -C.JUMP; f.ground = false; f.jumps = 1;
                w.events.push({type: 'jump', id: f.id});
            } else if (f.wallCd <= 0 && (f.x <= 30 || f.x >= W - 30)) {
                const away = f.x <= 30 ? 1 : -1;
                f.vx = away * 580; f.vy = -C.JUMP2; f.face = away; f.wallCd = 0.3;
                w.events.push({type: 'walljump', id: f.id, x: Math.round(f.x), y: Math.round(f.y - 40)});
            } else if (f.jumps > 0) {
                f.vy = -C.JUMP2; f.jumps--;
                w.events.push({type: 'jump', id: f.id, double: true});
            }
        }
        // dash: 10 frames of invulnerability; it also cancels a punch's recovery
        const cancellable = f.atk && STRING.includes(f.atk.kind) && f.atk.t >= f.atk.move.from;
        if ((pressed & IN.DASH) && f.dashCd <= 0 && (f.ground || f.airDash) && (!f.atk || cancellable)) {
            if (dir)
                f.face = dir;
            f.dashT = C.DASH_T; f.inv = Math.max(f.inv, C.DASH_T); f.dashCd = C.DASH_CD;
            if (!f.ground) {
                f.airDash = false; f.vy = 0;
            }
            if (f.atk)
                f.comboT = 0.35;          // the string can go on after the dash
            f.atk = null;
            w.events.push({type: 'dash', id: f.id, x: Math.round(f.x), y: Math.round(f.y), cancel: !!cancellable});
        }
        if (f.atk || f.dashT > 0 || !(pressed & (IN.LIGHT | IN.HEAVY)))
            return;
        // attacks: an un-aimed one turns you to the nearest foe close by (as in Tekken)
        if (inp.aim === null || inp.aim === undefined) {
            let near = null;
            for (const o of w.fighters) {
                if (o !== f && o.st !== 'ko' && o.st !== 'gone' && Math.abs(o.x - f.x) < 160 &&
                    Math.abs(o.y - f.y) < 120 && (!near || Math.abs(o.x - f.x) < Math.abs(near.x - f.x)))
                    near = o;
            }
            if (near && Math.abs(near.x - f.x) > 4)
                f.face = near.x > f.x ? 1 : -1;
        }
        let kind;
        if ((pressed & IN.HEAVY) && !f.ground)
            kind = (k & IN.DOWN) ? 'dive' : 'airkick';
        else if ((pressed & IN.HEAVY) || ((pressed & IN.LIGHT) && (k & IN.UP) && f.ground))
            kind = 'uppercut';
        else {
            f.combo = f.comboT > 0 ? (f.combo % 3) + 1 : 1;
            kind = STRING[f.combo - 1];
        }
        const d = kind === 'uppercut' ? {x: f.face * 0.4, y: -0.9} : aimOf(f, k & ~IN.UP, inp.aim);
        if (Math.abs(d.x) > 0.2 && STRING.includes(kind))
            f.face = d.x > 0 ? 1 : -1;
        f.atk = {kind, move: MOVES[kind], t: 0, hit: [], dir: d};
        if (kind === 'airkick') {
            f.vx = f.face * 720; f.vy = Math.min(f.vy, 0) * 0.3;
        } else if (kind === 'dive') {
            f.vx = f.face * 760; f.vy = 760;           // 45 degrees down
        }
        w.events.push({type: 'swing', id: f.id, kind});
    }

    function attacks(w, f, live, dt) {
        const a = f.atk;
        if (!a || f.st === 'ko')
            return;
        a.t += dt;
        const m = a.move;
        if (a.t >= m.from && a.t <= m.to) {
            const big = w.hazard === 'gloves' ? 1.6 : 1;
            let cx, cy;
            if (a.kind === 'airkick') {
                cx = f.x + f.face * 34; cy = f.y - 40;
            } else if (a.kind === 'dive') {
                cx = f.x + f.face * 26; cy = f.y - 8;
            } else {
                const len = Math.hypot(a.dir.x, a.dir.y) || 1;
                cx = f.x + a.dir.x / len * m.reach * (big > 1 ? 1.3 : 1);
                cy = f.y - 58 + a.dir.y / len * m.reach * (big > 1 ? 1.3 : 1);
            }
            for (const t of live) {
                if (t === f || a.hit.includes(t.id) || t.st === 'ko' || t.inv > 0 || t.shield > 0)
                    continue;
                if (circleHits(cx, cy, m.r * big, hurt(t))) {
                    a.hit.push(t.id);
                    applyHit(w, f, t, a.kind);
                    if (!f.atk)
                        break;                         // a dive's ricochet ends it
                }
            }
        }
        if (f.atk && a.t >= m.dur) {
            f.atk = null;
            if (STRING.includes(a.kind))
                f.comboT = 0.4;
        }
    }

    // the Tekken moment: both nearly out, both swinging, close together
    function slowmoCheck(w, live) {
        if (w.noDamage || w.slowmo > 0 || w.slowmoCd > 0)
            return;
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i], b = live[j];
                if (a.atk && b.atk && a.hp > 0 && b.hp > 0 && a.hp < C.HP * 0.25 && b.hp < C.HP * 0.25 &&
                    Math.hypot(a.x - b.x, a.y - b.y) < 150) {
                    w.slowmo = 1.2;
                    w.slowmoCd = 8;
                    w.events.push({type: 'slowmo', x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2 - 50)});
                    return;
                }
            }
        }
    }

    function bounceOff(w, f, side, solid) {
        f.vx = side * Math.abs(f.vx) * 0.62;
        f.vy = Math.min(f.vy, -320);
        if (f.st !== 'ko' && !w.noDamage && !f.dummy)
            f.hp = Math.max(1, f.hp - 3);
        w.hitstop = Math.max(w.hitstop, 0.05);
        w.events.push({type: 'wallbounce', id: f.id, x: Math.round(f.x), y: Math.round(f.y - 50)});
        if (solid && solid.solid) {                  // a pillar takes the blow, and gives way after a few
            solid.hp--;
            if (solid.hp <= 0) {
                solid.alive = false; solid.respawn = 14;
                w.events.push({type: 'pillar', x: Math.round(solid.x + solid.w / 2), y: Math.round(solid.y + solid.h / 2)});
            }
        }
    }

    function move(w, f, dt) {
        if (f.ledge) {
            const p = w.plats[f.ledge.p];
            if (!p || !p.alive) {
                f.ledge = null;
                f.st = 'air';
            } else {
                f.x = f.ledge.side < 0 ? p.x - 16 : p.x + p.w + 16;
                f.y = p.y + 72;
                f.vx = f.vy = 0;
                f.st = 'ledge';
                return;
            }
        }
        const grav = C.GRAV * w.gravity * (w.hazard === 'lowgrav' ? 0.45 : 1);
        if (f.dashT > 0 && !f.ground)
            f.vy = 0;
        else if (f.atk && f.atk.kind === 'dive')
            f.vy = Math.max(f.vy, 760);                // the dive holds its 45-degree line
        else if (!f.ground || f.vy < 0)
            f.vy = Math.min(C.FALL_MAX, f.vy + grav * dt);
        if (f.dashT > 0)
            f.vx = f.face * C.DASH_V;
        if (f.st === 'tumble' || f.st === 'ko')
            f.spin += f.spinV * dt;
        const oldY = f.y, wasGround = f.ground, impact = f.vy;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        const hard = (f.st === 'tumble' || f.st === 'hurt' || f.st === 'ko') && Math.abs(f.vx) > 520;
        // the arena's side walls: bumpers (asteroid), or a bounce after a hard hit
        if (f.x < 22 || f.x > W - 22) {
            const side = f.x < 22 ? 1 : -1;
            f.x = side > 0 ? 22 : W - 22;
            if (MAPS[w.map] && MAPS[w.map].bumpers && f.st !== 'ko') {
                f.vx = side * 1250; f.vy = -560; f.st = 'air'; f.stun = 0; f.atk = null;
                w.events.push({type: 'bumper', x: Math.round(f.x), y: Math.round(f.y - 50)});
            } else if (hard) {
                bounceOff(w, f, side, null);
            } else {
                f.vx = 0;
            }
        }
        // pillars: solid from the side
        for (const p of w.plats) {
            if (!p.solid || !p.alive || f.st === 'ko')
                continue;
            if (f.y > p.y + 4 && f.y - 94 < p.y + p.h && f.x + 20 > p.x && f.x - 20 < p.x + p.w) {
                const side = f.x < p.x + p.w / 2 ? -1 : 1;
                f.x = side < 0 ? p.x - 20 : p.x + p.w + 20;
                if (hard)
                    bounceOff(w, f, side, p);
                else
                    f.vx = 0;
            }
        }
        // platforms: land on top (one-way ones can be jumped through from below)
        f.ground = false;
        if (f.st !== 'ko' && f.vy >= 0) {
            for (const p of w.plats) {
                if (!p.alive || (p.oneWay && f.drop > 0))
                    continue;
                if (oldY <= p.y + 2 && f.y >= p.y && f.x >= p.x - 6 && f.x <= p.x + p.w + 6) {
                    f.y = p.y; f.vy = 0; f.ground = true; f.plat = p;
                    break;
                }
            }
        }
        if (f.ground && !wasGround) {
            f.jumps = 2; f.airDash = true; f.juggle = 0;
            if (f.atk && f.atk.kind === 'dive')
                f.atk = null;
            if (f.st === 'tumble') {                      // a ragdoll lands: back on its feet
                if (impact > 700) {
                    f.vy = -impact * 0.3; f.ground = false;   // one bounce first
                    w.events.push({type: 'thud', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
                } else {
                    f.st = 'idle'; f.spin = 0; f.stun = Math.min(f.stun, 0.12); f.inv = Math.max(f.inv, 0.3);
                    w.events.push({type: 'land', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
                }
            } else if (impact > 500) {
                w.events.push({type: 'land', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
            }
        }
        // ledge grab: falling just past a platform's edge
        if (!f.ground && f.vy > 0 && f.st !== 'tumble' && f.st !== 'ko' && f.stun <= 0 && f.ledgeCd <= 0 && !f.atk &&
            !f.dummy) {
            w.plats.forEach((p, i) => {
                if (f.ledge || !p.alive || p.floor || p.solid)
                    return;
                for (const side of [-1, 1]) {
                    const edge = side < 0 ? p.x : p.x + p.w;
                    const out = (f.x - edge) * side;
                    if (out > 0 && out < 36 && f.y > p.y + 30 && f.y < p.y + 100) {
                        f.ledge = {p: i, side}; f.ledgeT = 0; f.inv = Math.max(f.inv, C.LEDGE_INV);
                        f.face = -side; f.jumps = 2; f.airDash = true;
                        w.events.push({type: 'ledge', id: f.id});
                        return;
                    }
                }
            });
        }
        if (f.st !== 'ko' && f.st !== 'tumble' && f.st !== 'hurt' && !f.ledge)
            f.st = !f.ground ? 'air' : f.dashT > 0 ? 'dash' : Math.abs(f.vx) > 40 ? 'run' : 'idle';
        // the pit: out (or, where there is none, back from the top)
        if (f.y > H + 220 && f.st !== 'gone') {
            if (f.dummy || !w.pit) {
                Object.assign(f, {x: f.dummy ? f.anchor : W / 2, y: 100, vx: 0, vy: 0, st: 'air', spin: 0});
                return;
            }
            if (f.st !== 'ko') {
                f.hp = 0;
                w.events.push({type: 'ko', x: Math.round(f.x), y: H - 40, id: f.id, by: f.lastHit, fell: true});
            }
            f.st = 'gone';
        }
    }

    function platforms(w, live, dt) {
        for (const p of w.plats) {
            if (!p.crumble && !p.solid)
                continue;
            if (!p.alive) {
                p.respawn -= dt;
                if (p.respawn <= 0) {
                    p.alive = true; p.load = 0; p.breaking = 0; p.hp = p.maxHp;
                    w.events.push({type: 'restore', x: Math.round(p.x + p.w / 2), y: p.y});
                }
                continue;
            }
            if (!p.crumble)
                continue;
            if (p.breaking > 0) {
                p.breaking -= dt;
                if (p.breaking <= 0) {
                    p.alive = false; p.respawn = p.respawnAfter || 7;
                    w.events.push({type: 'crumble', x: Math.round(p.x + p.w / 2), y: p.y});
                }
            } else if (live.some(f => f.ground && f.plat === p)) {
                p.load += dt;
                if (p.load > (p.crumbleAfter || 1.6))
                    p.breaking = 0.7;
            } else {
                p.load = Math.max(0, p.load - dt * 0.5);
            }
        }
    }

    // the Reactor Core: a beam sweeps the lower floor every 18 s (three beeps first)
    function beam(w, live, dt) {
        const b = w.beam, cfg = MAPS[w.map] && MAPS[w.map].beam;
        if (!b || !cfg)
            return;
        if (b.phase === 'idle') {
            b.next -= dt;
            if (b.next <= cfg.warn) {
                b.phase = 'warn'; b.beeps = 0;
            }
        }
        if (b.phase === 'warn') {
            const due = Math.floor(cfg.warn - b.next) + 1;
            if (b.beeps < Math.min(3, due)) {
                b.beeps++;
                w.events.push({type: 'beep', n: b.beeps});
            }
            b.next -= dt;
            if (b.next <= 0) {
                b.phase = 'sweep'; b.x = b.dir > 0 ? -40 : W + 40; b.hit = [];
                w.events.push({type: 'beam'});
            }
            return;
        }
        if (b.phase === 'sweep') {
            b.x += b.dir * W / 1.4 * dt;
            for (const f of live) {
                if (f.st === 'ko' || b.hit.includes(f.id) || f.inv > 0 || f.shield > 0 || f.y < cfg.top)
                    continue;
                if (Math.abs(f.x - b.x) < 36) {
                    b.hit.push(f.id);
                    f.vx = b.dir * 420; f.vy = -980; f.ground = false; f.st = 'tumble'; f.spinV = b.dir * 12;
                    f.stun = 0.6; f.atk = null;
                    w.hitstop = Math.max(w.hitstop, 0.06);
                    w.events.push({type: 'hit', x: Math.round(f.x), y: Math.round(f.y - 50), kind: 'beam', power: 18,
                        heavy: true, color: '#f43f5e', by: null, on: f.id, dx: 0, dy: -1});
                    if (!w.noDamage) {
                        f.hp = Math.max(0, f.hp - 18);
                        if (f.hp <= 0)
                            knockOut(w, f, null);
                    }
                }
            }
            if (b.x < -60 || b.x > W + 60) {
                b.phase = 'idle'; b.next = cfg.every; b.dir = -b.dir;
            }
        }
    }

    function anvils(w, live, dt) {
        if (w.hazard === 'anvil') {
            w.anvilT -= dt;
            if (w.anvilT <= 0) {
                w.anvilT = 0.45;
                w.anvils.push({x: 60 + Math.random() * (W - 120), y: -60, vy: 200});
            }
        }
        for (const a of w.anvils) {
            a.vy += C.GRAV * 0.8 * dt;
            a.y += a.vy * dt;
            for (const f of live) {
                if (a.dead || f.st === 'ko' || f.inv > 0 || f.shield > 0)
                    continue;
                if (circleHits(a.x, a.y, 26, hurt(f))) {
                    a.dead = true;
                    f.vy = 380; f.vx = (f.x < a.x ? -1 : 1) * 260; f.stun = 0.45; f.st = 'hurt'; f.atk = null;
                    w.events.push({type: 'anvil', x: Math.round(a.x), y: Math.round(a.y), on: f.id});
                    if (!w.noDamage) {
                        f.hp = Math.max(0, f.hp - 10);
                        if (f.hp <= 0)
                            knockOut(w, f, null);
                    }
                }
            }
            if (!a.dead && w.plats.some(p => p.alive && a.x > p.x && a.x < p.x + p.w && a.y >= p.y && a.y - a.vy * dt < p.y + 4)) {
                a.dead = true;
                w.events.push({type: 'clang', x: Math.round(a.x), y: Math.round(a.y)});
            }
            if (a.y > H + 100)
                a.dead = true;
        }
        w.anvils = w.anvils.filter(a => !a.dead);
    }

    // ---------------------------------------------------------------- the rig
    // f: {x, y, face, st, ak (attack kind), ap (attack progress 0-1), vx,
    // ground, spin, color, inv, shield, gear: {hat}}; t: seconds.
    // Returns the head's position and tilt (for the headgear's ribbons).
    function drawRig(ctx, f, t, opts = {}) {
        const s = f.face || 1;
        const run = f.st === 'run' ? Math.sin(t * 15) : 0;
        const lean = Math.max(-1, Math.min(1, (f.vx || 0) / 440)) * 0.22 * s;
        const hip = {x: 0, y: -46};
        let lThigh = -0.15 + run * 0.7, rThigh = 0.15 - run * 0.7, lShin = 0.1 + Math.max(0, run) * 0.6,
            rShin = 0.1 + Math.max(0, -run) * 0.6;
        let lArm = -0.4 - run * 0.6, rArm = 0.5 + run * 0.6, lFore = -0.7, rFore = -0.9;
        let body = lean;
        const bob = f.st === 'idle' ? Math.sin(t * 3) * 1.5 : 0;
        const p = Math.min(1, f.ap || 0);
        const out = Math.sin(p * Math.PI);        // 0 -> 1 -> 0 over the move
        switch (f.st) {
        case 'air':
            lThigh = 0.6; lShin = -1.2; rThigh = -0.3; rShin = -0.6; lArm = -1.9; rArm = 1.6; lFore = 0.4; rFore = -0.4;
            break;
        case 'dash':
            body = 0.55; lThigh = 1.0; lShin = -0.4; rThigh = -0.9; rShin = -1.0; lArm = -1.4; rArm = -1.2;
            lFore = -0.2; rFore = -0.2;
            break;
        case 'ledge':
            lArm = 2.9; rArm = 2.7; lFore = 0; rFore = 0; lThigh = -0.1; rThigh = 0.2; lShin = 0; rShin = 0.3; body = -0.1;
            break;
        case 'hurt':
            body = -0.45; lArm = -2.2; rArm = 2.2; lFore = -0.8; rFore = 0.8; lThigh = 0.3; rThigh = -0.3;
            break;
        }
        switch (f.ak) {
        case 'jab':                                // the lead hand, straight out and back
            rArm = 1.57 + (f.aimY || 0) * out; rFore = -0.9 * (1 - out); lArm = 0.9; lFore = -1.6; body += 0.1 * out;
            break;
        case 'hook':                               // the rear hand swings round, low
            lArm = 0.6 + 1.0 * out; lFore = -1.2 + 0.4 * out; rArm = 0.7; rFore = -1.6; body += 0.22 * out;
            break;
        case 'straight':                           // everything behind it: hips turn, arm locks out
            rArm = 1.57 + (f.aimY || 0) * out; rFore = 0; lArm = -0.3; lFore = -1.4; body += 0.32 * out;
            lThigh = -0.5 * out; rThigh = 0.5 * out;
            break;
        case 'uppercut': {
            const k = Math.min(1, p * 1.6);
            rArm = 0.4 + k * 2.6; rFore = -0.3 * (1 - k); body = -0.25 * k + 0.2 * (1 - k); lThigh = 0.5; lShin = -0.6;
            break;
        }
        case 'airkick':
            body = -0.7; lThigh = 1.5; rThigh = -0.4; lShin = 0; rShin = -1.2; lArm = -2.0; rArm = -1.6;
            break;
        case 'dive':                               // a diving kick, 45 degrees down
            body = 0.5; lThigh = 0.9; rThigh = 0.2; lShin = 0; rShin = -1.3; lArm = -2.4; rArm = -2.0;
            break;
        }
        if (f.st === 'tumble' || f.st === 'ko') {
            lArm = -2.4 + Math.sin(t * 9) * 0.4; rArm = 2.0; lThigh = 0.9; rThigh = -0.7; lShin = -0.9; rShin = 0.8;
            lFore = 0.6; rFore = -0.6;
        }
        ctx.save();
        ctx.translate(f.x, f.y + bob);
        if (f.st === 'tumble' || f.st === 'ko') {
            ctx.translate(0, -46);
            ctx.rotate(f.spin || 0);
            ctx.translate(0, 46);
        }
        ctx.scale(s, 1);
        const alpha = opts.alpha === undefined ? 1 : opts.alpha;
        ctx.globalAlpha = alpha * (f.inv > 0 && !f.dummy && Math.floor(t * 20) % 2 ? 0.5 : 1);
        ctx.strokeStyle = opts.flash ? '#ffffff' : f.color;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (!opts.noGlow) {
            ctx.shadowColor = f.color;
            ctx.shadowBlur = 10;
        }
        const pt = (o, ang, len) => ({x: o.x + Math.sin(ang) * len, y: o.y + Math.cos(ang) * len});
        const neck = pt(hip, Math.PI - body, 34), head = pt(hip, Math.PI - body, 50), shoulder = pt(hip, Math.PI - body, 30);
        const limb = (o, a1, a2, l1, l2) => {
            const j = pt(o, a1, l1), e = pt(j, a1 + a2, l2);
            ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(j.x, j.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            return e;
        };
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(neck.x, neck.y); ctx.stroke();
        limb(hip, lThigh, lShin, 24, 24);
        limb(hip, rThigh, rShin, 24, 24);
        const fist2 = limb(shoulder, lArm + body, lFore, 18, 18);
        const fist = limb(shoulder, rArm + body, rFore, 18, 18);
        ctx.beginPath(); ctx.arc(head.x, head.y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
        drawHat(ctx, f.gear && f.gear.hat, head, body, f.color, t);
        if (opts.gloves) {                            // Giant Boxing Gloves
            ctx.fillStyle = '#ef4444';
            for (const q of [fist, fist2]) {
                ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, Math.PI * 2); ctx.fill();
            }
        }
        if (f.bomb) {                                 // Bomb Tag: the bomb rides on your head
            const blink = f.bombT < 5 ? Math.floor(t * (f.bombT < 2 ? 12 : 6)) % 2 : 0;
            ctx.fillStyle = '#0f172a';
            ctx.strokeStyle = blink ? '#f43f5e' : '#e2e8f0';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(head.x, head.y - 26, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(head.x + 5, head.y - 34); ctx.quadraticCurveTo(head.x + 12, head.y - 44, head.x + 8, head.y - 48);
            ctx.stroke();
            ctx.fillStyle = blink ? '#f43f5e' : '#facc15';
            ctx.beginPath(); ctx.arc(head.x + 8, head.y - 49, 2.5 + Math.random(), 0, Math.PI * 2); ctx.fill();
        }
        if (f.shield > 0 && !f.dummy) {               // the spawn shield
            ctx.globalAlpha = 0.22 + 0.12 * Math.sin(t * 10);
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, -48, 58, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        const ang = f.st === 'tumble' || f.st === 'ko' ? (f.spin || 0) : 0;
        const hx = head.x * s, hy = head.y + 46;
        return {x: f.x + hx * Math.cos(ang) - hy * Math.sin(ang), y: f.y - 46 + hx * Math.sin(ang) + hy * Math.cos(ang) + bob};
    }

    // headgear, drawn in the rig's own (facing-right) space
    function drawHat(ctx, hat, head, body, color, t) {
        if (!hat)
            return;
        ctx.save();
        ctx.translate(head.x, head.y);
        ctx.rotate(body);
        ctx.lineWidth = 3;
        switch (hat) {
        case 'bandana':                               // the knot; its ribbons are drawn by the engine
            ctx.strokeStyle = '#f1f5f9';
            ctx.beginPath(); ctx.arc(0, 0, 11.5, -2.6, -0.5); ctx.stroke();
            break;
        case 'visor':
            ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
            ctx.beginPath();
            ctx.moveTo(-2, -5); ctx.lineTo(15, -4); ctx.lineTo(14, 3); ctx.lineTo(-2, 2); ctx.closePath();
            ctx.fill();
            break;
        case 'kasa':                                  // a wide conical straw hat
            ctx.fillStyle = '#d6b37a';
            ctx.strokeStyle = '#8b6d3f';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(-26, -6); ctx.lineTo(0, -22); ctx.lineTo(26, -6); ctx.closePath();
            ctx.fill(); ctx.stroke();
            break;
        case 'crown':
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.moveTo(-10, -10); ctx.lineTo(-10, -22); ctx.lineTo(-5, -15); ctx.lineTo(0, -24); ctx.lineTo(5, -15);
            ctx.lineTo(10, -22); ctx.lineTo(10, -10); ctx.closePath();
            ctx.fill();
            break;
        case 'eyepatch':
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-11, -6); ctx.lineTo(11, -2); ctx.stroke();
            ctx.fillStyle = '#0f172a';
            ctx.beginPath(); ctx.ellipse(6, -1, 4.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }
        ctx.restore();
    }

    return {W, H, C, COLORS, HATS, TRAILS, HAZARDS, VOTE_PAIRS, MODES, MAPS, ARENAS, IN, MOVES, stage, createWorld,
        makeFighter, makeDummy, explode, knockOut, step, drawRig};
});
