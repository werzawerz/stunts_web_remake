// node tools/stunts/bitmap.mjs <file.PVS> <outDir>   — dump every bitmap of a file as PNG (local only).
// Bitmap layout (wiki.stunts.hu, stressed editor): u16 width, u16 height, u16 ×2 unknown,
// u16 x, u16 y (screen position), 4 flag bytes, then one palette index per pixel.
// Flag byte 2: 0x10 = stored column by column, 0x20 = column-major and interlaced.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseResources, unpack } from './formats.mjs';

/** 256 RGB colours (0-255) from the game's palette (SDMAIN.PVS "!pal": 16-byte header + 6-bit RGB). */
export function loadPalette(dir) {
  const pal = parseResources(unpack(new Uint8Array(readFileSync(join(dir, 'SDMAIN.PVS'))))).get('!pal');
  const out = [];
  for (let i = 0; i < 256; i++) out.push([0, 1, 2].map((k) => Math.round((pal[16 + i * 3 + k] * 255) / 63)));
  return out;
}

export function decodeBitmap(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = dv.getUint16(0, true);
  const height = dv.getUint16(2, true);
  const x = dv.getUint16(8, true);
  const y = dv.getUint16(10, true);
  const flags = b[14];
  const data = b.subarray(16);
  const pixels = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let i;
      if (flags & 0x10) i = px * height + py;
      else if (flags & 0x20) i = (py % 2 === 0 ? 0 : height / 2) + px * height + (py >> 1);
      else i = py * width + px;
      pixels[py * width + px] = data[i];
    }
  }
  return { width, height, x, y, flags, pixels };
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngFromIndexed(bmp, palette, transparent = -1) {
  const raw = Buffer.alloc((bmp.width * 4 + 1) * bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    raw[y * (bmp.width * 4 + 1)] = 0;
    for (let x = 0; x < bmp.width; x++) {
      const idx = bmp.pixels[y * bmp.width + x];
      const [r, g, b] = palette[idx];
      const o = y * (bmp.width * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = idx === transparent ? 0 : 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bmp.width, 0);
  ihdr.writeUInt32BE(bmp.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && /[\\/]bitmap\.mjs$/.test(process.argv[1])) {
  const [file, outDir] = process.argv.slice(2);
  const dir = file.replace(/[\\/][^\\/]+$/, '');
  const palette = loadPalette(dir);
  mkdirSync(outDir, { recursive: true });
  for (const [id, bytes] of parseResources(unpack(new Uint8Array(readFileSync(file))))) {
    if (id.startsWith('!')) continue;
    const bmp = decodeBitmap(bytes);
    writeFileSync(join(outDir, `${id}.png`), pngFromIndexed(bmp, palette, 255));
    console.log(`${id} ${bmp.width}x${bmp.height} at ${bmp.x},${bmp.y} flags ${bmp.flags.toString(16)}`);
  }
}
