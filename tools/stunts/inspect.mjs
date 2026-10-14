// node tools/stunts/inspect.mjs <file> [shapeId]
// Lists resources of an original Stunts file; for shape files prints each shape's bounding box
// (game units, x right / y up / z forward), or every vertex and polygon of one shape.
import { readFileSync } from 'node:fs';
import { parseResources, parseShape, unpack } from './formats.mjs';

const [file, only] = process.argv.slice(2);
const raw = new Uint8Array(readFileSync(file));
const data = unpack(raw);
const res = parseResources(data);
const isShape = /\.(P3S|3SH)$/i.test(file);

for (const [id, bytes] of res) {
  if (only && id !== only) continue;
  if (!isShape) {
    console.log(`${id.padEnd(5)} ${String(bytes.length).padStart(6)} bytes`);
    continue;
  }
  const s = parseShape(bytes);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of s.verts) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], v[k])), (max[k] = Math.max(max[k], v[k]));
  console.log(
    `${id.padEnd(5)} v=${String(s.verts.length).padStart(3)} p=${String(s.prims.length).padStart(3)}  x ${min[0]}..${max[0]}  y ${min[1]}..${max[1]}  z ${min[2]}..${max[2]}`,
  );
  if (only) {
    s.verts.forEach((v, i) => console.log(`  v${i}: ${v.join(', ')}`));
    s.prims.forEach((p, i) => console.log(`  p${i}: type ${p.type} mat ${p.materials.join('/')} idx ${p.idx.join(',')}`));
  }
}
