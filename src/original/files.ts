/*
 * Where original Stunts files are looked up at runtime:
 *  1. /original_game/STUNTS11/ — the developer's own copy (git-ignored, served only by the dev server)
 *  2. <base>/original/         — public/original/, shipped with a build only if the owner puts files there
 */
const SOURCES = ['/original_game/STUNTS11/', `${import.meta.env.BASE_URL}original/`];

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // Vite answers unknown paths with index.html; real game files never start with "<".
    return buf.length > 0 && buf[0] !== 0x3c ? buf : null;
  } catch {
    return null;
  }
}

/** First copy of `name` found in the known locations, or null. */
export async function fetchOriginal(name: string): Promise<Uint8Array | null> {
  for (const base of SOURCES) {
    const b = await fetchBytes(base + name);
    if (b) return b;
  }
  return null;
}

/** Car id (as in CARS) → file suffix of CAR*.RES, ST*.P3S, STDA*.PVS, STDB*.PVS. */
export const CAR_FILES: Record<string, string> = {
  nsx: 'ANSX',
  audi: 'AUDI',
  coun: 'COUN',
  gto: 'FGTO',
  jag: 'JAGU',
  lanc: 'LANC',
  l002: 'LM02',
  962: 'P962',
  pc4: 'PC04',
  indy: 'PMIN',
  zr1: 'VETT',
};
