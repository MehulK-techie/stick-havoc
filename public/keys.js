// Stick Havoc: which key does what. Defaults below; players can rebind them
// (the Controls window), and the choice is kept in this browser.
// Works as a CommonJS module (Node, for the tests) and as window.Keys (browser).
(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./physics.js') : root.Physics);
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Keys = api;
})(typeof self !== 'undefined' ? self : this, function (Physics) {
    'use strict';
    const IN = Physics.IN;
    const STORE = 'stick_havoc_keys';
    // [id, label, input bits, default keys]
    const ACTIONS = [
        ['left', 'Move left', IN.LEFT, ['KeyA', 'ArrowLeft']],
        ['right', 'Move right', IN.RIGHT, ['KeyD', 'ArrowRight']],
        ['jump', 'Jump', IN.JUMP | IN.UP, ['KeyW', 'Space', 'ArrowUp']],
        ['punch', 'Punch / combo', IN.LIGHT, ['KeyJ', 'KeyZ']],
        ['launcher', 'Launcher', IN.HEAVY, ['KeyK', 'KeyX']],
        ['guard', 'Guard', IN.DOWN, ['KeyS', 'ArrowDown']],
        ['grab', 'Grab', IN.GRAB, ['KeyG']],
        ['dash', 'Dash', IN.DASH, ['KeyL', 'KeyC']],
        ['use', 'Interact / weapon', IN.USE, ['KeyE']],
        ['rage', 'Rage Art', IN.RAGE, ['KeyV']],
    ];
    const MAX = 3;                    // keys per action
    // keys the game keeps for itself: menus, the move list, sparring, the console, emojis and votes
    const RESERVED = ['Escape', 'ShiftLeft', 'ShiftRight', 'Enter', 'NumpadEnter', 'Tab', 'KeyP', 'KeyO', 'KeyB', 'KeyQ',
        'KeyR', 'Minus', ...[0, 1, 2, 5, 6, 7, 8, 9].map(n => 'Digit' + n)];
    const defaults = () => Object.fromEntries(ACTIONS.map(([id, , , keys]) => [id, keys.slice()]));
    let binds = defaults();

    function load(storage) {
        binds = defaults();
        try {
            const saved = JSON.parse(storage.getItem(STORE) || 'null');
            for (const [id] of ACTIONS) {
                const keys = saved && saved[id];
                if (Array.isArray(keys) && keys.length && keys.every(k => typeof k === 'string' && !RESERVED.includes(k)))
                    binds[id] = keys.slice(0, MAX);
            }
        } catch { /* nothing saved, or a private window: the defaults */ }
        return binds;
    }

    function save(storage) {
        try {
            storage.setItem(STORE, JSON.stringify(binds));
        } catch { /* private window: this session only */ }
    }

    // what a key presses: the input bits (Space jumps without also meaning "up", as it always has)
    function bits(code) {
        let k = 0;
        for (const [id, , b] of ACTIONS) {
            if (binds[id].includes(code))
                k |= id === 'jump' && code === 'Space' ? IN.JUMP : b;
        }
        return k;
    }

    const is = (code, id) => binds[id].includes(code);

    // put a key on an action (in slot i, or a new slot): it leaves whatever action had it before.
    // False if the game keeps that key for itself.
    function bind(id, code, i) {
        if (RESERVED.includes(code) || !binds[id])
            return false;
        for (const other of Object.keys(binds)) {
            if (other !== id && binds[other].includes(code) && binds[other].length > 1)
                binds[other] = binds[other].filter(k => k !== code);
            else if (other !== id && binds[other].includes(code))
                return false;         // (it's that action's only key: rebind that one first)
        }
        const keys = binds[id].filter(k => k !== code);
        if (i !== undefined && i < keys.length)
            keys[i] = code;
        else if (keys.length < MAX)
            keys.push(code);
        else
            keys[MAX - 1] = code;
        binds[id] = keys;
        return true;
    }

    function unbind(id, code) {
        if (binds[id] && binds[id].length > 1)
            binds[id] = binds[id].filter(k => k !== code);
    }

    function reset() {
        binds = defaults();
    }

    // a key's name as printed on the keyboard
    function label(code) {
        const named = {Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backquote: '`',
            Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
            Comma: ',', Period: '.', Slash: '/', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt',
            AltRight: 'Alt', Backspace: '⌫', CapsLock: 'Caps'};
        if (named[code])
            return named[code];
        if (/^Key[A-Z]$/.test(code) || /^Digit\d$/.test(code))
            return code.slice(-1);
        if (/^Numpad/.test(code))
            return 'Num ' + code.slice(6);
        return code;
    }

    const first = id => label(binds[id][0]);

    return {ACTIONS, MAX, RESERVED, load, save, bits, is, bind, unbind, reset, label, first,
        get binds() { return binds; }};
});
