"use client";

/** Optional sound, OFF by default. Short soft tones via WebAudio; no assets. */
const KEY = "cw-sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

let ctx: AudioContext | null = null;

export function playTone(kind: "reveal-good" | "reveal-ok" | "tap"): void {
  if (!soundEnabled()) return;
  try {
    ctx ??= new AudioContext();
    const notes = kind === "reveal-good" ? [523, 659, 784] : kind === "reveal-ok" ? [440, 523] : [660];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const t = ctx!.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch {
    /* audio unavailable */
  }
}
