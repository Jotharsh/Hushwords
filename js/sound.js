// Small synthesized sound effects, so there are no audio files to load. Starts only after a first tap, as browsers require.
import * as store from './store.js';

let ctx = null, master = null;
let muted = store.muted.get();
export const isMuted = () => muted;
export function setMuted(v) { muted = v; store.muted.set(v); }

function audio() {
  if (muted) return null;
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0 } = {}) {
  const c = audio(); if (!c) return;
  const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.25, at = 0, freq = 1800, q = 0.8 } = {}) {
  const c = audio(); if (!c) return;
  const t = c.currentTime + at, len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(master); s.start(t);
}
export const buzz = (ms) => { try { if (!muted) navigator.vibrate?.(ms); } catch {} };

export const sfx = {
  select() { tone(520, 0.07, { type: 'triangle', vol: 0.18 }); buzz(8); },
  flip() { noise(0.09, { vol: 0.28, freq: 2400, q: 1.2 }); tone(180, 0.08, { type: 'triangle', vol: 0.12, slide: -60 }); },
  good() { sfx.flip(); tone(660, 0.14, { vol: 0.22, at: 0.07 }); tone(990, 0.22, { vol: 0.22, at: 0.17 }); buzz(18); },
  wrong() { sfx.flip(); tone(190, 0.28, { type: 'sawtooth', vol: 0.2, at: 0.06, slide: -70 }); buzz([30, 40, 30]); },
  boom() { noise(0.7, { vol: 0.5, freq: 160, q: 0.5 }); tone(90, 0.9, { type: 'sine', vol: 0.5, slide: -55 }); tone(60, 1.1, { type: 'sine', vol: 0.4, at: 0.1, slide: -30 }); buzz([60, 40, 120]); },
  clue() { tone(784, 0.5, { vol: 0.2, type: 'sine' }); tone(1176, 0.9, { vol: 0.12, at: 0.05, type: 'sine' }); buzz(12); },
  turn() { tone(440, 0.12, { type: 'triangle', vol: 0.14 }); tone(554, 0.16, { type: 'triangle', vol: 0.14, at: 0.1 }); },
  tick() { tone(1400, 0.04, { type: 'square', vol: 0.06 }); },
  win() { [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.45, { vol: 0.2, at: i * 0.11, type: 'triangle' })); tone(262, 1.2, { vol: 0.2, at: 0.1, type: 'sine' }); buzz([20, 30, 20, 30, 60]); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.5, { vol: 0.17, at: i * 0.2, type: 'sine' })); },
};
