// Stick Havoc: the shared simulation, the maps and the stick-figure rig.
// The server runs step() 30 times a second (it is the only authority);
// the browser uses the maps, the constants and drawRig().
// Works as a CommonJS module (Node) and as window.Physics (browser).
(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./weapons.js') : root.Weapons);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Physics = api;
})(typeof self !== 'undefined' ? self : this, function (Weapons) {
    'use strict';

    const W = 1600, H = 900;              // every map, in world units (y grows downwards)
    const FPS = 60;                       // frame data below is in 60 fps frames
    const fr = n => n / FPS;
    // the wardrobe: (name, colour)
    // 16 colours, one per player at a time (the server keeps them unique)
    const COLORS = [['Cyan', '#22d3ee'], ['Hot Pink', '#f472b6'], ['Lime', '#a3e635'], ['Electric Gold', '#facc15'],
        ['Violet', '#a78bfa'], ['Emerald', '#34d399'], ['Sunset Orange', '#fb923c'], ['White', '#f1f5f9'],
        ['Crimson', '#f43f5e'], ['Ice Blue', '#93c5fd'], ['Magenta', '#e879f9'], ['Teal', '#2dd4bf'],
        ['Coral', '#fda4af'], ['Mint', '#86efac'], ['Lemon', '#fef08a'], ['Indigo', '#818cf8']];
    const HATS = {bandana: 'Ninja Bandana', visor: 'Cyber Visor', kasa: 'Samurai Kasa', crown: 'Golden Crown',
        eyepatch: 'Bandit Eyepatch', chef: 'Chef Hat', cat: 'Cat Ears', beanie: 'Cyber Beanie', viking: 'Viking Horns'};
    const TRAILS = {ghost: 'Ghost Afterimages', sparkle: 'Neon Sparkles', smoke: 'Shadow Smoke', rainbow: 'Rainbow Prism',
        pixel: 'Pixel Dust'};
    const C = {
        GRAV: 2300, RUN: 440, ACC_GROUND: 5200, ACC_AIR: 2600, ACC_ICE: 650,
        JUMP: 860, JUMP2: 780, FALL_MAX: 1500, HP: 100,
        DASH_V: 980, DASH_T: fr(10), DASH_CD: 0.5,    // 10 frames of invulnerability
        LEDGE_INV: 1.0, SPAWN_SHIELD: 2.5,
    };
    const HAZARDS = {ice: 'Slippery Ice', anvil: 'Anvil Rain', lowgrav: 'Low Gravity', gloves: 'Giant Boxing Gloves'};
    const VOTE_PAIRS = [['ice', 'anvil'], ['lowgrav', 'gloves'], ['ice', 'gloves'], ['anvil', 'lowgrav']];
    const MODES = {koth: 'King of the Hill', rumble: 'Royal Rumble', bomb: 'Bomb Tag', lava: 'Floor Is Lava'};
    const IN = {LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, JUMP: 16, LIGHT: 32, HEAVY: 64, DASH: 128, USE: 256, GRAB: 512};
    const PROJECTILES = ['laser', 'grenade', 'thrown'];

    // ---------------------------------------------------------------- maps
    // plats: {x, y, w, h} tops you land on; oneWay: jump up through it;
    // crumble: gone after `crumbleAfter` s stood on, back after `respawnAfter`;
    // solid: a pillar (blocks from the side, bounces, breaks after `hp` hits).
    const MAPS = {
        lobby: {
            name: 'Locker Room', pit: false,
            plats: [{x: 0, y: 800, w: W, h: 100, floor: true},
                {x: 110, y: 560, w: 330, h: 16, oneWay: true}, {x: 1160, y: 560, w: 330, h: 16, oneWay: true},
                // the parkour tower, up to the ceiling: start on the first step, the pad at the top stops the clock
                {x: 1440, y: 450, w: 90, h: 12, oneWay: true, parkour: 'start'}, {x: 1260, y: 350, w: 80, h: 12, oneWay: true},
                {x: 1440, y: 250, w: 70, h: 12, oneWay: true}, {x: 1270, y: 150, w: 60, h: 12, oneWay: true},
                {x: 1420, y: 70, w: 110, h: 12, oneWay: true, parkour: 'finish'}],
            climbZone: 1220,                  // left of this, a climber has left the tower: their clock resets
            climbers: 4,                      // at most this many on the clock at once
            stations: {wardrobe: {x: 250, y: 800}, console: {x: 800, y: 800}, dojo: {x: 1040, y: 800},
                dummy: {x: 1320, y: 800}},
            ball: {x: 520, y: 700},
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
    MAPS.magma = {
        name: 'The Magma Foundry', pit: true, lava: {base: 830, amp: 70, period: 9},
        plats: [{x: 120, y: 620, w: 280, h: 24}, {x: 1200, y: 620, w: 280, h: 24},
            {x: 520, y: 520, w: 220, h: 18, move: {axis: 'x', from: 470, to: 880, period: 6}},
            {x: 860, y: 380, w: 220, h: 18, move: {axis: 'y', from: 300, to: 500, period: 5}},
            {x: 640, y: 240, w: 300, h: 16, oneWay: true}],
        spawns: [[260, 620], [1340, 620], [630, 520], [970, 380], [790, 240], [180, 620], [1420, 620], [330, 620],
            [1270, 620], [700, 240], [880, 240], [560, 520], [940, 380], [220, 620], [1380, 620]],
    };
    MAPS.skytrain = {
        name: 'Cyber Sky Train', pit: true, wind: 260, tunnel: {every: 15, warn: 2.5},
        plats: [{x: 60, y: 720, w: 1480, h: 40, floor: true, train: true},
            {x: 300, y: 560, w: 200, h: 14, oneWay: true}, {x: 1100, y: 560, w: 200, h: 14, oneWay: true}],
        spawns: [[400, 720], [1200, 720], [600, 720], [1000, 720], [800, 720], [300, 720], [1300, 720], [500, 720],
            [1100, 720], [700, 720], [900, 720], [400, 560], [1200, 560], [200, 720], [1400, 720]],
    };
    const ARENAS = ['rooftops', 'reactor', 'asteroid', 'colosseum', 'magma', 'skytrain'];

    function stage(map) {
        const m = MAPS[map] || MAPS.lobby;
        return m.plats.map(p => Object.assign({alive: true, load: 0, breaking: 0, respawn: 0, maxHp: p.hp || 0}, p));
    }

    function createWorld(map) {
        const m = MAPS[map] || MAPS.lobby;
        return {map, plats: stage(map), fighters: [], anvils: [], time: 0, timeScale: 1, clash: null, slowmoCd: 0,
            ball: m.ball ? {x: m.ball.x, y: m.ball.y, vx: 0, vy: 0} : null, lavaY: m.lava ? m.lava.base : null,
            tunnel: m.tunnel ? {next: m.tunnel.every, x: null, hit: []} : null, hotT: 30, hot: 0, airReset: false,
            hitstop: 0, hazard: null, hazardT: 0, anvilT: 0, events: [], noDamage: false,
            weapons: false, crates: [], shots: [], crateT: 8,
            gravity: m.gravity || 1, pit: !!m.pit,
            beam: m.beam ? {next: m.beam.every, phase: 'idle', x: -100, dir: 1, beeps: 0, hit: []} : null};
    }

    function makeFighter(id, name, color, x, y, gear) {
        return {id, name, color, gear: gear || {}, x, y, vx: 0, vy: 0, face: x < W / 2 ? 1 : -1, hp: C.HP,
            ground: false, jumps: 2, st: 'air', atk: null, combo: 0, comboT: 0, stun: 0, inv: 0,
            shield: C.SPAWN_SHIELD, dashT: 0, dashCd: 0, airDash: true, ledge: null, ledgeT: 0, ledgeCd: 0, juggle: 0,
            spin: 0, spinV: 0, drop: 0, wallCd: 0, koT: 0, lastHit: null, prev: 0,
            blocking: false, blockT: 0, guardHits: 0, guardT: 0, weapon: null, comboN: 0, comboDmg: 0, comboBy: null};
    }

    // the lobby's punching dummy: springs back to where it stands, never falls over for good
    function makeDummy(x, y) {
        const d = makeFighter(0, 'Dummy', '#64748b', x, y);
        Object.assign(d, {dummy: true, anchor: x, shield: 0, face: -1});
        return d;
    }

    // ---------------------------------------------------------------- moves
    // frame data at 60 fps: startup (from), active until (to), total (dur)
    const HANG = 106, GRIP = 16;         // hanging from a ledge: feet this far below the top, body this far out
    const MOVES = {
        jab: {dur: fr(12), from: fr(4), to: fr(8), reach: 48, r: 32, dmg: 4},
        hook: {dur: fr(15), from: fr(5), to: fr(9), reach: 50, r: 34, dmg: 5},
        straight: {dur: fr(21), from: fr(6), to: fr(11), reach: 58, r: 38, dmg: 9},
        uppercut: {dur: fr(24), from: fr(7), to: fr(14), reach: 46, r: 50, dmg: 12},
        grab: {dur: fr(24), from: fr(3), to: fr(7), reach: 0, r: 0, dmg: 10},
        airkick: {dur: fr(25), from: fr(3), to: fr(21), reach: 0, r: 40, dmg: 11},
        dive: {dur: fr(30), from: fr(2), to: fr(27), reach: 0, r: 40, dmg: 10},
        lunge: {dur: fr(20), from: fr(6), to: fr(11), reach: 70, r: 38, dmg: 8},      // forward + J
        sweep: {dur: fr(22), from: fr(6), to: fr(11), reach: 52, r: 34, dmg: 7},      // down + J, low
        pound: {dur: fr(60), from: fr(2), to: fr(58), reach: 0, r: 36, dmg: 9},       // down + K in the air
        ledgekick: {dur: fr(13), from: fr(3), to: fr(11), reach: 0, r: 46, dmg: 16},  // J while hanging
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
        if (f.st === 'ledge')               // hanging: the hands on the lip can be stamped on
            return {x0: f.x - 20, x1: f.x + 20, y0: f.y - HANG - 34, y1: f.y};
        return {x0: f.x - 20, x1: f.x + 20, y0: f.y - 94, y1: f.y};
    }

    function circleHits(cx, cy, r, box) {
        const nx = Math.max(box.x0, Math.min(cx, box.x1)), ny = Math.max(box.y0, Math.min(cy, box.y1));
        return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
    }

    function callout(w, f, text) {
        w.events.push({type: 'callout', x: Math.round(f.x), y: Math.round(f.y - 130), text});
    }

    function baseDamage(kind) {
        const m = MOVES[kind] || Weapons.KINDS[kind] || Weapons.SHOTS[kind];
        return m ? m.dmg : 8;
    }

    // a: the attacker (for a projectile, a stand-in at the projectile); t: who's hit
    function applyHit(w, a, t, kind) {
        const gloves = w.hazard === 'gloves' ? 1.35 : 1;
        const airborne = !t.ground;
        const ranged = PROJECTILES.includes(kind);
        const hanging = t.ledge;
        // guarding, facing the blow: a fresh guard parries, a held one takes a fifth
        if (t.blocking && t.face === (a.x > t.x ? 1 : -1)) {
            if (t.blockT < 0.15 && !ranged && a.atk !== undefined) {
                a.stun = 0.45; a.st = 'hurt'; a.atk = null; a.vx = -a.face * 220;
                w.hitstop = Math.max(w.hitstop, 0.06);
                callout(w, t, 'PARRY!');
                w.events.push({type: 'parry', x: Math.round(t.x), y: Math.round(t.y - 60), by: t.id});
                return;
            }
            const chip = Math.round(baseDamage(kind) * 0.2);
            if (!w.noDamage && !t.dummy)
                t.hp = Math.max(1, t.hp - chip);
            t.guardHits++;
            t.guardT = 1.2;
            if (t.guardHits >= 3) {                    // three in a row: the guard breaks
                t.blocking = false; t.guardHits = 0; t.st = 'hurt'; t.stun = 0.9; t.vx = a.face * 260;
                w.hitstop = Math.max(w.hitstop, 0.07);
                callout(w, t, 'GUARD BREAK!');
                w.events.push({type: 'guardbreak', x: Math.round(t.x), y: Math.round(t.y - 60)});
            } else {
                t.vx = a.face * 180;                   // pushed back, nothing more
                w.events.push({type: 'block', x: Math.round(t.x + (a.x > t.x ? 18 : -18)), y: Math.round(t.y - 60)});
            }
            return;
        }
        const m = MOVES[kind];
        const wk = Weapons.KINDS[kind] || Weapons.SHOTS[kind];
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
        case 'lunge':                                  // a piercing straight with a step behind it
            kx = a.face * 520; ky = -200; stun = 0.4;
            break;
        case 'sweep':                                  // swept off their feet: down for a moment
            kx = a.face * 120; ky = -300; stun = 0.6; tumble = true;
            break;
        case 'pound':
            kx = a.face * 160; ky = airborne ? 900 : -420; stun = 0.5;
            break;
        case 'ledgekick':                              // up over the lip, boot first
            kx = a.face * 600; ky = -420; stun = 0.5; tumble = true;
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
        default:                                       // a weapon, or a projectile
            kx = a.face * wk.kx; ky = wk.ky; stun = wk.stun; tumble = !!wk.tumble;
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
        let dmg = Math.round(baseDamage(kind) * (gloves > 1 ? 1.25 : 1));
        if (hanging) {                                 // hit while hanging: knocked off, and it hurts more
            dmg = Math.round(dmg * 1.3);
            kx = hanging.side * 260; ky = 380; tumble = true; stun = Math.max(stun, 0.5);   // outwards and down
            t.noGrab = hanging.p; t.ledgeCd = 0.6;
            callout(w, t, 'LEDGE PUNISH!');
        } else if (t.atk && t.atk.t < t.atk.move.to && !ranged) {   // a counter: caught mid-attack
            dmg = Math.round(dmg * 1.25);
            callout(w, t, 'COUNTER!');
        } else if (kind === 'uppercut' && !airborne) {
            callout(w, t, 'UPPERCUT!');
        } else if (kind === 'straight') {
            callout(w, t, 'CLEAN HIT!');               // the string's finisher, landed
        }
        // the combo: more hits while they're still reeling from the last
        const chained = t.comboBy === a.id && w.time - (t.comboAt || -9) < 0.5;
        t.comboAt = w.time;
        t.comboN = chained ? t.comboN + 1 : 1;
        t.comboDmg = (chained ? t.comboDmg : 0) + dmg;
        t.comboBy = a.id;
        if (t.comboN >= 2)
            w.events.push({type: 'combo', by: a.id, on: t.id, n: t.comboN, dmg: t.comboDmg, crit: t.comboN >= 4});
        t.vx = kx * gloves;
        t.vy = ky * gloves;
        if (t.vy < 0)
            t.ground = false;
        t.stun = stun;
        t.atk = null;
        t.ledge = null;
        t.dashT = 0;
        t.blocking = false;
        t.lastHit = a.id;
        t.st = tumble ? 'tumble' : 'hurt';
        if (tumble)
            t.spinV = (a.face > 0 ? 1 : -1) * 13;
        else
            t.spin = 0;
        const heavy = !['jab', 'hook', 'katana', 'laser'].includes(kind);
        w.hitstop = Math.max(w.hitstop, heavy ? 0.06 : 0.03);
        const hx = (a.x + t.x) / 2, hy = t.y - 60;
        const len = Math.hypot(kx, ky) || 1;
        const shown = w.noDamage && !t.dummy ? 0 : dmg;
        w.events.push({type: 'hit', x: Math.round(hx), y: Math.round(hy), kind, power: dmg, heavy, color: a.color,
            by: a.id, on: t.id, dx: Math.round(kx / len * 100) / 100, dy: Math.round(ky / len * 100) / 100});
        if (t.dummy) {                                 // the training dummy has opinions about your combos
            const crit = kind === 'straight' && Math.random() < 0.3;
            const quip = ['OOF!', 'NICE COMBO!', 'OKAY, OKAY!', 'I YIELD!'][Math.min(3, t.comboN - 3)];
            w.events.push({type: 'pop', x: Math.round(t.x), y: Math.round(t.y - 110),
                text: t.comboN >= 3 ? quip : heavy && !crit && kind !== 'straight' ? 'BOOM!' : crit ? 'CRIT!' : `${dmg} DMG`,
                big: heavy || crit || t.comboN >= 3});
            return;
        }
        if (shown <= 0)
            return;
        if (w.airReset && !a.ground && a.jumps !== undefined) {
            a.jumps = Math.max(a.jumps, 1); a.airDash = true;
        }
        const clash = w.clash && [w.clash.a, w.clash.b].includes(a.id) && [w.clash.a, w.clash.b].includes(t.id);
        if (clash) {                                   // the climax: the first blow in ends it
            w.clash = null;
            callout(w, a, 'FIRST STRIKE!');
            w.events.push({type: 'clashWin', x: Math.round(hx), y: Math.round(hy), by: a.id, on: t.id, color: a.color});
            knockOut(w, t, a, kind);
            w.hitstop = 0.1; w.koSlow = 0; w.timeScale = 1;   // a hard freeze, then straight back to full speed
            return;
        }
        t.hp = Math.max(0, t.hp - shown);
        if (t.hp <= 0) {
            if (a.hp > 0 && a.hp < C.HP * 0.25)
                callout(w, a, 'CLUTCH REVERSAL!');
            knockOut(w, t, a, kind);
        }
    }

    // a grab: they're swung round and thrown the other way (guarding doesn't help)
    function applyThrow(w, a, t) {
        t.x = a.x - a.face * 30;
        t.vx = -a.face * 950; t.vy = -540; t.ground = false; t.st = 'tumble'; t.spinV = -a.face * 12;
        t.stun = 0.7; t.atk = null; t.blocking = false; t.ledge = null; t.lastHit = a.id;
        w.hitstop = Math.max(w.hitstop, 0.06);
        callout(w, t, 'THROW!');
        w.events.push({type: 'hit', x: Math.round(t.x), y: Math.round(t.y - 60), kind: 'throw', power: 10, heavy: true,
            color: a.color, by: a.id, on: t.id, dx: -a.face, dy: -0.5});
        if (t.dummy || w.noDamage)
            return;
        t.hp = Math.max(0, t.hp - MOVES.grab.dmg);
        if (t.hp <= 0)
            knockOut(w, t, a);
    }

    function knockOut(w, t, a, kind) {
        t.hp = 0;
        t.st = 'ko';
        t.koT = 0;
        t.atk = null;
        const face = a ? a.face : (t.x < W / 2 ? 1 : -1);
        t.vx = face * 950;
        t.vy = -760;
        t.spinV = face * 16;
        w.hitstop = 0.12;                             // the knockout freeze
        w.clash = null;
        w.koSlow = 1.0;                               // then a second at quarter speed
        t.bounces = 0;
        t.mantle = null; t.ledge = null;
        w.events.push({type: 'ko', x: Math.round(t.x), y: Math.round(t.y - 50), id: t.id, by: a ? a.id : null,
            color: a ? a.color : '#f1f5f9', kind: kind || null});
    }

    // a bomb or a shockwave: everyone near is thrown away from (x, y)
    function explode(w, x, y, radius, power, skip) {
        for (const f of w.fighters) {
            if (f === skip || f.st === 'ko' || f.st === 'gone' || f.ghost)
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
        if (w.koSlow > 0) {                            // after a knockout: a second at 0.25x
            w.koSlow -= dtReal;
            w.timeScale += (0.25 - w.timeScale) * 0.5;
        } else if (w.clash) {                          // the climax: 0.15x until someone lands the first blow
            w.clash.t -= dtReal;
            w.timeScale = 0.15;
            if (w.clash.t <= 0) {                      // nobody connected: it fizzles out
                w.clash = null;
                w.events.push({type: 'clashEnd'});
            }
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
        separate(w, live);
        platforms(w, live, dt);
        movers(w, live, dt);
        ball(w, live, dt);
        lava(w, live, dt);
        train(w, live, dt);
        beam(w, live, dt);
        anvils(w, live, dt);
        crates(w, live, dt);
        shots(w, live, dt);
    }

    function control(w, f, inp, dt) {
        const k = inp.k | 0, pressed = k & ~f.prev;
        f.prev = k;
        for (const key of ['stun', 'inv', 'shield', 'dashCd', 'comboT', 'drop', 'wallCd', 'ledgeCd', 'guardT'])
            f[key] = Math.max(0, f[key] - dt);
        if (f.guardT <= 0)
            f.guardHits = 0;
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
            const awayKey = f.ledge.side < 0 ? IN.LEFT : IN.RIGHT;
            if ((pressed & IN.JUMP) && (k & awayKey)) {   // jump + away: leap off backwards
                f.ledge = null; f.vy = -C.JUMP; f.vx = -f.face * 420; f.face = -f.face; f.st = 'air'; f.jumps = 1;
                f.ledgeCd = 0.4;
                w.events.push({type: 'jump', id: f.id});
            } else if (pressed & (IN.JUMP | IN.UP | IN.LIGHT)) {   // climb (the 220 ms mantle), or J: a hop kick
                f.mantle = {t: 0, p: f.ledge.p, side: f.ledge.side};
                f.ledge = null; f.st = 'mantle'; f.inv = Math.max(f.inv, 0.25);
                w.events.push({type: 'mantle', id: f.id});
                if (pressed & IN.LIGHT) {
                    f.atk = {kind: 'ledgekick', move: MOVES.ledgekick, t: 0, hit: [], dir: {x: f.face, y: -0.4}};
                    f.atkAt = w.time;
                    w.events.push({type: 'swing', id: f.id, kind: 'ledgekick'});
                }
            } else if ((pressed & IN.DOWN) || f.ledgeT > 2.5) {
                f.noGrab = f.ledge.p;                       // not this ledge again until you land
                f.ledge = null; f.st = 'air'; f.vy = 180; f.ledgeCd = 0.25;   // let go: a small push down
            }
            return;
        }
        if (f.mantle)
            return;
        if ((pressed & IN.DASH) && f.st === 'tumble') {  // breakfall: tap dash just before you hit the floor
            f.techAt = w.time;
            return;
        }
        if (f.dashT > 0)
            f.dashT -= dt;
        const free = f.stun <= 0 && f.st !== 'tumble';
        const dir = ((k & IN.RIGHT) ? 1 : 0) - ((k & IN.LEFT) ? 1 : 0);
        if ((f.st === 'hurt' || f.st === 'land') && f.stun <= 0)
            f.st = f.ground ? 'idle' : 'air';
        if (!free) {
            f.blocking = false;
            return;
        }
        // guard: hold down on the ground (down + jump still drops through a ledge)
        const guard = f.ground && (k & IN.DOWN) && !(k & IN.JUMP) && !f.atk && f.dashT <= 0 &&
            !(pressed & (IN.LIGHT | IN.HEAVY | IN.GRAB | IN.DASH));
        if (guard) {
            f.blockT = f.blocking ? f.blockT + dt : 0;
            f.blocking = true;
        } else {
            f.blocking = false;
        }
        const aerial = f.atk && (f.atk.kind === 'airkick' || f.atk.kind === 'dive');
        // run
        if (f.blocking) {
            f.vx *= Math.pow(0.0001, dt);
        } else if (f.dashT <= 0 && !aerial) {
            const busy = f.atk ? 0.3 : 1;
            // the sky train's slipstream: in the air you drift backwards
            const wind = !f.ground && MAPS[w.map] && MAPS[w.map].wind ? MAPS[w.map].wind : 0;
            const target = dir * C.RUN * busy - wind;
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
        // E: pick up a crate's weapon, or throw the one you hold
        if (pressed & IN.USE)
            useItem(w, f, true);
        // G: a grab, on the ground
        if ((pressed & IN.GRAB) && !f.atk && f.dashT <= 0 && f.ground) {
            f.atk = {kind: 'grab', move: MOVES.grab, t: 0, hit: [], dir: {x: f.face, y: 0}};
            f.atkAt = w.time;
            w.events.push({type: 'swing', id: f.id, kind: 'grab'});
            return;
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
        if ((pressed & IN.LIGHT) && f.weapon) {           // a weapon in hand: J uses it
            weaponAttack(w, f);
            return;
        }
        let kind;
        const forward = f.face > 0 ? IN.RIGHT : IN.LEFT;
        if ((pressed & IN.HEAVY) && !f.ground)          // in the air: ↓+→ K dives at 45°, ↓ K pounds straight down
            kind = (k & IN.DOWN) ? ((k & (IN.LEFT | IN.RIGHT)) ? 'dive' : 'pound') : 'airkick';
        else if ((pressed & IN.HEAVY) || ((pressed & IN.LIGHT) && (k & IN.UP) && f.ground))
            kind = 'uppercut';
        else if ((pressed & IN.LIGHT) && (k & IN.DOWN) && f.ground)
            kind = 'sweep';
        else if ((pressed & IN.LIGHT) && (k & forward) && f.ground && f.comboT <= 0) {
            kind = 'lunge';                             // opens the string: J next is the hook
            f.combo = 1;
        } else {
            f.combo = f.comboT > 0 ? (f.combo % 3) + 1 : 1;
            kind = STRING[f.combo - 1];
        }
        const d = kind === 'uppercut' ? {x: f.face * 0.4, y: -0.9} : aimOf(f, k & ~IN.UP, inp.aim);
        if (Math.abs(d.x) > 0.2 && STRING.includes(kind))
            f.face = d.x > 0 ? 1 : -1;
        f.atk = {kind, move: MOVES[kind], t: 0, hit: [], dir: d};
        f.atkAt = w.time;
        if (kind === 'airkick') {
            f.vx = f.face * 720; f.vy = Math.min(f.vy, 0) * 0.3;
        } else if (kind === 'dive') {
            f.vx = f.face * 760; f.vy = 760;           // 45 degrees down
        } else if (kind === 'pound') {
            f.vx = 0; f.vy = 1400;                     // straight down, fast
        } else if (kind === 'lunge') {
            f.vx = f.face * 620;                       // the step in
        }
        w.events.push({type: 'swing', id: f.id, kind});
    }

    // a weapon swing, or a shot
    function weaponAttack(w, f) {
        const kind = f.weapon.kind, K = Weapons.KINDS[kind];
        if (K.melee) {
            f.atk = {kind, move: K, t: 0, hit: [], dir: {x: f.face, y: 0}};
        } else {
            f.atk = {kind, move: {dur: K.dur, from: 99, to: -1}, t: 0, hit: [], dir: {x: f.face, y: 0}};
            shoot(w, f, K.shot);
            f.vx -= f.face * (K.recoil || 0);
        }
        f.atkAt = w.time;
        w.events.push({type: 'swing', id: f.id, kind});
        if (--f.weapon.uses <= 0) {
            f.weapon = null;
            w.events.push({type: 'broke', id: f.id, kind});
        }
    }

    function shoot(w, f, kind) {
        const S = Weapons.SHOTS[kind];
        w.shots.push({kind, owner: f.id, x: f.x + f.face * 30, y: f.y - 58, vx: f.face * S.speed, vy: S.lift || 0,
            bounces: 0, life: S.life, color: f.color});
    }

    // E: pick up the nearest landed crate's weapon; with one in hand, throw it
    function useItem(w, f, pressedUse) {
        if (f.weapon && pressedUse) {
            shoot(w, f, f.weapon.kind === 'grenade' ? 'grenade' : 'thrown');
            w.events.push({type: 'swing', id: f.id, kind: 'throw'});
            f.weapon = null;
            return;
        }
        if (f.weapon)
            return;
        const crate = w.crates.find(c => c.landed ? Math.abs(c.x - f.x) < (pressedUse ? 70 : 34) && Math.abs(c.y - f.y) < 50 :
            pressedUse && !f.ground && Math.abs(c.x - f.x) < 60 && Math.abs(c.y - 20 - (f.y - 50)) < 70);
        if (crate)
            takeCrate(w, f, crate);
    }

    // a crate's weapon into f's hands; one snatched out of the air pops its parachute and bounces you up
    function takeCrate(w, f, crate) {
        w.crates = w.crates.filter(c => c !== crate);
        f.weapon = {kind: crate.kind, uses: Weapons.KINDS[crate.kind].uses};
        const air = !crate.landed;
        if (air) {
            f.vy = Math.min(f.vy, -360);
            f.jumps = Math.max(f.jumps, 1);
        }
        w.events.push({type: 'pickup', id: f.id, kind: crate.kind, x: Math.round(crate.x), y: Math.round(crate.y), air});
    }

    // where an attack's hitbox is this frame: {cx, cy, r}, or null outside its active frames
    function hitCircle(w, f) {
        const a = f.atk;
        if (!a || a.kind === 'grab' || a.t < a.move.from || a.t > a.move.to)
            return null;
        const m = a.move, big = w.hazard === 'gloves' ? 1.6 : 1;
        let cx, cy;
        if (a.kind === 'airkick') {
            cx = f.x + f.face * 34; cy = f.y - 40;
        } else if (a.kind === 'sweep') {             // along the floor
            cx = f.x + f.face * m.reach; cy = f.y - 12;
        } else if (a.kind === 'pound') {
            cx = f.x; cy = f.y - 6;
        } else if (a.kind === 'ledgekick') {         // the boot, coming up over the lip
            cx = f.x + f.face * 30; cy = f.y - 70;
        } else if (a.kind === 'uppercut') {          // low and forward: it catches a standing opponent
            cx = f.x + f.face * 34; cy = f.y - 52;
        } else if (Weapons.KINDS[a.kind]) {
            cx = f.x + f.face * m.reach; cy = f.y - 58;
        } else if (a.kind === 'dive') {
            cx = f.x + f.face * 26; cy = f.y - 8;
        } else {
            const len = Math.hypot(a.dir.x, a.dir.y) || 1;
            cx = f.x + a.dir.x / len * m.reach * (big > 1 ? 1.3 : 1);
            cy = f.y - 58 + a.dir.y / len * m.reach * (big > 1 ? 1.3 : 1);
        }
        return {cx, cy, r: m.r * big};
    }

    // the clash: when both blows land on the same frame, the one that went live first wins
    function firstStrike(f, o) {
        const ahead = (f.atk.t - f.atk.move.from) - (o.atk.t - o.atk.move.from);
        if (Math.abs(ahead) > 1e-9)
            return ahead > 0;
        return f.atkAt !== o.atkAt ? f.atkAt < o.atkAt : f.id < o.id;
    }

    function attacks(w, f, live, dt) {
        const a = f.atk;
        if (!a || f.st === 'ko')
            return;
        a.t += dt;
        const m = a.move;
        if (a.kind === 'grab' && a.t >= m.from && a.t <= m.to && !a.hit.length) {
            const t = live.find(o => o !== f && o.st !== 'ko' && o.ground && o.inv <= 0 && o.shield <= 0 && !o.ghost &&
                Math.abs(o.x - f.x) < 62 && Math.abs(o.y - f.y) < 40 && (o.x - f.x) * f.face > -10);
            if (t) {
                a.hit.push(t.id);
                applyThrow(w, f, t);
            }
        } else if (hitCircle(w, f)) {
            const {cx, cy, r} = hitCircle(w, f);
            if (!f.ground && !f.weapon && !f.dummy) {      // a falling crate, smashed in mid-air
                const crate = w.crates.find(c => !c.landed && circleHits(cx, cy, r, {x0: c.x - 22, x1: c.x + 22, y0: c.y - 44, y1: c.y}));
                if (crate)
                    takeCrate(w, f, crate);
            }
            const pair = w.clash && [w.clash.a, w.clash.b];
            for (const t of live) {
                if (t === f || a.hit.includes(t.id) || t.st === 'ko' || t.inv > 0 || t.shield > 0 || t.ghost)
                    continue;
                if (pair && pair.includes(f.id) && pair.includes(t.id)) {   // both connecting now? the first one in
                    const theirs = hitCircle(w, t);
                    if (theirs && circleHits(theirs.cx, theirs.cy, theirs.r, hurt(f)) && circleHits(cx, cy, r, hurt(t)) &&
                        !firstStrike(f, t))
                        continue;
                }
                if (circleHits(cx, cy, r, hurt(t))) {
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

    // the Tekken climax: both nearly out (or at match point), facing, swinging within 80 ms of each other
    function slowmoCheck(w, live) {
        if (w.noDamage || w.clash || w.slowmoCd > 0)
            return;
        const low = f => f.hp > 0 && (f.hp < C.HP * 0.25 || (w.matchPoint && f.hp < C.HP * 0.5));
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                const a = live[i], b = live[j];
                if (a.atk && b.atk && low(a) && low(b) && Math.abs(a.atkAt - b.atkAt) <= 0.08 + 1e-6 &&
                    (b.x - a.x) * a.face > 0 && (a.x - b.x) * b.face > 0 && Math.hypot(a.x - b.x, a.y - b.y) < 150) {
                    w.clash = {a: a.id, b: b.id, t: 1.6};
                    w.slowmoCd = 8;
                    w.timeScale = 0.15;
                    w.events.push({type: 'clash', x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2 - 50)});
                    return;
                }
            }
        }
    }

    // a wall splat: back off the wall at 65 %, and never down (a downward bounce could drive into the floor)
    function bounceOff(w, f, side, solid) {
        f.vx = side * Math.abs(f.vx) * 0.65;
        f.vy = Math.min(f.vy, -320);
        if (f.st !== 'ko' && !w.noDamage && !f.dummy)
            f.hp = Math.max(1, f.hp - 3);
        w.hitstop = Math.max(w.hitstop, 0.05);
        w.events.push({type: 'wallbounce', id: f.id, x: Math.round(f.x), y: Math.round(f.y - 50), pillar: !!solid});
        if (solid && solid.solid) {                  // a pillar takes the blow, and gives way after a few
            solid.hp--;
            if (solid.hp <= 0) {
                solid.alive = false; solid.respawn = 14;
                w.events.push({type: 'pillar', x: Math.round(solid.x + solid.w / 2), y: Math.round(solid.y + solid.h / 2)});
            }
        }
    }

    // the mantle over a ledge: chest to the lip, a leg up, weight forward, standing
    const MANTLE_T = 0.22;
    // the body's path over the lip at progress k: {fx: how far in from the edge (negative: still outside),
    // dy: how far the feet are below the top}. The rig uses it too, to keep the hands on the corner.
    function mantlePath(k) {
        const ease = u => u * u * (3 - 2 * u);
        if (k < 0.36)                         // 1: arms bend, the chest rises level with the edge
            return {fx: -GRIP, dy: HANG - (HANG - 38) * ease(k / 0.36)};
        if (k < 0.73) {                       // 2: hips swing forward, a knee hooks onto the top
            const u = ease((k - 0.36) / 0.37);
            return {fx: -GRIP + (GRIP + 22) * 0.55 * u, dy: 38 - 34 * u};
        }
        const u = ease((k - 0.73) / 0.27);    // 3: weight forward, up to standing
        return {fx: -GRIP + (GRIP + 22) * (0.55 + 0.45 * u), dy: 4 - 4 * u};
    }

    function mantle(w, f, dt) {
        const m = f.mantle, p = w.plats[m.p];
        if (!p || !p.alive) {
            f.mantle = null; f.st = 'air';
            return;
        }
        m.t += dt;
        const k = Math.min(1, m.t / MANTLE_T), path = mantlePath(k);
        f.x = (m.side < 0 ? p.x : p.x + p.w) - m.side * path.fx;
        f.y = p.y + path.dy;
        f.vx = f.vy = 0;
        f.mp = k;
        if (k >= 1) {
            f.mantle = null; f.y = p.y; f.ground = true; f.plat = p; f.st = 'idle'; f.jumps = 2; f.airDash = true;
            f.mp = 0;
        }
    }

    function move(w, f, dt) {
        if (f.mantle)
            return mantle(w, f, dt);
        if (f.ledge) {
            const p = w.plats[f.ledge.p];
            if (!p || !p.alive) {
                f.ledge = null;
                f.st = 'air';
            } else {
                f.x = f.ledge.side < 0 ? p.x - GRIP : p.x + p.w + GRIP;   // hands on the corner, arms straight up
                f.y = p.y + HANG;
                f.vx = f.vy = 0;
                f.st = 'ledge';
                return;
            }
        }
        if (f.rest) {                                  // a K.O. lying still: no gravity, nothing moves it
            if (f.restOn && f.restOn.alive)
                return;
            f.rest = false;                            // (unless the floor under it gives way)
        }
        const grav = C.GRAV * w.gravity * (w.hazard === 'lowgrav' ? 0.45 : 1);
        if (f.dashT > 0 && !f.ground)
            f.vy = 0;
        else if (f.atk && f.atk.kind === 'dive')
            f.vy = Math.max(f.vy, 760);                // the dive holds its 45-degree line
        else if (f.atk && f.atk.kind === 'pound')
            f.vy = Math.max(f.vy, 1400);
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
            if (!p.solid || !p.alive)
                continue;
            if (f.y > p.y + 4 && f.y - 94 < p.y + p.h && f.x + 20 > p.x && f.x - 20 < p.x + p.w) {
                const side = f.x < p.x + p.w / 2 ? -1 : 1;
                f.x = side < 0 ? p.x - 20 : p.x + p.w + 20;
                if (hard && f.st !== 'ko')
                    bounceOff(w, f, side, p);
                else
                    f.vx = 0;
            }
        }
        // platforms: land on top (one-way ones can be jumped through from below)
        f.ground = false;
        // (a wall bounce this step may have turned vy upwards: the landing goes by how the body arrived)
        if (f.st === 'ko' && (f.vy >= 0 || impact >= 0) && !f.rest) {
            const p = w.plats.filter(q => q.alive && crossed(q, oldY, f)).sort((a, b) => a.y - b.y)[0];
            if (p) {
                f.y = p.y;
                if (f.bounces++ < 1 && impact > 300) {
                    f.vy = -impact * 0.35; f.vx *= 0.5;
                    w.events.push({type: 'thud', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
                } else {                              // settled: lying flat
                    f.vy = 0; f.vx = 0; f.rest = true; f.restOn = p; f.spinV = 0;
                    f.spin = (Math.abs(f.spin % (2 * Math.PI)) < Math.PI ? 1 : -1) * Math.PI / 2 * Math.sign(f.face || 1);
                }
            }
        }
        if (f.rest) {
            f.vx = f.vy = 0;
            return;
        }
        if (f.st !== 'ko' && (f.vy >= 0 || impact >= 0)) {
            let top = null;                            // the highest top crossed (a fast fall can cross two)
            for (const p of w.plats) {
                if (p.alive && !(p.oneWay && f.drop > 0) && crossed(p, oldY, f) && (!top || p.y < top.y))
                    top = p;
            }
            if (top) {                                 // clamped to the top: never into it, never through it
                f.y = top.y; f.vy = 0; f.ground = true; f.plat = top;
                if (f.st !== 'tumble')
                    f.spin = 0;                        // (upright on the floor, whatever came before)
            }
        }
        if (f.ground && !wasGround && f.plat && f.plat.parkour) {
            const on = w.fighters.filter(o => o !== f && o.climbStart !== undefined).length;
            if (f.plat.parkour === 'start' && f.climbStart === undefined && on >= MAPS[w.map].climbers)
                w.events.push({type: 'climbFull', id: f.id});   // (four on the tower already)
            else if (f.plat.parkour === 'start')
                f.climbStart = w.time;
            else if (f.climbStart !== undefined) {
                w.events.push({type: 'climb', id: f.id, x: Math.round(f.x), y: Math.round(f.y),
                    t: Math.round((w.time - f.climbStart) * 100) / 100});
                f.climbStart = undefined;
            }
        }
        const zone = MAPS[w.map] && MAPS[w.map].climbZone;
        if (f.climbStart !== undefined && ((f.ground && !wasGround && f.plat && f.plat.floor) || (zone && f.x < zone))) {
            f.climbStart = undefined;                 // back on the floor, or off the tower: the clock resets
            w.events.push({type: 'climbReset', id: f.id});
        }
        if (f.ground && !wasGround) {
            f.jumps = 2; f.airDash = true; f.juggle = 0; f.noGrab = undefined;
            if (f.atk && f.atk.kind === 'dive')
                f.atk = null;
            if (f.atk && f.atk.kind === 'pound') {      // the pound lands: a shockwave along the floor
                f.atk = null;
                for (const o of w.fighters) {
                    if (o === f || !o.ground || o.st === 'ko' || o.inv > 0 || o.shield > 0 || o.ghost ||
                        Math.abs(o.x - f.x) > 150 || Math.abs(o.y - f.y) > 30)
                        continue;
                    o.vy = -460; o.vx = Math.sign(o.x - f.x || 1) * 260; o.ground = false; o.stun = 0.4; o.st = 'hurt';
                    o.atk = null; o.blocking = false;
                    if (!w.noDamage && !o.dummy) {
                        o.hp = Math.max(1, o.hp - 5);
                    }
                }
                w.events.push({type: 'pound', x: Math.round(f.x), y: Math.round(f.y)});
            }
            if (f.st === 'tumble' && w.time - (f.techAt ?? -9) < 0.25) {   // a breakfall: roll and up
                f.st = 'dash'; f.spin = 0; f.stun = 0; f.inv = Math.max(f.inv, fr(8)); f.dashT = fr(8);
                f.techAt = -9;
                w.events.push({type: 'tech', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
                callout(w, f, 'TECH!');
            } else if (f.st === 'tumble') {               // a ragdoll lands: flat on the floor, a 120 ms crouch, up
                f.st = 'land'; f.spin = 0; f.spinV = 0; f.vx *= 0.3; f.stun = 0.12; f.inv = Math.max(f.inv, 0.3);
                w.events.push({type: impact > 700 ? 'thud' : 'land', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
            } else if (impact > 500) {
                w.events.push({type: 'land', id: f.id, x: Math.round(f.x), y: Math.round(f.y)});
            }
        }
        // ledge grab: falling just past a platform's edge
        if (!f.ground && f.vy > 0 && f.st !== 'tumble' && f.st !== 'ko' && f.stun <= 0 && f.ledgeCd <= 0 && !f.atk &&
            !f.dummy) {
            w.plats.forEach((p, i) => {
                if (f.ledge || !p.alive || p.floor || p.solid || i === f.noGrab)
                    return;
                for (const side of [-1, 1]) {
                    const edge = side < 0 ? p.x : p.x + p.w;
                    const out = (f.x - edge) * side;
                    if (out > 0 && out < 36 && f.y > p.y + 60 && f.y < p.y + HANG + 24) {
                        f.ledge = {p: i, side}; f.ledgeT = 0; f.inv = Math.max(f.inv, C.LEDGE_INV);
                        f.face = -side; f.jumps = 2; f.airDash = true;
                        w.events.push({type: 'ledge', id: f.id});
                        return;
                    }
                }
            });
        }
        if (f.st !== 'ko' && f.st !== 'tumble' && f.st !== 'hurt' && f.st !== 'land' && !f.ledge)
            f.st = !f.ground ? 'air' : f.dashT > 0 ? 'dash' : f.blocking ? 'block' : Math.abs(f.vx) > 40 ? 'run' : 'idle';
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

    // bodies don't stack: two fighters closer than 30 px at the same height are eased apart sideways
    // (never up or down, so nobody is ever pushed into a floor)
    const BODY = 30;
    function separate(w, live) {
        const solid = live.filter(f => f.st !== 'ko' && !f.ghost && !f.dummy && !f.ledge && !f.mantle);
        for (let i = 0; i < solid.length; i++) {
            for (let j = i + 1; j < solid.length; j++) {
                const a = solid[i], b = solid[j], dx = b.x - a.x;
                if (Math.abs(dx) >= BODY || Math.abs(a.y - b.y) >= 60)
                    continue;
                const dir = Math.sign(dx) || (a.id < b.id ? 1 : -1), push = (BODY - Math.abs(dx)) / 4;
                for (const [f, d] of [[a, -dir], [b, dir]]) {
                    const x = Math.max(22, Math.min(W - 22, f.x + d * push));
                    if (!w.plats.some(p => p.solid && p.alive && x + 20 > p.x && x - 20 < p.x + p.w &&
                        f.y > p.y + 4 && f.y - 94 < p.y + p.h))
                        f.x = x;                       // (never into a pillar)
                }
            }
        }
    }

    // did f's feet pass the platform's top this step? Moving plates count from where they were as well,
    // so one rising into a falling body catches it instead of passing through
    function crossed(p, oldY, f) {
        const top0 = Math.max(p.y, p.py ?? p.y), x0 = Math.min(p.x, p.px ?? p.x), x1 = Math.max(p.x, p.px ?? p.x) + p.w;
        return oldY <= top0 + 2 && f.y >= p.y && f.x >= x0 - 6 && f.x <= x1 + 6;
    }

    function platforms(w, live, dt) {
        for (const p of w.plats) {
            if (!p.crumble && !p.solid)
                continue;
            if (!p.alive) {
                p.respawn -= dt;
                const blocked = p.solid && live.some(f => f.x + 20 > p.x && f.x - 20 < p.x + p.w && f.y > p.y + 4 &&
                    f.y - 94 < p.y + p.h);           // (a pillar never grows back around someone)
                if (p.respawn <= 0 && !blocked) {
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

    // moving platforms (the foundry's hover plates): whoever stands on one rides along
    function movers(w, live, dt) {
        for (const p of w.plats) {
            if (!p.move)
                continue;
            const m = p.move, k = (Math.sin(w.time * 2 * Math.PI / m.period) + 1) / 2;
            const v = m.from + (m.to - m.from) * k, d = v - p[m.axis];
            p.px = p.x; p.py = p.y;
            p[m.axis] = v;
            for (const f of live) {
                if (f.ground && f.plat === p)
                    f[m.axis === 'x' ? 'x' : 'y'] += d;
            }
        }
    }

    // the lobby's ball: bounces, rolls, flies off punches and kicks, pushed by bodies
    function ball(w, live, dt) {
        const b = w.ball;
        if (!b)
            return;
        b.vy += C.GRAV * 0.7 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const R = 18;
        if (b.x < R || b.x > W - R) {
            b.x = b.x < R ? R : W - R; b.vx = -b.vx * 0.88;
        }
        if (b.y < R) {
            b.y = R; b.vy = Math.abs(b.vy) * 0.6;
        }
        for (const p of w.plats) {
            if (p.alive && b.vy > 0 && b.x > p.x && b.x < p.x + p.w && b.y + R >= p.y && b.y + R - b.vy * dt <= p.y + 4) {
                b.y = p.y - R; b.vy = -b.vy * 0.8; b.vx *= 0.97;    // a lively bounce
                if (Math.abs(b.vy) < 60)
                    b.vy = 0;
            }
        }
        if (Math.abs(b.vy) < 1)
            b.vx *= Math.pow(0.4, dt);                // rolling to a stop
        for (const f of live) {
            if (f.ghost || f.dummy || f.st === 'ko')
                continue;
            const box = hurt(f);
            const strike = f.atk && f.atk.t >= f.atk.move.from && f.atk.t <= f.atk.move.to &&
                Math.hypot(b.x - (f.x + f.face * 50), b.y - (f.y - 50)) < 40 + R;
            if (strike || circleHits(b.x, b.y, R, box)) {
                const dir = b.x < f.x ? -1 : 1;
                if (strike) {                          // a punch drives it low and hard; a kick or launcher lofts it
                    const d = f.atk.dir || {x: f.face, y: -0.3}, light = STRING.includes(f.atk.kind);
                    b.vx = (d.x || f.face) * (light ? 1150 : 1350);
                    b.vy = Math.min(light ? -360 : -680, (d.y || 0) * 900 - (light ? 320 : 600));
                    b.by = f.id;
                    w.events.push({type: 'kick', x: Math.round(b.x), y: Math.round(b.y)});
                } else {                               // a dash, or just walking into it
                    b.vx = dir * Math.max(Math.abs(f.vx) * (f.dashT > 0 ? 1.4 : 1.1), 180);
                    b.by = f.id;
                    if (b.vy >= 0)
                        b.vy = -Math.max(120, Math.abs(f.vx) * 0.3);
                }
                if (circleHits(b.x, b.y, R, box))       // (out of the body it's touching)
                    b.x = dir < 0 ? box.x0 - R - 1 : box.x1 + R + 1;
            }
        }
    }

    // lava: the foundry's rises and falls; in Floor Is Lava the platforms
    // themselves turn hot every 30 s. Touch it and you're launched upwards.
    function burn(w, f, why) {
        f.vy = -1250; f.ground = false; f.st = 'tumble'; f.spinV = 10 * (Math.random() < 0.5 ? -1 : 1); f.stun = 0.45;
        f.atk = null; f.inv = Math.max(f.inv, 0.5);
        w.events.push({type: 'lava', x: Math.round(f.x), y: Math.round(f.y), why});
        if (!w.noDamage) {
            f.hp = Math.max(0, f.hp - 12);
            if (f.hp <= 0)
                knockOut(w, f, null);
        }
    }

    function lava(w, live, dt) {
        const m = MAPS[w.map];
        if (m && m.lava) {
            w.lavaY = m.lava.base - m.lava.amp * (Math.sin(w.time * 2 * Math.PI / m.lava.period) + 1) / 2;
            for (const f of live) {
                if (f.st !== 'ko' && f.inv <= 0 && f.y > w.lavaY)
                    burn(w, f, 'pool');
            }
        }
        if (w.floorLava) {                             // Floor Is Lava: 3 s warning, 8 s hot
            w.hotT -= dt;
            if (w.hot > 0) {
                w.hot -= dt;
                for (const f of live) {
                    if (f.ground && f.st !== 'ko' && f.inv <= 0)
                        burn(w, f, 'floor');
                }
                if (w.hot <= 0) {
                    w.hotT = 30;
                    w.events.push({type: 'cool'});
                }
            } else if (w.hotT <= 0) {
                w.hot = 8;
                w.events.push({type: 'hot'});
            } else if (w.hotT <= 3 && !w.warned) {
                w.warned = true;
                w.events.push({type: 'hotWarn'});
            }
            if (w.hot > 0)
                w.warned = false;
        }
    }

    // the sky train: a tunnel's mouth sweeps along the roof at head height; duck (guard) under it
    function train(w, live, dt) {
        const t = w.tunnel, cfg = MAPS[w.map] && MAPS[w.map].tunnel;
        if (!t || !cfg)
            return;
        if (t.x === null) {
            t.next -= dt;
            if (t.next <= cfg.warn && !t.warned) {
                t.warned = true;
                w.events.push({type: 'tunnelWarn'});
            }
            if (t.next <= 0) {
                t.x = W + 60; t.hit = []; t.warned = false;
            }
            return;
        }
        t.x -= 1500 * dt;
        const roof = w.plats[0].y;
        for (const f of live) {
            if (f.st === 'ko' || t.hit.includes(f.id) || f.inv > 0 || f.shield > 0 || f.ghost || Math.abs(f.x - t.x) > 30)
                continue;
            const ducked = f.st === 'block' || f.st === 'ledge';
            if (!ducked && f.y > roof - 140 && f.y <= roof + 2) {
                t.hit.push(f.id);
                f.vx = -900; f.vy = -420; f.ground = false; f.st = 'tumble'; f.spinV = -12; f.stun = 0.5; f.atk = null;
                w.events.push({type: 'hit', x: Math.round(f.x), y: Math.round(f.y - 60), kind: 'tunnel', power: 15,
                    heavy: true, color: '#facc15', by: null, on: f.id, dx: -1, dy: -0.4});
                if (!w.noDamage) {
                    f.hp = Math.max(0, f.hp - 15);
                    if (f.hp <= 0)
                        knockOut(w, f, null);
                }
            }
        }
        if (t.x < -60) {
            t.x = null; t.next = cfg.every;
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

    // supply crates: one parachutes onto a platform every 14-20 s (when weapons are on)
    function crates(w, live, dt) {
        if (w.weapons) {
            w.crateT -= dt;
            if (w.crateT <= 0 && w.crates.length < 3) {
                w.crateT = (14 + Math.random() * 6) / (w.crateRate || 1);   // (the sandbox can turn it up)
                const tops = w.plats.filter(p => p.alive && p.w > 120);
                const p = tops[Math.floor(Math.random() * tops.length)];
                if (p) {
                    const kind = Weapons.NAMES[Math.floor(Math.random() * Weapons.NAMES.length)];
                    const x = p.x + 40 + Math.random() * (p.w - 80);
                    w.crates.push({x, y: -60, kind, landed: false, life: 22});
                    w.events.push({type: 'crate', x: Math.round(x)});
                }
            }
        }
        for (const c of w.crates) {
            const below = w.plats.find(p => p.alive && c.x >= p.x && c.x <= p.x + p.w && p.y >= c.y - 2);
            if (!c.landed || !below || below.y > c.y + 2) {
                c.landed = false;
                const ny = c.y + 150 * dt;              // slow, under its parachute
                if (below && ny >= below.y) {
                    c.y = below.y; c.landed = true;
                    w.events.push({type: 'land', x: Math.round(c.x), y: Math.round(c.y)});
                } else {
                    c.y = ny;
                }
            }
            c.life -= dt;
        }
        w.crates = w.crates.filter(c => c.life > 0 && c.y < H + 100);
        for (const f of live) {                       // walking over a crate picks it up
            if (!f.weapon && !f.dummy && f.st !== 'ko')
                useItem(w, f, false);
        }
    }

    function shots(w, live, dt) {
        for (const s of w.shots) {
            const S = Weapons.SHOTS[s.kind];
            s.vy += (S.gravity || 0) * dt;
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.life -= dt;
            const owner = w.fighters.find(f => f.id === s.owner);
            // whoever it touches (not its thrower)
            const hit = live.find(f => f.id !== s.owner && f.st !== 'ko' && f.inv <= 0 && f.shield <= 0 && !f.ghost &&
                circleHits(s.x, s.y, s.kind === 'grenade' ? 12 : 16, hurt(f)));
            if (s.kind === 'grenade') {
                if (s.x < 20 || s.x > W - 20)
                    s.vx = -s.vx * 0.6;
                const p = s.vy > 0 && w.plats.find(q => q.alive && s.x >= q.x && s.x <= q.x + q.w &&
                    s.y >= q.y && s.y - s.vy * dt <= q.y + 2);
                if (p) {
                    s.y = p.y; s.vy = -Math.abs(s.vy) * 0.55; s.vx *= 0.8; s.bounces++;
                    w.events.push({type: 'bounce', x: Math.round(s.x), y: Math.round(s.y)});
                }
                if (hit || s.bounces > S.bounces || s.life <= 0) {
                    s.dead = true;
                    grenadeBoom(w, s, owner);
                }
                continue;
            }
            if (hit) {
                s.dead = true;
                const a = {id: s.owner, x: s.x - Math.sign(s.vx) * 40, y: s.y, face: Math.sign(s.vx) || 1,
                    color: s.color, hp: owner ? owner.hp : 0, stun: 0, vx: 0};
                applyHit(w, a, hit, s.kind);
            }
            if (s.x < 0 || s.x > W || s.y > H + 100 || s.life <= 0 ||
                w.plats.some(p => p.alive && p.solid && s.x > p.x && s.x < p.x + p.w && s.y > p.y && s.y < p.y + p.h))
                s.dead = true;
        }
        w.shots = w.shots.filter(s => !s.dead);
    }

    function grenadeBoom(w, s, owner) {
        const S = Weapons.SHOTS.grenade;
        for (const f of w.fighters) {
            if (f.st === 'ko' || f.st === 'gone' || f.inv > 0 || f.shield > 0 || f.dummy)
                continue;
            if (Math.hypot(f.x - s.x, f.y - 50 - s.y) < S.radius && !w.noDamage) {
                f.hp = Math.max(0, f.hp - S.dmg);
                f.lastHit = s.owner;
                if (f.hp <= 0)
                    knockOut(w, f, owner || null);
            }
        }
        explode(w, s.x, s.y, S.radius, S.power, null);
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
        const hip = {x: 0, y: f.st === 'land' ? -38 : -46};     // (a landing crouch drops the hips)
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
        case 'ledge':                              // hanging straight down from the hands (they're solved below)
            body = 0; lThigh = -0.1; rThigh = 0.15; lShin = 0.1; rShin = 0.25;
            break;
        case 'land':                               // the landing crouch: knees bent, arms out for balance
            body = 0.2; lThigh = 0.75; lShin = -1.3; rThigh = -0.45; rShin = 1.0;
            lArm = -0.6; rArm = 0.8; lFore = -0.5; rFore = -0.5;
            break;
        case 'mantle': {                           // 1: elbows bend; 2: a knee hooks up; 3: standing
            const k = p;
            if (k < 0.36) {
                const u = k / 0.36;
                lArm = 2.9 - 0.9 * u; rArm = 2.7 - 0.9 * u; lFore = -1.6 * u; rFore = -1.6 * u; body = -0.1 + 0.2 * u;
                lThigh = 0; rThigh = 0.2; lShin = 0.1; rShin = 0.3;
            } else if (k < 0.73) {
                const u = (k - 0.36) / 0.37;
                lArm = 2.0 - 1.2 * u; rArm = 1.8 - 1.2 * u; lFore = -1.6; rFore = -1.6; body = 0.1 + 0.4 * u;
                lThigh = 1.6 * u; lShin = -1.8 * u; rThigh = 0.2; rShin = 0.3;
            } else {
                const u = (k - 0.73) / 0.27;
                lArm = 0.8 - 0.6 * u; rArm = 0.6; lFore = -1.0; rFore = -1.0; body = 0.5 * (1 - u);
                lThigh = 1.6 * (1 - u); lShin = -1.8 * (1 - u); rThigh = 0.2 * (1 - u); rShin = 0.3 * (1 - u);
            }
            break;
        }
        case 'hurt':
            body = -0.45; lArm = -2.2; rArm = 2.2; lFore = -0.8; rFore = 0.8; lThigh = 0.3; rThigh = -0.3;
            break;
        case 'victory': {                          // both fists up, pumping
            const pump = Math.sin(t * 6);
            lArm = 2.7 + 0.25 * pump; rArm = 2.9 - 0.25 * pump; lFore = -0.3; rFore = 0.2;
            body = -0.05; lThigh = -0.2; rThigh = 0.2;
            break;
        }
        case 'block':                              // crouched, both forearms up in front of the face
            body = -0.05; rArm = 2.3; rFore = -1.5; lArm = 2.0; lFore = -1.3;
            lThigh = 0.6; lShin = -0.9; rThigh = -0.2; rShin = 0.7;
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
        case 'ledgekick':                          // up over the lip, the lead leg snapping out
            body = -0.35; lThigh = 1.9; lShin = 0; rThigh = -0.2; rShin = -0.9;
            break;
        case 'lunge':                              // a long step behind a locked-out straight
            rArm = 1.57; rFore = 0; lArm = -0.4; lFore = -1.4; body += 0.35 * out; lThigh = -0.7 * out; rThigh = 0.9 * out;
            rShin = -0.3 * out;
            break;
        case 'sweep':                              // down low, the lead leg swings out along the floor
            body = 0.6; lArm = -0.6; rArm = 0.6; lFore = -1.2; rFore = -1.2;
            lThigh = 0.9; lShin = -1.6; rThigh = 1.57 * (0.4 + 0.6 * out); rShin = 0;
            break;
        case 'pound':                              // knees up, fists down: straight onto them
            body = 0.1; lArm = 0.3; rArm = -0.3; lFore = 0; rFore = 0; lThigh = 1.2; lShin = -1.6; rThigh = 1.0; rShin = -1.4;
            break;
        case 'grab':                               // both hands out to grab
            rArm = 1.5; lArm = 1.3; rFore = -0.1 * (1 - out); lFore = -0.2; body += 0.2 * out;
            break;
        case 'katana': case 'bat':                 // overhead, then down and through
            rArm = 2.8 - 2.4 * Math.min(1, p * 1.4); rFore = -0.2; lArm = 0.6; lFore = -1.4; body += 0.2 * out;
            break;
        case 'blaster':
            rArm = 1.57; rFore = 0; lArm = 1.3; lFore = -0.4;
            break;
        case 'throw': case 'grenade':
            rArm = 2.8 - 1.6 * p; rFore = -0.3; lArm = 1.0; lFore = -1.0;
            break;
        }
        if (f.st === 'tumble' || f.st === 'ko') {
            lArm = -2.4 + Math.sin(t * 9) * 0.4; rArm = 2.0; lThigh = 0.9; rThigh = -0.7; lShin = -0.9; rShin = 0.8;
            lFore = 0.6; rFore = -0.6;
        }
        // on a ledge, and through the first two phases of the mantle, the hands hold the corner:
        // each arm is solved (two 18 px bones) to reach it from wherever the shoulder is
        let grip = null;
        if (f.st === 'ledge') {
            grip = {x: GRIP, y: -HANG};
        } else if (f.st === 'mantle' && p < 0.73) {
            const m = mantlePath(p);
            grip = {x: -m.fx, y: -m.dy};
        }
        if (grip) {
            const sh = {x: hip.x + Math.sin(Math.PI - body) * 30, y: hip.y + Math.cos(Math.PI - body) * 30};
            const reach = tx => {
                const vx = tx - sh.x, vy = grip.y - sh.y, d = Math.min(35.5, Math.hypot(vx, vy));
                const base = Math.atan2(vx, vy), bend = Math.acos(d / 36);
                return [base + bend - body, -2 * bend];   // elbows out, away from the wall
            };
            [lArm, lFore] = reach(grip.x - 2);
            [rArm, rFore] = reach(grip.x + 2);
        }
        ctx.save();
        ctx.translate(f.x, f.y + bob);
        if (f.st === 'tumble' || f.st === 'ko') {
            const lying = f.st === 'ko' && !f.vx && !f.vy;   // at rest: flat on the floor, not at hip height
            ctx.translate(0, lying ? -12 : -46);
            ctx.rotate(f.spin || 0);
            ctx.translate(0, 46);
        }
        ctx.scale(s, 1);
        if (f.st === 'ledge') {                       // a slow pendulum, swinging from the hands
            ctx.translate(GRIP, -HANG);
            ctx.rotate(Math.sin(t * 2.2) * 0.06);
            ctx.translate(-GRIP, HANG);
        }
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
        if (f.weapon && Weapons)                       // the weapon, along the forearm
            Weapons.draw(ctx, f.weapon, fist, Math.PI / 2 - (rArm + body + rFore));
        if (opts.eyes) {                               // Shadow Mehul's red eyes
            ctx.fillStyle = '#f43f5e';
            ctx.shadowColor = '#f43f5e';
            ctx.shadowBlur = 10;
            ctx.fillRect(head.x + 2, head.y - 3, 4, 2.5);
            ctx.fillRect(head.x + 7, head.y - 3, 3, 2.5);
            ctx.shadowBlur = 0;
        }
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
        case 'chef':                                  // a tall white toque
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(-10, -16, 20, 6);
            ctx.beginPath(); ctx.arc(-6, -22, 7, 0, Math.PI * 2); ctx.arc(6, -22, 7, 0, Math.PI * 2);
            ctx.arc(0, -27, 8, 0, Math.PI * 2); ctx.fill();
            break;
        case 'cat':
            ctx.fillStyle = color;
            for (const sx of [-1, 1]) {
                ctx.beginPath(); ctx.moveTo(sx * 4, -10); ctx.lineTo(sx * 10, -22); ctx.lineTo(sx * 12, -7); ctx.closePath();
                ctx.fill();
            }
            break;
        case 'beanie':
            ctx.fillStyle = '#1e293b';
            ctx.beginPath(); ctx.arc(0, -3, 12.5, Math.PI, 0); ctx.fill();
            ctx.fillStyle = color;
            ctx.fillRect(-12.5, -5, 25, 3);
            ctx.beginPath(); ctx.arc(0, -16, 3, 0, Math.PI * 2); ctx.fill();
            break;
        case 'viking':
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath(); ctx.arc(0, -3, 12.5, Math.PI, 0); ctx.fill();
            ctx.fillStyle = '#f1f5f9';
            for (const sx of [-1, 1]) {
                ctx.beginPath(); ctx.moveTo(sx * 10, -8); ctx.quadraticCurveTo(sx * 22, -12, sx * 20, -28);
                ctx.quadraticCurveTo(sx * 16, -14, sx * 6, -12); ctx.closePath(); ctx.fill();
            }
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
        makeFighter, makeDummy, explode, knockOut, step, drawRig, mantlePath, HANG, GRIP};
});
