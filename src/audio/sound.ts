/*
 * Car sounds synthesised with Web Audio, modelled on recordings of the original (Sound Blaster/AdLib
 * output, analysed for pitch, harmonics and envelopes; no original data is used):
 *  - engine: one buzzy tone whose fundamental follows the revs (≈ rpm / 176 Hz: ~5 Hz at idle,
 *    ~44 Hz at 7700 rpm), with strong 5th and 8th harmonics; same loudness on and off the throttle;
 *  - tyre squeal while sliding: ~522 Hz warbling at ~26 Hz, plus its octave;
 *  - crash: ~1.25 s of fading noise with the squeal over the first 0.85 s; the engine stops;
 *  - bump: a short low thud on hard landings.
 * Outside the deterministic simulation: it only reads the car state.
 */

/** Engine fundamental (Hz) for an engine speed, as measured on the original. */
export const engineHz = (rpm: number): number => rpm / 176;

/** Relative amplitudes of the engine tone's harmonics (index = harmonic number). */
const ENGINE_HARMONICS: Record<number, number> = { 1: 0.25, 2: 0.5, 5: 1, 8: 0.89, 13: 0.4, 18: 0.18, 21: 0.16 };

const SKID_HZ = 522;
const SKID_WARBLE_HZ = 26;

export interface SoundState {
  rpm: number;
  /** Tyres sliding (or scraping). */
  skidding: boolean;
  crashed: boolean;
  /** Menus: no engine. */
  silent?: boolean;
}

export class CarSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine!: OscillatorNode;
  private engineGain!: GainNode;
  private skidGain!: GainNode;
  private noise!: AudioBuffer;
  private wasCrashed = false;
  private crashUntil = 0;
  muted = false;

  /** Create the audio graph; call from a user gesture (browsers block audio before one). */
  start(): void {
    playThroughSilentSwitch();
    if (this.ctx || typeof AudioContext === 'undefined') {
      // iOS suspends ("interrupted") the context when the app goes to the background.
      if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.18;
    this.master.connect(ctx.destination);

    // Engine: harmonic series as a periodic wave on one oscillator.
    const top = 22;
    const real = new Float32Array(top);
    const imag = new Float32Array(top);
    for (const [k, a] of Object.entries(ENGINE_HARMONICS)) imag[Number(k)] = a;
    this.engine = ctx.createOscillator();
    this.engine.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    this.engine.frequency.value = engineHz(900);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.5;
    this.engine.connect(this.engineGain).connect(this.master);
    this.engine.start();

    // Squeal: two tones, amplitude-warbled, gated by skidGain.
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    const warble = ctx.createGain();
    warble.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = SKID_WARBLE_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(warble.gain);
    for (const [hz, a] of [
      [SKID_HZ, 0.5],
      [SKID_HZ * 2, 0.16],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(warble);
      o.start();
    }
    lfo.start();
    warble.connect(this.skidGain).connect(this.master);

    // White noise for crashes and bumps.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.18, this.ctx.currentTime, 0.02);
  }

  /** Follow the car; call once per rendered frame. */
  update(s: SoundState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (s.crashed && !this.wasCrashed) this.crash();
    this.wasCrashed = s.crashed;
    // One pending ramp per parameter: piling up a new automation every frame makes Chrome click.
    const glide = (p: AudioParam, v: number, tc: number): void => {
      p.cancelAndHoldAtTime(t);
      p.setTargetAtTime(v, t, tc);
    };
    glide(this.engine.frequency, engineHz(s.rpm), 0.03);
    glide(this.engineGain.gain, s.crashed || s.silent ? 0 : 0.5, 0.02);
    const squeal = (s.skidding && !s.crashed && !s.silent) || t < this.crashUntil;
    glide(this.skidGain.gain, squeal ? 1 : 0, 0.02);
  }

  private burst(seconds: number, shape: (g: AudioParam, t: number) => void, lowpassHz?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    let node: AudioNode = src;
    if (lowpassHz) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpassHz;
      node = node.connect(f);
    }
    node.connect(g).connect(this.master);
    shape(g.gain, ctx.currentTime);
    src.start();
    src.stop(ctx.currentTime + seconds);
  }

  /** Crash: fading noise, squeal over its first 0.85 s. */
  crash(): void {
    if (!this.ctx) return;
    this.crashUntil = this.ctx.currentTime + 0.85;
    this.burst(1.3, (g, t) => {
      g.setValueAtTime(0.55, t);
      g.linearRampToValueAtTime(0.35, t + 0.85);
      g.setValueAtTime(0.2, t + 0.86);
      g.linearRampToValueAtTime(0.12, t + 1.25);
      g.linearRampToValueAtTime(0, t + 1.3);
    });
  }

  /** Hard landing or a knock: a short low thud, louder for harder hits (strength 0..1). */
  bump(strength: number): void {
    if (!this.ctx) return;
    const a = 1.6 * Math.min(1, Math.max(0.3, strength));
    this.burst(0.35, (g, t) => {
      g.setValueAtTime(a, t);
      g.exponentialRampToValueAtTime(0.01, t + 0.3);
    }, 300);
  }
}

let silentClip: HTMLAudioElement | null = null;

/**
 * iPhones mute web audio when the ring/silent switch is on, as if it were a ringtone. Declaring the
 * page's audio as media playback lifts that (Safari 16.4+: navigator.audioSession); older iOS gets
 * the same from a silent clip playing in an audio element. Call from a user gesture.
 */
function playThroughSilentSwitch(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // Not allowed here; the clip below still helps.
    }
  }
  if (silentClip || typeof Audio === 'undefined') return;
  // A tenth of a second of silence (8 kHz, 8-bit mono WAV), looped.
  const n = 800;
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const text = (o: number, t: string): void => [...t].forEach((ch, i) => (bytes[o + i] = ch.charCodeAt(0)));
  text(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  text(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  text(36, 'data');
  dv.setUint32(40, n, true);
  bytes.fill(128, 44); // 8-bit silence
  silentClip = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
  silentClip.loop = true;
  silentClip.setAttribute('playsinline', '');
  void silentClip.play().catch(() => {
    silentClip = null; // try again on the next gesture
  });
}
