// The page and its scripts agree: every element the scripts look up by id is in index.html.
//   node test/page.js
'use strict';
const fs = require('fs'), path = require('path');
const pub = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
let failures = 0;
for (const file of fs.readdirSync(pub).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(pub, file), 'utf8');
    const used = [...src.matchAll(/(?:\$|getElementById)\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
    const missing = [...new Set(used)].filter(id => !ids.has(id));
    console.log(`${missing.length ? 'FAIL' : 'ok  '} ${file}: every id it looks up is on the page${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
    failures += missing.length ? 1 : 0;
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
