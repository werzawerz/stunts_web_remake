// node tools/stunts/track-pieces.mjs [dir] — which element and terrain codes the original tracks use.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'original_game/STUNTS11';
const total = new Map();
for (const f of readdirSync(dir).filter((x) => /\.TRK$/i.test(x))) {
  const b = readFileSync(join(dir, f));
  const codes = new Map();
  for (let i = 0; i < 900; i++) codes.set(b[i], (codes.get(b[i]) ?? 0) + 1);
  const terrain = new Set([...b.subarray(0x385, 0x385 + 900)]);
  console.log(`${f.padEnd(12)} horizon ${b[0x384]} elements ${[...codes.keys()].filter((c) => c).sort((x, y) => x - y).map((c) => c.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`${''.padEnd(12)} terrain ${[...terrain].sort((x, y) => x - y).map((c) => c.toString(16).padStart(2, '0')).join(' ')}`);
  for (const [c, n] of codes) if (c) total.set(c, (total.get(c) ?? 0) + n);
}
console.log('all codes:', [...total.keys()].sort((x, y) => x - y).map((c) => c.toString(16).padStart(2, '0')).join(' '));
