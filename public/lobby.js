// Stick Havoc: the lobby's room, drawn in world space behind the fighters.
// A locker room: back wall, ceiling lights, the wardrobe mirror (left),
// the host's console and its wall screen (middle), the dummy's post (right).
'use strict';
const Lobby = (() => {
    const {W, MAPS, MODES} = Physics;
    const ST = MAPS.lobby.stations;
    let qr = null, url = '';
    const pops = [];                  // the dummy's floating words: BOOM!, 12 DMG, CRIT!

    fetch('/info').then(r => r.json()).then(info => {
        qr = info.qr;
        url = info.main;
    }).catch(() => {});

    function rounded(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    }

    // the room, behind everything
    function back(ctx, t) {
        // back wall panels and a floor line
        ctx.fillStyle = '#0e1420';
        ctx.fillRect(-200, -200, W + 400, 1000);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 2;
        for (let x = 0; x <= W; x += 160) {
            ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, 800); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(148, 163, 184, 0.05)';
        ctx.fillRect(0, 700, W, 100);                   // a wainscot along the floor
        // ceiling lights: soft cones
        for (const x of [260, 800, 1340]) {
            const g = ctx.createLinearGradient(0, 40, 0, 520);
            g.addColorStop(0, 'rgba(226, 232, 240, 0.10)');
            g.addColorStop(1, 'rgba(226, 232, 240, 0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.moveTo(x - 30, 40); ctx.lineTo(x + 30, 40); ctx.lineTo(x + 170, 520); ctx.lineTo(x - 170, 520);
            ctx.fill();
            ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
            rounded(ctx, x - 40, 34, 80, 6, 3);
            ctx.fill();
        }
        // lockers by the wardrobe
        for (let i = 0; i < 3; i++) {
            const x = 40 + i * 54;
            ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
            rounded(ctx, x, 620, 48, 180, 4);
            ctx.fill();
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
            ctx.stroke();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
            ctx.fillRect(x + 38, 700, 3, 18);
            for (let v = 0; v < 3; v++)
                ctx.fillRect(x + 10, 636 + v * 6, 28, 2);
        }
        wardrobe(ctx, t);
        console_(ctx, t);
        dummyPost(ctx);
    }

    function wardrobe(ctx, t) {
        const {x, y} = ST.wardrobe;
        // a tall mirror in a thin frame
        ctx.save();
        rounded(ctx, x - 46, y - 210, 92, 200, 46);
        const g = ctx.createLinearGradient(x - 46, y - 210, x + 46, y - 10);
        g.addColorStop(0, 'rgba(148, 163, 184, 0.16)');
        g.addColorStop(0.5, 'rgba(148, 163, 184, 0.05)');
        g.addColorStop(1, 'rgba(148, 163, 184, 0.12)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
        ctx.stroke();
        // a slow sheen across the glass
        const sx = x - 46 + ((t * 40) % 220) - 60;
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath(); ctx.moveTo(sx, y - 210); ctx.lineTo(sx + 26, y - 210); ctx.lineTo(sx - 30, y); ctx.lineTo(sx - 56, y);
        ctx.fill();
        ctx.restore();
        label(ctx, 'WARDROBE', x, y - 226);
    }

    // the host's console: a desk and a wall screen with the room's state and the join code
    function console_(ctx, t) {
        const {x, y} = ST.console;
        const sel = state.sel || {mode: 'koth', map: 'rooftops'};
        // the screen
        const sw = 520, sh = 250, sx = x - sw / 2, sy = 180;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        rounded(ctx, sx, sy, sw, sh, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '800 30px system-ui, sans-serif';
        ctx.fillText('STICK HAVOC', sx + 28, sy + 52);
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('TOURNAMENT EDITION', sx + 30, sy + 74);
        const row = (k, v, yy, accent) => {
            ctx.font = '700 11px system-ui, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(k, sx + 30, yy);
            ctx.font = '700 19px system-ui, sans-serif';
            ctx.fillStyle = accent || '#e5e7eb';
            ctx.fillText(v, sx + 30, yy + 22);
        };
        row('MODE', MODES[sel.mode], sy + 112, '#22d3ee');
        row('MAP', MAPS[sel.map].name, sy + 162);
        row('PLAYERS READY', `${state.ready || 0} / ${state.max || 10}`, sy + 212);
        // the QR code, for joining
        if (qr) {
            const n = qr.length, cell = Math.floor(150 / n), size = cell * n, qx = sx + sw - size - 34, qy = sy + 30;
            ctx.fillStyle = '#f8fafc';
            rounded(ctx, qx - 8, qy - 8, size + 16, size + 16, 8);
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            qr.forEach((r, i) => {
                for (let c = 0; c < n; c++) {
                    if (r[c] === '1')
                        ctx.fillRect(qx + c * cell, qy + i * cell, cell, cell);
                }
            });
            ctx.textAlign = 'center';
            ctx.font = '600 12px ui-monospace, monospace';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(url.replace('http://', ''), qx + size / 2, qy + size + 28);
        }
        // the countdown, once the host has pressed start
        if (state.starting !== null && state.starting !== undefined) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            rounded(ctx, sx, sy, sw, sh, 14);
            ctx.fill();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#22d3ee';
            ctx.font = '800 96px system-ui, sans-serif';
            ctx.fillText(String(Math.max(1, Math.ceil(state.starting))), x, sy + sh / 2 + 34);
        }
        // the desk
        ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
        rounded(ctx, x - 90, y - 64, 180, 64, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
        ctx.stroke();
        ctx.fillStyle = Math.floor(t * 2) % 2 ? '#22d3ee' : 'rgba(34, 211, 238, 0.35)';
        ctx.fillRect(x - 60, y - 48, 8, 4);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        for (let i = 0; i < 6; i++)
            ctx.fillRect(x - 40 + i * 16, y - 50, 10, 6);
        label(ctx, 'HOST CONSOLE', x, y - 80);
    }

    function dummyPost(ctx) {
        const {x, y} = ST.dummy;
        ctx.fillStyle = 'rgba(51, 65, 85, 0.9)';
        rounded(ctx, x - 34, y - 10, 68, 10, 4);       // the base
        ctx.fill();
        label(ctx, 'TRAINING DUMMY', x, y - 150);
    }

    function label(ctx, text, x, y) {
        ctx.textAlign = 'center';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
        ctx.fillText(text, x, y);
    }

    // in front: the prompt at your station, and the dummy's words
    function front(ctx, dt, me, myId, hostId) {
        if (me && state.near) {
            const s = ST[state.near];
            const isHost = myId === hostId;
            const text = state.near === 'wardrobe' ? 'E  Customize' :
                isHost ? 'Q  Mode    Tab  Map    E  Start' : 'Only the host (👑) can start';
            ctx.font = '700 15px system-ui, sans-serif';
            const w = ctx.measureText(text).width + 28;
            const y = s.y - (state.near === 'console' ? 120 : 250);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            rounded(ctx, s.x - w / 2, y - 22, w, 34, 9);
            ctx.fill();
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillStyle = '#e5e7eb';
            ctx.fillText(text, s.x, y);
        }
        for (const p of pops) {
            p.t += dt;
            const k = p.t / 1.1;
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - k * k);
            ctx.translate(p.x + p.dx * p.t, p.y - 70 * p.t);
            ctx.rotate(p.rot);
            ctx.textAlign = 'center';
            ctx.font = `800 italic ${p.big ? 34 : 22}px system-ui, sans-serif`;
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(11, 15, 23, 0.9)';
            ctx.strokeText(p.text, 0, 0);
            ctx.fillStyle = p.big ? '#facc15' : '#f1f5f9';
            ctx.fillText(p.text, 0, 0);
            ctx.restore();
        }
        for (let i = pops.length - 1; i >= 0; i--) {
            if (pops[i].t > 1.1)
                pops.splice(i, 1);
        }
    }

    function pop(ev) {
        pops.push({text: ev.text, big: ev.big, x: ev.x, y: ev.y, t: 0, dx: (Math.random() - 0.5) * 80,
            rot: (Math.random() - 0.5) * 0.3});
    }

    const state = {near: null, sel: null, ready: 0, max: 10, starting: null};
    return {back, front, pop, state};
})();
