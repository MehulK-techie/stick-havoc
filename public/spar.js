// Stick Havoc: practice sparring against the bot, run entirely in this
// browser (the same simulation and bot as the server), so it never touches
// the rest of the room. The engine draws it like a match.
'use strict';
const Spar = (() => {
    const P = Physics, BOT_ID = -1, STEP = 1 / 30;
    let w = null, myId = null, mem = {}, diff = 'sparMedium', acc = 0, k = 0, aim = null, events = [], resetT = 0;
    let me = null;

    function start(id, look) {
        myId = id;
        w = P.createWorld('colosseum');
        w.weapons = false;
        me = P.makeFighter(id, look.name, look.color, 600, 820, look.gear);
        const bot = P.makeFighter(BOT_ID, 'Practice Bot', '#cbd5e1', 1000, 820);
        w.fighters.push(me, bot);
        mem = {}; acc = 0; events = []; resetT = 0;
        styleBot();
    }

    function styleBot() {
        const b = w && w.fighters.find(f => f.id === BOT_ID), S = Bot.STYLES[diff];
        if (b)
            Object.assign(b, {name: S.name, color: S.color, gear: {hat: S.hat}});
    }

    function toggle() {
        diff = diff === 'sparMedium' ? 'sparHard' : 'sparMedium';
        styleBot();
        return diff === 'sparHard' ? 'Hard' : 'Medium';
    }

    // a fixed 30 Hz step, as on the server; the page draws in between
    function frame(dt) {
        if (!w)
            return null;
        acc = Math.min(acc + dt, 0.2);
        while (acc >= STEP) {
            acc -= STEP;
            const bot = w.fighters.find(f => f.id === BOT_ID);
            const inputs = {[myId]: {k, aim}, [BOT_ID]: {k: bot ? Bot.think(bot, w, diff, mem, STEP) : 0}};
            w.events = [];
            P.step(w, inputs, STEP);
            events.push(...w.events);
            // someone's down: both back up, full health, after a moment
            if (w.fighters.some(f => f.st === 'ko' || f.st === 'gone') && (resetT += STEP) > 2) {
                resetT = 0;
                w.fighters.forEach((f, i) => Object.assign(f, P.makeFighter(f.id, f.name, f.color, i ? 1000 : 600, 820, f.gear)));
                styleBot();
            }
        }
        return snapshot();
    }

    const r1 = v => Math.round(v * 10) / 10;
    function snapshot() {
        const s = {
            type: 's', scene: 'match', map: w.map, host: null, ts: r1(w.timeScale), sel: null, ready: 0, max: 15,
            starting: null, ph: 'fight', pt: 0, mode: 'spar', round: 0, winner: null, champion: null,
            hz: null, hzT: 0, vote: null, bomb: null, beam: null, ball: null, lavaY: null, tunnel: null, heat: null,
            pl: w.plats.map(p => [p.alive ? 1 : 0, 0, 0, p.solid ? p.hp : 0, Math.round(p.x), Math.round(p.y)]),
            f: w.fighters.filter(f => f.st !== 'gone').map(f => [f.id, Math.round(f.x), Math.round(f.y), Math.round(f.vx),
                Math.round(f.vy), f.face, Math.ceil(f.hp), f.st, f.atk ? f.atk.kind : 0, f.atk ? r1(f.atk.t / f.atk.move.dur) : 0,
                f.combo, f.inv > 0 ? 1 : 0, f.shield > 0 ? 1 : 0, r1(f.spin), f.ground ? 1 : 0,
                f.atk && f.atk.dir ? r1(f.atk.dir.y) : 0, f.weapon ? f.weapon.kind : 0, f.weapon ? f.weapon.uses : 0, 0]),
            cr: [], sh: w.shots.map(x => [Math.round(x.x), Math.round(x.y), x.kind, Math.round(x.vx)]), an: [],
            q: [], act: [myId, BOT_ID], wins: [], tl: null, arcade: null, target: 0,
            spar: diff === 'sparHard' ? 'Hard' : 'Medium', ev: events,
        };
        events = [];
        return s;
    }

    function botInfo() {
        const S = Bot.STYLES[diff];
        return {name: S.name, color: S.color, gear: {hat: S.hat}};
    }

    return {
        start, toggle, frame, botInfo, BOT_ID,
        input(keys, a) { k = keys; aim = a; },
        stop() { w = null; },
        get active() { return !!w; },
    };
})();
