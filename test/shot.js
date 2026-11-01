// Screenshots of the game in headless Firefox, driven over WebDriver BiDi:
//   node test/shot.js OUT_DIR
// Walks a player through it with real key presses: lobby.png, drawer.png
// (the wardrobe), settings.png (the host console), moves.png, spar.png
// (practice bot), match.png (the Magma Foundry), ko.png (the K.O. cinematic),
// podium.png (the winner's card), sandbox.png (a 1P sandbox match), rig.png (ledge grip, mantle, landing
// crouch, drawn close up), phone.png (touch controls).
'use strict';
const {spawn} = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const WebSocket = require('ws');
const outDir = path.resolve(process.argv[2] || '.');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env: {...process.env, PORT: 3998}});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-ff-'));
const ff = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '9229'],
    {stdio: 'ignore'});
let ws, seq = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((ok, bad) => {
    const id = ++seq;
    pending.set(id, m => m.type === 'error' ? bad(new Error(m.message || m.error)) : ok(m.result));
    ws.send(JSON.stringify({id, method, params}));
});
async function shot(ctx, name) {
    const {data} = await call('browsingContext.captureScreenshot', {context: ctx});
    fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'));
    console.log('saved', path.join(outDir, name));
}
(async () => {
    try {
        for (let i = 0; i < 60 && !ws; i++) {
            await sleep(500);
            try {
                ws = await new Promise((ok, bad) => {
                    const s = new WebSocket('ws://127.0.0.1:9229/session');
                    s.on('open', () => ok(s)); s.on('error', bad);
                });
            } catch { ws = null; }
        }
        ws.on('message', d => { const m = JSON.parse(d); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
        await call('session.new', {capabilities: {}});
        const {contexts} = await call('browsingContext.getTree', {});
        const ctx = contexts[0].context;
        await call('browsingContext.setViewport', {context: ctx, viewport: {width: 1280, height: 720}});
        const keys = (...seq) => call('input.performActions', {context: ctx, actions: [{type: 'key', id: 'kb', actions: seq}]});
        const hold = (key, ms) => keys({type: 'keyDown', value: key}, {type: 'pause', duration: ms}, {type: 'keyUp', value: key});
        const tap = key => keys({type: 'keyDown', value: key}, {type: 'keyUp', value: key});
        const js = expression => call('script.evaluate', {expression, target: {context: ctx}, awaitPromise: false});
        const waitFor = async (expression, ms) => {
            for (let t = 0; t < ms; t += 250) {
                const r = await js(expression);
                if (r && r.result && r.result.value === true)
                    return true;
                await sleep(250);
            }
            return false;
        };
        await call('browsingContext.navigate', {context: ctx, url: 'http://127.0.0.1:3998/?name=Tester', wait: 'complete'});
        await sleep(2500);
        await shot(ctx, 'lobby.png');
        await hold('a', 850);              // to the wardrobe
        await sleep(400);
        await tap('e');
        await sleep(900);
        await shot(ctx, 'drawer.png');
        await tap('\uE00C');              // Esc
        await hold('d', 1250);             // to the console
        await sleep(400);
        await tap('e');                    // the match settings
        await sleep(800);
        await shot(ctx, 'settings.png');
        await tap('\uE00C');
        await tap('\uE008');              // Shift: the move list
        await sleep(500);
        await shot(ctx, 'moves.png');
        await tap('\uE008');
        await tap('p');                    // P: practice against the bot, in this browser
        await sleep(4500);
        await shot(ctx, 'spar.png');
        await tap('\uE00C');              // Esc: back to the lobby
        await sleep(800);
        for (let i = 0; i < 4; i++)
            await tap('\uE004');          // Tab x4 at the console: the Magma Foundry
        await tap('e');
        await sleep(400);
        await js(`[...document.querySelectorAll('#sRows button')].find(b => b.textContent === 'First to 3').click()`);
        await sleep(300);
        await tap('\uE007');              // Enter: start (alone: against the training bot)
        await sleep(9000);
        await shot(ctx, 'match.png');
        // standing still, Tester loses three rounds: the K.O. cinematic, then the winner's card
        if (await waitFor(`document.body.classList.contains('cinematic')`, 90000)) {
            await sleep(700);
            await shot(ctx, 'ko.png');
        }
        if (await waitFor(`document.getElementById('podium').classList.contains('show')`, 150000)) {
            await sleep(900);
            await shot(ctx, 'podium.png');
        }
        // the 1P sandbox: back in the lobby, alone, FFA against three bots
        if (await waitFor(`!document.body.classList.contains('in-match')`, 20000)) {
            await sleep(1500);
            await js(`Hud.openSettings(Lobby.state.sel, true, {mode: [], map: [], target: [], timer: [], weapons: [], limit: []})`);
            await sleep(400);
            await js(`[...document.querySelectorAll('#sSoloRows button')].find(b => b.textContent === 'FFA · 3 bots').click()`);
            await sleep(200);
            await shot(ctx, 'solo.png');
            await js(`document.getElementById('sSandbox').click()`);
            await sleep(8000);
            await shot(ctx, 'sandbox.png');
            await tap('\uE00C');          // Esc: leaves the sandbox
            await sleep(1500);
        }
        // the rig close up: hanging from both edges, the mantle, the landing crouch
        await js(`(() => {
            const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
            c.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0b0f17';
            document.body.appendChild(c);
            const g = c.getContext('2d'); g.scale(1.6, 1.6);
            const {HANG, GRIP} = Physics, top = 150;
            const plat = (x, w) => { g.fillStyle = '#334155'; g.fillRect(x, top, w, 14); g.fillStyle = '#94a3b8'; g.fillRect(x, top, w, 2); };
            const rig = (f, t) => Physics.drawRig(g, Object.assign({vx: 0, inv: 0, gear: {}}, f), t);
            plat(20, 110); rig({x: 130 + GRIP, y: top + HANG, face: -1, st: 'ledge', color: '#22d3ee'}, 0.3);
            plat(230, 110); rig({x: 230 - GRIP, y: top + HANG, face: 1, st: 'ledge', color: '#f472b6'}, 1.1);
            for (const [i, k] of [[0, 0.2], [1, 0.55]]) {
                const px = 390 + i * 150, m = Physics.mantlePath(k);
                plat(px, 110); rig({x: px + m.fx, y: top + m.dy, face: 1, st: 'mantle', ap: k, color: '#a3e635'}, 0);
            }
            g.fillStyle = '#334155'; g.fillRect(20, 400, 740, 14);
            rig({x: 120, y: 400, face: 1, st: 'land', color: '#facc15'}, 0);
            rig({x: 260, y: 400, face: 1, st: 'idle', color: '#e5e7eb'}, 0);
        })()`);
        await sleep(300);
        await shot(ctx, 'rig.png');
        // a phone, sideways, with the touch pads
        await call('browsingContext.setViewport', {context: ctx, viewport: {width: 860, height: 412}});
        await call('browsingContext.navigate', {context: ctx, url: 'http://127.0.0.1:3998/?name=Phone&touch=1', wait: 'complete'});
        await sleep(3000);
        await shot(ctx, 'phone.png');
        await call('session.end', {}).catch(() => {});
    } catch (e) {
        console.error('screenshot failed:', e.message);
        process.exitCode = 1;
    } finally {
        ff.kill(); srv.kill();
        setTimeout(() => { fs.rmSync(profile, {recursive: true, force: true}); process.exit(); }, 800);
    }
})();
