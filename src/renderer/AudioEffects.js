/**
 * AudioEffects — Native Web Audio API 8-bit Synthesizer
 * Generates classic arcade sound effects without loading external audio files.
 */

export class AudioEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    
    // Engine sound state
    this.engineBuffer = null;
    this.engineSource = null;
    this.engineGain = null;
    this.isEngineLoading = false;
  }

  /** Initialize on first user interaction to comply with browser autoplay policies */
  init() {
    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.6;// Boosted from 0.3
      this.masterGain.connect(this.ctx.destination);

      // Load the real engine sample
      this._loadEngineSound();
    } catch (e) {
      console.warn('Web Audio API not supported', e);
      this.enabled = false;
    }
  }

  async _loadEngineSound() {
    if (this.isEngineLoading || this.engineBuffer) return;
    this.isEngineLoading = true;
    
    try {
      console.log('[AudioEffects] Loading high-fidelity engine sound...');
      // IMPORTANT: The path is relative to the root/src depending on the dev server config
      // User provided d:\Work\OpenF1\src\do_what_you_want-f1-racing-car-sound-430459.mp3
      // We'll try the relative path from the app root
      const response = await fetch('/src/do_what_you_want-f1-racing-car-sound-430459.mp3');
      const arrayBuffer = await response.arrayBuffer();
      this.engineBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      
      this._startEngineLoop();
      console.log('[AudioEffects] Engine sample loaded and looping.');
    } catch (e) {
      console.error('[AudioEffects] Failed to load engine MP3:', e);
    } finally {
      this.isEngineLoading = false;
    }
  }

  _startEngineLoop() {
    if (!this.engineBuffer || !this.ctx) return;
    
    // Stop existing if any
    if (this.engineSource) {
      try { this.engineSource.stop(); } catch(e) {}
    }

    this.engineSource = this.ctx.createBufferSource();
    this.engineSource.buffer = this.engineBuffer;
    this.engineSource.loop = true;
    
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime); // Start silent
    
    this.engineSource.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    
    this.engineSource.start(0);
  }

  toggle(enabled) {
    this.enabled = enabled;
  }

  setVolume(val) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, val));
    }
  }

  _playTone(freq, type, duration, vol = 1, slideTo = null) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type; // 'square', 'sawtooth', 'triangle', 'sine'
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
    }

    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  /** Mushroom Boost: Quick ascending chirps */
  playMushroom() {
    this._playTone(330, 'square', 0.1, 0.5); // E4
    setTimeout(() => this._playTone(440, 'square', 0.1, 0.5), 100); // A4
    setTimeout(() => this._playTone(660, 'square', 0.2, 0.5), 200); // E5
  }

  /** Dishum Dishum: Punching sound (Boxing) */
  playDishum() {
    this._playTone(150, 'square', 0.15, 0.6);
    setTimeout(() => this._playTone(120, 'square', 0.2, 0.4), 100);
  }

  /** Hehe: Giggle sound (Banana) */
  playHehe() {
    this._playTone(700, 'sine', 0.05, 0.4);
    setTimeout(() => this._playTone(850, 'sine', 0.05, 0.4), 80);
    setTimeout(() => this._playTone(800, 'sine', 0.1, 0.4), 160);
  }

  /** Star Power: Classic invincibility arpeggio */
  playStar() {
    if (!this.enabled || !this.ctx) return;
    const notes = [440, 554, 659, 880, 659, 554]; // A major arpeggio
    let time = 0;
    for (let i = 0; i < 3; i++) { // Loop 3 times
      notes.forEach(f => {
        setTimeout(() => this._playTone(f, 'square', 0.1, 0.3), time);
        time += 80;
      });
    }
  }

  /** Crash (Red/Blue Shell): Harsh noise burst */
  playCrash() {
    if (!this.enabled || !this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.5; // 0.5 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // White noise
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    
    // Lowpass filter to make it sound like a "thud/explosion" rather than static
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noiseSource.start();
  }

  /** Update continuous car engine pitch based on speed and load (acceleration) */
  updateEngine(speedValue, deltaSpeed = 0, isPlaying) {
    if (!this.enabled || !this.ctx || !this.engineSource || !this.engineGain) return;
    
    // Engine sound only follows the tracked driver
    if (!isPlaying || speedValue < 2) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      return;
    }

    // --- Dynamic Load (Volume) Scaling ---
    let baseGain = 0.5; // Default cruising volume
    if (deltaSpeed > 0.6) {
      baseGain = 0.85; // Heavy acceleration "Roar"
    } else if (deltaSpeed < -1.5) {
      baseGain = 0.35; // Heavy braking "Muffled"
    }
    
    this.engineGain.gain.setTargetAtTime(baseGain, this.ctx.currentTime, 0.25);
    
    // --- Dynamic Pitch (RPM Simulation) ---
    // At high speeds (>220 km/h), simulate engine redline
    let rate = 0.4 + (speedValue / 350) * 1.4;
    if (speedValue > 220) {
      // Add more piercing pitch at the end of the straight
      rate += (speedValue - 220) / 400; 
    }
    
    this.engineSource.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.25);
  }
}
