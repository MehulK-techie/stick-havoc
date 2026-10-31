// Stick Havoc: every sound made on the spot with the Web Audio API.
// No sound files: oscillators, filtered noise and envelopes.
'use strict';
const Sfx = (() => {
    let ctx = null, master = null, noiseBuf = null;

    function init() {
        if (ctx)
            return ctx.state === 'suspended' ? ctx.resume() : null;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC)
            return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp).connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++)
            d[i] = Math.random() * 2 - 1;
    }

    // an envelope on a gain: quick attack, exponential fall
    function env(g, t, peak, attack, decay) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    function tone(type, f0, f1, dur, peak = 0.5, delay = 0) {
        if (!ctx)
            return;
        const t = ctx.currentTime + delay;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0)
            o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        env(g, t, peak, 0.005, dur);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    function noise(dur, filter, f0, f1, peak = 0.4, q = 1, delay = 0) {
        if (!ctx)
            return;
        const t = ctx.currentTime + delay;
        const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noiseBuf;
        flt.type = filter;
        flt.Q.value = q;
        flt.frequency.setValueAtTime(f0, t);
        flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        env(g, t, peak, 0.004, dur);
        s.connect(flt).connect(g).connect(master);
        s.start(t, Math.random() * 0.5);
        s.stop(t + dur + 0.05);
    }

    const sounds = {
        light: () => { tone('sine', 210, 70, 0.09, 0.5); noise(0.04, 'highpass', 3200, 2200, 0.22); },
        heavy: () => { tone('sine', 110, 38, 0.32, 0.9); tone('square', 70, 40, 0.18, 0.15); noise(0.12, 'lowpass', 1200, 200, 0.4); },
        dropkick: () => { tone('sine', 140, 45, 0.28, 0.85); noise(0.1, 'bandpass', 900, 300, 0.4, 2); },
        swing: () => noise(0.09, 'highpass', 1800, 5000, 0.12),
        dash: () => noise(0.22, 'highpass', 600, 6000, 0.35),
        jump: () => tone('square', 320, 640, 0.09, 0.12),
        land: () => tone('sine', 120, 70, 0.08, 0.3),
        thud: () => { tone('sine', 90, 40, 0.2, 0.7); noise(0.1, 'lowpass', 600, 120, 0.3); },
        wallbounce: () => { tone('triangle', 300, 220, 0.25, 0.4); tone('triangle', 452, 330, 0.25, 0.3); },
        ledge: () => tone('triangle', 520, 520, 0.06, 0.15),
        crumble: () => noise(0.7, 'lowpass', 500, 60, 0.6),
        clang: () => { for (const f of [523, 787, 1046, 1410]) tone('triangle', f, f * 0.98, 0.5, 0.18); },
        anvil: () => { sounds.clang(); tone('sine', 80, 35, 0.3, 0.8); },
        count: () => tone('sine', 660, 660, 0.18, 0.4),
        fight: () => { for (const [f, d] of [[523, 0], [659, 0.05], [784, 0.1], [1046, 0.15]]) tone('sawtooth', f, f, 0.4, 0.12, d); },
        ko: () => {
            tone('sine', 70, 30, 0.9, 1.0); noise(0.6, 'lowpass', 2000, 80, 0.6);
            for (const [f, d] of [[392, 0.25], [523, 0.38], [659, 0.51], [1046, 0.64]]) tone('square', f, f * 1.01, 0.35, 0.12, d);
        },
        slowmo: () => { noise(1.2, 'lowpass', 2400, 120, 0.4, 4); tone('sine', 220, 55, 1.2, 0.3); },
        emoji: () => tone('triangle', 880 + Math.random() * 300, 1400, 0.08, 0.12),
        vote: () => { tone('sine', 880, 880, 0.12, 0.25); tone('sine', 1320, 1320, 0.15, 0.2, 0.12); },
        straight: () => { tone('sine', 150, 50, 0.2, 0.8); noise(0.08, 'bandpass', 1500, 500, 0.35, 1.5); },
        beam: () => { tone('sawtooth', 220, 90, 0.35, 0.25); noise(0.3, 'highpass', 2000, 800, 0.3); },
        beamSweep: () => { tone('sawtooth', 110, 330, 1.2, 0.18); noise(1.2, 'bandpass', 400, 2400, 0.25, 3); },
        beep: () => tone('square', 880, 880, 0.12, 0.18),
        cancel: () => { noise(0.12, 'highpass', 1200, 6000, 0.3); tone('triangle', 900, 1400, 0.06, 0.12); },
        bumper: () => { tone('sine', 180, 520, 0.18, 0.5); tone('triangle', 360, 900, 0.18, 0.2); },
        restore: () => tone('triangle', 440, 660, 0.15, 0.15),
        // the lobby
        near: () => tone('sine', 1180, 1180, 0.05, 0.08),
        ui: () => tone('triangle', 740, 980, 0.06, 0.12),
        open: () => { tone('sine', 520, 780, 0.12, 0.14); tone('sine', 780, 1040, 0.12, 0.1, 0.06); },
        siren: () => { tone('sine', 620, 930, 0.32, 0.28); tone('sine', 930, 620, 0.32, 0.2, 0.32); },
        // Bomb Tag
        tick: () => tone('square', 1500, 1500, 0.03, 0.12),
        tickFast: () => { tone('square', 1900, 1900, 0.03, 0.18); tone('square', 1900, 1900, 0.03, 0.14, 0.25); },
        pass: () => { tone('triangle', 500, 1000, 0.1, 0.25); },
        boom: () => {
            tone('sine', 60, 25, 1.4, 1.0); noise(1.2, 'lowpass', 3000, 60, 0.9);
            tone('sawtooth', 90, 30, 0.6, 0.2);
        },
        // guarding, grabbing, weapons
        block: () => { tone('triangle', 520, 380, 0.08, 0.25); noise(0.05, 'bandpass', 2500, 1800, 0.2, 3); },
        parry: () => { tone('triangle', 1320, 1760, 0.18, 0.3); tone('sine', 2640, 2640, 0.25, 0.12, 0.04); },
        guardbreak: () => { tone('square', 300, 90, 0.3, 0.3); noise(0.25, 'lowpass', 2400, 300, 0.4); },
        grab: () => noise(0.08, 'bandpass', 800, 400, 0.25, 2),
        crate: () => { tone('sine', 660, 880, 0.12, 0.15); tone('sine', 880, 1100, 0.12, 0.12, 0.12); },
        pickup: () => { tone('triangle', 660, 1320, 0.12, 0.2); },
        slash: () => { noise(0.12, 'highpass', 4000, 9000, 0.35); tone('sine', 300, 120, 0.1, 0.4); },
        zap: () => { tone('sawtooth', 1200, 300, 0.15, 0.25); },
        laser: () => { tone('square', 1800, 400, 0.16, 0.18); },
        bounce: () => tone('sine', 420, 300, 0.06, 0.2),
        warp: () => { tone('sine', 200, 1600, 0.25, 0.25); noise(0.25, 'bandpass', 600, 6000, 0.2, 2); },
        claim: () => { for (const [f, d] of [[880, 0], [1175, 0.07], [1568, 0.14]]) tone('triangle', f, f, 0.18, 0.16, d); },
        kick: () => { tone('sine', 260, 120, 0.1, 0.4); },
        sizzle: () => { noise(0.5, 'highpass', 3000, 1500, 0.35); tone('sawtooth', 120, 60, 0.3, 0.12); },
        bassdrop: () => { tone('sine', 120, 32, 0.7, 1.0); tone('sawtooth', 60, 30, 0.5, 0.15); },
        clash: () => {                         // a parry: two blades meeting, ringing
            for (const f of [1240, 1870, 2650, 3310]) tone('triangle', f, f * 0.995, 0.6, 0.12);
            noise(0.05, 'highpass', 5000, 8000, 0.3);
        },
        hazard: () => { for (const [f, d] of [[300, 0], [450, 0.1], [600, 0.2]]) tone('sawtooth', f, f * 1.5, 0.25, 0.12, d); },
    };

    return {
        init,
        play(name) {
            try {
                if (ctx && sounds[name])
                    sounds[name]();
            } catch (e) { /* sound is a bonus; never let it break the game */ }
        },
        get ready() { return !!ctx; },
    };
})();
