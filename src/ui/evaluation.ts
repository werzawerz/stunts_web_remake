/*
 * The original's evaluation screen after a race (shown here after a crash): the track's fastest
 * times on top, the run's figures below and three buttons. Layout measured from the original's
 * 320x200 screen; drawn with our own font.
 */

export interface EvalRow {
  name: string;
  car: string;
  time: string;
}

export interface EvalButton {
  /** One or two lines. */
  label: string[];
  enabled: boolean;
}

export interface EvaluationData {
  trackName: string;
  /** Fastest times (up to 7); null while loading or offline. */
  rows: EvalRow[] | null;
  elapsed: string;
  /** Shortcut penalty included in the elapsed time (seconds), if any. */
  penaltySec?: number;
  averageMph: number;
  impactMph: number | null;
  topMph: number;
  buttons: EvalButton[];
  selected: number;
  /** Name entry for the online fastest times, drawn as the original's black box. */
  prompt?: { title: string; text: string; status: string } | null;
}

const GREY = '#a8a8a8';
const DARK = '#545454';
const LIGHT = '#fcfcfc';

/** Screen rectangles of the buttons (x, y, w, h). */
export function buttonRects(count: number): [number, number, number, number][] {
  const w = 71;
  const gap = 9;
  const x0 = Math.round((320 - (count * w + (count - 1) * gap)) / 2);
  return Array.from({ length: count }, (_, i) => [x0 + i * (w + gap), 175, w, 22]);
}

/** Bold white lettering with a black outline, like the original's large font. */
function outlined(c: CanvasRenderingContext2D, t: string, x: number, y: number, align: CanvasTextAlign, size = 9): void {
  c.font = `bold ${size}px monospace`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.lineWidth = 2;
  c.lineJoin = 'round';
  c.strokeStyle = '#000000';
  c.strokeText(t, x, y);
  c.fillStyle = LIGHT;
  c.fillText(t, x, y);
}

function plain(c: CanvasRenderingContext2D, t: string, x: number, y: number, align: CanvasTextAlign, color = '#000000'): void {
  c.font = '7px monospace';
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(t, x, y);
}

/** A panel with a dark frame and a light inner edge, like the original's. */
function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  c.fillStyle = GREY;
  c.fillRect(x, y, w, h);
  c.fillStyle = DARK;
  c.fillRect(x, y + h - 3, w, 3);
  c.fillRect(x + w - 3, y, 3, h);
  c.fillRect(x, y, 2, h);
  c.fillRect(x, y, w, 2);
}

export function drawEvaluation(c: CanvasRenderingContext2D, d: EvaluationData): void {
  c.fillStyle = '#000000';
  c.fillRect(0, 0, 320, 200);
  panel(c, 0, 0, 320, 101);
  panel(c, 0, 102, 320, 98);

  outlined(c, `FASTEST TIMES for '${d.trackName.toUpperCase()}'`, 160, 8, 'center');
  outlined(c, 'NAME', 16, 18, 'left');
  outlined(c, 'CAR', 120, 18, 'left');
  outlined(c, 'OPP.', 223, 18, 'left');
  outlined(c, 'TIME', 304, 18, 'right');
  if (d.rows === null) plain(c, 'Loading...', 16, 28, 'left', DARK);
  else if (d.rows.length === 0) plain(c, 'No times yet', 16, 28, 'left', DARK);
  else
    d.rows.slice(0, 7).forEach((r, i) => {
      const y = 28 + i * 10;
      plain(c, r.name.slice(0, 22), 16, y, 'left');
      plain(c, r.car.slice(0, 22), 120, y, 'left');
      plain(c, r.time, 308, y, 'right');
    });

  const lines = [
    `Elapsed time: ${d.elapsed}`,
    ...(d.penaltySec ? [`Penalty time: ${d.penaltySec} sec`] : []),
    `Average speed: ${String(Math.round(d.averageMph)).padStart(4)} Mph`,
    ...(d.impactMph !== null ? [`Impact speed: ${String(Math.round(d.impactMph)).padStart(4)} Mph`] : []),
    `Top speed: ${String(Math.round(d.topMph)).padStart(4)} Mph`,
  ];
  lines.forEach((t, i) => outlined(c, t, 160, 111 + i * 10, 'center'));

  if (d.prompt) {
    const w = 200;
    const h = 40;
    const x = 60;
    const y = 56;
    c.fillStyle = '#000000';
    c.fillRect(x, y, w, h);
    c.strokeStyle = '#a80000';
    c.lineWidth = 1;
    c.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
    c.font = 'bold 8px monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = LIGHT;
    c.fillText(d.prompt.title, x + 9, y + 11);
    const cursor = Math.floor(performance.now() / 400) % 2 === 0 ? '_' : ' ';
    c.fillStyle = '#fcfc54';
    c.fillText(d.prompt.text + cursor, x + 9, y + 22);
    c.fillStyle = '#a8a8a8';
    c.font = '7px monospace';
    c.fillText(d.prompt.status, x + 9, y + 32);
  }

  buttonRects(d.buttons.length).forEach(([x, y, w, h], i) => {
    const b = d.buttons[i]!;
    // Raised button: light face, dark shadow below and to the right.
    c.fillStyle = DARK;
    c.fillRect(x + 2, y + 2, w, h);
    c.fillStyle = GREY;
    c.fillRect(x, y, w, h);
    c.fillStyle = '#000000';
    c.fillRect(x, y + h - 1, w, 1);
    c.fillRect(x + w - 1, y, 1, h);
    if (i === d.selected) {
      c.strokeStyle = '#fcfc54';
      c.lineWidth = 1;
      c.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    }
    b.label.forEach((t, k) => {
      const ty = y + h / 2 + (k - (b.label.length - 1) / 2) * 8;
      if (b.enabled) outlined(c, t, x + w / 2, ty, 'center');
      else plain(c, t, x + w / 2, ty, 'center', DARK);
    });
  });
}
