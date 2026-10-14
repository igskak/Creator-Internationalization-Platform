// The placeholder beat of a Reel (plan 18 decision RL-7, M8-08): a royalty-free 120 BPM pattern
// made in code, so there is no licence to hold. Kick and clap enter after the hook scene, a pulse
// of bass and hats carries the hook, a short pop marks every cut, an impact lands on the peak
// scene and a riser leads out of the flash opener. Port of spikes/reels/make-sound.py; owner-
// supplied licensed tracks come later (Q-08) and use the same slot in the assembly.

export const SAMPLE_RATE = 44_100;
const BEAT_SECONDS = 0.5;
/** The audio ends with a fade of this length, so the cut at the end of the video is not abrupt. */
const FADE_OUT_SECONDS = 0.35;
/** Peak of the mix, in full scale: 0.85 is −1.4 dBFS, which leaves the true peak below −1 dBTP. */
const PEAK = 0.85;
/**
 * Soft clipping before the final peak scaling: drums are all peaks, and without it the mix sits
 * near −21 LUFS, quieter than the feed it plays in. A drive of 1.4 brings it to about −15 LUFS
 * (measured with ebur128: −15.3 LUFS, true peak −1.1 dBTP); a drive of 1.8 already reaches −0.8 dBTP.
 */
const SOFT_CLIP_DRIVE = 1.4;
/** Fixed seed: the same Reel always gets the same beat, so the input hash stays honest. */
const SEED = 7;

export type BeatEventKind =
  | "kick"
  | "clap"
  | "hat"
  | "hat-open"
  | "bass"
  | "pop"
  | "boom"
  | "riser";
export type BeatEvent = {
  /** Seconds from the start of the audio. */
  time: number;
  kind: BeatEventKind;
  gain: number;
  /** Bass and pop pitch (Hz), riser length (s). */
  param?: number;
  /** Bass note length (s). */
  length?: number;
};

export type BeatInput = {
  /** Length of each scene in beats (half a second each), in order. */
  sceneBeats: readonly number[];
  /** Seconds of flash opener before the first scene; the beat starts after it. */
  flashSeconds: number;
  /** Index of the scene that gets the impact (the PEAK scene); none when absent. */
  peakSceneIndex?: number | undefined;
};

/** Length of the audio: the flash opener plus every scene, exactly as long as the video. */
export function beatDurationSeconds(input: BeatInput): number {
  const beats = input.sceneBeats.reduce((a, b) => a + b, 0);
  return Math.round((input.flashSeconds + beats * BEAT_SECONDS) * 1000) / 1000;
}

/** What plays when: the whole pattern as data, so the grid is tested without synthesizing a sample. */
export function beatSchedule(input: BeatInput): BeatEvent[] {
  const events: BeatEvent[] = [];
  const starts: number[] = [];
  let acc = 0;
  for (const d of input.sceneBeats) {
    starts.push(acc);
    acc += d;
  }
  const totalBeats = acc;
  // 8th-note grid.
  for (let step = 0; step < totalBeats * 2; step++) {
    const time = input.flashSeconds + (step * BEAT_SECONDS) / 2;
    const onBeat = step % 2 === 0;
    const beatNo = Math.floor(step / 2);
    let scene = 0;
    for (const [i, s] of starts.entries()) if (s <= step / 2 + 1e-9) scene = i;
    const intro = scene === 0;
    if (onBeat && !intro) events.push({ time, kind: "kick", gain: 0.9 });
    if (onBeat && beatNo % 2 === 1 && !intro) events.push({ time, kind: "clap", gain: 0.35 });
    events.push({ time, kind: onBeat ? "hat" : "hat-open", gain: onBeat ? 0.22 : 0.3 });
    if (!onBeat && !intro) {
      events.push({ time, kind: "bass", gain: 0.55, param: beatNo % 4 < 2 ? 55 : 73.4 });
    }
    if (intro && onBeat) events.push({ time, kind: "bass", gain: 0.55, param: 55, length: 0.3 });
  }
  // A pop on every cut after the first scene.
  for (const [i, s] of starts.entries()) {
    if (i > 0) {
      events.push({
        time: input.flashSeconds + s * BEAT_SECONDS,
        kind: "pop",
        gain: 0.5,
        param: i % 2 ? 1400 : 1800,
      });
    }
  }
  const peak = input.peakSceneIndex;
  const peakStart = peak === undefined ? undefined : starts[peak];
  if (peakStart !== undefined && peak !== 0) {
    events.push({
      time: input.flashSeconds + peakStart * BEAT_SECONDS - 0.02,
      kind: "boom",
      gain: 0.75,
    });
  }
  if (input.flashSeconds > 0) {
    events.push({ time: 0, kind: "riser", gain: 0.5, param: input.flashSeconds });
  }
  return events.sort((a, b) => a.time - b.time);
}

