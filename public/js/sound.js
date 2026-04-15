/**
 * CardRoyal Sound Effects
 * Pure Web Audio API — no external files needed
 */

const _AC = window.AudioContext || window.webkitAudioContext;
let _ctx = null;
let _muted = false;

function _getCtx() {
  if (!_ctx) _ctx = new _AC();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

// ── Noise buffer helper ────────────────────────────────────────────────────────
function _noise(ctx, durationSec) {
  const n    = Math.floor(ctx.sampleRate * durationSec);
  const buf  = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src  = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

// ── Public SFX object ─────────────────────────────────────────────────────────
const SFX = {

  /** Card whoosh — played when card starts flying from deck */
  cardWhoosh() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;
    const dur = 0.22;

    const src  = _noise(ctx, dur);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(2400, now);
    band.frequency.linearRampToValueAtTime(600, now + dur);
    band.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(band); band.connect(gain); gain.connect(ctx.destination);
    src.start(now);
  },

  /** Card flip — played at midpoint when face-down flips face-up */
  cardFlip() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    // High click
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.07);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.07);
  },

  /** Card land — soft thud when card hits the pile */
  cardLand() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.12);
  },

  /** Shuffle — rapid card-flick noise burst */
  shuffle(durationMs = 3000) {
    if (_muted) return;
    const ctx   = _getCtx();
    const count = Math.floor(durationMs / 65);

    for (let i = 0; i < count; i++) {
      const t    = ctx.currentTime + i * 0.065;
      const src  = _noise(ctx, 0.045);
      const hi   = ctx.createBiquadFilter();
      hi.type = 'highpass';
      hi.frequency.value = 1400 + Math.random() * 1200;

      const gain = ctx.createGain();
      const vol  = 0.06 + Math.random() * 0.05;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      src.connect(hi); hi.connect(gain); gain.connect(ctx.destination);
      src.start(t);
    }
  },

  /** Win fanfare — ascending major arpeggio */
  win() {
    if (_muted) return;
    const ctx   = _getCtx();
    const now   = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C E G C E

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.14;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.5);
    });

    // Gold shimmer overtone
    setTimeout(() => {
      const s = _getCtx();
      const t = s.currentTime;
      const o = s.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2093, t);
      o.frequency.exponentialRampToValueAtTime(1760, t + 0.6);
      const g = s.createGain();
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g); g.connect(s.destination);
      o.start(t); o.stop(t + 0.6);
    }, 400);
  },

  /** Lose — descending minor tones */
  lose() {
    if (_muted) return;
    const ctx   = _getCtx();
    const now   = ctx.currentTime;
    const notes = [392, 311.13, 246.94]; // G Eb B

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 600;

      const gain = ctx.createGain();
      const t = now + i * 0.22;
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      osc.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.4);
    });
  },

  /** Coin — bet placed */
  coin() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    [1318, 1760].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      osc.type   = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.06;
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.35);
    });
  },

  /** Tick — urgent countdown timer */
  tick() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1100;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.03);
  },

  /** Button click */
  click() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(700, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.04);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.04);
  },

  /** Room join / player joined chime */
  join() {
    if (_muted) return;
    const ctx   = _getCtx();
    const now   = ctx.currentTime;
    const notes = [659, 880];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.25);
    });
  },

  /** Win card reveal — special chime */
  winCard() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    [1046, 1318, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.08;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.4);
    });
  },

  /** Game start — double chime */
  gameStart() {
    if (_muted) return;
    const ctx = _getCtx();
    const now = ctx.currentTime;

    [523, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.4);
    });
  },

  // ── Mute toggle ──────────────────────────────────────────────────────────────
  toggleMute() {
    _muted = !_muted;
    return _muted;
  },
  isMuted() { return _muted; }
};

// Unlock audio context on first user interaction (browser autoplay policy)
['click','keydown','touchstart'].forEach(e =>
  document.addEventListener(e, () => { if (_ctx && _ctx.state === 'suspended') _ctx.resume(); }, { once: true })
);
