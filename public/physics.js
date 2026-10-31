// Stick Havoc: the shared simulation and the stick-figure rig.
// The server runs step() 30 times a second (it is the only authority);
// the browser uses the stage layout, the constants and drawRig().
// Works as a CommonJS module (Node) and as window.Physics (browser).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Physics = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const W = 1600, H = 900;              // the arena, in world units (y grows downwards)
    const COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#facc15', '#fb923c',
        '#fb7185', '#a78bfa', '#3b82f6', '#34d399', '#e879f9'];
    const C = {
        GRAV: 2300, RUN: 430, ACC_GROUND: 4200, ACC_AIR: 2200, ACC_ICE: 650,
        JUMP: 840, JUMP2: 760, FALL_MAX: 1500, HP: 100,
        DASH_V: 950, DASH_T: 0.2, DASH_CD: 0.55,     // 0.2 s = 12 frames at 60 fps: invulnerable
        LEDGE_INV: 1.0, SPAWN_SHIELD: 3.0,
    };
    const HAZARDS = {ice: 'Slippery Ice', anvil: 'Anvil Rain', lowgrav: 'Low Gravity', gloves: 'Giant Boxing Gloves'};
    const VOTE_PAIRS = [['ice', 'anvil'], ['lowgrav', 'gloves'], ['ice', 'gloves'], ['anvil', 'lowgrav']];
    // input bits
    const IN = {LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, JUMP: 16, LIGHT: 32, HEAVY: 64, DASH: 128};

    // ---------------------------------------------------------------- stages
    function stage(mode) {
        if (mode === 'rumble') {          // three tiers, every platform crumbles; the bottom is a pit
            return [
                {x: 100, y: 790, w: 440, h: 26, crumble: true}, {x: 620, y: 810, w: 360, h: 26, crumble: true},
                {x: 1060, y: 790, w: 440, h: 26, crumble: true},
                {x: 280, y: 600, w: 300, h: 18, oneWay: true, crumble: true},
                {x: 1020, y: 600, w: 300, h: 18, oneWay: true, crumble: true},
                {x: 650, y: 420, w: 300, h: 18, oneWay: true, crumble: true},
            ].map(p => Object.assign({alive: true, load: 0, breaking: 0, respawn: 0}, p));
        }
        return [                          // King of the Hill: a floor wall to wall, three ledges
            {x: 0, y: 820, w: W, h: 80, floor: true},
            {x: 230, y: 610, w: 300, h: 18, oneWay: true}, {x: 1070, y: 610, w: 300, h: 18, oneWay: true},
            {x: 650, y: 440, w: 300, h: 18, oneWay: true},
        ].map(p => Object.assign({alive: true, load: 0, breaking: 0, respawn: 0}, p));
    }

    function createWorld(mode) {
        return {mode, plats: stage(mode), fighters: [], anvils: [], time: 0, timeScale: 1, slowmo: 0, slowmoCd: 0,
            hitstop: 0, hazard: null, hazardT: 0, anvilT: 0, events: []};
    }

    function makeFighter(id, name, color, x, y) {
        return {id, name, color, x, y, vx: 0, vy: 0, face: x < W / 2 ? 1 : -1, hp: C.HP, ground: false, jumps: 2,
            st: 'air', atk: null, combo: 0, comboT: 0, stun: 0, inv: 0, shield: C.SPAWN_SHIELD, dashT: 0, dashCd: 0,
            airDash: true, ledge: null, ledgeT: 0, ledgeCd: 0, juggle: 0, spin: 0, spinV: 0, drop: 0, wallCd: 0,
            koT: 0, lastHit: null, prev: 0};
    }

    // ---------------------------------------------------------------- combat
    const MOVES = {
        light: {dur: 0.24, from: 0.06, to: 0.14, reach: 50, r: 34},
        light3: {dur: 0.34, from: 0.08, to: 0.18, reach: 56, r: 38},
        heavy: {dur: 0.42, from: 0.15, to: 0.27, reach: 54, r: 42},
        dropkick: {dur: 0.45, from: 0.03, to: 0.4, reach: 30, r: 42},
    };

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
        let dmg, kx, ky, stun, tumble = false;
        if (kind === 'light') {
            const finisher = a.combo === 3;
            dmg = finisher ? 8 : 5;
            const d = a.atk.dir;
            kx = d.x * (finisher ? 520 : 260);
            ky = d.y * 260 - (finisher ? 360 : 90);
            stun = finisher ? 0.42 : 0.26;
            if (airborne && t.juggle > 0) {               // a juggle: keep them up, two or three times
                t.juggle++;
                if (t.juggle <= 3) {
                    kx = a.face * 130; ky = -500;
                } else {
                    kx = a.face * 760; ky = -320; tumble = true; t.juggle = 0;
                }
            }
        } else if (kind === 'heavy') {
            dmg = 13;
            if (airborne) {
                kx = a.face * 680; ky = -520; tumble = true;
            } else {                                      // the launcher
                kx = a.face * 220; ky = -1080; t.juggle = 1;
            }
            stun = 0.7;
        } else {                                          // drop kick
            dmg = 12; kx = a.face * 1000; ky = -260; stun = 0.6; tumble = true;
        }
        dmg = Math.round(dmg * (gloves > 1 ? 1.25 : 1));
        t.vx = kx * gloves;
        t.vy = ky * gloves;
        if (t.vy < 0)
            t.ground = false;
        t.stun = stun;
        t.atk = null;
        t.ledge = null;
        t.dashT = 0;
        t.lastHit = a.id;
        if (tumble) {
            t.st = 'tumble';
            t.spinV = (a.face > 0 ? 1 : -1) * 13;
        } else {
            t.st = 'hurt';
        }
        t.hp = Math.max(0, t.hp - dmg);
        const hx = (a.x + t.x) / 2, hy = t.y - 60;
        w.hitstop = Math.max(w.hitstop, kind === 'light' ? 0.035 : 0.07);
        w.events.push({type: 'hit', x: Math.round(hx), y: Math.round(hy), kind, power: dmg, color: a.color, by: a.id, on: t.id});
        if (t.hp <= 0) {
            t.st = 'ko';
            t.koT = 0;
            t.vx = a.face * 950;
            t.vy = -760;
            t.spinV = a.face * 16;
            w.hitstop = 0.08;                             // the knockout freeze
            w.slowmo = 0;
            w.timeScale = 1;
            w.events.push({type: 'ko', x: Math.round(t.x), y: Math.round(t.y - 50), id: t.id, by: a.id, color: a.color});
        }
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
            move(w, f, inputs[f.id] || {k: 0}, dt);
        platforms(w, live, dt);
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
        // run
        if (f.dashT <= 0) {
            const busy = f.atk && f.atk.kind !== 'dropkick' ? 0.35 : 1;
            const target = dir * C.RUN * busy;
            const acc = f.ground ? (w.hazard === 'ice' ? C.ACC_ICE : C.ACC_GROUND) : C.ACC_AIR;
            const dv = target - f.vx;
            if (!(f.atk && f.atk.kind === 'dropkick'))
                f.vx += Math.max(-acc * dt, Math.min(acc * dt, dv));
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
                f.vx = away * 560; f.vy = -C.JUMP2; f.face = away; f.wallCd = 0.3;
                w.events.push({type: 'walljump', id: f.id, x: Math.round(f.x), y: Math.round(f.y - 40)});
            } else if (f.jumps > 0) {
                f.vy = -C.JUMP2; f.jumps--;
                w.events.push({type: 'jump', id: f.id, double: true});
            }
        }
        // dash / dodge roll: 12 frames of invulnerability
        if ((pressed & IN.DASH) && f.dashCd <= 0 && (f.ground || f.airDash)) {
            if (dir)
                f.face = dir;
            f.dashT = C.DASH_T; f.inv = Math.max(f.inv, C.DASH_T); f.dashCd = C.DASH_CD;
            if (!f.ground) {
                f.airDash = false; f.vy = 0;
            }
            f.atk = null;
            w.events.push({type: 'dash', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
        }
        // attacks (as in Tekken, an un-aimed attack turns you to the nearest foe close by)
        if (!f.atk && f.dashT <= 0) {
            if ((pressed & (IN.LIGHT | IN.HEAVY)) && (inp.aim === null || inp.aim === undefined)) {
                let near = null;
                for (const o of w.fighters) {
                    if (o !== f && o.st !== 'ko' && o.st !== 'gone' && Math.abs(o.x - f.x) < 160 && Math.abs(o.y - f.y) < 120 &&
                        (!near || Math.abs(o.x - f.x) < Math.abs(near.x - f.x)))
                        near = o;
                }
                if (near && Math.abs(near.x - f.x) > 4)
                    f.face = near.x > f.x ? 1 : -1;
            }
            if (pressed & IN.LIGHT) {
                f.combo = f.comboT > 0 ? (f.combo % 3) + 1 : 1;
                const dir2 = aimOf(f, k, inp.aim);
                if (Math.abs(dir2.x) > 0.2)
                    f.face = dir2.x > 0 ? 1 : -1;
                f.atk = {kind: 'light', move: f.combo === 3 ? MOVES.light3 : MOVES.light, t: 0, hit: [], dir: dir2};
                w.events.push({type: 'swing', id: f.id, kind: 'light'});
            } else if (pressed & IN.HEAVY) {
                if (!f.ground) {
                    f.atk = {kind: 'dropkick', move: MOVES.dropkick, t: 0, hit: [], dir: {x: f.face, y: 0.4}};
                    f.vx = f.face * 720; f.vy = 520;
                } else {
                    f.atk = {kind: 'heavy', move: MOVES.heavy, t: 0, hit: [], dir: {x: f.face * 0.4, y: -0.9}};
                }
                w.events.push({type: 'swing', id: f.id, kind: f.atk.kind});
            }
        }
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
            if (a.kind === 'dropkick') {
                cx = f.x + f.face * 34; cy = f.y - 26;
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
                }
            }
        }
        if (a.t >= m.dur) {
            f.atk = null;
            if (a.kind === 'light')
                f.comboT = 0.45;
        }
    }

    // the Tekken moment: both nearly out, both swinging, close together
    function slowmoCheck(w, live) {
        if (w.slowmo > 0 || w.slowmoCd > 0)
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

    function move(w, f, inp, dt) {
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
        const grav = C.GRAV * (w.hazard === 'lowgrav' ? 0.45 : 1);
        if (f.dashT > 0 && !f.ground) {
            f.vy = 0;
        } else if (!f.ground || f.vy < 0) {
            f.vy = Math.min(C.FALL_MAX, f.vy + grav * dt);
        }
        if (f.dashT > 0)
            f.vx = f.face * C.DASH_V;
        if (f.st === 'tumble' || f.st === 'ko')
            f.spin += f.spinV * dt;
        const oldY = f.y, wasGround = f.ground, impact = f.vy;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        // the arena's side walls: a hard hit bounces off them
        if (f.x < 22 || f.x > W - 22) {
            const side = f.x < 22 ? 1 : -1;
            f.x = side > 0 ? 22 : W - 22;
            if ((f.st === 'tumble' || f.st === 'hurt' || f.st === 'ko') && Math.abs(f.vx) > 520) {
                f.vx = side * Math.abs(f.vx) * 0.62;
                f.vy = Math.min(f.vy, -320);
                if (f.st !== 'ko')
                    f.hp = Math.max(1, f.hp - 3);
                w.hitstop = Math.max(w.hitstop, 0.05);
                w.events.push({type: 'wallbounce', id: f.id, x: Math.round(f.x), y: Math.round(f.y - 50)});
            } else {
                f.vx = 0;
            }
        }
        // platforms: land on top (one-way ones can be jumped through from below)
        f.ground = false;
        if (f.st !== 'ko' && f.vy >= 0) {
            for (const p of w.plats) {
                if (!p.alive || (p.oneWay && (f.drop > 0)))
                    continue;
                if (oldY <= p.y + 2 && f.y >= p.y && f.x >= p.x - 6 && f.x <= p.x + p.w + 6) {
                    f.y = p.y; f.vy = 0; f.ground = true; f.plat = p;
                    break;
                }
            }
        }
        if (f.ground && !wasGround) {
            f.jumps = 2; f.airDash = true; f.juggle = 0;
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
        if (!f.ground && f.vy > 0 && f.st !== 'tumble' && f.st !== 'ko' && f.stun <= 0 && f.ledgeCd <= 0 && !f.atk) {
            w.plats.forEach((p, i) => {
                if (f.ledge || !p.alive || p.floor)
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
        // the pit (Royal Rumble): out
        if (f.y > H + 220 && f.st !== 'gone') {
            if (f.st !== 'ko') {
                f.hp = 0;
                w.events.push({type: 'ko', x: Math.round(f.x), y: H - 40, id: f.id, by: f.lastHit, fell: true});
            }
            f.st = 'gone';
        }
    }

    function platforms(w, live, dt) {
        for (const p of w.plats) {
            if (!p.crumble)
                continue;
            if (!p.alive) {
                p.respawn -= dt;
                if (p.respawn <= 0) {
                    p.alive = true; p.load = 0; p.breaking = 0;
                }
                continue;
            }
            if (p.breaking > 0) {
                p.breaking -= dt;
                if (p.breaking <= 0) {
                    p.alive = false; p.respawn = 7;
                    w.events.push({type: 'crumble', x: Math.round(p.x + p.w / 2), y: p.y});
                }
            } else if (live.some(f => f.ground && f.plat === p)) {
                p.load += dt;
                if (p.load > 1.6)
                    p.breaking = 0.7;
            } else {
                p.load = Math.max(0, p.load - dt * 0.5);
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
                    f.hp = Math.max(0, f.hp - 10);
                    f.vy = 380; f.vx = (f.x < a.x ? -1 : 1) * 260; f.stun = 0.45; f.st = 'hurt'; f.atk = null;
                    w.events.push({type: 'anvil', x: Math.round(a.x), y: Math.round(a.y), on: f.id});
                    if (f.hp <= 0) {
                        f.st = 'ko'; f.vy = -500; f.spinV = 12;
                        w.events.push({type: 'ko', x: Math.round(f.x), y: Math.round(f.y - 50), id: f.id, by: null});
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
    // f: {x, y, face, st, ak (attack kind), ap (attack progress 0-1), vx, vy,
    // ground, spin, color, inv, gloves}; t: seconds (animation clock).
    // Returns the head position (for the headband ribbon).
    function drawRig(ctx, f, t, opts = {}) {
        const s = f.face || 1;
        const run = f.st === 'run' ? Math.sin(t * 15) : 0;
        const lean = Math.max(-1, Math.min(1, (f.vx || 0) / 430)) * 0.22 * s;
        let hip = {x: 0, y: -46}, neck = {x: 0, y: -80};
        // joint angles (radians from straight down; positive = towards facing)
        let lThigh = -0.15 + run * 0.7, rThigh = 0.15 - run * 0.7, lShin = 0.1, rShin = 0.1;
        let lArm = -0.4 - run * 0.6, rArm = 0.5 + run * 0.6, lFore = -0.6, rFore = -0.8;
        let body = lean, bob = f.st === 'idle' ? Math.sin(t * 3) * 1.5 : 0;
        const p = f.ap || 0;
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
        if (f.ak === 'light') {                       // a jab: the front arm shoots out
            const reach = Math.sin(Math.min(1, p) * Math.PI);
            const up = f.aimUp ? -1.1 : 0;
            rArm = 1.57 + up * reach + (f.aimY || 0) * reach;
            rFore = 0;
            lArm = 0.9; lFore = -1.6;
            body += 0.15 * reach;
            if (f.combo === 3) {
                lThigh = 1.4 * reach; lShin = -0.2;
            }
        } else if (f.ak === 'heavy') {                // the launcher: a rising uppercut
            const k = Math.min(1, p * 1.6);
            rArm = 0.4 + k * 2.6; rFore = -0.3 * (1 - k);
            body = -0.25 * k + 0.2 * (1 - k);
            lThigh = 0.5; lShin = -0.6;
        } else if (f.ak === 'dropkick') {             // both feet forward, body back
            body = -0.9; lThigh = 1.5; rThigh = 1.3; lShin = 0; rShin = 0.1; lArm = -2.0; rArm = -1.6;
        }
        if (f.st === 'tumble' || f.st === 'ko') {
            lArm = -2.4; rArm = 2.0; lThigh = 0.9; rThigh = -0.7; lShin = -0.9; rShin = 0.8; lFore = 0.6; rFore = -0.6;
        }
        const glow = opts.alpha === undefined ? 1 : opts.alpha;
        ctx.save();
        ctx.translate(f.x, f.y + bob);
        if (f.st === 'tumble' || f.st === 'ko') {
            ctx.translate(0, -46);
            ctx.rotate(f.spin || 0);
            ctx.translate(0, 46);
        }
        ctx.scale(s, 1);
        ctx.globalAlpha = glow * (f.inv > 0 && Math.floor(t * 20) % 2 ? 0.45 : 1);
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (!opts.noGlow) {
            ctx.shadowColor = f.color;
            ctx.shadowBlur = 14;
        }
        const pt = (o, ang, len) => ({x: o.x + Math.sin(ang) * len, y: o.y + Math.cos(ang) * len});
        neck = pt(hip, Math.PI - body, 34);
        const head = pt(hip, Math.PI - body, 50);
        const shoulder = pt(hip, Math.PI - body, 30);
        const limb = (o, a1, a2, l1, l2) => {
            const j = pt(o, a1, l1), e = pt(j, a1 + a2, l2);
            ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(j.x, j.y); ctx.lineTo(e.x, e.y); ctx.stroke();
            return e;
        };
        ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(neck.x, neck.y); ctx.stroke();
        limb(hip, lThigh, lShin, 24, 24);
        limb(hip, rThigh, rShin, 24, 24);
        limb(shoulder, lArm + body, lFore, 18, 18);
        const fist = limb(shoulder, rArm + body, rFore, 18, 18);
        ctx.beginPath(); ctx.arc(head.x, head.y, 11, 0, Math.PI * 2); ctx.stroke();
        if (opts.gloves) {                            // Giant Boxing Gloves
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(fist.x, fist.y, 13, 0, Math.PI * 2); ctx.fill();
        }
        if (f.shield > 0) {                           // the spawn shield
            ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 10);
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, -48, 60, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
        // the head in world space, for the ribbon
        const ang = f.st === 'tumble' || f.st === 'ko' ? (f.spin || 0) : 0;
        const hx = head.x * s, hy = head.y + 46;
        return {x: f.x + hx * Math.cos(ang) - hy * Math.sin(ang), y: f.y - 46 + hx * Math.sin(ang) + hy * Math.cos(ang) + bob};
    }

    return {W, H, C, COLORS, HAZARDS, VOTE_PAIRS, IN, stage, createWorld, makeFighter, step, drawRig};
});