/** mulberry32: a small seeded generator, so the noise of the hats and the clap never changes. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

function voices(rand: () => number) {
  const noise = () => rand() * 2 - 1;
  const make = (
    seconds: number,
    sample: (k: number, t: number, n: number) => number,
  ): Float32Array => {
    const n = Math.floor(seconds * SAMPLE_RATE);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = sample(k, k / SAMPLE_RATE, n);
    return out;
  };
  return {
    kick: () =>
      make(
        0.28,
        (_k, t) =>
          Math.sin(TAU * (48 * t + (70 * (1 - Math.exp(-t * 30))) / 30)) * Math.exp(-t * 11),
      ),
    clap: () => make(0.16, (_k, t) => noise() * Math.exp(-t * 28) * 0.8),
    hat: (open: boolean) => {
      let prev = 0;
      const decay = open ? 20 : 90;
      return make(open ? 0.12 : 0.035, (_k, t) => {
        const x = noise();
        const y = (x - prev) * Math.exp(-t * decay) * 0.5;
        prev = x;
        return y;
      });
    },
    bass: (f: number, length = 0.22) =>
      make(length, (_k, t) => Math.sin(TAU * f * t) * Math.exp(-t * 7) * 0.9),
    pop: (f: number) => make(0.07, (_k, t) => Math.sin(TAU * f * t) * Math.exp(-t * 55) * 0.5),
    boom: () =>
      make(
        0.9,
        (_k, t) => Math.sin(TAU * (38 + 60 * Math.exp(-t * 9)) * t) * Math.exp(-t * 3.2) * 1.2,
      ),
    riser: (length: number) => {
      let phase = 0;
      return make(length, (k, _t, n) => {
        const p = k / n;
        phase += (TAU * (300 + 2600 * p * p)) / SAMPLE_RATE;
        return (Math.sin(phase) * 0.25 + noise() * 0.2) * p * 0.6;
      });
    },
  };
}

export type Beat = {
  /** A mono 16-bit WAV file. */
  wav: Uint8Array;
  durationSeconds: number;
  /** Peak and mean level of the mix in dBFS, for the checks. */
  peakDb: number;
  rmsDb: number;
};

const db = (x: number) =>
  x <= 0 ? Number.NEGATIVE_INFINITY : Math.round(20 * Math.log10(x) * 100) / 100;

/** A 16-bit mono WAV file of the samples. */
export function encodeWav(samples: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return new Uint8Array(buffer);
}

export function synthesizeBeat(input: BeatInput): Beat {
  if (input.sceneBeats.length === 0) throw new Error("A beat needs scenes.");
  const seconds = beatDurationSeconds(input);
  const total = Math.floor(seconds * SAMPLE_RATE);
  const buf = new Float32Array(total);
  const v = voices(random(SEED));
  const add = (time: number, samples: Float32Array, gain: number) => {
    const start = Math.floor(time * SAMPLE_RATE);
    for (let k = 0; k < samples.length; k++) {
      const i = start + k;
      if (i >= 0 && i < total) buf[i] = (buf[i] ?? 0) + (samples[k] ?? 0) * gain;
    }
  };
  for (const e of beatSchedule(input)) {
    switch (e.kind) {
      case "kick":
        add(e.time, v.kick(), e.gain);
        break;
      case "clap":
        add(e.time, v.clap(), e.gain);
        break;
      case "hat":
        add(e.time, v.hat(false), e.gain);
        break;
      case "hat-open":
        add(e.time, v.hat(true), e.gain);
        break;
      case "bass":
        add(e.time, v.bass(e.param ?? 55, e.length), e.gain);
        break;
      case "pop":
        add(e.time, v.pop(e.param ?? 1400), e.gain);
        break;
      case "boom":
        add(e.time, v.boom(), e.gain);
        break;
      case "riser":
        add(e.time, v.riser(e.param ?? 0.88), e.gain);
        break;
    }
  }
  // Fade out at the end, then bring the peak to −1 dBFS.
  const fadeStart = seconds - FADE_OUT_SECONDS;
  let peak = 0;
  for (let k = 0; k < total; k++) {
    const t = k / SAMPLE_RATE;
    const f = t > fadeStart ? Math.max(0, 1 - (t - fadeStart) / FADE_OUT_SECONDS) : 1;
    const x = Math.tanh((buf[k] ?? 0) * f * SOFT_CLIP_DRIVE) / Math.tanh(SOFT_CLIP_DRIVE);
    buf[k] = x;
    peak = Math.max(peak, Math.abs(x));
  }
  const scale = peak > 0 ? PEAK / peak : 0;
  const pcm = new Int16Array(total);
  let sumSquares = 0;
  let outPeak = 0;
  for (let k = 0; k < total; k++) {
    const x = Math.max(-1, Math.min(1, (buf[k] ?? 0) * scale));
    pcm[k] = Math.round(x * 32767);
    sumSquares += x * x;
    outPeak = Math.max(outPeak, Math.abs(x));
  }
  return {
    wav: encodeWav(pcm),
    durationSeconds: seconds,
    peakDb: db(outPeak),
    rmsDb: db(Math.sqrt(sumSquares / total)),
  };
}
