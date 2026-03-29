/**
 * PlaybackControls — Play/Pause, speed, and scrubber for race replay.
 */

export class PlaybackControls {
  constructor(container) {
    this.container = container;
    this.isPlaying = false;
    this.speed = 1;
    this.progress = 0;     // 0..1
    this.totalLaps = 0;

    this.onPlay = null;
    this.onPause = null;
    this.onPause = null;
    this.onSeek = null;
    this.onSpeedChange = null;
    this.onAudioToggle = null;
    this.isAudioEnabled = true;

    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <button class="play-btn" id="playBtn" title="Play / Pause">▶</button>
      <div class="scrubber-container">
        <span class="time-label" id="currentLapLabel">Lap 0</span>
        <input type="range" class="scrubber" id="scrubber" min="0" max="100000" value="0" />
        <span class="time-label" id="totalLapLabel">/ 0</span>
      </div>
      <div class="speed-selector">
        <button class="speed-btn active" data-speed="1">1x</button>
        <button class="speed-btn" data-speed="2">2x</button>
        <button class="speed-btn" data-speed="5">5x</button>
        <button class="speed-btn" data-speed="10">10x</button>
      </div>
      <button class="icon-button" id="audioToggleBtn" title="Toggle Sound Effects" style="margin-left: 8px; font-size: 1.2rem;">🔊</button>
    `;

    this.playBtn = this.container.querySelector('#playBtn');
    this.scrubber = this.container.querySelector('#scrubber');
    this.currentLapLabel = this.container.querySelector('#currentLapLabel');
    this.totalLapLabel = this.container.querySelector('#totalLapLabel');
    this.speedBtns = this.container.querySelectorAll('.speed-btn');
    this.audioToggleBtn = this.container.querySelector('#audioToggleBtn');

    this.playBtn.addEventListener('click', () => this.toggle());

    this.audioToggleBtn.addEventListener('click', () => {
      this.isAudioEnabled = !this.isAudioEnabled;
      this.audioToggleBtn.textContent = this.isAudioEnabled ? '🔊' : '🔇';
      if (this.onAudioToggle) this.onAudioToggle(this.isAudioEnabled);
    });

    this.scrubber.addEventListener('input', () => {
      const val = parseInt(this.scrubber.value) / 100000;
      this.progress = val;
      if (this.onSeek) this.onSeek(val);
    });

    this.speedBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.speed = parseInt(btn.dataset.speed);
        if (this.onSpeedChange) this.onSpeedChange(this.speed);
      });
    });
  }

  toggle() {
    this.isPlaying = !this.isPlaying;
    this.playBtn.textContent = this.isPlaying ? '⏸' : '▶';
    if (this.isPlaying && this.onPlay) this.onPlay();
    if (!this.isPlaying && this.onPause) this.onPause();
  }

  setProgress(val, currentLap) {
    this.progress = val;
    this.scrubber.value = Math.floor(val * 100000);
    this.currentLapLabel.textContent = `Lap ${currentLap}`;
  }

  setTotalLaps(total) {
    this.totalLaps = total;
    this.totalLapLabel.textContent = `/ ${total}`;
  }

  reset() {
    this.isPlaying = false;
    this.playBtn.textContent = '▶';
    this.progress = 0;
    this.scrubber.value = 0;
    this.currentLapLabel.textContent = 'Lap 0';
  }
}
