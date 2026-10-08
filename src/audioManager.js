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
}

export const soundManager = new SoundManager();
