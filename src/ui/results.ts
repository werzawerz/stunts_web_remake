/** Race clock as the original shows it: m:ss.hh */
export function formatRaceTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

const NAME_KEY = 'stunts.playerName';

/** The player's name from last time (for the leaderboard), or ''. */
export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private mode or blocked storage: the name just isn't remembered.
  }
}

/** True when the user is typing in a form field (game keys must not react then). */
export const typingInForm = (e: KeyboardEvent): boolean =>
  e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
