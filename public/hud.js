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
    // (the keys shown are the player's own bindings: keys.js)
    function commands(scene) {
        const k = Keys.first;
        const fight = [[`${k('left')} / ${k('right')}`, 'Move'], [k('jump'), 'Jump'], [k('punch'), 'Punch'],
            [k('launcher'), 'Launcher'], [k('guard'), 'Guard'], [k('grab'), 'Grab'], [k('dash'), 'Dash']];
        return scene === 'lobby' ? [...fight, [k('use'), 'Use'], ['P', 'Spar'], ['Shift', 'Moves']] :
            [...fight, [k('use'), 'Weapon']];
    }
    let shownScene = null;

    function setScene(scene, force) {
        if (scene === shownScene && !force)
            return;
        shownScene = scene;
        const bar = $('commands');
        bar.textContent = '';
        for (const [key, what] of commands(scene)) {
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
        $('sSolo').classList.toggle('hidden', !isHost);
        settingsAlone = isAlone(isHost);
        if (isSoloOpen())
            renderSolo();
    }

    // the snapshot's settings changed (the host clicked): redraw what everyone sees
    function syncSettings(sel, isHost) {
        if (isSettingsOpen() && (JSON.stringify(sel) !== settingsSel || isHost !== settingsHost ||
            isAlone(isHost) !== settingsAlone))
            renderSettings(sel, isHost);
        else if (isSoloOpen() && isAlone(isHost) === $('oSandbox').disabled)
            renderSolo();              // (someone joined or left: the sandbox is only for one)
    }

    function closeSettings() {
        $('settings').classList.remove('open');
    }

    const isSettingsOpen = () => $('settings').classList.contains('open');
    $('sStart').addEventListener('click', () => {
        send({t: 'console', do: 'start'});
        closeSettings();
    });
    $('sSolo').addEventListener('click', () => openSolo());

    // ------------------------------------------------------------ feedback & bugs
    let fbKind = 'bug';
    const isFeedbackOpen = () => !$('feedback').classList.contains('hidden');

    function openFeedback() {
        $('feedback').classList.remove('hidden');
        $('fbNote').textContent = '';
        $('fbText').focus();
        Sfx.play('open');
    }

    function closeFeedback() {
        $('feedback').classList.add('hidden');
        $('fbText').blur();
    }

    // the server's answer
    function feedbackAnswer(m) {
        if (m.type === 'feedbackSaved') {
            $('fbText').value = '';
            closeFeedback();
            toast('Thanks: saved on the host\'s computer');
        } else {
            $('fbNote').textContent = m.why;
        }
    }
    for (const b of document.querySelectorAll('#fbKinds button')) {
        b.addEventListener('click', () => {
            fbKind = b.dataset.k;
            for (const o of document.querySelectorAll('#fbKinds button'))
                o.classList.toggle('on', o === b);
        });
    }
    $('fbBtn').addEventListener('click', openFeedback);
    $('fbCancel').addEventListener('click', closeFeedback);
    $('fbSend').addEventListener('click', () => {
        const text = $('fbText').value.trim();
        if (!text)
            return ($('fbNote').textContent = 'Write something first.');
        $('fbNote').textContent = 'Sending…';
        send({t: 'feedback', category: fbKind, text});
    });

    // ------------------------------------------------------------ 1P Solo: the arcade ladder, or a sandbox
    const SOLO = {
        map: ['Map', null],
        mode: ['Mode', {duel: '1v1 Duel', rumble: 'FFA vs bots', bomb: 'Bomb Tag', lava: 'Floor Is Lava'}],
        bots: ['Bots', {1: '1', 2: '2', 3: '3'}],
        level: ['Difficulty', {easy: 'Easy', medium: 'Medium', hard: 'Hard', demon: 'Demon'}],
        crates: ['Weapons', {off: 'Off', normal: 'On', frequent: 'Frequent'}],
        target: ['Match', {3: 'First to 3', 5: 'First to 5', 7: 'First to 7'}],
    };
    const LEVELS = {easy: 'casual, slow to react', medium: 'strings and combos', hard: 'guards, parries and techs',
        demon: 'frame-perfect juggles and parries'};
    const solo = {map: 'rooftops', mode: 'duel', bots: 3, level: 'medium', crates: 'normal', target: 3};
    const isSoloOpen = () => !$('solo').classList.contains('hidden');

    function renderSolo() {
        const rows = $('oRows');
        rows.textContent = '';
        for (const [key, [title, names]] of Object.entries(SOLO)) {
            const values = key === 'map' ? Physics.ARENAS : Object.keys(names).map(v => key === 'bots' || key === 'target' ? +v : v);
            const nameOf = v => key === 'map' ? Physics.MAPS[v].name.replace(/^The /, '') : names[v];
            const row = optionRow(title, values, nameOf, key === 'bots' && solo.mode === 'duel' ? 1 : solo[key],
                key === 'bots' && solo.mode === 'duel', value => {
                    solo[key] = value;
                    renderSolo();
                });
            rows.appendChild(row);
        }
        const alone = isAlone(true);
        $('oSandbox').disabled = !alone;
        $('oNote').textContent = alone ? `Any arena, any mode, against bots (${solo.level}: ${LEVELS[solo.level]}). ` +
            'R restarts the round; Esc leaves.' : 'For when you are the only one in the room.';
    }

    function openSolo() {
        closeSettings();
        renderSolo();
        $('solo').classList.remove('hidden');
        Sfx.play('open');
    }

    function closeSolo() {
        $('solo').classList.add('hidden');
    }
    $('oClose').addEventListener('click', closeSolo);
    $('oArcade').addEventListener('click', () => {
        send({t: 'arcade'});
        closeSolo();
    });
    $('oSandbox').addEventListener('click', () => {
        send(Object.assign({t: 'sandbox'}, solo, {bots: solo.mode === 'duel' ? 1 : solo.bots}));
        closeSolo();
    });
    $('sClose').addEventListener('click', closeSettings);

    // ------------------------------------------------------------ the move list
    // ------------------------------------------------------------ the controls: rebinding the keys
    let listening = null;             // {id, i}: the key slot waiting for a key press
    const isControlsOpen = () => !$('controls').classList.contains('hidden');

    function renderControls(note) {
        const rows = $('cRows');
        rows.textContent = '';
        for (const [id, title] of Keys.ACTIONS) {
            const row = document.createElement('div');
            row.className = 'row';
            const label = document.createElement('span');
            label.textContent = title;
            const keys = document.createElement('div');
            keys.className = 'keys';
            const slot = (text, i, cls) => {
                const b = document.createElement('button');
                b.textContent = listening && listening.id === id && listening.i === i ? '…' : text;
                b.className = listening && listening.id === id && listening.i === i ? 'listen' : cls || '';
                b.title = cls === 'add' ? 'Add a key' : 'Click, then press the new key';
                b.addEventListener('click', () => {
                    listening = {id, i};
                    renderControls();
                });
                return b;
            };
            Keys.binds[id].forEach((code, i) => {
                const b = slot(Keys.label(code), i);
                b.addEventListener('contextmenu', e => {      // right-click: remove (an action keeps at least one)
                    e.preventDefault();
                    Keys.unbind(id, code);
                    saveKeys();
                });
                keys.appendChild(b);
            });
            if (Keys.binds[id].length < Keys.MAX)
                keys.appendChild(slot('+', Keys.binds[id].length, 'add'));
            row.append(label, keys);
            rows.appendChild(row);
        }
        $('cNote').textContent = note || '';
    }

    function saveKeys(note) {
        Keys.save(localStorage);
        setScene(shownScene, true);
        renderControls(note);
    }

    function openControls() {
        listening = null;
        renderControls();
        $('controls').classList.remove('hidden');
        Sfx.play('open');
    }

    function closeControls() {
        listening = null;
        $('controls').classList.add('hidden');
    }

    // the key press that rebinds (taken before the game sees it)
    window.addEventListener('keydown', e => {
        if (!isControlsOpen())
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!listening) {
            if (e.code === 'Escape')
                closeControls();
            return;
        }
        if (e.code === 'Escape') {
            listening = null;
            return renderControls();
        }
        const {id, i} = listening;
        listening = null;
        if (Keys.bind(id, e.code, i)) {
            Sfx.play('ui');
            saveKeys();
        } else {
            renderControls(Keys.RESERVED.includes(e.code) ? `${Keys.label(e.code)} is kept for the game's own menus.` :
                `${Keys.label(e.code)} is the only key for another action: give that one a new key first.`);
        }
    }, true);
    $('keysBtn').addEventListener('click', openControls);
    $('cDone').addEventListener('click', closeControls);
    $('cReset').addEventListener('click', () => {
        Keys.reset();
        saveKeys('Back to the default keys.');
    });

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
        openSettings, syncSettings, closeSettings, isSettingsOpen, toggleMoves, combo, isControlsOpen, openControls,
        openSolo, closeSolo, isSoloOpen, isFeedbackOpen, closeFeedback, feedbackAnswer,
    };
})();
