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
