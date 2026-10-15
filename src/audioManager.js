// Gestor de audio aislado y optimizado para evitar bloqueos en el hilo principal
class SoundManager {
  constructor() {
    this.ctx = null;
    this.noiseBuffer = null;
    this.lastTriggerTime = 0;
    this.activeVoices = 0;
    this.maxConcurrentVoices = 3; // Limitar polifonía para proteger el rendimiento

    this.sparkleFrequencies = [2093, 2637, 3136, 3951, 4700, 5274]; // Escala cristalina C7-E8
    this.isUnlocked = false;
    this.fxEnabled = true;

    this.setupUnlockListeners();
  }

  // Inicialización lazy y desbloqueo seguro ante interacción del usuario
  setupUnlockListeners() {
    const unlock = () => {
      this.getAudioContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.ctx && this.ctx.state === 'running') {
        this.isUnlocked = true;
      }
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  getAudioContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        this.ctx = new AudioContextClass();
        this.precalculateNoiseBuffer();
      } catch {
        return null;
      }
    }
    return this.ctx;
  }

  // Pre-generar el búfer de ruido una sola vez en memoria (evita recolector de basura y micro-tirones)
  precalculateNoiseBuffer() {
    if (this.noiseBuffer || !this.ctx) return;
    try {
      const duration = 0.12;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // Envolvente decreciente pre-calculada
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
      }
    } catch {
      this.noiseBuffer = null;
    }
  }

  playGlitter() {
    if (!this.fxEnabled) return;
    const nowMs = performance.now();
    // Throttle rápido (mínimo 70ms entre llamadas)
    if (nowMs - this.lastTriggerTime < 70) return;
    if (this.activeVoices >= this.maxConcurrentVoices) return;

    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') {
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return;
    }

    this.lastTriggerTime = nowMs;
    this.activeVoices++;

    const now = ctx.currentTime;

    // Nodo de ganancia maestro para esta instancia de glitter
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    masterGain.connect(ctx.destination);

    // Campanillas sintetizadas ligeras (5 osciladores)
    const tonesCount = 5;
    for (let i = 0; i < tonesCount; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = this.sparkleFrequencies[i % this.sparkleFrequencies.length] * (0.97 + Math.random() * 0.06);
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      const startTime = now + i * 0.028 + Math.random() * 0.012;
      const duration = 0.07 + Math.random() * 0.03;

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.01);
    }

    // Shimmer aéreo usando el búfer pre-calculado
    if (this.noiseBuffer) {
      try {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(6000, now);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.04, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(masterGain);

        noise.start(now);
      } catch {
        // En caso de error en nodo de ruido, continuar normalmente
      }
    }

    // Liberar voz activa al terminar la reproducción
    setTimeout(() => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      masterGain.disconnect();
    }, 450);
  }

  // Impacto de bola de cristal en caja de madera (Modo Relax / Caja de bolas):
  // 1. Resonancia de madera (knock cálido percusivo ~200-260Hz)
  // 2. Tintineo cristalino brillante (~2400-3200Hz) con armónico de canica
  playWoodGlassHit(intensity = 0.5) {
    if (!this.fxEnabled) return;
    const nowMs = performance.now();
    if (nowMs - (this.lastWoodHitTime || 0) < 55) return;
    this.lastWoodHitTime = nowMs;

    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const master = ctx.createGain();
    const clampedInt = Math.max(0.18, Math.min(1.0, intensity));
    master.gain.setValueAtTime(0.32 * clampedInt, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    master.connect(ctx.destination);

    // Componente 1: Cuerpo resonante de madera (knock hueco y percusivo)
    const woodOsc = ctx.createOscillator();
    const woodGain = ctx.createGain();
    const woodFreq = 210 + Math.random() * 50;
    woodOsc.type = 'sine';
    woodOsc.frequency.setValueAtTime(woodFreq * 1.5, now);
    woodOsc.frequency.exponentialRampToValueAtTime(woodFreq, now + 0.022);

    woodGain.gain.setValueAtTime(0.55 * clampedInt, now);
    woodGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    woodOsc.connect(woodGain);
    woodGain.connect(master);
    woodOsc.start(now);
    woodOsc.stop(now + 0.09);

    // Componente 2: Clic/tintineo de canica de cristal nítida
    const glassOsc = ctx.createOscillator();
    const glassGain = ctx.createGain();
    const glassFreq = 2600 + Math.random() * 600;
    glassOsc.type = 'triangle';
    glassOsc.frequency.setValueAtTime(glassFreq, now);

    glassGain.gain.setValueAtTime(0.0001, now);
    glassGain.gain.linearRampToValueAtTime(0.32 * clampedInt, now + 0.002);
    glassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    glassOsc.connect(glassGain);
    glassGain.connect(master);
    glassOsc.start(now);
    glassOsc.stop(now + 0.05);

    // Componente 3: Armónico cristalino agudo
    const clinkOsc = ctx.createOscillator();
    const clinkGain = ctx.createGain();
    clinkOsc.type = 'sine';
    clinkOsc.frequency.setValueAtTime(glassFreq * 1.6, now);
    clinkGain.gain.setValueAtTime(0.14 * clampedInt, now);
    clinkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    clinkOsc.connect(clinkGain);
    clinkGain.connect(master);
    clinkOsc.start(now);
    clinkOsc.stop(now + 0.04);

    setTimeout(() => master.disconnect(), 180);
  }

  // Cristal roto: crujido de ruido agudo + fragmentos tintineantes inarmónicos
  playGlassBreak() {
    if (!this.fxEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    masterGain.connect(ctx.destination);

    if (this.noiseBuffer) {
      try {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(3500, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.9, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(masterGain);
        noise.start(now);
      } catch {
        // continuar con los tintineos
      }
    }

    for (let i = 0; i < 9; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = now + Math.random() * 0.22;
      const dur = 0.05 + Math.random() * 0.12;
      osc.frequency.setValueAtTime(2400 + Math.random() * 5200, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }

    setTimeout(() => masterGain.disconnect(), 800);
  }

  // Victoria: fanfarria "ti ti ti tiii, ti tiii, ti ti tiiii" + aplauso breve
  playVictory() {
    if (!this.fxEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }

    const now = ctx.currentTime + 0.05;
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    // [midi, duración en segundos]
    const fanfare = [
      [72, 0.11], [72, 0.11], [72, 0.11], [72, 0.38],
      [68, 0.38], [70, 0.38],
      [72, 0.13], [70, 0.13], [72, 0.9],
    ];
    let t = now;
    for (const [midi, dur] of fanfare) {
      for (const [type, mult, level] of [['square', 1, 0.22], ['triangle', 0.5, 0.35]]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12) * mult, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.01);
        gain.gain.setValueAtTime(level, t + dur * 0.75);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + dur);
      }
      t += dur;
    }

    // Aplauso: multitud estéreo de muchas palmas superpuestas, suavizadas y normalizadas
    try {
      const applauseStart = now + 1.2;
      const length = 2.6;
      const sr = ctx.sampleRate;
      const total = Math.floor(sr * length);
      const buffer = ctx.createBuffer(2, total, sr);

      for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        let i = 0;
        while (i < total) {
          const pos = i / total;
          // Envolvente: crece rápido, se mantiene y se desvanece al final
          const swell = Math.min(1, pos / 0.25);
          const fade = pos > 0.55 ? Math.max(0, 1 - (pos - 0.55) / 0.45) : 1;
          const level = swell * swell * (3 - 2 * Math.min(1, swell)) * fade * fade;

          // Cada palma: ataque suave y caída exponencial con ruido filtrado
          const clapLen = Math.floor(sr * (0.015 + Math.random() * 0.03));
          const attack = Math.max(2, Math.floor(sr * 0.0015));
          const amp = (0.25 + Math.random() * 0.75) * level;
          let lp = 0;
          for (let k = 0; k < clapLen && i + k < total; k++) {
            lp += 0.28 * ((Math.random() * 2 - 1) - lp); // paso bajo: quita el siseo agudo
            const env = Math.min(1, k / attack) * Math.exp(-k / (clapLen * 0.28));
            data[i + k] += lp * amp * env;
          }
          // Alta densidad para textura de multitud, no de chasquidos aislados
          i += Math.max(1, Math.floor(sr * (0.0015 + Math.random() * 0.01 * (1.15 - level))));
        }

        // Normalizar para evitar saturación
        let peak = 0;
        for (let k = 0; k < total; k++) peak = Math.max(peak, Math.abs(data[k]));
        if (peak > 0) {
          const norm = 0.85 / peak;
          for (let k = 0; k < total; k++) data[k] *= norm;
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 450;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 5500;
      const gain = ctx.createGain();
      gain.gain.value = 0.55;
      source.connect(high);
      high.connect(low);
      low.connect(gain);
      gain.connect(master);
      source.start(applauseStart);
    } catch {
      // sin aplauso si falla el búfer
    }

    setTimeout(() => master.disconnect(), 4200);
  }

  // Música: Tetris (Korobeiniki) extendido, notas MIDI [nota, duración en tiempos] (0 = silencio)
  startMusic() {
    if (this.musicTimer) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const beat = 60 / 150;

    // Cada sección: compases de 4 tiempos con su fundamental de bajo
    const A = {
      bass: [40, 45, 40, 45],
      notes: [
        [76, 1], [71, 0.5], [72, 0.5], [74, 1], [72, 0.5], [71, 0.5],
        [69, 1], [69, 0.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
        [71, 1.5], [72, 0.5], [74, 1], [76, 1],
        [72, 1], [69, 1], [69, 2],
      ],
    };
    const A2 = {
      bass: A.bass,
      notes: [...A.notes.slice(0, -3), [72, 1], [69, 1], [69, 1], [0, 1]],
    };
    const B = {
      bass: [50, 48, 40, 45],
      notes: [
        [74, 1.5], [77, 0.5], [81, 1], [79, 0.5], [77, 0.5],
        [76, 1.5], [72, 0.5], [76, 1], [74, 0.5], [72, 0.5],
        [71, 1], [71, 0.5], [72, 0.5], [74, 1], [76, 1],
        [72, 1], [69, 1], [69, 2],
      ],
    };
    const up = (s) => ({ bass: s.bass, notes: s.notes.map(([m, d]) => [m ? m + 12 : 0, d]) });
    const C = {
      bass: [45, 40, 45, 40, 45, 40, 45, 45],
      notes: [
        [76, 2], [72, 2], [74, 2], [71, 2], [72, 2], [69, 2], [68, 4],
        [76, 2], [72, 2], [74, 2], [71, 2], [72, 2], [76, 2], [81, 4],
      ],
    };

    const sections = [A, A2, B, up(B), C, up(A), A2, B];
    const melody = [];
    const bass = [];
    for (const s of sections) {
      melody.push(...s.notes);
      // Bajo "oom-pah": fundamental y quinta alternadas, un golpe por tiempo
      for (const root of s.bass) {
        bass.push([root, 1], [root + 7, 1], [root, 1], [root + 7, 1]);
      }
    }

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.035;
    this.musicGain.connect(ctx.destination);

    const tracks = [
      { notes: melody, type: 'square', level: 1, i: 0, t: ctx.currentTime + 0.1 },
      { notes: bass, type: 'triangle', level: 0.9, i: 0, t: ctx.currentTime + 0.1 },
    ];

    this.musicTimer = setInterval(() => {
      for (const tr of tracks) {
        while (tr.t < ctx.currentTime + 0.4) {
          const [midi, beats] = tr.notes[tr.i];
          const dur = beats * beat;
          if (midi) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = tr.type;
            osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), tr.t);
            gain.gain.setValueAtTime(0.0001, tr.t);
            gain.gain.exponentialRampToValueAtTime(tr.level, tr.t + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, tr.t + dur * 0.92);
            osc.connect(gain);
            gain.connect(this.musicGain);
            osc.start(tr.t);
            osc.stop(tr.t + dur);
          }
          tr.t += dur;
          tr.i = (tr.i + 1) % tr.notes.length;
        }
      }
    }, 100);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicGain) {
      const gain = this.musicGain;
      this.musicGain = null;
      try {
        gain.gain.setValueAtTime(gain.gain.value, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.15);
      } catch {
        // ignorar
      }
      setTimeout(() => gain.disconnect(), 250);
    }
  }
}

export const soundManager = new SoundManager();
