// Stick Havoc: the browser side. Sends keys, draws the server's world at
// 60 fps (interpolated between its 30 Hz snapshots): the lobby or a match,
// with a moving camera, hit-stop, slow motion, particles and the crowd.
'use strict';
(() => {
    const {W, H, IN, HAZARDS, MAPS, MODES, drawRig, stage} = Physics;
    const $ = id => document.getElementById(id);
    const cv = $('game'), ctx = cv.getContext('2d');

    // ------------------------------------------------------------ state
    let ws = null, myId = null, hostId = null, choices = null, scene = 'lobby';
    let colors = [];                    // [[name, hex]] from the server
    let sparring = false;               // practice against the bot, simulated in this browser (spar.js)
    let sandbox = false;                // a 1P sandbox match is on (Esc goes back to the lobby)
    let solo = false;                   // this browser's player is in a 1P match (sandbox or arcade): R restarts
    let serverNear = null;              // the station the server says you stand at (kept through sparring)
    let roster = new Map();             // id -> {name, color, gear, wins, bot}
    let snaps = [];                     // [{at, s}] newest last
    let map = 'lobby', plats = stage('lobby');
    const particles = [], floaters = [], banners = [], ghosts = [];
    const heads = new Map(), shownHp = new Map(), flashes = new Map();
    const cam = {x: W / 2, y: H / 2, z: 1, shake: 0, kx: 0, ky: 0, flash: 0, slow: 0, slowX: 0, slowY: 0};
    let lastPhase = null, snapCount = 0;
    const params = new URLSearchParams(location.search);

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
            if (m.type === 's') {
                if (!sparring)
                    onSnapshot(m);
                else if (m.scene !== 'lobby' || m.starting !== null || m.ev.some(e => e.type === 'starting'))
                    endSpar(true);              // the host is starting a match: everyone in, now
                else
                    Object.assign(Lobby.state, {sel: m.sel, ready: m.ready, starting: m.starting});
            }
            else if (m.type === 'roster') {
                roster = new Map(m.list.map(p => [p.id, p]));
                hostId = m.host;
                Hud.setRoster(roster, myId);
            } else if (m.type === 'welcome') {
                myId = m.id;
                colors = m.colors;
                Hud.setOptions({colors: m.colors, hats: m.hats, trails: m.trails});
                choices = m.choices;
                Lobby.state.version = 'v' + m.version;
                $('ver').textContent = 'v' + m.version;
                restoreLook();
            } else if (m.type === 'near') {
                Lobby.state.near = serverNear = m.station;
                if (m.station)
                    Sfx.play('near');
            } else if (m.type === 'feedbackSaved' || m.type === 'feedbackRefused') {
                Hud.feedbackAnswer(m);
            } else if (m.type === 'colorAssigned') {   // the saved colour was taken: this one is yours now
                const named = (colors.find(c => c[1] === m.color) || ['a free colour'])[0];
                Hud.toast(`Notice: Saved color was taken, assigned ${named}!`, 5000);
                try {
                    const saved = JSON.parse(localStorage.getItem('sh-look') || '{}');
                    localStorage.setItem('sh-look', JSON.stringify(Object.assign(saved, {color: m.color})));
                } catch { /* private window */ }
            } else if (m.type === 'colorTaken') {
                Hud.toast(`That colour is ${m.by}'s: pick a free one`);
            } else if (m.type === 'full') {
                Hud.toast('The room is full', 6000);
            }
        };
        ws.onclose = () => {
            Hud.toast('Disconnected: is the host still running? Retrying…');
            setTimeout(connect, 1500);
        };
    }

    function sendMsg(m) {
        if (sparring && m.t === 'lobby')
            return endSpar(false);              // "Back to lobby" while practising: stop practising
        if (ws && ws.readyState === 1)
            ws.send(JSON.stringify(m));
    }
    Hud.init(sendMsg);

    // your look from last time (or ?name=), sent as soon as you arrive
    function restoreLook() {
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem('sh-look') || 'null');
        } catch { /* private window */ }
        const name = params.get('name') || (saved && saved.name);
        if (saved || name)
            sendMsg(Object.assign({t: 'look'}, saved || {}, {name: name || '', restore: true}));
    }

    function onSnapshot(s) {
        sandbox = !!s.sandbox && s.scene === 'match';
        solo = s.scene === 'match' && (sandbox || !!(s.arcade && s.arcade.player === myId));
        snaps.push({at: performance.now(), s});
        while (snaps.length > 8)
            snaps.shift();
        if (s.map !== map) {
            map = s.map;
            plats = stage(map);
            heads.clear();
        }
        s.pl.forEach((p, i) => {
            if (plats[i]) {
                plats[i].alive = !!p[0]; plats[i].breaking = p[1]; plats[i].load = p[2]; plats[i].hp = p[3];
                if (p[4] !== undefined) {         // (moving platforms move)
                    plats[i].x = p[4]; plats[i].y = p[5];
                }
            }
        });
        Object.assign(Lobby.state, {sel: s.sel, ready: s.ready, max: s.max, starting: s.starting, goals: s.goals,
            record: s.record, board: s.board || []});
        Hud.setScene(s.scene);
        if (s.scene === 'lobby' && scene !== 'lobby') {
            hidePodium();
            endCinema();
        }
        scene = s.scene;
        if (s.scene === 'lobby') {
            Hud.syncSettings(s.sel, myId === hostId);
        } else {
            Lobby.state.near = null;
            if (Hud.isDrawerOpen())
                Hud.closeDrawer();
            if (snapCount++ % 5 === 0)
                Hud.match(s, roster, myId);
            Hud.vote(s.vote, myId);
        }
        for (const ev of s.ev)
            onEvent(ev);
        phases(s);
    }

    function phases(s) {
        lastPhase = s.scene === 'lobby' ? 'lobby' : s.ph;   // (the countdown is the server's: see 'count')
    }

    // the countdown's banners cut in at once (no waiting behind another banner), so sight and sound agree
    function cue(text, color, dur, size) {
        banners.length = 0;
        banner(text, color, dur, size);
    }

    function info(id) {
        if (id < 0 && sparring)
            return Spar.botInfo();
        return roster.get(id) || {name: '?', color: '#e5e7eb', gear: {}};
    }
    const nameOf = id => info(id).name;
    const colorOf = id => info(id).color;

    // ------------------------------------------------------------ practice sparring
    function startSpar() {
        if (scene !== 'lobby' || sparring || myId === null)
            return;
        const me = roster.get(myId) || {};
        Spar.start(myId, {name: me.name || 'You', color: me.color || '#22d3ee', gear: me.gear || {}});
        sparring = true;
        snaps = [];
        sendMsg({t: 'in', k: 0});
        sendMsg({t: 'spar', on: true});
        Hud.closeDrawer();
        Hud.closeSettings();
        banner('PRACTICE', '#22d3ee', 1.2, 80);
        Hud.toast('Practice bot · B: Medium / Hard · Esc or P: back to the lobby', 4000);
        Sfx.play('warp');
    }

    function endSpar(warp) {
        if (!sparring)
            return;
        Spar.stop();
        sparring = false;
        snaps = [];
        sendMsg({t: 'spar', on: false});
        Lobby.state.near = serverNear;
        cam.flash = 0.8;
        Sfx.play('warp');
        if (warp) {                             // pulled into the host's match
            banner('MATCH STARTING', '#22d3ee', 1.2, 64);
            ring(W / 2, H / 2, '#22d3ee');
        }
    }

    function onEvent(ev) {
        switch (ev.type) {
        case 'hit': {
            const power = ev.heavy ? 1 : 0.35;
            burst(ev.x, ev.y, ev.color, ev.heavy ? 22 : 9, ev.heavy ? 900 : 480, ev.dx, ev.dy);
            cam.kx += ev.dx * 16 * power;            // a shove along the hit's direction
            cam.ky += ev.dy * 16 * power;
            cam.shake = Math.max(cam.shake, ev.heavy ? 10 : 3);
            if (ev.on === 0)
                flashes.set(0, performance.now());
            if (ev.on === myId)
                Touch.buzz(ev.heavy ? 40 : 15);
            Sfx.play(ev.kind === 'jab' || ev.kind === 'hook' ? 'light' : ev.kind === 'straight' ? 'straight' :
                ev.kind === 'beam' ? 'beam' : ev.kind === 'katana' ? 'slash' : ev.kind === 'laser' ? 'zap' : 'heavy');
            break;
        }
        case 'pop':
            Lobby.pop(ev);
            break;
        case 'colorClaimed':
            if (ev.id === myId)
                Sfx.play('claim');
            break;
        case 'kick':
            burst(ev.x, ev.y, '#e5e7eb', 8, 400);
            Sfx.play('kick');
            break;
        case 'lava':
            burst(ev.x, ev.y, '#fb923c', 18, 700, 0, -1);
            Sfx.play('sizzle');
            if (ev.id === myId)
                Touch.buzz(30);
            break;
        case 'hotWarn':
            Hud.toast('The floor turns to lava in 3 s: get airborne!');
            Sfx.play('beep');
            break;
        case 'hot':
            banner('FLOOR IS LAVA', '#fb923c', 1.4, 70);
            Sfx.play('hazard');
            break;
        case 'cool':
            Hud.toast('The floor has cooled');
            break;
        case 'tunnelWarn':
            Hud.toast('Tunnel ahead: duck (hold S)!');
            Sfx.play('beep');
            break;
        case 'callout':                          // PARRY!, COUNTER!, GUARD BREAK!, UPPERCUT!, THROW!, ...
            Lobby.pop({text: ev.text, x: ev.x, y: ev.y, big: true,
                color: /REVERSAL|BREAK/.test(ev.text) ? '#f43f5e' : /PARRY/.test(ev.text) ? '#22d3ee' : '#facc15'});
            if (/CLUTCH/.test(ev.text))
                banner('CLUTCH REVERSAL!', '#f43f5e', 1.4, 64);
            break;
        case 'combo':
            if (ev.by === myId || !fighterNow(myId))
                Hud.combo(ev.n, ev.dmg, ev.crit, colorOf(ev.by));
            if (ev.n === 3) {
                Sfx.play('bassdrop');
                const f = fighterNow(ev.on);
                if (f)
                    Lobby.pop({text: '3x COMBO!', x: f[1], y: f[2] - 160, big: true, color: '#facc15'});
            }
            break;
        case 'block':
            burst(ev.x, ev.y, '#93c5fd', 6, 260);
            Sfx.play('block');
            break;
        case 'parry':
            ring(ev.x, ev.y, '#22d3ee');
            Sfx.play('clash');
            break;
        case 'guardbreak':
            burst(ev.x, ev.y, '#f43f5e', 16, 600);
            cam.shake = Math.max(cam.shake, 12);
            Sfx.play('guardbreak');
            break;
        case 'crate':
            Sfx.play('crate');
            break;
        case 'pickup':
            if (ev.air) {                             // snatched out of the air: the parachute pops
                burst(ev.x, ev.y - 30, '#e5e7eb', 22, 420);
                ring(ev.x, ev.y - 30, '#f8fafc');
                Sfx.play('kick');
            }
            if (ev.id === myId) {
                Hud.toast(`${Weapons.KINDS[ev.kind].name}: J to use it, E to throw it`);
                Touch.buzz(20);
            }
            Sfx.play('pickup');
            break;
        case 'broke':
            if (ev.id === myId)
                Hud.toast(`Your ${Weapons.KINDS[ev.kind].name} is used up`);
            break;
        case 'bounce':
            Sfx.play('bounce');
            break;
        case 'host':
            Hud.toast(`👑 ${nameOf(ev.id)} is now Room Host`, 3500);
            break;
        case 'timeup':
            banner('TIME', '#e5e7eb', 1.2, 110);
            break;
        case 'stageClear':
            banner('STAGE CLEAR!', '#22d3ee', 2.4, 90);
            setTimeout(() => banner(`Time: ${ev.time}s  ·  next: ${ev.next}`, '#e5e7eb', 1.8, 34), 1200);
            Sfx.play('fight');
            break;
        case 'gameOver':
            banner('GAME OVER', '#f43f5e', 3, 100);
            setTimeout(() => banner(`Stage ${ev.stage} · beaten by ${ev.by}`, '#e5e7eb', 2, 32), 1400);
            break;
        case 'arcadeWin':
            banner('ARCADE CLEAR', '#facc15', 3.5, 96);
            setTimeout(() => banner(`Shadow Mehul is beaten · ${ev.time}s`, '#e5e7eb', 2.2, 32), 1400);
            break;
        case 'ko':
            ring(ev.x, ev.y, ev.color || '#f1f5f9');
            burst(ev.x, ev.y, ev.color || '#f1f5f9', 50, 1300);
            cam.shake = 28; cam.flash = 1; cam.slow = 0;
            startCinema();
            banner('K.O.!', '#f43f5e', 1.5, 150, 'spring');
            if (ev.id === myId)
                Touch.buzz(90);
            Sfx.play('ko');
            break;
        case 'clash':                             // the climax: 0.15x, the camera closes in on the two of them
            cam.slow = 2; cam.slowX = ev.x; cam.slowY = ev.y;
            Sfx.play('slowmo');
            break;
        case 'clashWin':                          // the first blow in: a gold starburst and a deep stinger
            starburst(ev.x, ev.y, '#facc15');
            ring(ev.x, ev.y, '#fde68a');
            burst(ev.x, ev.y, '#facc15', 40, 900);
            cam.slow = 0; cam.flash = 1; cam.shake = 30;
            Sfx.play('stinger');
            break;
        case 'clashEnd':
            cam.slow = 0;
            break;
        case 'wallbounce':
            burst(ev.x, ev.y, '#e5e7eb', 14, 600);
            cam.shake = Math.max(cam.shake, 10);
            Sfx.play('wallbounce');
            break;
        case 'pillar':
            dust(ev.x, ev.y, 40, '#94a3b8');
            cam.shake = Math.max(cam.shake, 14);
            Sfx.play('crumble');
            break;
        case 'bumper':
            ring(ev.x, ev.y, '#a78bfa');
            Sfx.play('bumper');
            break;
        case 'dash': {
            const gear = (roster.get(ev.id) || {}).gear || {};
            if (gear.trail === 'sparkle')
                burst(ev.x, ev.y - 50, colorOf(ev.id), 14, 260);
            else if (gear.trail === 'smoke')
                dust(ev.x, ev.y - 20, 12, '#334155');
            else
                dust(ev.x, ev.y, 5);
            Sfx.play(ev.cancel ? 'cancel' : 'dash');
            break;
        }
        case 'jump':
            if (ev.double)
                Sfx.play('jump');
            break;
        case 'walljump':
            burst(ev.x, ev.y, '#e5e7eb', 6, 300);
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
            Sfx.play(ev.kind === 'blaster' ? 'laser' : ev.kind === 'grab' ? 'grab' : 'swing');
            break;
        case 'crumble':
            dust(ev.x, ev.y, 30, '#fb923c');
            cam.shake = Math.max(cam.shake, 8);
            Sfx.play('crumble');
            break;
        case 'restore':
            Sfx.play('restore');
            break;
        case 'clang': case 'anvil':
            burst(ev.x, ev.y, '#94a3b8', 12, 500);
            cam.shake = Math.max(cam.shake, 8);
            Sfx.play(ev.type);
            break;
        case 'beep':
            Sfx.play('beep');
            break;
        case 'beam':
            cam.shake = Math.max(cam.shake, 6);
            Sfx.play('beamSweep');
            break;
        case 'bomb':
            Hud.toast(`${nameOf(ev.id)} has the bomb`);
            Sfx.play('ui');
            break;
        case 'bombpass':
            Sfx.play('pass');
            break;
        case 'tick':
            Sfx.play(ev.t <= 5 ? 'tickFast' : 'tick');
            break;
        case 'boom':
            ring(ev.x, ev.y, '#facc15');
            ring(ev.x, ev.y, '#f43f5e');
            burst(ev.x, ev.y, '#facc15', 70, 1500);
            dust(ev.x, ev.y, 30, '#475569');
            cam.shake = 40; cam.flash = 1;
            Sfx.play('boom');
            break;
        case 'emoji':
            // up the side gutters only: the middle of the arena stays clear
            floaters.push({e: ev.e, x: Math.random() < 0.5 ? 0.025 + Math.random() * 0.045 : 0.93 + Math.random() * 0.045,
                y: 0.98, vy: 0.22 + Math.random() * 0.06, wob: Math.random() * 6, size: 24 + Math.random() * 10, life: 0});
            Sfx.play('emoji');
            break;
        case 'vote':
            Sfx.play('vote');
            break;
        case 'hazard':
            banner(ev.name.toUpperCase(), '#facc15', 1.6, 56);
            Sfx.play('hazard');
            break;
        case 'hazardEnd':
            Hud.toast(`${HAZARDS[ev.hazard]} is over`);
            break;
        case 'match':
            cam.z = 0.7; cam.y = H * 0.8;        // a sweep in to the new stage
            Hud.toast(ev.name);
            break;
        case 'restart':
            Hud.toast('Round restarted');
            break;
        case 'getReady':                          // the stage is up; the server's 3, 2, 1 follows
            cue('GET READY', '#e5e7eb', 0.6, 64);
            break;
        case 'count':                             // one chime per server tick: 3, 2, 1, then FIGHT! and the gong
            if (ev.n > 0) {
                cue(String(ev.n), '#22d3ee', 0.9, 130);
                Sfx.play('count' + ev.n);
            } else {
                cue('FIGHT!', '#e5e7eb', 0.9, 110);
                Sfx.play('gong');
                cam.shake = Math.max(cam.shake, 14);
            }
            break;
        case 'roundEnd':                          // after the K.O. (banners take turns: no overlap)
            if (ev.champion) {
                setTimeout(() => showPodium(ev.champion, ev.stats), 2300);
            } else {
                banner(ev.winner ? `ROUND ${ev.round || ''} · ${nameOf(ev.winner).toUpperCase()}` : 'DRAW',
                    ev.winner ? colorOf(ev.winner) : '#e5e7eb', 1.6, 52);
            }
            break;
        case 'goal':
            for (let i = 0; i < 60; i++) {           // confetti
                const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 400 + Math.random() * 700;
                particles.push({k: 'pixel', x: ev.x, y: ev.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0,
                    max: 1.2 + Math.random() * 0.6, color: `hsl(${Math.random() * 360}, 90%, 62%)`, size: 6});
            }
            banner('GOAL!', '#facc15', 1.3, 110);
            Sfx.play('airhorn');
            Sfx.play('chime');
            for (let i = 0; i < 3; i++)                // fireworks over the net
                setTimeout(() => {
                    const fx = ev.x - 60 - Math.random() * 160, fy = ev.y - 160 - Math.random() * 120;
                    burst(fx, fy, `hsl(${Math.random() * 360}, 90%, 65%)`, 30, 520);
                    ring(fx, fy, '#fde68a');
                    Sfx.play('firework');
                }, 250 + i * 280);
            break;
        case 'climb':
            Lobby.pop({text: `CLIMB TIME: ${ev.t.toFixed(2)}s`, x: ev.x, y: ev.y - 120, big: true, color: '#facc15'});
            if (ev.id === myId)
                Hud.toast(`Parkour tower: ${ev.t.toFixed(2)} s`);
            for (let i = 0; i < 3; i++)                // gold fireworks over the finish
                setTimeout(() => {
                    const fx = ev.x + (Math.random() - 0.5) * 160, fy = ev.y - 120 - Math.random() * 60;
                    burst(fx, fy, '#facc15', 30, 520);
                    ring(fx, fy, '#fde68a');
                    Sfx.play('firework');
                }, i * 260);
            break;
        case 'record':
            Hud.toast(`New tower record: ${ev.t.toFixed(2)} s by ${ev.name}`, 3500);
            break;
        case 'climbReset':
            if (ev.id === myId)
                Hud.toast('Off the tower: the climb clock resets');
            break;
        case 'climbFull':
            if (ev.id === myId)
                Hud.toast('Four on the tower already: wait for one to finish or drop');
            break;
        case 'tech':
            dust(ev.x, ev.y, 10);
            Sfx.play('dash');
            break;
        case 'pound':
            ring(ev.x, ev.y - 10, '#e5e7eb');
            dust(ev.x, ev.y, 24);
            cam.shake = Math.max(cam.shake, 14);
            cam.ky += 10;
            Sfx.play('heavy');
            break;
        case 'mantle':
            Sfx.play('ledge');
            break;
        case 'lobby':
            banner('LOBBY', '#e5e7eb', 1.2, 54);
            break;
        }
    }

    // ------------------------------------------------------------ effects
    function burst(x, y, color, n, speed, dx = 0, dy = 0) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
            particles.push({k: 'spark', x, y, vx: Math.cos(a) * v + dx * speed * 0.6, vy: Math.sin(a) * v + dy * speed * 0.6,
                life: 0, max: 0.2 + Math.random() * 0.3, color, size: 1.5 + Math.random() * 2});
        }
    }

    function dust(x, y, n, color = '#475569') {
        for (let i = 0; i < n; i++) {
            particles.push({k: 'dust', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 240,
                vy: -Math.random() * 150, life: 0, max: 0.4 + Math.random() * 0.3, color, size: 4 + Math.random() * 5});
        }
    }

    function ring(x, y, color) {
        particles.push({k: 'ring', x, y, life: 0, max: 0.55, color, size: 10});
    }

    function starburst(x, y, color) {
        for (let i = 0; i < 24; i++)
            particles.push({k: 'ray', x, y, a: i / 24 * Math.PI * 2 + Math.random() * 0.1, life: 0, max: 0.5,
                color, size: i % 2 ? 2 : 4});
    }

    function banner(text, color, dur, size, style) {
        banners.push({text, color, dur, size, t: 0, style});
    }

    // the knockout's cinematic: letterbox bars slide in, the HUD steps aside
    const cinema = {on: false, t: 0, until: 0};
    function startCinema() {
        cinema.on = true;
        cinema.t = 0;
        cinema.until = performance.now() + 3200;
        document.body.classList.add('cinematic');
    }

    function endCinema() {
        cinema.on = false;
        document.body.classList.remove('cinematic');
    }

    // the winner's card: their figure in a victory loop, their name, the match in three numbers
    let podiumFor = null;
    function showPodium(id, stats) {
        const p = info(id);
        podiumFor = {id, p, t0: performance.now()};
        $('pName').textContent = p.name;
        $('pName').style.color = p.color;
        $('pName').style.textShadow = `0 0 18px ${p.color}`;
        $('pStats').innerHTML = stats ? `<span>Rounds <b>${stats.rounds}</b></span><span>Highest combo <b>${stats.combo} hits</b></span>` +
            `<span>Finishing move <b>${stats.finisher}</b></span>` : '';
        $('podium').classList.remove('hidden');
        requestAnimationFrame(() => $('podium').classList.add('show'));
        startCinema();                          // a lava or ring-out finish has no K.O. to start it
        cinema.until = Infinity;
        banners.length = 0;
        Sfx.play('fight');
    }

    function hidePodium() {
        if (!podiumFor)
            return;
        podiumFor = null;
        $('podium').classList.remove('show');
        setTimeout(() => $('podium').classList.add('hidden'), 300);
        endCinema();
    }

    function drawPodium() {
        if (!podiumFor)
            return;
        const c = $('podiumFig'), g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        g.setTransform(1.5, 0, 0, 1.5, 110 - 1.5 * 100, 0);
        const t = (performance.now() - podiumFor.t0) / 1000;
        drawRig(g, {x: 100, y: 128 + Math.abs(Math.sin(t * 3)) * -6, face: 1, st: 'victory', vx: 0, color: podiumFor.p.color,
            gear: podiumFor.p.gear || {}}, t, {eyes: (podiumFor.p.gear || {}).eyes});
        const s = snaps.length && snaps[snaps.length - 1].s;
        if (s && s.ph === 'end')
            $('pCount').textContent = `Returning to lobby in ${Math.max(1, Math.ceil(7.5 - s.pt))}s...`;
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
        if (a.s.map !== b.s.map)
            a = b;
        const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at)));
        const out = [];
        for (const fb of b.s.f) {
            const fa = a.s.f.find(f => f[0] === fb[0]) || fb;
            const lerp = i => fa[i] + (fb[i] - fa[i]) * k;
            const p = fb[0] === 0 ? {name: 'Dummy', color: '#94a3b8', gear: {}} : info(fb[0]);
            out.push({id: fb[0], x: lerp(1), y: lerp(2), vx: fb[3], vy: fb[4], face: fb[5], hp: fb[6], st: fb[7],
                ak: fb[8] || null, ap: fb[9], combo: fb[10], inv: fb[11], shield: fb[12],
                spin: fa[13] + (fb[13] - fa[13]) * k, ground: fb[14], aimY: fb[15], dummy: fb[0] === 0,
                name: p.name, color: p.color, gear: p.gear || {}, weapon: fb[16] || null, uses: fb[17], ghost: fb[18],
                climb: fb[19] >= 0 ? fa[19] + (fb[19] - fa[19]) * k : -1,
                bomb: !!(b.s.bomb && b.s.bomb.id === fb[0]), bombT: b.s.bomb ? b.s.bomb.t : 0});
        }
        return {s: b.s, f: out, an: b.s.an, cr: b.s.cr || [], sh: b.s.sh || []};
    }

    function fighterNow(id) {
        const v = snaps.length && snaps[snaps.length - 1].s;
        return v && v.f.find(f => f[0] === id);
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

    // world units to pixels: the whole room on a big screen; on a phone,
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
        if (sparring) {
            const s = Spar.frame(dt);
            if (s)
                onSnapshot(s);
        }
        const v = view();
        updateCamera(v, dt);
        draw(v, dt);
        requestAnimationFrame(frame);
    }

    function updateCamera(v, dt) {
        const base = baseScale();
        let tx = W / 2, ty = H / 2, tz = 1;
        const lobby = !v || v.s.scene === 'lobby';
        const fs = v ? v.f.filter(f => f.st !== 'ko' && !f.dummy) : [];
        const me = v && v.f.find(f => f.id === myId);
        if (cam.slow > 0) {                     // slow motion: close in on the clash
            cam.slow -= dt;
            tx = cam.slowX; ty = cam.slowY; tz = 1.75;
        } else if (lobby) {                     // the lobby: the whole room (around you on a phone)
            if (me) {
                tx = me.x; ty = me.y - 120;
            }
        } else if (fs.length) {
            const xs = fs.map(f => f.x), ys = fs.map(f => f.y - 50);
            if (v.s.lavaY !== null && v.s.lavaY !== undefined)
                ys.push(v.s.lavaY - 20);                // keep the rising lava in sight
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
            tz = Math.max(1, Math.min(1.35, Math.min(cw / ((x1 - x0 + 520) * base), ch / ((y1 - y0 + 420) * base))));
        }
        const k = 1 - Math.exp(-dt * (cam.slow > 0 ? 9 : 3.5));
        cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
        const halfW = cw / (2 * base * cam.z), halfH = ch / (2 * base * cam.z);
        cam.x = Math.max(Math.min(halfW, W / 2), Math.min(W - Math.min(halfW, W / 2), cam.x));
        cam.y = Math.max(Math.min(halfH, H / 2), Math.min(H - Math.min(halfH, H / 2), cam.y));
        const decay = Math.exp(-dt * 10);
        cam.shake *= decay; cam.kx *= decay; cam.ky *= decay;
        cam.flash = Math.max(0, cam.flash - dt * 5);
    }

    function draw(v, dt) {
        const z = baseScale() * cam.z;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0b0f17';
        ctx.fillRect(0, 0, cw, ch);
        const sx = (Math.random() - 0.5) * cam.shake + cam.kx, sy = (Math.random() - 0.5) * cam.shake + cam.ky;
        ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cw / 2 - cam.x * z + sx), dpr * (ch / 2 - cam.y * z + sy));
        const lobby = !v || v.s.scene === 'lobby';
        if (lobby)
            Lobby.back(ctx, clock);
        else
            drawBackdrop();
        drawPlatforms(v);
        if (v) {
            drawHazards(v.s);
            for (const [x, y] of v.an)
                drawAnvil(x, y);
            for (const [x, y, , landed] of v.cr)
                Weapons.drawCrate(ctx, x, y, landed, clock);
            if (v.s.ball && !v.s.ballOut)
                drawBall(v.s.ball);
            if (v.s.tunnel)
                drawTunnel(v.s.tunnel);
            for (const [x, y, kind, vx] of v.sh)
                Weapons.drawShot(ctx, kind, x, y, vx, clock);
            drawGhosts(dt);
            for (const f of v.f)
                drawFighter(f, v.s);
        }
        drawParticles(dt);
        if (lobby)
            Lobby.front(ctx, dt, v && v.f.find(f => f.id === myId), myId, hostId);
        Lobby.drawPops(ctx, dt);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (cam.slow > 0) {                     // slow motion: a dark vignette
            const g = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.2, cw / 2, ch / 2, ch * 0.75);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(2,6,23,0.7)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, cw, ch);
        }
        if (cam.flash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${cam.flash * 0.45})`;
            ctx.fillRect(0, 0, cw, ch);
        }
        if (cinema.on && performance.now() > cinema.until && !podiumFor)
            endCinema();
        if (v && !lobby && !cinema.on)
            drawHud(v);
        if (cinema.on || cinema.t > 0) {            // the letterbox: 36 px bars sliding in and out
            cinema.t = Math.max(0, Math.min(1, cinema.t + (cinema.on ? dt : -dt) * 4));
            const bar = 36 * cinema.t;
            ctx.fillStyle = '#05070b';
            ctx.fillRect(0, 0, cw, bar);
            ctx.fillRect(0, ch - bar, cw, bar);
        }
        drawPodium();
        if (lobby && v)
            drawClimbClock(v);
        drawSpeedLines(v);
        drawFloaters(dt);
        drawBanners(dt);
    }

    function drawBackdrop() {
        ctx.fillStyle = '#0d1320';
        ctx.fillRect(-200, -200, W + 400, H + 400);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
        ctx.beginPath();
        for (let x = 0; x <= W; x += 80) {
            ctx.moveTo(x, -200); ctx.lineTo(x, H + 200);
        }
        for (let y = -160; y <= H + 160; y += 80) {
            ctx.moveTo(-200, y); ctx.lineTo(W + 200, y);
        }
        ctx.stroke();
        if (MAPS[map] && MAPS[map].pit) {               // the drop: a fade into darkness
            const g = ctx.createLinearGradient(0, H - 120, 0, H + 200);
            g.addColorStop(0, 'rgba(11,15,23,0)');
            g.addColorStop(1, 'rgba(2,6,23,1)');
            ctx.fillStyle = g;
            ctx.fillRect(-200, H - 120, W + 400, 320);
        }
        const bumpers = MAPS[map] && MAPS[map].bumpers;  // the side walls, or the asteroid's bumpers
        ctx.save();
        ctx.lineWidth = bumpers ? 6 : 2;
        ctx.strokeStyle = bumpers ? 'rgba(167, 139, 250, 0.8)' : 'rgba(148, 163, 184, 0.35)';
        ctx.beginPath();
        ctx.moveTo(3, -200); ctx.lineTo(3, H + 200);
        ctx.moveTo(W - 3, -200); ctx.lineTo(W - 3, H + 200);
        ctx.stroke();
        if (bumpers) {
            ctx.fillStyle = 'rgba(167, 139, 250, 0.6)';
            for (let y = 140; y < 820; y += 60) {
                for (const [x, d] of [[12, 1], [W - 12, -1]]) {
                    ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x + d * 10, y); ctx.lineTo(x, y + 8); ctx.fill();
                }
            }
        }
        ctx.restore();
    }

    function drawPlatforms(v) {
        const reactorWarn = v && v.s.beam && v.s.beam.ph === 'warn' && Math.floor(clock * 6) % 2;
        for (const p of plats) {
            if (!p.alive) {
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
                ctx.setLineDash([6, 8]);
                ctx.lineWidth = 1;
                ctx.strokeRect(p.x, p.y, p.w, Math.min(p.h, 20));
                ctx.setLineDash([]);
                continue;
            }
            const jx = p.breaking ? (Math.random() - 0.5) * 5 : 0;
            if (p.solid) {                               // a stone pillar, cracking as it's hit
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(p.x, p.y, p.w, p.h);
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
                ctx.lineWidth = 2;
                ctx.strokeRect(p.x, p.y, p.w, p.h);
                ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
                ctx.fillRect(p.x - 6, p.y, p.w + 12, 12);
                ctx.strokeStyle = 'rgba(11, 15, 23, 0.9)';
                for (let c = 0; c < (p.maxHp || 3) - (p.hp || 0); c++) {
                    const cy = p.y + 50 + c * 70;
                    ctx.beginPath(); ctx.moveTo(p.x + 8, cy); ctx.lineTo(p.x + 30, cy + 22); ctx.lineTo(p.x + 22, cy + 40);
                    ctx.lineTo(p.x + p.w - 6, cy + 58); ctx.stroke();
                }
                continue;
            }
            const col = p.breaking ? '#f43f5e' : p.crumble ? '#fb923c' : p.floor ? '#22d3ee' : '#94a3b8';
            ctx.fillStyle = '#111827';
            ctx.fillRect(p.x + jx, p.y, p.w, p.floor ? 100 : p.h);
            if (p.floor && reactorWarn) {               // the reactor's warning stripes over the floor
                ctx.save();
                ctx.beginPath(); ctx.rect(0, p.y - 130, W, 130); ctx.clip();
                ctx.fillStyle = 'rgba(244, 63, 94, 0.18)';
                for (let x = -130; x < W; x += 60) {
                    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x + 30, p.y); ctx.lineTo(x + 160, p.y - 130);
                    ctx.lineTo(x + 130, p.y - 130); ctx.fill();
                }
                ctx.restore();
            }
            ctx.save();
            ctx.shadowColor = col;
            ctx.shadowBlur = p.floor ? 10 : 6;
            ctx.strokeStyle = col;
            ctx.lineWidth = p.floor ? 2 : 3;
            ctx.beginPath();
            ctx.moveTo(p.x + jx, p.y); ctx.lineTo(p.x + p.w + jx, p.y);
            ctx.stroke();
            ctx.restore();
            if (p.crumble && p.load > 0) {              // how close the bridge is to giving way
                ctx.fillStyle = 'rgba(251, 146, 60, 0.5)';
                ctx.fillRect(p.x, p.y + p.h - 3, p.w * Math.min(1, p.load), 3);
            }
        }
    }

    function drawBall([x, y]) {
        ctx.save();
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {                // panel lines, turning as it rolls
            const a = x / 18 + i * Math.PI * 2 / 5;
            ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawTunnel(t) {
        const roof = plats[0].y;
        if (t.warn) {
            ctx.fillStyle = Math.floor(clock * 6) % 2 ? 'rgba(250, 204, 21, 0.9)' : 'rgba(250, 204, 21, 0.3)';
            ctx.beginPath(); ctx.arc(W - 30, roof - 160, 10, 0, Math.PI * 2); ctx.fill();
        }
        if (t.x !== null) {                           // the tunnel mouth: a bar at head height
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(t.x - 24, -200, 48, roof - 140 + 200);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(t.x - 24, roof - 150, 48, 10);
        }
    }

    function drawHazards(s) {
        if (s.lavaY !== null && s.lavaY !== undefined) {   // the foundry's molten pool
            const g = ctx.createLinearGradient(0, s.lavaY - 30, 0, s.lavaY + 120);
            g.addColorStop(0, 'rgba(251, 146, 60, 0)');
            g.addColorStop(0.25, 'rgba(249, 115, 22, 0.85)');
            g.addColorStop(1, 'rgba(127, 29, 29, 1)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(-200, H + 300);
            for (let x = -200; x <= W + 200; x += 40)
                ctx.lineTo(x, s.lavaY + Math.sin(x / 60 + clock * 3) * 6);
            ctx.lineTo(W + 200, H + 300);
            ctx.fill();
        }
        if (s.heat && s.heat.hot > 0) {               // Floor Is Lava: every platform glows
            ctx.save();
            ctx.shadowColor = '#f97316';
            ctx.shadowBlur = 18;
            ctx.fillStyle = 'rgba(249, 115, 22, 0.75)';
            for (const p of plats)
                if (p.alive) ctx.fillRect(p.x, p.y - 4, p.w, 8);
            ctx.restore();
        }
        if (s.beam && s.beam.ph === 'sweep') {          // the reactor beam
            const x = s.beam.x, top = MAPS[map].beam.top - 40;
            const g = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
            g.addColorStop(0, 'rgba(244,63,94,0)');
            g.addColorStop(0.5, 'rgba(244,63,94,0.85)');
            g.addColorStop(1, 'rgba(244,63,94,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - 40, top, 80, 820 - top);
            ctx.fillStyle = '#fecdd3';
            ctx.fillRect(x - 2, top, 4, 820 - top);
        }
    }

    function drawAnvil(x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.moveTo(-26, -18); ctx.lineTo(30, -18); ctx.lineTo(18, -6); ctx.lineTo(10, -6); ctx.lineTo(14, 14);
        ctx.lineTo(-14, 14); ctx.lineTo(-10, -6); ctx.lineTo(-20, -6); ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawFighter(f, s) {
        const gear = f.gear || {};
        const fast = Math.abs(f.vx) > 700 || f.st === 'dash' || f.ak === 'airkick' || f.ak === 'dive';
        if (fast && (gear.trail || 'ghost') === 'ghost')
            ghosts.push({f: Object.assign({}, f), life: 0});
        else if (fast && gear.trail === 'sparkle' && Math.random() < 0.6)
            particles.push({k: 'spark', x: f.x, y: f.y - 30 - Math.random() * 50, vx: -f.vx * 0.1, vy: -60, life: 0,
                max: 0.35, color: f.color, size: 2});
        else if (fast && gear.trail === 'smoke' && Math.random() < 0.7)
            particles.push({k: 'dust', x: f.x, y: f.y - 20 - Math.random() * 40, vx: -f.vx * 0.05, vy: -40, life: 0,
                max: 0.5, color: '#1e293b', size: 8});
        const flash = f.dummy && performance.now() - (flashes.get(0) || 0) < 90;
        if (fast && gear.trail === 'rainbow')
            for (let i = 0; i < 2; i++)
                particles.push({k: 'spark', x: f.x - f.face * i * 6, y: f.y - 20 - Math.random() * 60, vx: -f.vx * 0.15,
                    vy: 0, life: 0, max: 0.4, color: `hsl(${(clock * 400 + i * 60) % 360}, 90%, 65%)`, size: 3});
        else if (fast && gear.trail === 'pixel' && Math.random() < 0.8)
            particles.push({k: 'pixel', x: f.x + (Math.random() - 0.5) * 20, y: f.y - Math.random() * 80, vx: -f.vx * 0.05,
                vy: -30, life: 0, max: 0.5, color: f.color, size: 5});
        if (f.ghost && f.st !== 'ko') {                 // in the wardrobe or sparring: a see-through ghost
            ctx.save();
            ctx.globalAlpha = 0.35 + 0.15 * Math.sin(clock * 5);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(f.x, f.y - 48, 34, 58, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }
        const isHost = f.id === hostId && s.scene === 'lobby';
        if (isHost && f.st !== 'ko') {                    // the room host: a lit ring at their feet
            ctx.save();
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 12;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(f.x, f.y + 2, 30 + Math.sin(clock * 3) * 2, 7, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }
        const head = drawRig(ctx, f, clock, {gloves: s.hz === 'gloves', flash, eyes: gear.eyes, alpha: f.ghost ? 0.45 : 1});
        if (gear.hat === 'bandana')
            drawRibbons(f, head);
        if (f.st === 'ko' || f.dummy)
            return;
        // the name tag (in the Royal Rumble with a small health bar)
        ctx.save();
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = f.id === myId ? '#f1f5f9' : 'rgba(226, 232, 240, 0.7)';
        const ty = f.y - (gear.hat === 'kasa' || gear.hat === 'crown' ? 140 : 128) - (f.bomb ? 30 : 0);
        ctx.fillText(f.name, f.x, ty);
        if (isHost) {                                     // 👑 ROOM HOST, lit, over the name
            ctx.font = '800 11px system-ui, sans-serif';
            const w = ctx.measureText('👑 ROOM HOST').width + 14;
            ctx.fillStyle = 'rgba(250, 204, 21, 0.16)';
            ctx.fillRect(f.x - w / 2, ty - 34, w, 18);
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
            ctx.lineWidth = 1;
            ctx.strokeRect(f.x - w / 2, ty - 34, w, 18);
            ctx.fillStyle = '#facc15';
            ctx.fillText('👑 ROOM HOST', f.x, ty - 21);
            ctx.font = '600 14px system-ui, sans-serif';
        } else if (f.id === hostId) {
            ctx.fillText('👑', f.x - ctx.measureText(f.name).width / 2 - 12, ty);
        }
        if (f.climb >= 0) {                               // on the tower: this climber's own clock, over their head
            const text = `${f.name}: ${f.climb.toFixed(2)}s`;
            ctx.font = '700 11px ui-monospace, monospace';
            const w = ctx.measureText(text).width + 14, cy = ty - (f.id === hostId ? 58 : 36);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
            ctx.fillRect(f.x - w / 2, cy, w, 18);
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
            ctx.lineWidth = 1;
            ctx.strokeRect(f.x - w / 2, cy, w, 18);
            ctx.fillStyle = '#e5e7eb';
            ctx.fillText(text, f.x, cy + 13);
            ctx.font = '600 14px system-ui, sans-serif';
        }
        if (f.weapon) {                                   // what's in hand, and how much is left
            ctx.font = '700 11px system-ui, sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(`${Weapons.KINDS[f.weapon].name.toUpperCase()} ${'●'.repeat(f.uses || 0)}`, f.x, ty + 30);
        }
        if (s.scene === 'match' && s.mode === 'rumble') {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
            ctx.fillRect(f.x - 28, ty + 6, 56, 4);
            ctx.fillStyle = f.color;
            ctx.fillRect(f.x - 28, ty + 6, 56 * Math.max(0, f.hp) / 100, 4);
        }
        if (f.bomb) {
            ctx.font = '700 13px ui-monospace, monospace';
            ctx.fillStyle = f.bombT < 5 ? '#f43f5e' : '#facc15';
            ctx.fillText(`${Math.max(0, f.bombT).toFixed(1)}s`, f.x, f.y - 128);
        }
        if (f.id === myId) {
            ctx.fillStyle = '#f1f5f9';
            ctx.beginPath();
            ctx.moveTo(f.x - 5, ty + 14); ctx.lineTo(f.x + 5, ty + 14); ctx.lineTo(f.x, ty + 20);
            ctx.fill();
        }
        ctx.restore();
    }

    // the bandana's two tails, trailing the head's recent path
    function drawRibbons(f, head) {
        let trail = heads.get(f.id);
        if (!trail) {
            trail = [];
            heads.set(f.id, trail);
        }
        trail.unshift({x: head.x, y: head.y});
        if (trail.length > 12)
            trail.pop();
        const pts = [{x: trail[0].x - f.face * 9, y: trail[0].y - 5}];
        for (let i = 1; i < trail.length; i++) {
            const prev = pts[i - 1];
            let dx = trail[i].x - f.face * (9 + i * 2.4) - prev.x, dy = trail[i].y - 5 + i * 1.2 - prev.y;
            const len = Math.hypot(dx, dy);
            if (len > 7) {                       // each segment at most 7 long: no streak across the arena
                dx = dx / len * 7; dy = dy / len * 7;
            }
            pts.push({x: prev.x + dx, y: prev.y + dy});
        }
        ctx.save();
        ctx.strokeStyle = '#f1f5f9';
        ctx.globalAlpha = 0.8;
        ctx.lineCap = 'round';
        for (const off of [0, 5]) {
            ctx.lineWidth = 2.6 - off * 0.2;
            ctx.beginPath();
            pts.forEach((p, i) => {
                const sway = Math.sin(clock * 9 + i * 0.7 + off) * i * 0.5;
                i ? ctx.lineTo(p.x, p.y + off * 0.5 + sway) : ctx.moveTo(p.x, p.y);
            });
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawGhosts(dt) {
        for (const g of ghosts) {
            g.life += dt;
            drawRig(ctx, g.f, clock, {alpha: Math.max(0, 0.3 - g.life * 1.5), noGlow: true});
        }
        for (let i = ghosts.length - 1; i >= 0; i--) {
            if (ghosts[i].life > 0.2)
                ghosts.splice(i, 1);
        }
    }

    function drawParticles(dt) {
        ctx.save();
        for (const p of particles) {
            p.life += dt;
            const a = Math.max(0, 1 - p.life / p.max);
            if (p.k === 'ray') {                      // a starburst ray: a spoke shooting out from the centre
                const r0 = 30 + p.life * 1400, r1 = r0 + 60 + p.size * 30;
                ctx.strokeStyle = p.color;
                ctx.globalAlpha = a;
                ctx.lineWidth = p.size * a + 1;
                ctx.beginPath();
                ctx.moveTo(p.x + Math.cos(p.a) * r0, p.y + Math.sin(p.a) * r0);
                ctx.lineTo(p.x + Math.cos(p.a) * r1, p.y + Math.sin(p.a) * r1);
                ctx.stroke();
                continue;
            }
            if (p.k === 'ring') {
                ctx.strokeStyle = p.color;
                ctx.globalAlpha = a * 0.8;
                ctx.lineWidth = 4 * a + 1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 20 + p.life * 900, 0, Math.PI * 2);
                ctx.stroke();
                continue;
            }
            p.vy += (p.k === 'dust' ? 260 : 900) * dt;
            p.vx *= Math.exp(-dt * (p.k === 'dust' ? 4 : 2));
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.k === 'pixel') {                    // pixel dust: little squares
                ctx.globalAlpha = a;
                ctx.fillStyle = p.color;
                ctx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, p.size, p.size);
                continue;
            }
            if (p.k === 'spark') {
                ctx.globalAlpha = a;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = p.size;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
                ctx.stroke();
            } else {
                ctx.globalAlpha = a * 0.35;
                ctx.fillStyle = p.color;
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
        const font = (wt, px) => `${wt} ${px}px system-ui, sans-serif`;
        if ((s.mode === 'koth' || s.mode === 'arcade' || s.mode === 'spar') && s.act.length) {   // the two fighters' health across the top
            const barW = Math.min(340, cw * 0.34), y = 18;
            s.act.slice(0, 2).forEach((id, i) => {
                const f = v.f.find(o => o.id === id);
                const p = info(id);
                const hp = f ? Math.max(0, f.hp) : 0;
                const shown = shownHp.get(id) ?? hp;
                shownHp.set(id, shown + (hp - shown) * 0.1);
                const x = i === 0 ? cw / 2 - 36 - barW : cw / 2 + 36;
                ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
                ctx.fillRect(x - 2, y - 2, barW + 4, 14);
                ctx.fillStyle = 'rgba(244, 63, 94, 0.5)';         // what was just lost, draining
                const lag = shownHp.get(id) / 100 * barW;
                ctx.fillRect(i === 0 ? x + barW - lag : x, y, lag, 10);
                ctx.fillStyle = p.color;
                const w = hp / 100 * barW;
                ctx.fillRect(i === 0 ? x + barW - w : x, y, w, 10);
                ctx.font = font(600, 14);
                ctx.textAlign = i === 0 ? 'right' : 'left';
                ctx.fillStyle = '#e5e7eb';
                ctx.fillText(p.name, i === 0 ? x + barW : x, y + 30);
            });
            ctx.font = font(800, 14);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('VS', cw / 2, 28);
        } else if (s.mode === 'rumble') {
            ctx.font = font(700, 14);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#e5e7eb';
            ctx.fillText(`${v.f.filter(f => f.st !== 'ko').length} LEFT`, cw / 2, 30);
        } else if (s.mode === 'bomb' && s.bomb) {
            ctx.font = font(700, 15);
            ctx.textAlign = 'center';
            ctx.fillStyle = s.bomb.t < 5 ? '#f43f5e' : '#facc15';
            ctx.fillText(`BOMB · ${nameOf(s.bomb.id)} · ${Math.max(0, s.bomb.t).toFixed(1)}s`, cw / 2, 30);
        }
        if (s.mode === 'arcade' && s.arcade) {
            ctx.font = font(700, 12);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(`ARCADE · STAGE ${s.arcade.stage} / ${s.arcade.of} · ${s.arcade.t}s`, cw / 2, 62);
        }
        if (s.tl !== null && s.tl !== undefined && s.ph === 'fight') {
            ctx.font = font(800, 22);
            ctx.textAlign = 'center';
            ctx.fillStyle = s.tl <= 10 ? '#f43f5e' : '#e5e7eb';
            ctx.fillText(String(s.tl), cw / 2, s.mode === 'koth' || s.mode === 'arcade' ? 54 : 56);
        }
        if (s.hz) {
            ctx.font = font(600, 13);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#facc15';
            ctx.fillText(`${HAZARDS[s.hz]} · ${Math.ceil(s.hzT)}s`, cw / 2, 62);
        }
        if (s.beam && s.beam.ph === 'warn') {
            ctx.font = font(700, 14);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#f43f5e';
            ctx.fillText('BEAM INCOMING: GET OFF THE FLOOR', cw / 2, 84);
        }
        if (s.ph === 'waiting') {
            ctx.font = font(600, 17);
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
            ctx.fillText('Waiting for a second player…', cw / 2, ch * 0.3);
        }
    }

    // the parkour clock, top right, while you're on the tower
    function drawClimbClock(v) {
        const me = v.s.f.find(f => f[0] === myId);
        if (!me || !(me[19] >= 0))
            return;
        ctx.save();
        ctx.font = '700 15px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'right';
        const text = `CLIMB: ${me[19].toFixed(2)}s`, w = ctx.measureText(text).width + 22;
        ctx.fillStyle = 'rgba(17, 24, 39, 0.9)';
        ctx.fillRect(cw - 16 - w, 58, w, 30);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
        ctx.strokeRect(cw - 16 - w, 58, w, 30);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillText(text, cw - 27, 78);
        ctx.restore();
    }

    // dashing fast: streaks along the screen's edges
    function drawSpeedLines(v) {
        const me = v && v.f.find(f => f.id === myId);
        if (!me || !(me.st === 'dash' || Math.abs(me.vx) > 800))
            return;
        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
            const y = (i * 97 + clock * 900) % ch, len = 60 + (i * 37) % 120;
            const x = i % 2 ? (clock * 1400 * -me.face + i * 211) % (cw * 0.12) : cw - ((clock * 1400 + i * 173) % (cw * 0.12));
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - me.face * len, y); ctx.stroke();
        }
        ctx.restore();
    }

    function drawFloaters(dt) {
        ctx.save();
        ctx.textAlign = 'center';
        for (const fl of floaters) {
            fl.life += dt;
            fl.y -= fl.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - fl.life / 2);          // gone after 2 s
            ctx.font = `${fl.size}px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.fillText(fl.e, fl.x * cw + Math.sin(fl.life * 4 + fl.wob) * 8, fl.y * ch);
        }
        ctx.restore();
        for (let i = floaters.length - 1; i >= 0; i--) {
            if (floaters[i].life > 2)
                floaters.splice(i, 1);
        }
    }

    function drawBanners(dt) {
        // one at a time, in order: the K.O., then the round, never on top of each other
        for (const b of banners.slice(0, 1)) {
            b.t += dt;
            const k = b.t / b.dur;
            const scale = b.style === 'spring' ? 1 + 0.5 * Math.exp(-7 * b.t) * Math.cos(16 * b.t) :
                k < 0.12 ? 0.85 + (k / 0.12) * 0.15 : 1;
            ctx.save();
            ctx.globalAlpha = k < 0.12 ? k / 0.12 : k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
            ctx.translate(cw / 2, ch * 0.4);
            ctx.scale(scale, scale);
            const size = Math.min(b.size, cw / Math.max(3, b.text.length) * 1.4);
            ctx.font = `800 ${size}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = b.style === 'spring' ? 'rgba(0, 0, 0, 0.85)' : 'rgba(11, 15, 23, 0.55)';
            ctx.fillText(b.text, b.style === 'spring' ? 6 : 3, b.style === 'spring' ? 8 : 4);   // a sharp drop shadow
            ctx.fillStyle = b.color;
            ctx.fillText(b.text, 0, 0);
            ctx.restore();
        }
        for (let i = banners.length - 1; i >= 0; i--) {
            if (banners[i].t >= banners[i].dur)
                banners.splice(i, 1);
        }
    }

    // ------------------------------------------------------------ input
    Keys.load(localStorage);              // (keys.js: the bindings, the player's own if they've changed them)
    const held = new Map();
    let touchBits = 0, mouseBits = 0, aim = null, sentK = -1, sentAim = null;

    function bits() {
        let k = touchBits | mouseBits;
        for (const b of held.values())
            k |= b;
        return k;
    }

    function pushInput(force) {
        const k = Hud.isDrawerOpen() || Hud.isSettingsOpen() || Hud.isControlsOpen() || Hud.isSoloOpen() ||
            Hud.isFeedbackOpen() ? 0 : bits();
        if (sparring)
            return Spar.input(k, mouseBits ? aim : null);
        if (force || k !== sentK || aim !== sentAim) {
            sentK = k; sentAim = aim;
            sendMsg({t: 'in', k, aim: mouseBits ? aim : null});
        }
    }
    setInterval(() => pushInput(true), 250);   // a heartbeat, in case a message was lost

    // the input feed: what you just pressed, in the game's words
    function feedFor(bit) {
        const k = bits();
        const me = fighterNow(myId), air = me && !me[14];
        const up = k & IN.UP, down = k & IN.DOWN;
        const J = Keys.first('punch'), K = Keys.first('launcher');
        if (bit & IN.LIGHT)
            return up && !air ? `↑ + ${J}  LAUNCH` : `${J}  PUNCH`;
        if (bit & IN.HEAVY)
            return air ? (down ? `↓ + ${K}  DIVE` : `${K}  AIR KICK`) : `${K}  LAUNCHER`;
        if (bit & IN.DASH)
            return `${Keys.first('dash')}  DASH`;
        if (bit & IN.GRAB)
            return `${Keys.first('grab')}  GRAB`;
        if (bit & IN.USE)
            return `${Keys.first('use')}  WEAPON`;
        if (bit & IN.JUMP)
            return 'JUMP';
        if (bit & IN.LEFT)
            return '←';
        if (bit & IN.RIGHT)
            return '→';
        if (bit & IN.DOWN)
            return air ? '↓' : '↓  GUARD';
        return null;
    }

    // E: the station you stand at (the wardrobe, or the host's console)
    function interact() {
        const near = Lobby.state.near;
        if (near === 'dojo') {
            startSpar();
        } else if (near === 'wardrobe') {
            const me = roster.get(myId) || {};
            sendMsg({t: 'ghost', on: true});         // untouchable while customizing
            Hud.openDrawer({name: me.name || '', color: me.color, hat: (me.gear || {}).hat || null,
                trail: (me.gear || {}).trail || 'ghost'});
            held.clear();
            pushInput();
        } else if (near === 'console') {         // the match settings: the host edits, everyone can read
            Hud.openSettings(Lobby.state.sel, myId === hostId, choices);
            held.clear();
            pushInput();
        }
    }

    window.addEventListener('keydown', e => {
        if (Hud.isControlsOpen())               // (the Controls window is listening for a key)
            return;
        if (Hud.isFeedbackOpen()) {             // typing a note: the keys are the note's, not the fighter's
            if (e.code === 'Escape')
                Hud.closeFeedback();
            return;
        }
        if (Hud.isDrawerOpen()) {
            if (e.code === 'Escape' || Keys.is(e.code, 'use'))
                Hud.closeDrawer();
            return;
        }
        if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
            Hud.toggleMoves();                  // (held keys stay held: walking and attacks go on)
            return;
        }
        if (sparring && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
            endSpar(false);
            return;
        }
        if (sparring && e.code === 'KeyB' && !e.repeat) {
            Hud.toast(`Practice bot: ${Spar.toggle()}`);
            return;
        }
        if (e.code === 'Escape') {
            const menu = Hud.isSettingsOpen() || Hud.isSoloOpen() ||
                !document.getElementById('moves').classList.contains('hidden');
            Hud.toggleMoves(false);
            Hud.closeSettings();
            Hud.closeSolo();
            if (sandbox && !menu && !e.repeat)     // nothing to close: Esc leaves the sandbox
                sendMsg({t: 'lobby'});
            return;
        }
        if (Hud.isSettingsOpen()) {
            if (Keys.is(e.code, 'use'))
                Hud.closeSettings();
            else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && myId === hostId) {
                sendMsg({t: 'console', do: 'start'});
                Hud.closeSettings();
            }
            return;
        }
        if (e.code === 'KeyP' && scene === 'lobby' && !e.repeat) {
            if (Lobby.state.near === 'console' && myId === hostId)
                Hud.openSolo();                  // the host at the console: 1P Solo
            else
                startSpar();                     // anyone else, anywhere: practice against the bot
            return;
        }
        if (e.code === 'KeyR' && scene === 'match' && solo && !e.repeat) {   // 1P: the round again, now
            sendMsg({t: 'restart'});
            return;
        }
        if (Keys.is(e.code, 'use') && (scene === 'match' || sparring)) {   // in a match, E picks up / throws a weapon
            e.preventDefault();
            if (!e.repeat) {
                held.set(e.code, IN.USE);
                Hud.feed('E  WEAPON');
                pushInput();
            }
            return;
        }
        if (Keys.bits(e.code) && !Keys.is(e.code, 'use')) {
            e.preventDefault();
            if (!e.repeat) {
                held.set(e.code, Keys.bits(e.code));
                const label = feedFor(Keys.bits(e.code));
                if (label)
                    Hud.feed(label);
            }
            pushInput();
        } else if (Keys.is(e.code, 'use') && !e.repeat) {
            interact();
        } else if ((e.code === 'KeyQ' || e.code === 'Tab') && Lobby.state.near === 'console') {
            e.preventDefault();
            if (myId === hostId) {
                sendMsg({t: 'console', do: e.code === 'KeyQ' ? 'mode' : 'map'});
                Sfx.play('ui');
            }
        } else if (/^Digit[5-8]$/.test(e.code)) {
            sendMsg({t: 'emoji', e: ['🔥', '💀', '🤡', '🚀'][+e.code.slice(5) - 5]});
        } else if (e.code === 'Digit1' || e.code === 'Digit2') {
            Hud.castVote(e.code === 'Digit1' ? 0 : 1);
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
    function myScreenPos() {
        const v = view();
        const f = v && v.f.find(o => o.id === myId);
        if (!f)
            return null;
        const z = baseScale() * cam.z;
        return {x: cw / 2 + (f.x - cam.x) * z, y: ch / 2 + (f.y - 58 - cam.y) * z};
    }
    cv.addEventListener('mousemove', e => {
        const me = myScreenPos();
        if (me)
            aim = Math.round(Math.atan2(e.clientY - me.y, e.clientX - me.x) * 100) / 100;
        if (mouseBits)
            pushInput();
    });
    cv.addEventListener('mousedown', e => {
        if (e.button !== 0 || myId === null || Hud.isDrawerOpen())
            return;
        mouseBits = IN.LIGHT;
        Hud.feed('CLICK  PUNCH');
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
        if (params.get('touch') === '1')
            return true;
        return window.matchMedia('(pointer: coarse)').matches;
    }
    if (isTouch()) {
        $('touch').classList.remove('hidden');
        document.body.classList.add('touch');
        Touch.init({
            bits(bit, on) {
                touchBits = on ? touchBits | bit : touchBits & ~bit;
                pushInput();
            },
            use() {                                  // E: a station in the lobby; a weapon in a match
                if (scene === 'lobby')
                    return interact();
                touchBits |= IN.USE;
                pushInput();
                setTimeout(() => {
                    touchBits &= ~IN.USE;
                    pushInput();
                }, 120);
            },
        });
    }
    // the first touch or key unlocks audio (browsers need a gesture)
    for (const ev of ['pointerdown', 'keydown'])
        window.addEventListener(ev, () => Sfx.init(), {once: true});

    connect();
    requestAnimationFrame(frame);
})();
