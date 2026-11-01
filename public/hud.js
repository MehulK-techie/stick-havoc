// Stick Havoc: the page's own controls around the canvas. The command bar,
// the input feed, the wardrobe drawer, the match panels and the vote.
'use strict';
const Hud = (() => {
    const $ = id => document.getElementById(id);
    let send = () => {};
    let look = null;                  // {name, color, hat, trail}: what the wardrobe shows
    let rosterNow = new Map(), meId = null;   // who holds which colour (each colour: one player)
    let options = null;               // the wardrobe's choices, from the server
    let voted = null;

    // ------------------------------------------------------------ the command bar
    const COMMANDS = {
        lobby: [['A / D', 'Move'], ['W', 'Jump'], ['J', 'Punch'], ['K', 'Launcher'], ['S', 'Guard'], ['G', 'Grab'],
            ['L', 'Dash'], ['E', 'Use'], ['P', 'Spar'], ['Shift', 'Moves']],
        match: [['A / D', 'Move'], ['W', 'Jump'], ['J', 'Punch'], ['K', 'Launcher'], ['S', 'Guard'], ['G', 'Grab'],
            ['L', 'Dash'], ['E', 'Weapon']],
    };
    let shownScene = null;

    function setScene(scene) {
        if (scene === shownScene)
            return;
        shownScene = scene;
        const bar = $('commands');
        bar.textContent = '';
        for (const [key, what] of COMMANDS[scene]) {
            const el = document.createElement('div');
            el.className = 'cmd';
            const k = document.createElement('b');
            k.textContent = key;
            el.append(k, what.toUpperCase());
            bar.appendChild(el);
        }
        for (const id of ['info', 'board', 'emojis'])
            $(id).classList.toggle('hidden', scene !== 'match');
        document.body.classList.toggle('in-match', scene === 'match');
        if (scene !== 'lobby')
            closeSettings();
        if (scene !== 'match')
            $('vote').classList.add('hidden');
    }

    // ------------------------------------------------------------ the input feed
    // the last four things you pressed, each fading after 1.5 s
    function feed(text) {
        const box = $('feed');
        const el = document.createElement('div');
        el.className = 'in';
        el.textContent = text;
        box.prepend(el);
        while (box.children.length > 4)
            box.lastChild.remove();
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 420);
        }, 1500);
    }

    // ------------------------------------------------------------ the wardrobe
    function setOptions(o) {
        options = o;
    }

    function openDrawer(current) {
        if (!options)
            return;
        look = Object.assign({}, current);
        $('dName').value = look.name;
        const fill = (box, items, key, make) => {
            box.textContent = '';
            for (const [value, label] of items) {
                const b = make(value, label);
                b.classList.toggle('on', look[key] === value);
                b.addEventListener('click', () => {
                    look[key] = value;
                    for (const o of box.children)
                        o.classList.toggle('on', o === b);
                    push();
                    Sfx.play('ui');
                });
                box.appendChild(b);
            }
        };
        fill($('dColors'), options.colors.map(([n, c]) => [c, n]), 'color', (c, n) => {
            const b = document.createElement('button');
            b.className = 'sw';
            b.style.background = c;
            b.title = n;
            b.dataset.color = c;
            return b;
        });
        lockColors();
        const chip = (_v, label) => {
            const b = document.createElement('button');
            b.textContent = label;
            return b;
        };
        fill($('dHats'), [[null, 'None'], ...Object.entries(options.hats)], 'hat', chip);
        fill($('dTrails'), Object.entries(options.trails), 'trail', chip);
        $('drawer').classList.add('open');
        Sfx.play('open');
    }

    // colours someone else wears: locked, with their initial on the swatch
    function lockColors() {
        const owners = new Map([...rosterNow.values()].filter(p => !p.bot && p.id !== meId).map(p => [p.color, p.name]));
        for (const b of $('dColors').children) {
            const who = owners.get(b.dataset.color);
            b.disabled = !!who;
            b.classList.toggle('taken', !!who);
            b.textContent = who ? who.trim()[0].toUpperCase() : '';
            b.title = who ? `Taken by ${who}` : b.title.replace(/^Taken by .*/, b.dataset.color);
        }
    }

    function setRoster(roster, myId) {
        rosterNow = roster;
        meId = myId;
        if (isDrawerOpen())
            lockColors();
    }

    function push() {
        send({t: 'look', name: $('dName').value.trim(), color: look.color, hat: look.hat, trail: look.trail});
        try {
            localStorage.setItem('sh-look', JSON.stringify(Object.assign({}, look, {name: $('dName').value.trim()})));
        } catch { /* private window */ }
    }

    function closeDrawer() {
        if (!isDrawerOpen())
            return;
        $('dName').blur();
        $('drawer').classList.remove('open');
        push();
        send({t: 'ghost', on: false});        // out of the wardrobe: solid again
    }

    const isDrawerOpen = () => $('drawer').classList.contains('open');
    $('dDone').addEventListener('click', closeDrawer);
    $('dName').addEventListener('change', push);
    $('dName').addEventListener('keydown', e => {
        e.stopPropagation();          // typing a name doesn't move your fighter
        if (e.key === 'Enter' || e.key === 'Escape')
            closeDrawer();
    });

    // ------------------------------------------------------------ the match panels
    function match(s, roster, myId) {
        $('iMode').textContent = {koth: 'King of the Hill', rumble: 'Royal Rumble', bomb: 'Bomb Tag',
            arcade: '1P Arcade', lava: 'Floor Is Lava', spar: 'Practice'}[s.mode] || '';
        $('iMap').textContent = Physics.MAPS[s.map] ? Physics.MAPS[s.map].name : '';
        $('iRound').textContent = s.spar ? `Bot: ${s.spar} · B switches · Esc leaves` :
            s.arcade ? `Stage ${s.arcade.stage} of ${s.arcade.of} · ${s.arcade.t}s` :
            `Round ${s.round} · first to ${s.target}${s.tl !== null ? ` · ${s.tl}s left` : ''}`;
        $('iEnd').classList.toggle('hidden', s.host !== myId && s.mode !== 'spar');
        const list = $('bList');
        list.textContent = '';
        const wins = new Map(s.wins);
        let ids, title;
        if (s.mode === 'koth') {                // the queue, ranked: who's fighting, who's next
            title = 'Queue'; ids = [...s.act, ...s.q];
        } else if (s.mode === 'bomb') {
            title = 'Still in'; ids = s.f.filter(f => f[7] !== 'ko').map(f => f[0]);
        } else {
            title = 'Wins'; ids = [...roster.keys()].sort((a, b) => (wins.get(b) || 0) - (wins.get(a) || 0));
        }
        $('bTitle').textContent = title;
        for (const id of ids) {
            const p = roster.get(id);
            if (!p)
                continue;
            const li = document.createElement('li');
            const rank = s.mode === 'koth' ? `#${list.children.length + 1} ${list.children.length < s.act.length ? 'Fighting' :
                list.children.length === s.act.length ? 'Next' : 'Waiting'} · ` : '';
            li.textContent = `${rank}${p.name}${wins.get(id) ? '  ' + '★'.repeat(Math.min(5, wins.get(id))) : ''}${id === myId ? ' (you)' : ''}`;
            li.style.color = p.color;
            list.appendChild(li);
        }
        if (!list.children.length) {
            const li = document.createElement('li');
            li.textContent = 'nobody';
            li.style.color = 'var(--dim)';
            list.appendChild(li);
        }
    }

    function vote(v, myId) {
        const el = $('vote');
        if (!v) {
            el.classList.add('hidden');
            voted = null;
            return;
        }
        el.classList.remove('hidden');
        const key = v.o.join();
        const mine = v.v.includes(myId);
        const names = Physics.HAZARDS;
        $('vq').textContent = mine ? 'Crowd vote: what happens next?' : 'The crowd is voting';
        $('v0').textContent = `1 · ${names[v.o[0]]}  ${v.c[0]}`;
        $('v1').textContent = `2 · ${names[v.o[1]]}  ${v.c[1]}`;
        $('v0').disabled = $('v1').disabled = !mine || voted === key;
        $('vt').textContent = `${Math.ceil(v.t)}s`;
        $('vbar').style.width = `${Math.max(0, v.t / 5) * 100}%`;
        el.dataset.key = key;
    }

    function castVote(o) {
        const el = $('vote');
        if (el.classList.contains('hidden') || voted === el.dataset.key)
            return;
        voted = el.dataset.key;
        send({t: 'vote', o});
    }
    $('v0').addEventListener('click', () => castVote(0));
    $('v1').addEventListener('click', () => castVote(1));
    for (const b of document.querySelectorAll('#emojis button'))
        b.addEventListener('click', () => send({t: 'emoji', e: b.dataset.e}));
    $('iEnd').addEventListener('click', () => send({t: 'lobby'}));

    // ------------------------------------------------------------ the match settings (host console)
    const LABELS = {
        mode: ['Game mode', {koth: 'King of the Hill', rumble: 'Royal Rumble', bomb: 'Bomb Tag', lava: 'Floor Is Lava',
            random: 'Random', shuffle: 'Banger Shuffle'}],
        target: ['Match', {3: 'First to 3', 5: 'First to 5', 7: 'First to 7'}],
        timer: ['Round timer', {45: '45 s', 60: '60 s', 90: '90 s', 0: '∞'}],
        weapons: ['Weapons', {true: 'On', false: 'Off'}],
        limit: ['Player limit', null],
        map: ['Map', null],
    };
    let choices = null, settingsHost = false, settingsSel = null, settingsAlone = false;
    // the 1P sandbox's own picks (only the one person in the room sees them; the map and length come from above)
    const SOLO = {
        mode: ['Mode', {duel: '1v1 Duel', rumble: 'FFA · 3 bots', bomb: 'Bomb Tag', lava: 'Floor Is Lava'}],
        level: ['Bots', {easy: 'Easy', normal: 'Normal', hard: 'Hard'}],
        crates: ['Weapon crates', {off: 'Off', normal: 'Normal', frequent: 'Frequent'}],
    };
    const solo = {mode: 'duel', level: 'normal', crates: 'normal'};

    const isAlone = isHost => !!(isHost && typeof Lobby !== 'undefined' && Lobby.state.ready === 1);

    // a settings row: a label, and a button per choice with the current one lit
    function optionRow(title, values, nameOf, current, disabled, onPick) {
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = title;
        const opts = document.createElement('div');
        opts.className = 'opts';
        for (const value of values) {
            const b = document.createElement('button');
            b.textContent = nameOf(value);
            b.classList.toggle('on', current === value);
            b.disabled = disabled;
            b.addEventListener('click', () => {
                onPick(value);
                Sfx.play('ui');
            });
            opts.appendChild(b);
        }
        row.append(label, opts);
        return row;
    }

    function openSettings(sel, isHost, ch) {
        choices = ch;
        renderSettings(sel, isHost);
        $('settings').classList.add('open');
        Sfx.play('open');
    }

    function renderSettings(sel, isHost) {
        if (!choices)
            return;
        settingsHost = isHost;
        settingsSel = JSON.stringify(sel);
        $('sNote').textContent = isHost ? 'You are the room host: every change shows on everyone\'s screen.' :
            'Waiting for Host to start...';
        $('sStart').classList.toggle('hidden', !isHost);
        $('sArcade').classList.toggle('hidden', !isHost);
        const rows = $('sRows');
        rows.textContent = '';
        for (const [key, [title, names]] of Object.entries(LABELS)) {
            const nameOf = value => names ? names[value] : key === 'map' ? (value === 'random' ? 'Random' :
                value === 'shuffle' ? 'Banger Shuffle' : Physics.MAPS[value].name.replace(/^The /, '')) : String(value);
            rows.appendChild(optionRow(title, choices[key], nameOf, sel[key], !isHost,
                value => send({t: 'settings', key, value})));
        }
        // alone in the room: the sandbox, against bots, on any map
        const alone = isAlone(isHost);
        settingsAlone = alone;
        $('sSolo').classList.toggle('hidden', !alone);
        const soloRows = $('sSoloRows');
        soloRows.textContent = '';
        for (const [key, [title, names]] of Object.entries(SOLO)) {
            soloRows.appendChild(optionRow(title, Object.keys(names), v => names[v], solo[key], false, value => {
                solo[key] = value;
                renderSettings(sel, isHost);
            }));
        }
    }

    // the snapshot's settings changed (the host clicked): redraw what everyone sees
    function syncSettings(sel, isHost) {
        if (isSettingsOpen() && (JSON.stringify(sel) !== settingsSel || isHost !== settingsHost ||
            isAlone(isHost) !== settingsAlone))
            renderSettings(sel, isHost);
    }

    function closeSettings() {
        $('settings').classList.remove('open');
    }

    const isSettingsOpen = () => $('settings').classList.contains('open');
    $('sStart').addEventListener('click', () => {
        send({t: 'console', do: 'start'});
        closeSettings();
    });
    $('sArcade').addEventListener('click', () => {
        send({t: 'arcade'});
        closeSettings();
    });
    $('sSandbox').addEventListener('click', () => {
        const sel = JSON.parse(settingsSel || '{}');
        send(Object.assign({t: 'sandbox', map: sel.map, target: sel.target}, solo));
        closeSettings();
    });
    $('sClose').addEventListener('click', closeSettings);

    // ------------------------------------------------------------ the move list
    const toggleMoves = force => $('moves').classList.toggle('hidden', force === undefined ? undefined : !force);
    $('movesBtn').addEventListener('click', () => toggleMoves());
    $('moves').addEventListener('click', () => toggleMoves(false));

    // ------------------------------------------------------------ the combo counter
    let comboTimer = 0;
    function combo(n, dmg, crit, color) {
        const el = $('combo');
        el.innerHTML = `<div class="n" style="color:${color}">${n}<small>HITS</small></div>` +
            `<div class="d">${dmg} DMG${crit ? ' · <span class="crit">CRITICAL!</span>' : ''}</div>`;
        el.classList.remove('hidden');
        el.style.opacity = '1';
        clearTimeout(comboTimer);
        comboTimer = setTimeout(() => {
            el.style.opacity = '0';
        }, 1600);
    }

    let toastTimer = 0;
    function toast(text, ms = 2600) {
        const el = $('toast');
        el.textContent = text;
        el.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
    }

    return {
        init(sender) { send = sender; },
        setScene, feed, setOptions, openDrawer, closeDrawer, isDrawerOpen, match, vote, castVote, toast, setRoster,
        openSettings, syncSettings, closeSettings, isSettingsOpen, toggleMoves, combo,
    };
})();
