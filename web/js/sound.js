const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export class Sound {
  constructor(enabled = false) {
    this.enabled = enabled;
    this.context = null;
    this.master = null;
  }

  wake() {
    if (this.enabled) this.#resume();
  }

  toggle() {
    if (this.enabled) { this.enabled = false; return false; }
    if (!this.#ensure()) return null;
    this.enabled = true;
    this.#resume();
    this.#note(660, 0, 0.12, 0.12, "sine", 784);
    return true;
  }

  drop() {
    this.#note(132, 0, 0.18, 0.28, "triangle", 72);
    this.#note(330, 0.015, 0.1, 0.08, "sine", 245);
  }

  rivalDrop() { this.#note(494, 0, 0.1, 0.07, "sine", 440); }

  candle() {
    this.#note(659, 0, 0.14, 0.1, "sine", 659);
    this.#note(554, 0.16, 0.17, 0.12, "sine", 554);
    this.#note(440, 0.36, 0.25, 0.15, "triangle", 392);
  }

  tip() {
    this.#note(164, 0, 0.55, 0.32, "triangle", 55);
    this.#note(82, 0.04, 0.42, 0.14, "sine", 48);
  }

  survive(flat = false) {
    const notes = flat ? [523, 659, 784, 988] : [523, 659, 784];
    notes.forEach((freq, i) => this.#note(freq, i * 0.12, 0.2, 0.13, "sine", freq * 1.01));
  }

  fall() {
    this.#note(246, 0, 0.32, 0.25, "triangle", 92);
    this.#note(123, 0.12, 0.34, 0.16, "sine", 55);
  }

  refund() {
    this.#note(392, 0, 0.18, 0.1, "sine", 392);
    this.#note(523, 0.13, 0.2, 0.12, "sine", 523);
  }

  claim() {
    [659, 784, 988].forEach((freq, i) => this.#note(freq, i * 0.09, 0.2, 0.12, "sine", freq * 1.01));
  }

  #ensure() {
    if (this.context) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = 0.72;
    this.master.connect(this.context.destination);
    return true;
  }

  #resume() {
    if (this.context?.state === "suspended") this.context.resume().catch(() => {});
  }

  #note(frequency, delay, duration, volume, type, endFrequency) {
    if (!this.enabled || !this.#ensure()) return;
    const ctx = this.context;
    this.#resume();
    const start = ctx.currentTime + delay;
    const end = start + duration;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(clamp(frequency, 35, 1800), start);
    oscillator.frequency.exponentialRampToValueAtTime(clamp(endFrequency, 35, 1800), end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.018, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
