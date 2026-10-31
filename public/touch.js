// Stick Havoc: phone controls. A floating joystick under the left thumb
// (sideways: move; down: guard; up: aims the launcher) and arcade buttons on
// the right thumb's arc, with a short buzz on every press.
'use strict';
const Touch = (() => {
    const IN = Physics.IN;
    // the right thumb: [label, small text, bit, size, right, bottom]; null bit = the E action
    const BUTTONS = [
        ['J', 'PUNCH', IN.LIGHT, 78, 104, 34],
        ['K', 'LAUNCH', IN.HEAVY, 60, 120, 128],
        ['L', 'DASH', IN.DASH, 58, 24, 74],
        ['W', 'JUMP', IN.JUMP, 58, 40, 158],
    ];
    const PILLS = [['E', null, 52, 196, 40], ['G', IN.GRAB, 52, 196, 84]];
    let api = null, stickBits = 0;

    function buzz(ms = 15) {
        try {
            if (navigator.vibrate)
                navigator.vibrate(ms);
        } catch { /* not allowed: fine */ }
    }

    function button(root, label, sub, bit, w, h, right, bottom, pill) {
        const b = document.createElement('button');
        b.className = 'btn' + (pill ? ' pill' : '');
        Object.assign(b.style, {width: `${w}px`, height: `${h}px`, right: `${right}px`, bottom: `${bottom}px`,
            fontSize: `${Math.round(h * 0.34)}px`});
        b.innerHTML = sub ? `${label}<small>${sub}</small>` : label;
        const down = e => {
            e.preventDefault();
            b.setPointerCapture?.(e.pointerId);
            b.classList.add('down');
            buzz();
            if (bit === null)
                api.use();
            else
                api.bits(bit, true);
        };
        const up = e => {
            e.preventDefault();
            b.classList.remove('down');
            if (bit !== null)
                api.bits(bit, false);
        };
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('lostpointercapture', up);
        root.appendChild(b);
    }

    // the joystick appears where the left thumb lands
    function stick(root) {
        const zone = document.createElement('div');
        zone.className = 'stickzone';
        const base = document.createElement('div');
        base.className = 'base';
        const knob = document.createElement('div');
        knob.className = 'knob';
        base.appendChild(knob);
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'Move: drag here';
        zone.append(base, hint);
        root.appendChild(zone);
        let id = null, ox = 0, oy = 0;
        const set = bits => {
            if (bits === stickBits)
                return;
            for (const bit of [IN.LEFT, IN.RIGHT, IN.UP, IN.DOWN])
                api.bits(bit, !!(bits & bit));
            if (bits & ~stickBits & (IN.LEFT | IN.RIGHT | IN.DOWN))
                buzz(8);
            stickBits = bits;
        };
        zone.addEventListener('pointerdown', e => {
            e.preventDefault();
            id = e.pointerId;
            zone.setPointerCapture?.(id);
            const r = zone.getBoundingClientRect();
            ox = e.clientX; oy = e.clientY;
            Object.assign(base.style, {display: 'block', left: `${ox - r.left}px`, top: `${oy - r.top}px`});
            knob.style.transform = '';
            hint.style.display = 'none';
        });
        zone.addEventListener('pointermove', e => {
            if (e.pointerId !== id)
                return;
            let dx = e.clientX - ox, dy = e.clientY - oy;
            const d = Math.hypot(dx, dy), max = 46;
            if (d > max) {
                dx = dx / d * max; dy = dy / d * max;
            }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            let bits = 0;
            if (dx < -16) bits |= IN.LEFT;
            if (dx > 16) bits |= IN.RIGHT;
            if (dy > 26) bits |= IN.DOWN;            // down: guard (or down + K in the air: dive)
            if (dy < -30) bits |= IN.UP;             // up: aims J into the launcher
            set(bits);
        });
        const end = e => {
            if (e.pointerId !== id)
                return;
            id = null;
            base.style.display = 'none';
            set(0);
        };
        zone.addEventListener('pointerup', end);
        zone.addEventListener('pointercancel', end);
    }

    function init(handlers) {
        api = handlers;
        const root = document.getElementById('touch');
        root.textContent = '';
        stick(root);
        for (const [label, sub, bit, size, right, bottom] of BUTTONS)
            button(root, label, sub, bit, size, size, right, bottom);
        for (const [label, bit, w, right, bottom] of PILLS)
            button(root, label, null, bit, w, 34, right, bottom, true);
    }

    return {init, buzz};
})();
