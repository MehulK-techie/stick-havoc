// Stick Havoc: the weapons that drop in crates, shared by the server
// (what they do) and the browser (how they look).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    else
        root.Weapons = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const fr = n => n / 60;
    // melee: a swing's frame data and what a hit does; shooters fire a projectile
    const KINDS = {
        katana: {name: 'Katana', uses: 5, melee: true, dur: fr(14), from: fr(3), to: fr(10), reach: 74, r: 46,
            dmg: 9, kx: 420, ky: -200, stun: 0.3},
        bat: {name: 'Home-Run Bat', uses: 3, melee: true, dur: fr(34), from: fr(16), to: fr(24), reach: 66, r: 52,
            dmg: 14, kx: 1400, ky: -520, stun: 0.8, tumble: true},
        blaster: {name: 'Laser Blaster', uses: 3, shot: 'laser', dur: fr(16), recoil: 260},
        grenade: {name: 'Bouncy Bomb', uses: 1, shot: 'grenade', dur: fr(18)},
    };
    const SHOTS = {
        laser: {speed: 1700, gravity: 0, dmg: 8, kx: 520, ky: -160, stun: 0.3, life: 1.2},
        grenade: {speed: 700, lift: -520, gravity: 1800, bounces: 2, radius: 210, power: 1000, dmg: 14, life: 4},
        thrown: {speed: 1200, lift: -180, gravity: 900, dmg: 10, kx: 640, ky: -360, stun: 0.5, life: 2},
    };
    const NAMES = Object.keys(KINDS);

    // a weapon in a fist (the rig's own facing-right space: +x forward)
    function draw(ctx, kind, fist, angle) {
        ctx.save();
        ctx.translate(fist.x, fist.y);
        ctx.rotate(angle || 0);
        ctx.shadowBlur = 0;
        switch (kind) {
        case 'katana':
            ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(46, -10); ctx.stroke();
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(-8, 2); ctx.lineTo(4, -1); ctx.stroke();
            break;
        case 'bat':
            ctx.strokeStyle = '#d6b37a'; ctx.lineCap = 'round';
            ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(16, -4); ctx.stroke();
            ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(16, -4); ctx.lineTo(40, -11); ctx.stroke();
            break;
        case 'blaster':
            ctx.fillStyle = '#94a3b8';
            ctx.fillRect(-2, -6, 22, 7); ctx.fillRect(0, 0, 6, 8);
            ctx.fillStyle = '#22d3ee'; ctx.fillRect(18, -5, 4, 5);
            break;
        case 'grenade':
            ctx.fillStyle = '#334155'; ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(6, -2, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            break;
        }
        ctx.restore();
    }

    // a crate, parachuting or landed
    function drawCrate(ctx, x, y, landed, t, gold) {
        ctx.save();
        ctx.translate(x, y);
        if (!landed) {                                // the parachute, swaying
            ctx.rotate(Math.sin(t * 2.4) * 0.08);
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-16, -30); ctx.lineTo(-36, -84); ctx.moveTo(16, -30); ctx.lineTo(36, -84);
            ctx.stroke();
            ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
            ctx.beginPath(); ctx.moveTo(-46, -80); ctx.quadraticCurveTo(0, -128, 46, -80); ctx.closePath(); ctx.fill();
        }
        if (gold) {                                   // the Rage orb: a glowing gold ball, not a crate
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 16 + Math.sin(t * 6) * 6;
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.arc(0, -20, 15, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff7cc';
            ctx.beginPath(); ctx.arc(-5, -25, 4, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            return;
        }
        ctx.fillStyle = '#334155';
        ctx.fillRect(-18, -32, 36, 32);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.strokeRect(-18, -32, 36, 32);
        ctx.beginPath(); ctx.moveTo(-18, -32); ctx.lineTo(18, 0); ctx.moveTo(18, -32); ctx.lineTo(-18, 0); ctx.stroke();
        ctx.restore();
    }

    function drawShot(ctx, kind, x, y, vx, t) {
        ctx.save();
        if (kind === 'laser') {
            ctx.strokeStyle = '#22d3ee'; ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 12; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(x - Math.sign(vx) * 34, y); ctx.lineTo(x, y); ctx.stroke();
        } else if (kind === 'grenade') {
            ctx.fillStyle = '#334155'; ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = Math.floor(t * 10) % 2 ? '#f43f5e' : '#facc15';
            ctx.beginPath(); ctx.arc(x + 3, y - 8, 2.5, 0, Math.PI * 2); ctx.fill();
        } else {                                      // a thrown weapon, spinning
            ctx.translate(x, y);
            ctx.rotate(t * 18 * Math.sign(vx || 1));
            ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke();
        }
        ctx.restore();
    }

    return {KINDS, SHOTS, NAMES, draw, drawCrate, drawShot};
});
