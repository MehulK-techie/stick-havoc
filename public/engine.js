// Stick Havoc: the browser side. Sends keys, draws the server's world at
// 60 fps (interpolated between its 30 Hz snapshots) with a moving camera,
// hit-stop, slow motion, particles and the crowd's emojis and votes.
'use strict';
(() => {
    const {W, H, IN, COLORS, HAZARDS, drawRig, stage} = window.Physics;
    const $ = id => document.getElementById(id);
    const cv = $('game'), ctx = cv.getContext('2d');

    // ------------------------------------------------------------ state
    let ws = null, myId = null, hostId = null, mode = 'koth';
    let roster = new Map();             // id -> {name, color, wins, bot}
    let snaps = [];                     // [{at, s}] newest last
    let plats = stage('koth');
    let myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const particles = [], floaters = [], banners = [], ghosts = [];
    const heads = new Map();            // id -> recent head positions (ribbons)
    const shownHp = new Map();
    const cam = {x: W / 2, y: H / 2, z: 1, shake: 0, flash: 0, slow: 0, slowX: 0, slowY: 0};
    let lastPhase = null, lastCount = null, lastVote = null;

    // ------------------------------------------------------------ network
    function connect() {
        ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
        ws.onmessage = e => {
            let m;
            try {
                m = JSON.parse(e.data);
            } catch {
                return;
            }
            if (m.type === 's')
                onSnapshot(m);
            else if (m.type === 'roster') {
                roster = new Map(m.list.map(p => [p.id, p]));
                hostId = m.host;
                setMode(m.mode);
                drawQueue();
            } else if (m.type === 'hello') {
                buildSwatches(m.colors);
            } else if (m.type === 'welcome') {
                myId = m.id;
                $('join').classList.add('hidden');
                for (const id of ['top', 'emojis'])
                    $(id).classList.remove('hidden');
                document.body.classList.add('playing');
                if (isTouch()) {
                    $('touch').classList.remove('hidden');
                    document.body.classList.add('touch');
                }
            } else if (m.type === 'full') {
                toast('The room is full (10 players)');
            } else if (m.type === 'phase') {
                setMode(m.mode);
            }
        };
        ws.onclose = () => {
            toast('Disconnected: is the host still running? Retrying…');
            setTimeout(connect, 1500);
        };
    }

    function sendMsg(m) {
        if (ws && ws.readyState === 1)
            ws.send(JSON.stringify(m));
    }

    function onSnapshot(s) {
        const now = performance.now();
        snaps.push({at: now, s});
        while (snaps.length > 8)
            snaps.shift();
        if (s.mode !== mode)
            setMode(s.mode);
        s.pl.forEach((p, i) => {
            if (plats[i]) {
                plats[i].alive = !!p[0]; plats[i].breaking = p[1];
            }
        });
        for (const ev of s.ev)
            onEvent(ev, s);
        // phases: the countdown, FIGHT!, the winner
        if (s.ph !== lastPhase) {
            if (s.ph === 'fight') {
                banner('FIGHT!', '#facc15', 0.9, 120);
                Sfx.play('fight');
            } else if (s.ph === 'ko' && lastPhase === 'fight') {
                const win = s.f.find(f => f[7] !== 'ko' && f[6] > 0);
                const p = win && roster.get(win[0]);
                setTimeout(() => banner(p ? `${p.name.toUpperCase()} WINS` : 'DRAW', p ? p.color : '#e6edf3', 2, 64), 900);
            } else if (s.ph === 'waiting') {
                lastCount = null;
            }
            lastPhase = s.ph;
        }
        if (s.ph === 'countdown') {
            const n = 3 - Math.floor(s.pt);
            if (n !== lastCount && n > 0) {
                lastCount = n;
                banner(String(n), '#22d3ee', 0.8, 140);
                Sfx.play('count');
            }
        } else {
            lastCount = null;
        }
        drawVote(s.vote);
        drawQueue(s);
    }

    function fighterById(s, id) {
        return s.f.find(f => f[0] === id);
    }

    function onEvent(ev, s) {
        switch (ev.type) {
        case 'hit': {
            const strong = ev.kind !== 'light';
            burst(ev.x, ev.y, ev.color, strong ? 26 : 12, strong ? 900 : 520);
            cam.shake = Math.max(cam.shake, strong ? 14 : 5);
            Sfx.play(ev.kind === 'light' ? 'light' : ev.kind);
            break;
        }
        case 'ko':
            ring(ev.x, ev.y, ev.color || '#ffffff');
            burst(ev.x, ev.y, ev.color || '#ffffff', 60, 1400);
            burst(ev.x, ev.y, '#ffffff', 30, 900);
            cam.shake = 34; cam.flash = 1; cam.slow = 0;
            banner('K.O.!', '#f43f5e', 1.4, 170);
            Sfx.play('ko');
            break;
        case 'slowmo':
            cam.slow = 1.2; cam.slowX = ev.x; cam.slowY = ev.y;
            Sfx.play('slowmo');
            break;
        case 'wallbounce':
            burst(ev.x, ev.y, '#e6edf3', 16, 600);
            cam.shake = Math.max(cam.shake, 12);
            Sfx.play('wallbounce');
            break;
        case 'dash':
            dust(ev.x, ev.y, 8);
            Sfx.play('dash');
            break;
        case 'jump':
            if (ev.double)
                Sfx.play('jump');
            break;
        case 'walljump':
            burst(ev.x, ev.y, '#a3e635', 8, 400);
            Sfx.play('jump');
            break;
        case 'land': case 'thud':
            dust(ev.x, ev.y, ev.type === 'thud' ? 14 : 6);
            Sfx.play(ev.type);
            break;
        case 'ledge':
            Sfx.play('ledge');
            break;
        case 'swing':
            Sfx.play('swing');
            break;
        case 'crumble':
            dust(ev.x, ev.y, 30, '#f97316');
            cam.shake = Math.max(cam.shake, 8);
            Sfx.play('crumble');
            break;
        case 'clang': case 'anvil':
            burst(ev.x, ev.y, '#94a3b8', 14, 500);
            cam.shake = Math.max(cam.shake, 9);
            Sfx.play(ev.type);
            break;
        case 'emoji':
            floaters.push({e: ev.e, x: 0.08 + Math.random() * 0.84, y: 1.02, vy: 0.11 + Math.random() * 0.07,
                wob: Math.random() * 6, size: 34 + Math.random() * 22, life: 0});
            Sfx.play('emoji');
            break;
        case 'vote':
            Sfx.play('vote');
            break;
        case 'hazard':
            banner(ev.name.toUpperCase() + '!', '#facc15', 1.6, 70);
            Sfx.play('hazard');
            break;
        case 'hazardEnd':
            toast(`${HAZARDS[ev.hazard]} is over`);
            break;
        case 'mode':
            plats = stage(ev.mode);
            banner(ev.mode === 'rumble' ? 'ROYAL RUMBLE' : 'KING OF THE HILL', '#22d3ee', 1.6, 64);
            break;
        }
    }

    // ------------------------------------------------------------ effects
    function burst(x, y, color, n, speed) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
            particles.push({k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0,
                max: 0.25 + Math.random() * 0.35, color, size: 2 + Math.random() * 2});
        }
    }

    function dust(x, y, n, color = '#64748b') {
        for (let i = 0; i < n; i++) {
            particles.push({k: 'dust', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 260,
                vy: -Math.random() * 160, life: 0, max: 0.4 + Math.random() * 0.3, color, size: 4 + Math.random() * 5});
        }
    }

    function ring(x, y, color) {
        particles.push({k: 'ring', x, y, life: 0, max: 0.6, color, size: 10});
    }

    function banner(text, color, dur, size) {
        banners.push({text, color, dur, size, t: 0});
    }

    let toastTimer = 0;
    function toast(text) {
        const el = $('toast');
        el.textContent = text;
        el.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    }

    // ------------------------------------------------------------ interpolation
    const RENDER_DELAY = 70;            // ms behind the newest snapshot: always two to blend between

    function view() {
        if (!snaps.length)
            return null;
        const t = performance.now() - RENDER_DELAY;
        let a = snaps[0], b = snaps[snaps.length - 1];
        for (let i = 0; i < snaps.length - 1; i++) {
            if (snaps[i].at <= t && snaps[i + 1].at >= t) {
                a = snaps[i]; b = snaps[i + 1];
                break;
            }
        }
        const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
        const out = [];
        for (const fb of b.s.f) {
            const fa = fighterById(a.s, fb[0]) || fb;
            const lerp = (i) => fa[i] + (fb[i] - fa[i]) * k;
            const p = roster.get(fb[0]) || {name: '?', color: '#e6edf3'};
            out.push({id: fb[0], x: lerp(1), y: lerp(2), vx: fb[3], vy: fb[4], face: fb[5], hp: fb[6], st: fb[7],
                ak: fb[8] || null, ap: fb[9], combo: fb[10], inv: fb[11], shield: fb[12],
                spin: fa[13] + (fb[13] - fa[13]) * k, ground: fb[14], aimUp: fb[15] < -0.5, aimY: fb[15],
                name: p.name, color: p.color});
        }
        return {s: b.s, f: out, an: b.s.an};
    }

    // ------------------------------------------------------------ drawing
    let dpr = 1, cw = 0, ch = 0;
    function resize() {
        dpr = Math.min(2, window.devicePixelRatio || 1);
        cw = window.innerWidth; ch = window.innerHeight;
        cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    }
    window.addEventListener('resize', resize);
    resize();

    // world units to pixels: the whole arena on a big screen; on a phone,
    // about 900 x 560 of it around the action (the camera follows)
    function baseScale() {
        const all = Math.min(cw / W, ch / H);
        return cw < 900 || ch < 500 ? Math.max(all, Math.min(cw / 900, ch / 560)) : all;
    }

    let lastFrame = performance.now(), clock = 0;
    function frame(now) {
        const dt = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        clock += dt;
        const v = view();
        updateCamera(v, dt);
        draw(v, dt);
        requestAnimationFrame(frame);
    }

    function updateCamera(v, dt) {
        const base = baseScale();
        let tx = W / 2, ty = H / 2, tz = 1;
        const fs = v ? v.f.filter(f => f.st !== 'ko') : [];
        if (cam.slow > 0) {                     // slow motion: close in on the clash
            cam.slow -= dt;
            tx = cam.slowX; ty = cam.slowY; tz = 1.75;
        } else if (fs.length) {
            const xs = fs.map(f => f.x), ys = fs.map(f => f.y - 50);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
            tz = Math.max(1, Math.min(1.35, Math.min(cw / ((x1 - x0 + 520) * base), ch / ((y1 - y0 + 420) * base))));
        }
        const k = 1 - Math.exp(-dt * (cam.slow > 0 ? 9 : 4));
        cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
        // keep the view inside the arena
        const halfW = cw / (2 * base * cam.z), halfH = ch / (2 * base * cam.z);
        cam.x = Math.max(Math.min(halfW, W / 2), Math.min(W - Math.min(halfW, W / 2), cam.x));
        cam.y = Math.max(Math.min(halfH, H / 2), Math.min(H - Math.min(halfH, H / 2), cam.y));
        cam.shake *= Math.exp(-dt * 9);
        cam.flash = Math.max(0, cam.flash - dt * 5);
    }

    function draw(v, dt) {
        const base = baseScale(), z = base * cam.z;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, cw, ch);
        const sx = (Math.random() - 0.5) * cam.shake, sy = (Math.random() - 0.5) * cam.shake;
        ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cw / 2 - cam.x * z + sx), dpr * (ch / 2 - cam.y * z + sy));
        drawArena();
        if (v) {
            for (const [x, y] of v.an)
                drawAnvil(x, y);
            drawGhosts(dt);
            for (const f of v.f)
                drawFighter(f, v.s);
        }
        drawParticles(dt);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (cam.slow > 0) {                     // slow motion: a dark, blue-tinted vignette
            const g = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.2, cw / 2, ch / 2, ch * 0.75);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(2,6,23,0.75)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, cw, ch);
        }
        if (cam.flash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${cam.flash * 0.55})`;
            ctx.fillRect(0, 0, cw, ch);
        }
        if (v)
            drawHud(v);
        drawFloaters(dt);
        drawBanners(dt);
    }

    function drawArena() {
        // the glowing grid
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.07)';
        ctx.beginPath();
        for (let x = 0; x <= W; x += 80) {
            ctx.moveTo(x, -200); ctx.lineTo(x, H + 200);
        }
        for (let y = -160; y <= H + 160; y += 80) {
            ctx.moveTo(-200, y); ctx.lineTo(W + 200, y);
        }
        ctx.stroke();
        // the side walls (fighters bounce off them)
        ctx.save();
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#22d3ee';
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(2, -200); ctx.lineTo(2, H + 200);
        ctx.moveTo(W - 2, -200); ctx.lineTo(W - 2, H + 200);
        ctx.stroke();
        for (const p of plats) {
            if (!p.alive) {
                ctx.strokeStyle = 'rgba(244, 63, 94, 0.15)';
                ctx.setLineDash([6, 8]);
                ctx.lineWidth = 1;
                ctx.strokeRect(p.x, p.y, p.w, 6);
                ctx.setLineDash([]);
                continue;
            }
            const jx = p.breaking ? (Math.random() - 0.5) * 6 : 0;
            const col = p.breaking ? '#f43f5e' : p.floor ? '#22d3ee' : p.crumble ? '#fb923c' : '#e879f9';
            ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
            ctx.fillRect(p.x + jx, p.y, p.w, p.floor ? 80 : p.h);
            ctx.shadowColor = col;
            ctx.strokeStyle = col;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(p.x + jx, p.y); ctx.lineTo(p.x + p.w + jx, p.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawAnvil(x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#475569';
        ctx.shadowColor = '#e2e8f0';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(-26, -18); ctx.lineTo(30, -18); ctx.lineTo(18, -6); ctx.lineTo(10, -6); ctx.lineTo(14, 14);
        ctx.lineTo(-14, 14); ctx.lineTo(-10, -6); ctx.lineTo(-20, -6); ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawFighter(f, s) {
        const gloves = s.hz === 'gloves';
        // motion blur: ghosts behind fast dashes and drop kicks
        if (Math.abs(f.vx) > 700 || f.st === 'dash' || f.ak === 'dropkick')
            ghosts.push({f: Object.assign({}, f), life: 0});
        const head = drawRig(ctx, f, clock, {gloves});
        // the headband: two ribbon tails trailing the head's recent path
        let trail = heads.get(f.id);
        if (!trail) {
            trail = [];
            heads.set(f.id, trail);
        }
        trail.unshift({x: head.x, y: head.y});
        if (trail.length > 12)
            trail.pop();
        // each segment at most 7 units long: it follows the motion's direction
        // without stretching across the arena after a big hit
        const pts = [{x: trail[0].x - f.face * 8, y: trail[0].y - 4}];
        for (let i = 1; i < trail.length; i++) {
            const prev = pts[i - 1];
            let dx = trail[i].x - f.face * (8 + i * 2.4) - prev.x, dy = trail[i].y - 4 + i * 1.2 - prev.y;
            const len = Math.hypot(dx, dy);
            if (len > 7) {
                dx = dx / len * 7; dy = dy / len * 7;
            }
            pts.push({x: prev.x + dx, y: prev.y + dy});
        }
        ctx.save();
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 0.85;
        ctx.lineCap = 'round';
        for (const off of [0, 5]) {
            ctx.lineWidth = 3.2 - off * 0.3;
            ctx.beginPath();
            pts.forEach((p, i) => {
                const sway = Math.sin(clock * 9 + i * 0.7 + off) * i * 0.5;
                i ? ctx.lineTo(p.x, p.y + off * 0.5 + sway) : ctx.moveTo(p.x, p.y);
            });
            ctx.stroke();
        }
        ctx.restore();
        // the name tag (and a small health bar in the Royal Rumble)
        if (f.st !== 'ko') {
            ctx.save();
            ctx.font = '700 15px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = f.id === myId ? '#ffffff' : 'rgba(230,237,243,0.75)';
            const ty = f.y - 128;
            ctx.fillText((f.id === hostId ? '👑 ' : '') + f.name, f.x, ty);
            if (s.mode === 'rumble') {
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.fillRect(f.x - 30, ty + 6, 60, 5);
                ctx.fillStyle = f.color;
                ctx.fillRect(f.x - 30, ty + 6, 60 * Math.max(0, f.hp) / 100, 5);
            }
            if (f.id === myId) {                // a small marker over yourself
                ctx.beginPath();
                ctx.moveTo(f.x - 6, ty + 14); ctx.lineTo(f.x + 6, ty + 14); ctx.lineTo(f.x, ty + 21);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    function drawGhosts(dt) {
        for (const g of ghosts) {
            g.life += dt;
            drawRig(ctx, g.f, clock, {alpha: Math.max(0, 0.35 - g.life * 1.6), noGlow: true});
        }
        for (let i = ghosts.length - 1; i >= 0; i--) {
            if (ghosts[i].life > 0.2)
                ghosts.splice(i, 1);
        }
    }

    function drawParticles(dt) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const p of particles) {
            p.life += dt;
            const a = Math.max(0, 1 - p.life / p.max);
            if (p.k === 'ring') {
                ctx.strokeStyle = p.color;
                ctx.globalAlpha = a;
                ctx.lineWidth = 6 * a + 1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 20 + p.life * 900, 0, Math.PI * 2);
                ctx.stroke();
                continue;
            }
            p.vy += (p.k === 'dust' ? 300 : 900) * dt;
            p.vx *= Math.exp(-dt * (p.k === 'dust' ? 4 : 2));
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = a;
            if (p.k === 'spark') {
                ctx.strokeStyle = p.color;
                ctx.lineWidth = p.size;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
                ctx.stroke();
            } else {
                ctx.fillStyle = p.color;
                ctx.globalAlpha = a * 0.4;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * (1 + p.life * 2), 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
        for (let i = particles.length - 1; i >= 0; i--) {
            if (particles[i].life >= particles[i].max)
                particles.splice(i, 1);
        }
    }

    function drawHud(v) {
        const s = v.s;
        // King of the Hill: the two fighters' health across the top
        if (s.mode === 'koth' && s.act.length) {
            const barW = Math.min(360, cw * 0.36), y = 16;
            s.act.slice(0, 2).forEach((id, i) => {
                const f = v.f.find(o => o.id === id);
                const p = roster.get(id) || {name: '?', color: '#fff', wins: 0};
                const hp = f ? Math.max(0, f.hp) : 0;
                const shown = shownHp.get(id) ?? hp;
                shownHp.set(id, shown + (hp - shown) * 0.12);
                const x = i === 0 ? cw / 2 - 40 - barW : cw / 2 + 40;
                ctx.fillStyle = 'rgba(15,20,30,0.85)';
                ctx.fillRect(x - 3, y - 3, barW + 6, 20);
                ctx.fillStyle = 'rgba(244,63,94,0.55)';         // the damage you just took, draining
                const lag = shownHp.get(id) / 100 * barW;
                ctx.fillRect(i === 0 ? x + barW - lag : x, y, lag, 14);
                ctx.fillStyle = p.color;
                const w = hp / 100 * barW;
                ctx.fillRect(i === 0 ? x + barW - w : x, y, w, 14);
                ctx.font = '800 15px system-ui, sans-serif';
                ctx.textAlign = i === 0 ? 'right' : 'left';
                ctx.fillStyle = '#e6edf3';
                ctx.fillText(`${p.name}${p.wins ? '  ★' + p.wins : ''}`, i === 0 ? x + barW : x, y + 36);
            });
            ctx.font = '900 18px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#facc15';
            ctx.fillText('VS', cw / 2, 29);
        } else if (s.mode === 'rumble') {
            const alive = v.f.filter(f => f.st !== 'ko').length;
            ctx.font = '800 16px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#fb923c';
            ctx.fillText(`ROYAL RUMBLE · ${alive} left`, cw / 2, 30);
        }
        // the hazard in play
        if (s.hz) {
            ctx.font = '800 15px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#facc15';
            ctx.fillText(`⚠ ${HAZARDS[s.hz]} · ${Math.ceil(s.hzT)}s`, cw / 2, 80);
        }
        if (s.ph === 'waiting') {
            ctx.font = '700 18px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(230,237,243,0.8)';
            ctx.fillText(s.mode === 'rumble' ? 'Waiting for a second player…' : 'Waiting for a challenger…', cw / 2, ch * 0.3);
        }
    }

    function drawFloaters(dt) {
        ctx.save();
        ctx.textAlign = 'center';
        for (const fl of floaters) {
            fl.life += dt;
            fl.y -= fl.vy * dt;
            ctx.globalAlpha = Math.min(1, Math.max(0, fl.y * 1.6));
            ctx.font = `${fl.size}px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.fillText(fl.e, fl.x * cw + Math.sin(fl.life * 3 + fl.wob) * 18, fl.y * ch);
        }
        ctx.restore();
        for (let i = floaters.length - 1; i >= 0; i--) {
            if (floaters[i].y < -0.1)
                floaters.splice(i, 1);
        }
    }

    function drawBanners(dt) {
        for (const b of banners) {
            b.t += dt;
            const k = b.t / b.dur;
            const scale = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4);
            ctx.save();
            ctx.globalAlpha = k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
            ctx.translate(cw / 2, ch * 0.42);
            ctx.scale(scale, scale);
            const size = Math.min(b.size, cw / Math.max(3, b.text.length) * 1.5);
            ctx.font = `900 italic ${size}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = Math.max(4, size / 14);
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(b.text, 0, 0);
            ctx.shadowColor = b.color;
            ctx.shadowBlur = 30;
            ctx.fillStyle = b.color;
            ctx.fillText(b.text, 0, 0);
            ctx.restore();
        }
        for (let i = banners.length - 1; i >= 0; i--) {
            if (banners[i].t >= banners[i].dur)
                banners.splice(i, 1);
        }
    }

    // ------------------------------------------------------------ side panels
    function setMode(m) {
        if (!m)
            return;
        if (m !== mode)
            plats = stage(m);
        mode = m;
        $('mKoth').classList.toggle('on', m === 'koth');
        $('mRumble').classList.toggle('on', m === 'rumble');
        const amHost = myId !== null && myId === hostId;
        for (const b of [$('mKoth'), $('mRumble')]) {
            b.disabled = !amHost;
            b.title = amHost ? b.title.replace(/ \(the host picks\)$/, '') : b.title.replace(/( \(the host picks\))?$/, ' (the host picks)');
        }
        $('modeLabel').textContent = amHost ? '👑 Mode' : 'Mode';
    }

    function drawQueue(s) {
        const q = s ? s.q : [];
        const list = $('qlist');
        list.textContent = '';
        const box = $('queue');
        box.querySelector('h3').textContent = mode === 'rumble' ? `All in: ${roster.size} fighters` : 'Next up';
        const names = mode === 'rumble' ? [...roster.keys()] : q;
        for (const id of names) {
            const p = roster.get(id);
            if (!p)
                continue;
            const li = document.createElement('li');
            li.textContent = `${p.name}${p.wins ? ' ★' + p.wins : ''}${id === myId ? ' (you)' : ''}`;
            li.style.color = p.color;
            list.appendChild(li);
        }
        if (!names.length) {
            const li = document.createElement('li');
            li.textContent = 'nobody yet';
            li.style.color = 'var(--dim)';
            list.appendChild(li);
        }
    }

    function drawVote(vote) {
        const el = $('vote');
        const mine = vote && vote.v.includes(myId);
        if (!vote) {
            el.classList.add('hidden');
            lastVote = null;
            return;
        }
        el.classList.remove('hidden');
        const key = vote.o.join();
        if (key !== lastVote) {
            lastVote = key;
            el.dataset.voted = '';
        }
        $('v0').textContent = `1 · ${HAZARDS[vote.o[0]]} (${vote.c[0]})`;
        $('v1').textContent = `2 · ${HAZARDS[vote.o[1]]} (${vote.c[1]})`;
        $('v0').disabled = $('v1').disabled = !mine || !!el.dataset.voted;
        $('vt').textContent = `${Math.ceil(vote.t)}s`;
        $('vbar').style.width = `${Math.max(0, vote.t / 5) * 100}%`;
        el.querySelector('.q').firstChild.textContent = mine ? 'Crowd vote: what happens next? ' : 'The crowd is voting… ';
    }

    function castVote(o) {
        const el = $('vote');
        if (el.classList.contains('hidden') || el.dataset.voted)
            return;
        el.dataset.voted = '1';
        sendMsg({t: 'vote', o});
    }

    // ------------------------------------------------------------ input
    const KEYS = {
        KeyA: IN.LEFT, ArrowLeft: IN.LEFT, KeyD: IN.RIGHT, ArrowRight: IN.RIGHT,
        KeyW: IN.UP | IN.JUMP, ArrowUp: IN.UP | IN.JUMP, Space: IN.JUMP, KeyS: IN.DOWN, ArrowDown: IN.DOWN,
        KeyJ: IN.LIGHT, KeyZ: IN.LIGHT, KeyK: IN.HEAVY, KeyX: IN.HEAVY, KeyL: IN.DASH, KeyC: IN.DASH,
    };
    const held = new Map();             // code -> bits
    let touchBits = 0, mouseBits = 0, aim = null, sentK = -1, sentAim = null;

    function bits() {
        let k = touchBits | mouseBits;
        for (const b of held.values())
            k |= b;
        return k;
    }

    function pushInput(force) {
        const k = bits();
        if (force || k !== sentK || aim !== sentAim) {
            sentK = k; sentAim = aim;
            sendMsg({t: 'in', k, aim: mouseBits ? aim : null});
        }
    }
    setInterval(() => pushInput(true), 250);   // a heartbeat, in case a message was lost

    window.addEventListener('keydown', e => {
        if (document.activeElement === $('name'))
            return;
        if (e.code in KEYS) {
            held.set(e.code, KEYS[e.code]);
            e.preventDefault();
            pushInput();
        } else if (/^Digit[5-8]$/.test(e.code)) {
            sendMsg({t: 'emoji', e: ['🔥', '💀', '🤡', '🚀'][+e.code.slice(5) - 5]});
        } else if (e.code === 'Digit1' || e.code === 'Digit2') {
            castVote(e.code === 'Digit1' ? 0 : 1);
        }
    });
    window.addEventListener('keyup', e => {
        if (held.delete(e.code))
            pushInput();
    });
    window.addEventListener('blur', () => {
        held.clear(); touchBits = 0; mouseBits = 0;
        pushInput();
    });

    // the mouse: a left click punches towards the pointer
    function myFighterScreen() {
        const v = view();
        const f = v && v.f.find(o => o.id === myId);
        if (!f)
            return null;
        const z = baseScale() * cam.z;
        return {x: cw / 2 + (f.x - cam.x) * z, y: ch / 2 + (f.y - 58 - cam.y) * z};
    }
    cv.addEventListener('mousemove', e => {
        const me = myFighterScreen();
        if (me)
            aim = Math.round(Math.atan2(e.clientY - me.y, e.clientX - me.x) * 100) / 100;
        if (mouseBits)
            pushInput();
    });
    cv.addEventListener('mousedown', e => {
        if (e.button !== 0 || myId === null)
            return;
        mouseBits = IN.LIGHT;
        pushInput();
    });
    window.addEventListener('mouseup', () => {
        if (mouseBits) {
            mouseBits = 0;
            pushInput();
        }
    });

    // touch: the on-screen pads, several fingers at once
    function isTouch() {
        if (new URLSearchParams(location.search).get('touch') === '1')
            return true;
        return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !window.matchMedia('(hover: hover)').matches;
    }

    for (const b of document.querySelectorAll('#touch button')) {
        const bit = +b.dataset.k;
        const down = e => {
            e.preventDefault();
            b.setPointerCapture?.(e.pointerId);
            touchBits |= bit; b.classList.add('down');
            pushInput();
        };
        const up = e => {
            e.preventDefault();
            touchBits &= ~bit; b.classList.remove('down');
            pushInput();
        };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('lostpointercapture', up);
    }

    // the crowd
    for (const b of document.querySelectorAll('#emojis button'))
        b.addEventListener('click', () => sendMsg({t: 'emoji', e: b.dataset.e}));
    $('v0').addEventListener('click', () => castVote(0));
    $('v1').addEventListener('click', () => castVote(1));
    for (const b of [$('mKoth'), $('mRumble')])
        b.addEventListener('click', () => sendMsg({t: 'mode', m: b.dataset.mode}));

    // ------------------------------------------------------------ joining
    function buildSwatches(colors) {
        const box = $('swatches');
        box.textContent = '';
        for (const c of colors) {
            const b = document.createElement('button');
            b.className = 'sw' + (c === myColor ? ' on' : '');
            b.style.background = c;
            b.style.color = c;
            b.title = c;
            b.addEventListener('click', () => {
                myColor = c;
                for (const o of box.children)
                    o.classList.toggle('on', o === b);
            });
            box.appendChild(b);
        }
    }

    function join() {
        Sfx.init();
        const name = $('name').value.trim() || `Fighter ${Math.floor(Math.random() * 90 + 10)}`;
        try {
            localStorage.setItem('sh-name', name);
            localStorage.setItem('sh-color', myColor);
        } catch { /* private window */ }
        sendMsg({t: 'join', name, color: myColor});
    }
    $('go').addEventListener('click', join);
    $('name').addEventListener('keydown', e => {
        if (e.key === 'Enter')
            join();
    });
    try {
        $('name').value = localStorage.getItem('sh-name') || '';
        myColor = localStorage.getItem('sh-color') || myColor;
    } catch { /* private window */ }

    // the join address and its QR code (drawn here: no internet needed)
    fetch('/info').then(r => r.json()).then(info => {
        $('url').textContent = info.main;
        const q = $('qr'), qc = q.getContext('2d'), n = info.qr.length, cell = Math.floor(164 / n);
        const off = Math.floor((180 - cell * n) / 2);
        qc.fillStyle = '#ffffff';
        qc.fillRect(0, 0, 180, 180);
        qc.fillStyle = '#0d1117';
        info.qr.forEach((row, r) => [...row].forEach((c, col) => {
            if (c === '1')
                qc.fillRect(off + col * cell, off + r * cell, cell, cell);
        }));
    }).catch(() => {});

    connect();
    // ?name=Ana joins straight away (handy for a second tab, or a test)
    const auto = new URLSearchParams(location.search).get('name');
    if (auto) {
        $('name').value = auto;
        const tryJoin = () => (ws && ws.readyState === 1 ? join() : setTimeout(tryJoin, 100));
        tryJoin();
    }
    requestAnimationFrame(frame);
})();
