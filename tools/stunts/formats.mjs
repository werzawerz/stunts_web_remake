// Readers for original Stunts data files, used only by local analysis tools. Nothing read
// here is bundled into the game: we extract measurements (sizes, heights, parameters) and
// re-create everything with our own assets. Formats per wiki.stunts.hu (Compression,
// Resource file format) and the documented behaviour of the stressed editor.

/** 24-bit little-endian length. */
const len24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

/** Decompress a packed file (.PRE, .P3S, .PVS ...). Returns the input unchanged if not packed. */
export function unpack(buf) {
  const asResource = buf.length >= 4 && (buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24)) === buf.length;
  if (asResource) return buf;
  let src = buf;
  let off = 0;
  let passes = 1;
  if (src[0] & 0x80) {
    passes = src[0] & 0x7f;
    off = 4; // pass count + final length
  }
  for (let p = 0; p < passes; p++) {
    const type = src[off];
    const outLen = len24(src, off + 1);
    off += 4;
    let out;
    if (type === 1) out = rle(src, off, outLen);
    else if (type === 2) out = huffman(src, off, outLen);
    else throw new Error(`unknown compression type ${type}`);
    src = out;
    off = 0;
  }
  return src;
}

function rle(src, off, outLen) {
  const srcLen = len24(src, off);
  off += 4; // length + reserved byte
  const flags = src[off++];
  const escCount = flags & 0x7f;
  const esc = [];
  for (let i = 0; i < escCount; i++) esc.push(src[off++]);
  const end = off + srcLen - (4 + 1 + escCount) + 0; // body runs to the end of the pass data
  let body = src.subarray(off);

  if (!(flags & 0x80)) {
    // Stage 1: sequence runs delimited by esc[1], followed by a repeat count.
    const seqEsc = esc[1];
    const tmp = [];
    let i = 0;
    while (i < body.length && tmp.length < outLen) {
      const b = body[i++];
      if (b === seqEsc) {
        const start = i;
        while (body[i] !== seqEsc) i++;
        const seq = body.subarray(start, i);
        i++;
        const reps = body[i++];
        for (let r = 0; r < reps; r++) for (const s of seq) tmp.push(s);
      } else tmp.push(b);
    }
    body = Uint8Array.from(tmp);
  }

  // Stage 2: single-byte runs. lookup = escape index + 1.
  const lookup = new Uint8Array(256);
  esc.forEach((e, i) => (lookup[e] = i + 1));
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  while (o < outLen) {
    const b = body[i++];
    const k = lookup[b];
    if (!k) {
      out[o++] = b;
    } else if (k === 1) {
      const n = body[i];
      const v = body[i + 1];
      i += 2;
      for (let r = 0; r < n; r++) out[o++] = v;
    } else if (k === 3) {
      const n = body[i] | (body[i + 1] << 8);
      const v = body[i + 2];
      i += 3;
      for (let r = 0; r < n; r++) out[o++] = v;
    } else {
      const v = body[i++];
      for (let r = 0; r < k - 1; r++) out[o++] = v;
    }
  }
  void end;
  return out;
}

/** Canonical Huffman, codes read most-significant bit first. */
function huffman(src, off, outLen) {
  const levels = src[off++] & 0x7f;
  const counts = [];
  for (let i = 0; i < levels; i++) counts.push(src[off++]);
  const total = counts.reduce((a, b) => a + b, 0);
  const alphabet = src.subarray(off, off + total);
  off += total;

  const first = [];
  const base = [];
  let code = 0;
  let idx = 0;
  for (let l = 0; l < levels; l++) {
    first.push(code);
    base.push(idx);
    code = (code + counts[l]) << 1;
    idx += counts[l];
  }

  const out = new Uint8Array(outLen);
  let o = 0;
  let bitPos = off * 8;
  while (o < outLen) {
    let c = 0;
    for (let l = 0; l < levels; l++) {
      const byte = src[bitPos >> 3];
      c = (c << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos++;
      if (c - first[l] < counts[l]) {
        out[o++] = alphabet[base[l] + c - first[l]];
        break;
      }
      if (l === levels - 1) throw new Error(`bad huffman code at output ${o}`);
    }
  }
  return out;
}

/** Resource container → Map(id → bytes). */
export function parseResources(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint16(4, true);
  const ids = [];
  for (let i = 0; i < count; i++) ids.push(String.fromCharCode(...buf.subarray(6 + i * 4, 10 + i * 4)).replace(/\0/g, ''));
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(dv.getUint32(6 + count * 4 + i * 4, true));
  const base = 6 + count * 8;
  const sorted = [...offsets].sort((a, b) => a - b);
  const map = new Map();
  ids.forEach((id, i) => {
    const start = offsets[i];
    const next = sorted.find((s) => s > start) ?? buf.length - base;
    map.set(id, buf.subarray(base + start, base + next));
  });
  return map;
}

/** 3D shape: vertices (x right, y up, z forward in game units) and primitives. */
export function parseShape(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nv = bytes[0];
  const np = bytes[1];
  const paints = bytes[2];
  let o = 4;
  const verts = [];
  for (let i = 0; i < nv; i++, o += 6) verts.push([dv.getInt16(o, true), dv.getInt16(o + 2, true), dv.getInt16(o + 4, true)]);
  o += np * 8; // two culling words per primitive
  const prims = [];
  for (let i = 0; i < np; i++) {
    const type = bytes[o++];
    const flags = bytes[o++];
    const materials = [...bytes.subarray(o, o + paints)];
    o += paints;
    const n = type === 11 ? 2 : type === 12 ? 6 : type;
    const idx = [...bytes.subarray(o, o + n)];
    o += n;
    prims.push({ type, flags, materials, idx });
  }
  return { verts, prims, paints };
}
