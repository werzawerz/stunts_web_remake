import type { LapTime } from '../net/supabase';

/** Race clock as the original shows it: m:ss.hh */
export function formatRaceTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export interface LapResult {
  timeSec: number;
  penaltySec: number;
  carName: string;
}

const NAME_KEY = 'stunts.playerName';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage: the name just isn't remembered.
  }
}

/** HTML overlay shown after the finish: lap time, penalty, name entry and the online top 10. */
export class ResultsPanel {
  readonly el: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly board: HTMLOListElement;
  private readonly status: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private onSubmit: ((name: string) => Promise<void>) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);min-width:44%;max-width:92%;' +
      'background:rgba(0,0,40,0.86);border:3px solid #fcfc54;color:#fcfcfc;font:bold 16px/1.35 monospace;' +
      'padding:14px 18px;display:none;text-align:center;box-shadow:0 0 0 3px #000';
    this.body = document.createElement('div');
    this.form = document.createElement('form');
    this.form.style.cssText = 'margin:10px 0 6px';
    this.input = document.createElement('input');
    this.input.maxLength = 20;
    this.input.placeholder = 'Your name';
    this.input.style.cssText =
      'font:bold 16px monospace;background:#000;color:#fcfc54;border:2px solid #fcfcfc;padding:3px 6px;width:12em';
    const button = document.createElement('button');
    button.textContent = 'Save time';
    button.type = 'submit';
    button.style.cssText =
      'font:bold 16px monospace;margin-left:8px;background:#fcfc54;color:#000;border:2px solid #000;padding:3px 10px;cursor:pointer';
    this.form.append(this.input, button);
    this.status = document.createElement('div');
    this.status.style.cssText = 'min-height:1.35em;color:#a8a8a8';
    const title = document.createElement('div');
    title.textContent = 'BEST TIMES';
    title.style.cssText = 'margin-top:8px;color:#54fcfc';
    this.board = document.createElement('ol');
    this.board.style.cssText = 'margin:4px 0 6px;padding-left:2.2em;text-align:left;white-space:pre';
    const hint = document.createElement('div');
    hint.textContent = 'R: race again   V: change car';
    hint.style.cssText = 'color:#a8a8a8;margin-top:4px';
    this.el.append(this.body, this.form, this.status, title, this.board, hint);
    parent.appendChild(this.el);

    this.input.value = loadName();
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.input.value.trim();
      if (!name || !this.onSubmit) return;
      saveName(name);
      this.form.style.display = 'none';
      this.status.textContent = 'Saving...';
      this.onSubmit(name)
        .then(() => (this.status.textContent = 'Saved!'))
        .catch((err: unknown) => {
          this.status.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
          this.form.style.display = '';
        });
    });
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(result: LapResult, onSubmit: (name: string) => Promise<void>): void {
    const total = result.timeSec + result.penaltySec;
    const lines = [`<div style="color:#fcfc54;font-size:22px">FINISHED</div>`, `<div>${result.carName}</div>`];
    lines.push(`<div>Time ${formatRaceTime(result.timeSec)}</div>`);
    if (result.penaltySec > 0) {
      lines.push(`<div style="color:#fc5454">Penalty +${result.penaltySec} s</div>`);
      lines.push(`<div>Total ${formatRaceTime(total)}</div>`);
    }
    this.body.innerHTML = lines.join('');
    this.onSubmit = onSubmit;
    this.form.style.display = '';
    this.status.textContent = '';
    this.board.innerHTML = '<li>loading...</li>';
    this.el.style.display = '';
    this.input.focus();
  }

  setLeaderboard(rows: LapTime[] | null): void {
    this.board.innerHTML = '';
    if (rows === null) {
      this.board.innerHTML = '<li>offline</li>';
      return;
    }
    if (rows.length === 0) {
      this.board.innerHTML = '<li>no times yet - be the first!</li>';
      return;
    }
    for (const r of rows) {
      const li = document.createElement('li');
      li.textContent = `${formatRaceTime(r.time_ms / 1000).padStart(8)}  ${r.player_name.padEnd(20)} ${r.car}`;
      this.board.appendChild(li);
    }
  }

  hide(): void {
    this.el.style.display = 'none';
    this.input.blur();
  }
}

/** True when the user is typing in a form field (game keys must not react then). */
export const typingInForm = (e: KeyboardEvent): boolean =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
