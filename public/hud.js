// Stick Havoc: the page's own controls around the canvas. The command bar,
// the input feed, the wardrobe drawer, the match panels and the vote.
'use strict';
const Hud = (() => {
    const $ = id => document.getElementById(id);
    let send = () => {};
    let look = null;                  // {name, color, hat, trail}: what the wardrobe shows
    let options = null;               // the wardrobe's choices, from the server
    let voted = null;

    // ------------------------------------------------------------ the command bar
    const COMMANDS = {
        lobby: [['A / D', 'Move'], ['W / Space', 'Jump'], ['J', 'Punch combo'], ['K', 'Launcher'], ['L', 'Dash'],
            ['E', 'Use']],
        match: [['A / D', 'Move'], ['W / Space', 'Jump'], ['J', 'Punch combo'], ['K', 'Launcher'], ['L', 'Dash'],
            ['↓ + K', 'Dive (air)']],
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
            return b;
        });
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
        $('iMode').textContent = {koth: 'King of the Hill', rumble: 'Royal Rumble', bomb: 'Bomb Tag'}[s.mode] || '';
        $('iMap').textContent = Physics.MAPS[s.map] ? Physics.MAPS[s.map].name : '';
        const target = s.mode === 'koth' ? 5 : s.mode === 'rumble' ? 3 : 1;
        $('iRound').textContent = s.mode === 'bomb' ? 'Last one standing wins' :
            `Round ${s.round} · first to ${target} win${target > 1 ? 's' : ''}`;
        $('iEnd').classList.toggle('hidden', s.host !== myId);
        const list = $('bList');
        list.textContent = '';
        const wins = new Map(s.wins);
        let ids, title;
        if (s.mode === 'koth') {
            title = 'Next up'; ids = s.q;
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
            li.textContent = `${p.name}${wins.get(id) ? '  ' + '★'.repeat(Math.min(5, wins.get(id))) : ''}${id === myId ? ' (you)' : ''}`;
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
        setScene, feed, setOptions, openDrawer, closeDrawer, isDrawerOpen, match, vote, castVote, toast,
    };
})();
