// Stick Havoc: the computer's fighters. One brain, five styles: the
// arcade ladder's opponents (and the training bot). The server runs them;
// think() returns the keys they'd be pressing this tick.
(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./physics.js') : root.Physics);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Bot = api;
})(typeof self !== 'undefined' ? self : this, function (P) {
    'use strict';
    const IN = P.IN;
    // react: seconds between decisions; the rest: how likely each habit is
    const STYLES = {
        rookie: {name: 'Rookie Stick', color: '#94a3b8', hat: null, react: 0.42, attack: 0.45, heavy: 0.05},
        acrobat: {name: 'Acrobat', color: '#a3e635', hat: 'bandana', react: 0.28, attack: 0.6, heavy: 0.2,
            jumpy: 0.3, dive: 0.65, block: 0.05},
        brawler: {name: 'Brawler', color: '#fb923c', hat: 'visor', react: 0.18, attack: 0.9, heavy: 0.3,
            dashCancel: 0.5, block: 0.1, grab: 0.12},
        ninja: {name: 'Ninja', color: '#a78bfa', hat: 'eyepatch', react: 0.13, attack: 0.7, heavy: 0.25,
            block: 0.5, grab: 0.2, wallKick: true, weapons: true, dive: 0.3, jumpy: 0.08},
        boss: {name: 'Shadow Mehul', color: '#334155', hat: 'kasa', eyes: true, react: 0.08, attack: 0.92, heavy: 0.35,
            juggle: true, block: 0.4, grab: 0.25, dive: 0.45, dashCancel: 0.6, weapons: true, jumpy: 0.05},
        training: {name: 'Training Bot', color: '#94a3b8', hat: 'visor', react: 0.2, attack: 0.65, heavy: 0.2,
            block: 0.1, grab: 0.08},
        // the practice bot: real defence (guards strings, rolls out, techs grabs) and J J K into a dive
        sparMedium: {name: 'Practice Bot', color: '#cbd5e1', hat: 'beanie', react: 0.18, attack: 0.8, heavy: 0.2,
            sparring: true, dive: 0.6, dashCancel: 0.3, grab: 0.1, jumpy: 0.04},
        sparHard: {name: 'Practice Bot', color: '#f8fafc', hat: 'viking', react: 0.06, attack: 0.9, heavy: 0.25,
            sparring: true, parry: true, techs: true, dive: 0.8, dashCancel: 0.5, grab: 0.15, jumpy: 0.04},
        // the sandbox's Demon: the practice bot's defence at 30 ms, juggles, and never lets up
        demon: {name: 'Demon', color: '#dc2626', hat: 'viking', eyes: true, react: 0.03, attack: 0.96, heavy: 0.3,
            sparring: true, parry: true, techs: true, juggle: true, dive: 0.85, dashCancel: 0.7, grab: 0.2,
            weapons: true, jumpy: 0.03},
    };
    const LADDER = ['rookie', 'acrobat', 'brawler', 'ninja', 'boss'];
    const TAPS = IN.LIGHT | IN.HEAVY | IN.JUMP | IN.DASH | IN.GRAB | IN.USE;

    function think(f, w, style, mem, dt) {
        const S = STYLES[style] || STYLES.training;
        mem.t = (mem.t || 0) - dt;
        if (mem.t > 0)                              // between decisions: hold, but let go of taps
            return (mem.k = (mem.k || 0) & ~TAPS);
        mem.t = S.react * (0.6 + Math.random() * 0.8);
        const r = () => Math.random();
        const foes = w.fighters.filter(o => o.id !== f.id && o.st !== 'ko' && o.st !== 'gone' && !o.dummy);
        let k = 0;
        // a weapon on the floor nearby: go and get it
        const crate = S.weapons && !f.weapon && w.crates.find(c => c.landed && Math.abs(c.x - f.x) < 420 &&
            Math.abs(c.y - f.y) < 140);
        const foe = foes.length ? foes.reduce((a, o) => Math.abs(o.x - f.x) < Math.abs(a.x - f.x) ? o : a) : null;
        const goal = crate ? {x: crate.x, y: crate.y} : foe;
        if (!goal)
            return (mem.k = 0);
        const dx = goal.x - f.x, dy = goal.y - f.y, dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > (crate ? 10 : 70))
            k |= dx > 0 ? IN.RIGHT : IN.LEFT;
        if (dy < -100 && r() < 0.5)
            k |= IN.JUMP;
        if (dy > 100 && r() < 0.3)
            k |= IN.DOWN | IN.JUMP;
        if (S.jumpy && f.ground && r() < S.jumpy)
            k |= IN.JUMP;
        if (S.sparring && foe) {
            const k2 = spar(f, w, S, mem, foe);
            if (k2 !== null)
                return (mem.k = stayOnStage(f, w, k2));
        }
        if (foe && !crate) {
            const fdx = foe.x - f.x, fdy = foe.y - f.y, near = Math.abs(fdx) < 85 && Math.abs(fdy) < 70;
            // their swing is coming: guard (a sharp one parries)
            if (S.block && f.ground && foe.atk && Math.hypot(fdx, fdy) < 120 && r() < S.block)
                return (mem.k = IN.DOWN, mem.t = 0.25, IN.DOWN);
            if (f.weapon) {
                const kind = f.weapon.kind, range = kind === 'blaster' ? 700 : kind === 'grenade' ? 520 : 95;
                if (Math.abs(fdx) < range && Math.abs(fdy) < 90 && (kind !== 'grenade' || Math.abs(fdx) > 180))
                    k |= IN.LIGHT;
            } else if (near && r() < S.attack) {
                if (S.grab && f.ground && foe.ground && r() < S.grab)
                    k |= IN.GRAB;
                else if (S.juggle && !foe.ground && foe.y < f.y - 20)
                    k |= IN.LIGHT;                  // keep them up there
                else if (r() < S.heavy)
                    k |= IN.HEAVY;
                else
                    k |= IN.LIGHT;
                if (S.dashCancel && f.atk && r() < S.dashCancel)
                    k = (k & ~TAPS) | IN.DASH;      // cancel the punch's recovery
            }
            // in the air above them: dive
            if (S.dive && !f.ground && fdy > 40 && Math.abs(fdx) < 220 && r() < S.dive)
                k |= IN.DOWN | IN.HEAVY;
            // against a wall in the air: kick off it
            if (S.wallKick && !f.ground && (f.x < 40 || f.x > P.W - 40))
                k |= IN.JUMP;
        }
        k = stayOnStage(f, w, k);
        if ((mem.k || 0) & TAPS)                    // a tap needs a release in between
            k &= ~(mem.k & TAPS);
        return (mem.k = k);
    }

    // the practice bot's game plan; null: fall back to the general one
    function spar(f, w, S, mem, foe) {
        const fdx = foe.x - f.x, fdy = foe.y - f.y, dist = Math.hypot(fdx, fdy);
        const toward = fdx > 0 ? IN.RIGHT : IN.LEFT, away = fdx > 0 ? IN.LEFT : IN.RIGHT;
        // defence first (it also drops any plan)
        const projectile = w.shots.some(s => s.owner !== f.id && Math.abs(s.x - f.x) < 260 && Math.sign(f.x - s.x) === Math.sign(s.vx));
        if (projectile && f.ground) {
            mem.plan = null;
            return IN.JUMP | away;                   // never guard a shot: jump it
        }
        if (S.techs && foe.atk && foe.atk.kind === 'grab' && dist < 90) {
            mem.plan = null;
            return IN.JUMP | away;                   // tech the throw
        }
        if (foe.atk)
            mem.seen = w.time;                       // they're swinging: be careful for a moment
        const wary = w.time - (mem.seen ?? -9) < 0.6 && dist < 130 && f.ground && !f.atk;
        const theirs = foe.atk && foe.atk.move && foe.atk.t < foe.atk.move.to && dist < 130 && f.ground && !f.atk;
        if (theirs || (wary && !mem.plan && Math.random() < (S.parry ? 0.7 : 0.4))) {
            mem.plan = null;
            if (f.guardHits >= 2)                    // the third would break it: roll away
                return IN.DASH | away;
            // guard; on Hard, raised during their startup so it lands as a parry
            if (!theirs || S.parry || foe.atk.t > 0.04) {
                mem.t = 0.2;
                return IN.DOWN;
            }
        }
        // a plan in progress: J, J, K (each its own tap, each when the last move is done), then the dive
        if (mem.plan && mem.plan.length) {
            const step = mem.plan[0];
            if (step === 'dive') {
                if (!f.ground && fdy > 20) {
                    mem.plan = null;
                    return IN.DOWN | IN.HEAVY | toward;
                }
                if (f.ground && !f.atk && foe.ground) {
                    mem.plan = null;                 // they never went up: start again
                    return 0;
                }
                return toward;
            }
            if (step && f.atk)
                return 0;                            // wait for the move to finish
            mem.plan.shift();
            return step;
        }
        if (foe.stun > 0 && !foe.ground && fdy < -30 && Math.abs(fdx) < 140)
            return IN.JUMP | toward;                 // they're up: follow
        if (Math.abs(fdx) < 80 && Math.abs(fdy) < 60 && f.ground && foe.ground && Math.random() < S.attack) {
            if (S.grab && foe.blocking && Math.random() < 0.6)
                return IN.GRAB;                      // a guard: grab them out of it
            mem.plan = [0, IN.LIGHT, 0, IN.HEAVY, 0, IN.JUMP | toward, 'dive'];
            return IN.LIGHT;
        }
        if (Math.abs(fdx) > 260 && f.ground && Math.random() < 0.25)
            return IN.DASH | toward;                 // close the gap fast
        return null;
    }

    // over a pit: don't walk off an edge unless another platform is in reach;
    // falling with nothing below, get back
    function stayOnStage(f, w, k) {
        if (!w.pit)
            return k;
        const under = x => w.plats.some(q => q.alive && x >= q.x && x <= q.x + q.w && q.y >= f.y - 4);
        const ahead = f.x + (k & IN.RIGHT ? 60 : k & IN.LEFT ? -60 : 0);
        if (f.ground && !under(ahead)) {
            const dir = k & IN.RIGHT ? 1 : -1;
            const reachable = w.plats.some(q => q.alive && q.y > f.y - 260 &&
                (dir > 0 ? q.x > f.x && q.x - f.x < 340 : f.x > q.x + q.w && f.x - (q.x + q.w) < 340));
            if (reachable && (k & (IN.LEFT | IN.RIGHT)))
                k |= IN.JUMP;
            else
                k &= ~(IN.LEFT | IN.RIGHT);
        } else if (!f.ground && f.vy > 0 && !under(f.x)) {
            const alive = w.plats.filter(q => q.alive);
            if (alive.length) {
                const home = alive.reduce((a, q) => Math.abs(q.x + q.w / 2 - f.x) < Math.abs(a.x + a.w / 2 - f.x) ? q : a);
                k = (k & ~(IN.LEFT | IN.RIGHT | IN.DOWN | IN.HEAVY)) | (home.x + home.w / 2 > f.x ? IN.RIGHT : IN.LEFT);
                k |= f.jumps > 0 ? IN.JUMP : IN.DASH;
            }
        }
        return k;
    }

    return {STYLES, LADDER, think};
});
