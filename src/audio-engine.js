const AUDIO_PREF_KEY = "emberfall-audio-muted-v1";

const midiToFrequency = (note) => 440 * 2 ** ((note - 69) / 12);

export class EmberAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.musicTimer = null;
    this.nextStepTime = 0;
    this.musicStep = 0;
    this.muted = localStorage.getItem(AUDIO_PREF_KEY) === "1";
    this.lastPlayed = new Map();
  }

  async unlock() {
    this.ensureContext();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (!this.musicTimer) this.startMusic();
    return !this.muted;
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem(AUDIO_PREF_KEY, this.muted ? "1" : "0");
    this.ensureContext();
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, now, 0.025);
    if (!this.muted) void this.unlock();
    return !this.muted;
  }

  isEnabled() {
    return !this.muted;
  }

  play(name, intensity = 1) {
    if (this.muted) return;
    this.ensureContext();
    if (this.context.state === "suspended") return;
    const now = this.context.currentTime;
    const throttles = {
      attackHit: 0.055,
      magicHit: 0.07,
      enemyPhysicalShot: 0.12,
      enemyMagicShot: 0.12,
      playerPhysicalHit: 0.12,
      playerMagicHit: 0.12,
      pickup: 0.06,
    };
    const throttle = throttles[name] ?? 0;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < throttle) return;
    this.lastPlayed.set(name, now);
    const power = Math.max(0.25, Math.min(2, intensity));

    switch (name) {
      case "attackCast":
        this.sweep(210, 480, 0.13, 0.055 * power, "triangle");
        break;
      case "attackRelease":
        this.sweep(620, 280, 0.1, 0.07 * power, "sawtooth");
        this.noise(0.08, 0.025 * power, 1900);
        break;
      case "attackHit":
        this.tone(118, 0.09, 0.075 * power, "square");
        this.noise(0.075, 0.05 * power, 720);
        break;
      case "magicHit":
        this.tone(420, 0.13, 0.05 * power, "sine", 12);
        this.tone(630, 0.11, 0.035 * power, "triangle", -7);
        break;
      case "novaCast":
        this.chord([50, 57, 62], 0.58, 0.032 * power, "sine", 0.08);
        this.sweep(120, 260, 0.65, 0.035 * power, "triangle");
        break;
      case "novaRelease":
        this.tone(54, 0.55, 0.16 * power, "sine");
        this.sweep(180, 760, 0.35, 0.095 * power, "sawtooth");
        this.noise(0.42, 0.11 * power, 520);
        break;
      case "dash":
        this.sweep(980, 150, 0.22, 0.08 * power, "sine");
        this.noise(0.2, 0.07 * power, 2600);
        break;
      case "wardCast":
        this.chord([57, 64, 69], 0.48, 0.027 * power, "triangle", 0.05);
        break;
      case "wardRelease":
        this.chord([62, 69, 74, 78], 0.7, 0.04 * power, "sine", 0.045);
        this.sweep(240, 520, 0.32, 0.04 * power, "triangle");
        break;
      case "potion":
        [69, 74, 81].forEach((note, index) => {
          this.tone(
            midiToFrequency(note),
            0.22,
            0.04 * power,
            "sine",
            0,
            now + index * 0.07,
          );
        });
        break;
      case "enemyPhysicalShot":
        this.sweep(340, 155, 0.13, 0.04 * power, "square");
        this.noise(0.09, 0.035 * power, 1300);
        break;
      case "enemyMagicShot":
        this.sweep(350, 780, 0.21, 0.035 * power, "sine");
        break;
      case "playerPhysicalHit":
        this.tone(72, 0.18, 0.12 * power, "square");
        this.noise(0.13, 0.09 * power, 480);
        break;
      case "playerMagicHit":
        this.tone(92, 0.25, 0.105 * power, "sine");
        this.sweep(520, 170, 0.24, 0.07 * power, "triangle");
        break;
      case "enemyDeath":
        this.sweep(180, 48, 0.3, 0.075 * power, "sawtooth");
        this.noise(0.23, 0.055 * power, 850);
        break;
      case "pickup":
        this.tone(740, 0.12, 0.035 * power, "sine");
        this.tone(980, 0.16, 0.025 * power, "sine", 0, now + 0.045);
        break;
      case "gear":
        [62, 69, 74, 81].forEach((note, index) => {
          this.tone(
            midiToFrequency(note),
            0.34,
            0.035 * power,
            "triangle",
            0,
            now + index * 0.065,
          );
        });
        break;
      case "levelUp":
        [57, 62, 66, 69, 74].forEach((note, index) => {
          this.tone(
            midiToFrequency(note),
            0.42,
            0.045 * power,
            "sine",
            0,
            now + index * 0.075,
          );
        });
        break;
      case "bossPhysicalWarning":
        this.tone(55, 0.72, 0.16 * power, "sawtooth");
        this.tone(55, 0.22, 0.13 * power, "square", 0, now + 0.5);
        break;
      case "bossMagicWarning":
        this.chord([40, 46, 53], 1.25, 0.07 * power, "sawtooth", 0.07);
        this.sweep(160, 520, 1.12, 0.045 * power, "sine");
        break;
      case "bossPhysicalImpact":
        this.tone(42, 0.62, 0.21 * power, "sine");
        this.noise(0.48, 0.16 * power, 310);
        break;
      case "bossMagicImpact":
        this.chord([35, 41, 47], 0.75, 0.11 * power, "sawtooth");
        this.noise(0.6, 0.11 * power, 980);
        break;
      case "regionClear":
        this.chord([50, 57, 62, 66], 1.1, 0.045 * power, "triangle", 0.08);
        break;
      default:
        break;
    }
  }

  ensureContext() {
    if (this.context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.music = this.context.createGain();
    this.effects = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.music.gain.value = 0.19;
    this.effects.gain.value = 0.82;
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;
    this.music.connect(this.master);
    this.effects.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.noiseBuffer = this.createNoiseBuffer();
  }

  startMusic() {
    this.nextStepTime = this.context.currentTime + 0.08;
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 35);
    this.scheduleMusic();
  }

  scheduleMusic() {
    if (!this.context || this.context.state !== "running") return;
    const secondsPerStep = 60 / 76 / 2;
    while (this.nextStepTime < this.context.currentTime + 0.18) {
      this.scheduleMusicStep(this.musicStep, this.nextStepTime);
      this.musicStep = (this.musicStep + 1) % 64;
      this.nextStepTime += secondsPerStep;
    }
  }

  scheduleMusicStep(step, when) {
    const roots = [43, 41, 38, 40];
    const bar = Math.floor(step / 16);
    const root = roots[bar];
    const local = step % 16;
    if (local === 0) {
      this.musicChord([root, root + 7, root + 12], when, 5.8, 0.018);
      this.musicTone(root - 12, when, 1.8, 0.06, "sine");
    }
    if ([0, 6, 8, 14].includes(local)) {
      const offset = local === 6 ? 7 : local === 14 ? 5 : 0;
      this.musicTone(root - 12 + offset, when, 0.72, 0.044, "triangle");
    }
    if (local % 2 === 0) {
      const arp = [0, 7, 12, 14, 12, 7, 5, 7][local / 2];
      this.musicTone(root + 12 + arp, when, 0.52, 0.015, "sine");
    }
    if (local === 0 || local === 8) {
      this.noise(0.16, 0.024, 170, when, this.music);
    }
    if (local === 4 || local === 12) {
      this.noise(0.08, 0.014, 2300, when, this.music);
    }
  }

  musicTone(note, when, duration, volume, type) {
    this.tone(
      midiToFrequency(note),
      duration,
      volume,
      type,
      0,
      when,
      this.music,
    );
  }

  musicChord(notes, when, duration, volume) {
    notes.forEach((note, index) => {
      this.musicTone(note, when + index * 0.035, duration, volume, "sine");
    });
  }

  tone(
    frequency,
    duration,
    volume,
    type = "sine",
    detune = 0,
    when = this.context.currentTime,
    destination = this.effects,
  ) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), when);
    oscillator.detune.setValueAtTime(detune, when);
    filter.type = "lowpass";
    filter.frequency.value = destination === this.music ? 1600 : 4200;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), when + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.04);
  }

  sweep(start, end, duration, volume, type = "sine") {
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, start), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.04);
  }

  chord(
    notes,
    duration,
    volume,
    type = "sine",
    stagger = 0,
  ) {
    const now = this.context.currentTime;
    notes.forEach((note, index) => {
      this.tone(
        midiToFrequency(note),
        duration,
        volume,
        type,
        0,
        now + stagger * index,
      );
    });
  }

  noise(
    duration,
    volume,
    cutoff,
    when = this.context.currentTime,
    destination = this.effects,
  ) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(Math.max(0.0002, volume), when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(when);
    source.stop(when + duration);
  }

  createNoiseBuffer() {
    const length = Math.floor(this.context.sampleRate * 1.2);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.86 + white * 0.14;
      data[index] = last;
    }
    return buffer;
  }
}
