/*
 * The original's crash effects, drawn on the 320x200 overlay: a cracked windscreen in the in-car
 * view, a speckled fireball where the car was in the outside views, and the "Please Wait..." box
 * before the evaluation screen. Our own drawings, modelled on the original's look.
 */

/** Small deterministic PRNG so a crash's cracks don't change from frame to frame. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

type Pt = [number, number];

/** Crack lines radiating from an impact point, with branches and a couple of jagged rings. */
export function crackLines(seed: number, w: number, h: number): Pt[][] {
  const r = rng(seed);
  const cx = w * (0.38 + r() * 0.12);
  const cy = h * (0.28 + r() * 0.1);
  const lines: Pt[][] = [];
  const rays = 13 + Math.floor(r() * 4);
  const rayAngles: number[] = [];
  const grow = (x: number, y: number, a: number, depth: number): void => {
    const line: Pt[] = [[x, y]];
    let len = 0;
    while (x > -20 && x < w + 20 && y > -20 && y < h + 20 && len < (depth === 0 ? 400 : 40 + r() * 50)) {
      a += (r() - 0.5) * 0.5;
      const step = 6 + r() * 14;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      len += step;
      line.push([x, y]);
      if (depth < 2 && r() < 0.18) grow(x, y, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), depth + 1);
    }
    lines.push(line);
  };
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.35;
    rayAngles.push(a);
    grow(cx, cy, a, 0);
  }
  // Rings: jagged arcs joining neighbouring rays near the impact.
  for (const radius of [9 + r() * 5, 24 + r() * 10]) {
    const ring: Pt[] = [];
    for (let i = 0; i <= rays; i++) {
      if (r() < 0.25 && ring.length > 1) {
        lines.push(ring.splice(0));
        continue;
      }
      const a = rayAngles[i % rays]!;
      const rr = radius * (0.8 + r() * 0.4);
      ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]);
    }
    if (ring.length > 1) lines.push(ring);
  }
  return lines;
}

export function drawCracks(c: CanvasRenderingContext2D, lines: Pt[][]): void {
  c.lineWidth = 1;
  c.lineJoin = 'bevel';
  for (const [color, dx, dy] of [
    ['#545454', 1, 1],
    ['#fcfcfc', 0, 0],
  ] as const) {
    c.strokeStyle = color;
    for (const line of lines) {
      c.beginPath();
      line.forEach(([x, y], i) => (i === 0 ? c.moveTo(x + dx + 0.5, y + dy + 0.5) : c.lineTo(x + dx + 0.5, y + dy + 0.5)));
      c.stroke();
    }
  }
}

const FIRE = ['#fcfcfc', '#fcfc54', '#fcfc54', '#fca854', '#fc5454', '#a80000'];

/** A speckled fireball of radius r (screen pixels), different every frame like the original's. */
export function drawFireball(c: CanvasRenderingContext2D, x: number, y: number, r: number, frame: number): void {
  const rand = rng(frame * 7919 + 13);
  const n = Math.floor(r * r * 1.6);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand());
    const px = Math.round(x + Math.cos(a) * d * r * 1.3);
    const py = Math.round(y + Math.sin(a) * d * r * 0.75);
    // Hotter towards the middle.
    const k = Math.min(FIRE.length - 1, Math.floor(d * FIRE.length * 0.8 + rand() * 2));
    c.fillStyle = FIRE[k]!;
    c.fillRect(px, py, 1, 1);
  }
}

/** The small "Please Wait..." box shown before the evaluation screen. */
export function drawPleaseWait(c: CanvasRenderingContext2D, w: number, h: number): void {
  const bw = 58;
  const bh = 13;
  const x = Math.round((w - bw) / 2);
  const y = Math.round(h * 0.75);
  c.fillStyle = '#000000';
  c.fillRect(x, y, bw, bh);
  c.strokeStyle = '#a80000';
  c.lineWidth = 1;
  c.strokeRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
  c.font = 'bold 7px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#fcfcfc';
  c.fillText('Please Wait...', x + bw / 2, y + bh / 2 + 0.5);
}
