// audit-idents.cjs — for each exported name, verify every OTHER module that
// mentions it either imports it or is its owner. Catches bare reads/writes
// (INPUT_IDS.forEach, `x = y` assignments) that the call-based audit misses.
const fs = require('fs');
const mods = ['main.js', 'book-features.js', 'app-ui.js', 'storage-cache.js', 'network-engine.js', 'utils.js', 'dom.js'];
const src = {};
for (const f of mods) src[f] = fs.readFileSync(f, 'utf8');
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const exportsOf = {};
for (const f of mods) {
  exportsOf[f] = new Set();
  for (const m of strip(src[f]).matchAll(/export\s+(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/g)) exportsOf[f].add(m[1]);
}
const ownerOf = Object.create(null);
for (const f of mods) for (const n of exportsOf[f]) if (!ownerOf[n]) ownerOf[n] = f;
let bad = 0;
for (const f of mods) {
  const body = strip(src[f]);
  const imported = new Set();
  for (const m of body.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([^'"]+)\.js['"]/g)) {
    for (const n of m[1].split(',')) { const t = n.trim(); if (t) imported.add(t); }
  }
  const declared = new Set([...body.matchAll(/^(?:export\s+)?(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  for (const m of body.matchAll(/\b([A-Z][A-Z0-9_]{2,}|[a-z_$][\w$]{3,})\b/g)) {
    const name = m[1];
    const owner = ownerOf[name];
    if (!owner || owner === f || imported.has(name) || declared.has(name)) continue;
    // skip property accesses (obj.NAME) and object keys ({NAME: / NAME:)
    const before = body[m.index - 1] || '';
    const after = body.slice(m.index + name.length).trimStart()[0] || '';
    if (before === '.') continue;
    const line = body.slice(0, m.index).split('\n').length;
    console.log(`${f}:${line} mentions ${name} (owned by ${owner}) without import/decl`);
    bad++;
    break; // one report per name per file is enough
  }
}
console.log(bad === 0 ? 'IDENT-AUDIT-CLEAN' : 'IDENT-ACTIONABLE=' + bad);
