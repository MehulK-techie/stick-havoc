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
        for (const x of [260, 1340]) {             // (the middle of the wall is the stadium screen)
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
        dojo(ctx, t);
        parkour(ctx, t);
        goal(ctx, t);
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
        neonSign(ctx, t, x, y - 292);
    }

    // CUSTOMIZE in neon, above the mirror (over the ledge, clear of the station's prompt), its arrow blinking down
    function neonSign(ctx, t, x, y) {
        const flicker = Math.sin(t * 2.4) * 0.5 + 0.5, dead = (t % 7) > 6.82;   // a slow pulse; now and then a stutter
        ctx.save();
        ctx.textAlign = 'center';
        rounded(ctx, x - 88, y - 26, 176, 40, 10);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(34, 211, 238, ${dead ? 0.2 : 0.55 + flicker * 0.35})`;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = dead ? 0 : 10 + flicker * 10;
        ctx.stroke();
        ctx.font = '800 20px system-ui, sans-serif';
        ctx.fillStyle = dead ? 'rgba(244, 114, 182, 0.3)' : '#f9a8d4';
        ctx.shadowColor = '#f472b6';
        ctx.shadowBlur = dead ? 0 : 14 + flicker * 12;
        ctx.fillText('CUSTOMIZE', x, y + 1);
        const on = Math.floor(t * 2) % 2 === 0;                                 // the arrow: on, off, on
        ctx.font = '700 16px system-ui, sans-serif';
        ctx.fillStyle = on ? '#22d3ee' : 'rgba(34, 211, 238, 0.25)';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = on ? 14 : 0;
        ctx.fillText('▼', x, y + 34 + (on ? 2 : 0));
        ctx.restore();
    }

    // the host's console: a desk below, and the stadium screen high on the wall
    // with the room's settings and the join code
    function console_(ctx, t) {
        const {x, y} = ST.console;
        const sel = state.sel || {mode: 'koth', map: 'rooftops', target: 5, timer: 0, weapons: true, limit: 10};
        const sw = 640, sh = 318, sx = x - sw / 2, sy = 50;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        rounded(ctx, sx, sy, sw, sh, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(34, 211, 238, 0.7)';           // a thin lit edge along the top
        ctx.fillRect(sx + 20, sy, sw - 40, 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '800 28px system-ui, sans-serif';
        ctx.fillText('STICK HAVOC', sx + 26, sy + 46);
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`CREATED BY MEHUL  ·  ${state.version || 'v1.2.0-tournament'}  ·  MIT`, sx + 27, sy + 66);
        const pickName = (v, names) => v === 'random' ? 'Random' : v === 'shuffle' ? 'Banger Shuffle' : names[v] || '';
        const rows = [
            ['MODE', pickName(sel.mode, MODES), '#22d3ee'],
            ['MATCH', `First to ${sel.target}  ·  ${sel.timer ? sel.timer + ' s rounds' : 'no timer'}`],
            ['MAP', sel.mode === 'shuffle' ? 'A new one each round' :
                pickName(sel.map, Object.fromEntries(Object.entries(MAPS).map(([k, m]) => [k, m.name])))],
            ['WEAPONS', sel.weapons ? 'On' : 'Off'],
            ['PLAYERS READY', `${state.ready || 0} / ${sel.limit || state.max || 10}`],
        ];
        rows.forEach(([k, v, accent], i) => {
            const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3;
            const rx = sx + 26 + col * 220, ry = sy + 100 + row * 46;
            ctx.font = '700 10px system-ui, sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText(k, rx, ry);
            ctx.font = '700 16px system-ui, sans-serif';
            ctx.fillStyle = accent || '#e5e7eb';
            ctx.fillText(v, rx, ry + 19);
        });
        // the footer: this game's repo, and the workstation setup it ships with, as two lit pills
        ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.fillRect(sx + 26, sy + sh - 74, sw - 52, 1);
        ctx.font = '700 11px ui-monospace, monospace';
        [['⚡ Stick Havoc', 'github.com/MehulK-techie/stick-havoc', '#22d3ee'],
            ['🐧 Fedora Workstation', 'github.com/MehulK-techie/fedora-workstation-config', '#a3e635']].forEach(([name, url, c], i) => {
            const py = sy + sh - 62 + i * 28, text = `${name}: ${url}`, pw = ctx.measureText(text).width + 24;
            rounded(ctx, sx + 26, py, pw, 22, 11);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.fill();
            ctx.strokeStyle = c;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#e5e7eb';
            ctx.fillText(text, sx + 38, py + 15);
        });
        if (qr) {
            const n = qr.length, cell = Math.floor(150 / n), size = cell * n, qx = sx + sw - size - 32, qy = sy + 30;
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

    // the dojo mat: practise against the bot
    function dojo(ctx, t) {
        const {x, y} = ST.dojo;
        ctx.fillStyle = 'rgba(34, 211, 238, 0.10)';
        rounded(ctx, x - 70, y - 6, 140, 6, 3);
        ctx.fill();
        ctx.strokeStyle = `rgba(34, 211, 238, ${0.35 + 0.15 * Math.sin(t * 2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y - 3, 66, 7, 0, 0, Math.PI * 2); ctx.stroke();
        label(ctx, 'DOJO · PRACTICE BOT', x, y - 150);
    }

    // the football goal against the right wall, and the lobby's score
    function goal(ctx, t) {
        const x = 1540, y = 650, h = 150;
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';      // the net
        ctx.lineWidth = 1;
        for (let gx = x; gx <= W; gx += 12) {
            ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
        }
        for (let gy = y; gy <= y + h; gy += 12) {
            ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(W, gy); ctx.stroke();
        }
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 10 + 4 * Math.sin(t * 3);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`LOBBY BALL: ${state.goals || 0} GOAL${state.goals === 1 ? '' : 'S'}`, 1490, y - 14);
    }

    // the parkour tower: where the clock starts and stops, and the best run so far
    function parkour(ctx, t) {
        // the billboard, between the stadium screen and the tower: the five best runs, one per climber
        const bx = 1132, by = 168, bw = 118, board = state.board || [];
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        rounded(ctx, bx, by, bw, 34 + Math.max(1, board.length) * 16, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = '800 9px system-ui, sans-serif';
        ctx.fillStyle = '#facc15';
        ctx.fillText('LOBBY CLIMB RECORD', bx + bw / 2, by + 16);
        ctx.font = '700 10px ui-monospace, monospace';
        if (!board.length) {
            ctx.fillStyle = '#64748b';
            ctx.fillText('no runs yet', bx + bw / 2, by + 36);
        }
        board.forEach((r, i) => {
            const ry = by + 36 + i * 16, name = r.name.length > 8 ? r.name.slice(0, 7) + '…' : r.name;
            ctx.fillStyle = i ? '#cbd5e1' : '#fde68a';
            ctx.textAlign = 'left';
            ctx.fillText(`${i + 1} ${name}`, bx + 8, ry);
            ctx.textAlign = 'right';
            ctx.fillText(`${r.t.toFixed(2)}s`, bx + bw - 8, ry);
        });
        for (const p of MAPS.lobby.plats) {
            if (!p.parkour)
                continue;
            if (p.parkour === 'finish') {             // a green hologram badge over the pad, pulsing, with sparkles
                const cx = p.x + p.w / 2, pulse = 0.5 + 0.5 * Math.sin(t * 3);
                ctx.save();
                ctx.shadowColor = '#4ade80';
                ctx.shadowBlur = 8 + pulse * 10;
                ctx.fillStyle = '#4ade80';
                ctx.fillRect(p.x, p.y - 3, p.w, 3);
                rounded(ctx, cx - 40, p.y - 30, 80, 20, 10);
                ctx.fillStyle = `rgba(74, 222, 128, ${0.1 + pulse * 0.08})`;
                ctx.fill();
                ctx.strokeStyle = `rgba(74, 222, 128, ${0.55 + pulse * 0.4})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.textAlign = 'center';
                ctx.font = '800 11px system-ui, sans-serif';
                ctx.fillStyle = '#bbf7d0';
                ctx.fillText('🏁 FINISH', cx, p.y - 16);
                ctx.shadowBlur = 6;
                for (let i = 0; i < 5; i++) {         // sparkles drifting up off the pad
                    const k = (t * 0.6 + i / 5) % 1, sx = p.x + 10 + ((i * 37) % (p.w - 20));
                    ctx.globalAlpha = 1 - k;
                    ctx.fillRect(sx, p.y - 4 - k * 34, 2, 2);
                }
                ctx.restore();
            } else {
                ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
                ctx.fillRect(p.x, p.y - 3, p.w, 3);
                ctx.textAlign = 'center';
                ctx.font = '700 10px system-ui, sans-serif';
                ctx.fillText('START ▲ CLIMB', p.x + p.w / 2, p.y - 10);
            }
        }
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
            const text = state.near === 'wardrobe' ? 'E  Customize' : state.near === 'dojo' ? 'E  Spar the practice bot' :
                isHost ? 'E  Match settings     Enter  Start' : 'E  View rules  ·  Waiting for Host to start...';
            ctx.font = '700 15px system-ui, sans-serif';
            const w = ctx.measureText(text).width + 28;
            const y = s.y - (state.near === 'wardrobe' ? 250 : 120);
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
    }

    // the floating words (the dummy's damage, PARRY!, COUNTER!, ...), in any scene
    function drawPops(ctx, dt) {
        for (const p of pops) {
            p.t += dt;
            const k = p.t / 1.1;
            ctx.save();
            ctx.globalAlpha = Math.max(0, 1 - k * k);
            ctx.translate(p.x + p.dx * p.t, p.y - 70 * p.t);
            ctx.rotate(p.rot);
            if (p.big && p.t < 0.22) {                // a comic burst: rays flying out from the hit
                const k = p.t / 0.22;
                ctx.strokeStyle = p.color || '#facc15';
                ctx.globalAlpha = 1 - k;
                ctx.lineWidth = 3;
                for (let i = 0; i < 10; i++) {
                    const a = i * Math.PI / 5 + p.rot;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a) * (18 + 50 * k), Math.sin(a) * (10 + 30 * k) - 10);
                    ctx.lineTo(Math.cos(a) * (34 + 90 * k), Math.sin(a) * (18 + 52 * k) - 10);
                    ctx.stroke();
                }
                ctx.globalAlpha = Math.max(0, 1 - (p.t / 1.1) ** 2);
                ctx.scale(0.7 + 0.3 * Math.min(1, k * 2), 0.7 + 0.3 * Math.min(1, k * 2));
            }
            ctx.textAlign = 'center';
            ctx.font = `800 italic ${p.big ? 34 : 22}px system-ui, sans-serif`;
            ctx.lineWidth = 5;
            ctx.strokeStyle = 'rgba(11, 15, 23, 0.9)';
            ctx.strokeText(p.text, 0, 0);
            ctx.fillStyle = p.color || (p.big ? '#facc15' : '#f1f5f9');
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
            rot: (Math.random() - 0.5) * 0.3, color: ev.color});
    }

    const state = {near: null, sel: null, ready: 0, max: 10, starting: null, version: null, goals: 0, record: null,
        board: []};
    return {back, front, pop, drawPops, state};
})();
