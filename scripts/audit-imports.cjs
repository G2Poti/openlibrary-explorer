// audit-imports.cjs — for EACH module, finds called identifiers that are
// exported by ANOTHER module but neither declared nor imported locally.
// (Method calls / locals are ignored: only cross-module misses are reported.)
const fs = require('fs');
const mods = ['main.js', 'book-features.js', 'app-ui.js', 'storage-cache.js', 'network-engine.js', 'utils.js', 'dom.js'];
const src = {};
for (const f of mods) src[f] = fs.readFileSync(f, 'utf8');

const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const exportsOf = {};
for (const f of mods) {
  exportsOf[f] = new Set();
  for (const m of stripComments(src[f]).matchAll(/export\s+(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/g)) exportsOf[f].add(m[1]);
}
const ownerOf = Object.create(null);
for (const f of mods) for (const n of exportsOf[f]) if (!ownerOf[n]) ownerOf[n] = f;
let bad = 0;
for (const f of mods) {
  const body = stripComments(src[f]);
  const local = new Set([...body.matchAll(/^(?:export\s+)?(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  for (const m of body.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([^'"]+)\.js['"]/g)) {
    for (const n of m[1].split(',')) { const t = n.trim(); if (t) local.add(t); }
  }
  for (const m of body.matchAll(/(?:function\s+\w*|catch)\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(',')) { const t = p.trim().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(t)) local.add(t); }
  }
  const seen = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (local.has(name) || seen.has(name)) continue;
    seen.add(name);
    if (ownerOf[name] && ownerOf[name] !== f) {
      const line = body.slice(0, m.index).split('\n').length;
      console.log(f + ': uses ' + name + ' (owned by ' + ownerOf[name] + ') e.g. line ' + line + ' — NOT IMPORTED');
      bad++;
    }
  }
}
console.log(bad === 0 ? 'AUDIT-CLEAN' : 'ACTIONABLE=' + bad);
