// Readers for the original Stunts data formats, used in the browser to show the player's own
// original files (nothing is bundled). Same algorithms as tools/stunts/formats.mjs.

const len24 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

/** Decompress a packed file (.P3S, .PRE ...); returns the input if it is not packed. */
export function unpack(buf: Uint8Array): Uint8Array {
  const asResource = buf.length >= 4 && (buf[0]! | (buf[1]! << 8) | (buf[2]! << 16) | (buf[3]! << 24)) === buf.length;
  if (asResource) return buf;
  let src = buf;
  let off = 0;
  let passes = 1;
  if (src[0]! & 0x80) {
    passes = src[0]! & 0x7f;
    off = 4;
  }
  for (let p = 0; p < passes; p++) {
    const type = src[off]!;
    const outLen = len24(src, off + 1);
    off += 4;
    if (type === 1) src = rle(src, off, outLen);
    else if (type === 2) src = huffman(src, off, outLen);
    else throw new Error(`unknown compression type ${type}`);
    off = 0;
  }
  return src;
}

function rle(src: Uint8Array, off: number, outLen: number): Uint8Array {
  off += 4; // packed length + reserved byte
  const flags = src[off++]!;
  const esc: number[] = [];
  for (let i = 0; i < (flags & 0x7f); i++) esc.push(src[off++]!);
  let body = src.subarray(off);
  if (!(flags & 0x80)) {
    // Sequence runs delimited by esc[1], followed by a repeat count.
    const seqEsc = esc[1];
    const tmp: number[] = [];
    let i = 0;
    while (i < body.length && tmp.length < outLen) {
      const b = body[i++]!;
      if (b === seqEsc) {
        const start = i;
        while (body[i] !== seqEsc) i++;
        const seq = body.subarray(start, i);
        i++;
        const reps = body[i++]!;
        for (let r = 0; r < reps; r++) for (const v of seq) tmp.push(v);
      } else tmp.push(b);
    }
    body = Uint8Array.from(tmp);
  }
  const lookup = new Uint8Array(256);
  esc.forEach((e, i) => (lookup[e] = i + 1));
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  while (o < outLen) {
    const b = body[i++]!;
    const k = lookup[b]!;
    if (!k) out[o++] = b;
    else if (k === 1) {
      const n = body[i]!;
      const v = body[i + 1]!;
      i += 2;
      for (let r = 0; r < n; r++) out[o++] = v;
    } else if (k === 3) {
      const n = body[i]! | (body[i + 1]! << 8);
      const v = body[i + 2]!;
      i += 3;
      for (let r = 0; r < n; r++) out[o++] = v;
    } else {
      const v = body[i++]!;
      for (let r = 0; r < k - 1; r++) out[o++] = v;
    }
  }
  return out;
}

/** Canonical Huffman, most-significant bit first. */
function huffman(src: Uint8Array, off: number, outLen: number): Uint8Array {
  const levels = src[off++]! & 0x7f;
  const counts: number[] = [];
  for (let i = 0; i < levels; i++) counts.push(src[off++]!);
  const total = counts.reduce((a, b) => a + b, 0);
  const alphabet = src.subarray(off, off + total);
  off += total;
  const first: number[] = [];
  const base: number[] = [];
  let code = 0;
  let idx = 0;
  for (let l = 0; l < levels; l++) {
    first.push(code);
    base.push(idx);
    code = (code + counts[l]!) << 1;
    idx += counts[l]!;
  }
  const out = new Uint8Array(outLen);
  let o = 0;
  let bit = off * 8;
  while (o < outLen) {
    let c = 0;
    for (let l = 0; l < levels; l++) {
      c = (c << 1) | ((src[bit >> 3]! >> (7 - (bit & 7))) & 1);
      bit++;
      if (c - first[l]! < counts[l]!) {
        out[o++] = alphabet[base[l]! + c - first[l]!]!;
        break;
      }
      if (l === levels - 1) throw new Error('bad huffman code');
    }
  }
  return out;
}

/** Resource container → Map(id → bytes). */
export function parseResources(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint16(4, true);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(String.fromCharCode(...buf.subarray(6 + i * 4, 10 + i * 4)).replace(/\0/g, ''));
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(dv.getUint32(6 + count * 4 + i * 4, true));
  const base = 6 + count * 8;
  const sorted = [...offsets].sort((a, b) => a - b);
  const map = new Map<string, Uint8Array>();
  ids.forEach((id, i) => {
    const start = offsets[i]!;
    const next = sorted.find((s) => s > start) ?? buf.length - base;
    map.set(id, buf.subarray(base + start, base + next));
  });
  return map;
}

export interface Shape {
  /** x right, y up, z forward, game units. */
  verts: [number, number, number][];
  prims: { type: number; flags: number; materials: number[]; idx: number[] }[];
  paints: number;
}

export function parseShape(bytes: Uint8Array): Shape {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nv = bytes[0]!;
  const np = bytes[1]!;
  const paints = bytes[2]!;
  let o = 4;
  const verts: [number, number, number][] = [];
  for (let i = 0; i < nv; i++, o += 6) verts.push([dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true)]);
  o += np * 8; // culling data
  const prims: Shape['prims'] = [];
  for (let i = 0; i < np; i++) {
    const type = bytes[o++]!;
    const flags = bytes[o++]!;
    const materials = [...bytes.subarray(o, o + paints)];
    o += paints;
    const n = type === 11 ? 2 : type === 12 ? 6 : type;
    prims.push({ type, flags, materials, idx: [...bytes.subarray(o, o + n)] });
    o += n;
  }
  return { verts, prims, paints };
}
