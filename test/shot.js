// Screenshots of the game in headless Firefox, driven over WebDriver BiDi:
//   node test/shot.js OUT_DIR
// Saves join.png (the join screen), fight.png (Tester vs the training bot,
// a few seconds in) and phone.png (the same at phone size, touch pads on).
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
        await call('browsingContext.navigate', {context: ctx, url: 'http://127.0.0.1:3998/', wait: 'complete'});
        await sleep(1500);
        await shot(ctx, 'join.png');
        await call('browsingContext.navigate', {context: ctx, url: 'http://127.0.0.1:3998/?name=Tester', wait: 'complete'});
        await sleep(8000);    // the countdown, then a few seconds of the bot fighting a standing player
        await shot(ctx, 'fight.png');
        // a phone, sideways, with the touch pads
        await call('browsingContext.setViewport', {context: ctx, viewport: {width: 860, height: 412}});
        await call('browsingContext.navigate', {context: ctx, url: 'http://127.0.0.1:3998/?name=Phone&touch=1', wait: 'complete'});
        await sleep(7000);
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
