// Screenshots of the game in headless Firefox, driven over WebDriver BiDi:
//   node test/shot.js OUT_DIR
// Walks a player through it with real key presses: lobby.png, drawer.png
// (the wardrobe), settings.png (the host console), moves.png, spar.png
// (practice bot), match.png (the Magma Foundry), phone.png (touch controls).
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
        await tap('\uE007');              // Enter: start (alone: against the training bot)
        await sleep(9000);
        await shot(ctx, 'match.png');
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
