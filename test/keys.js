// The key bindings (keys.js): defaults, rebinding, what the game keeps, saving.
//   node test/keys.js
'use strict';
const P = require('../public/physics.js');
const Keys = require('../public/keys.js');
let failures = 0;
const check = (what, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const store = {data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; }};

Keys.load(store);
check('defaults: W jumps (and is up), Space only jumps, J punches, E interacts',
    Keys.bits('KeyW') === (P.IN.JUMP | P.IN.UP) && Keys.bits('Space') === P.IN.JUMP && Keys.bits('KeyJ') === P.IN.LIGHT &&
    Keys.is('KeyE', 'use'));
check('rebinding punch to I: I punches', Keys.bind('punch', 'KeyI', 0) && Keys.bits('KeyI') === P.IN.LIGHT &&
    !Keys.is('KeyJ', 'punch'));
check('a key moves from the action that had it', Keys.bind('grab', 'KeyZ') && Keys.is('KeyZ', 'grab') &&
    !Keys.is('KeyZ', 'punch'));
check("an action's only key can't be taken", !Keys.bind('dash', 'KeyI') && Keys.is('KeyI', 'punch'));
check('the game keeps Esc, Shift, P', !Keys.bind('jump', 'Escape') && !Keys.bind('jump', 'ShiftLeft') &&
    !Keys.bind('jump', 'KeyP'));
Keys.save(store);
Keys.reset();
Keys.load(store);
check('saved in stick_havoc_keys and loaded back', 'stick_havoc_keys' in store.data && Keys.is('KeyI', 'punch') &&
    Keys.is('KeyZ', 'grab'));
store.data.stick_havoc_keys = '{"punch": ["Escape"], "jump": 7}';
Keys.load(store);
check('a broken or hostile save falls back to the defaults', Keys.is('KeyJ', 'punch') && Keys.is('KeyW', 'jump'));
check('labels: arrows and letters', Keys.label('ArrowLeft') === '←' && Keys.label('KeyJ') === 'J' &&
    Keys.label('Space') === 'Space');
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
