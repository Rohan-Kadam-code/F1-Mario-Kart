/**
 * MarioEffects — Maps real F1 race events to Mario Kart power-up effects.
 * Works with the ParticleSystem and DOM overlay for visual feedback.
 */

import { ParticleSystem } from './ParticleSystem.js';

/**
 * Event type constants
 */
export const EFFECT_TYPES = {
  OVERTAKE: 'overtake',
  PIT_STOP: 'pit',
  FASTEST_LAP: 'fastest_lap',
  DRS: 'drs',
  YELLOW_FLAG: 'yellow_flag',
  RED_FLAG: 'red_flag',
  SAFETY_CAR: 'safety_car',
  RAIN: 'rain',
  RETIREMENT: 'retirement',
  RACE_FINISH: 'race_finish',
  POKE: 'poke',
};

/** Mario Kart effect config per event type */
const EFFECT_CONFIG = {
  [EFFECT_TYPES.OVERTAKE]: {
    icon: '🍄',
    name: 'MUSHROOM BOOST',
    verb: 'used MUSHROOM BOOST and overtook',
    cssClass: 'overtake',
  },
  [EFFECT_TYPES.PIT_STOP]: {
    icon: '🔧',
    name: 'PIT CREW POWER-UP',
    verb: 'activated PIT CREW POWER-UP',
    cssClass: 'pit',
  },
  [EFFECT_TYPES.FASTEST_LAP]: {
    icon: '⭐',
    name: 'STAR POWER',
    verb: 'set FASTEST LAP — STAR POWER activated!',
    cssClass: 'fastest-lap',
  },
  [EFFECT_TYPES.DRS]: {
    icon: '🏎️',
    name: 'SPEED BOOST PAD',
    verb: 'activated DRS — SPEED BOOST!',
    cssClass: 'drs',
  },
  [EFFECT_TYPES.YELLOW_FLAG]: {
    icon: '🍌',
    name: 'BANANA PEEL',
    verb: 'Watch out! BANANA PEEL on track!',
    cssClass: 'flag',
  },
  [EFFECT_TYPES.RED_FLAG]: {
    icon: '🔴',
    name: 'RED SHELL',
    verb: 'RED SHELL IMPACT — Session stopped!',
    cssClass: 'flag',
  },
  [EFFECT_TYPES.SAFETY_CAR]: {
    icon: '👻',
    name: 'BOO',
    verb: 'BOO appeared — Safety Car deployed!',
    cssClass: 'flag',
  },
  [EFFECT_TYPES.RAIN]: {
    icon: '⚡',
    name: 'THUNDER CLOUD',
    verb: 'THUNDER CLOUD — Rain incoming!',
    cssClass: 'flag',
  },
  [EFFECT_TYPES.RETIREMENT]: {
    icon: '💥',
    name: 'BLUE SHELL',
    verb: 'hit by BLUE SHELL — RETIRED',
    cssClass: 'retirement',
  },
  [EFFECT_TYPES.RACE_FINISH]: {
    icon: '🏆',
    name: 'FINISH',
    verb: 'WINS THE RACE!',
    cssClass: 'fastest-lap',
  },
  [EFFECT_TYPES.POKE]: {
    icon: '🥊',
    name: 'POKE',
    verb: 'is poking the car ahead!',
    cssClass: 'overtake',
  },
};

export class MarioEffects {
  constructor(overlay, particles, eventFeed) {
    this.overlay = overlay;
    this.particles = particles;
    this.eventFeed = eventFeed;
    this.activeEffects = [];
    this.isRaining = false;
    this.hasSafetyCar = false;
  }

  /**
   * Trigger a Mario Kart effect for a race event.
   */
  trigger(type, data = {}) {
    const config = EFFECT_CONFIG[type];
    if (!config) return;

    // Add event to feed
    this._addToFeed(type, config, data);

    // Trigger canvas particle effects
    switch (type) {
      case EFFECT_TYPES.OVERTAKE:
        if (data.cx !== undefined) {
          this.particles.emitBoost(data.cx, data.cy, data.color || '#ffcc00', 20);
          this._showDOMEffect('🍄', data.cx, data.cy - 10, 'effect-mushroom');
        }
        break;

      case EFFECT_TYPES.PIT_STOP:
        if (data.cx !== undefined) {
          this.particles.emitSmoke(data.cx, data.cy, 12);
        }
        this._showDOMEffect('🔧', data.cx, data.cy, 'effect-pit');
        break;

      case EFFECT_TYPES.FASTEST_LAP:
        if (data.sprite) {
          data.sprite.hasStar = true;
          data.sprite.starTimer = 180; // 3 seconds at 60fps
        }
        if (data.cx !== undefined) {
          this.particles.emitStarSparkle(data.cx, data.cy);
          this._showDOMEffect('⭐', data.cx, data.cy - 15, 'effect-star');
        }
        this._flashOverlay('lightning-flash');
        break;

      case EFFECT_TYPES.DRS:
        if (data.sprite) {
          data.sprite.hasDRS = true;
        }
        break;

      case EFFECT_TYPES.YELLOW_FLAG:
        this._showDOMEffect('🍌', data.cx || 200, data.cy || 200, 'effect-banana');
        break;

      case EFFECT_TYPES.POKE:
        if (data.cx !== undefined) {
          this._showDOMEffect('🥊', data.cx, data.cy, 'effect-poke');
        }
        break;

      case EFFECT_TYPES.RED_FLAG:
        this._flashOverlay('effect-red-shell');
        this._triggerScreenShake();
        break;

      case EFFECT_TYPES.SAFETY_CAR:
        this.hasSafetyCar = true;
        this._showDOMEffect('👻', 
          data.canvasWidth ? data.canvasWidth / 2 : 300,
          data.canvasHeight ? data.canvasHeight / 2 : 200,
          'effect-ghost');
        break;

      case EFFECT_TYPES.RAIN:
        this.isRaining = true;
        this._flashOverlay('lightning-flash');
        break;

      case EFFECT_TYPES.RETIREMENT:
        if (data.cx !== undefined) {
          this.particles.emitExplosion(data.cx, data.cy, 40);
        }
        if (data.sprite) {
          data.sprite.isRetired = true;
        }
        this._triggerScreenShake();
        break;

      case EFFECT_TYPES.RACE_FINISH:
        this.particles.emitConfetti(data.canvasWidth || 800, 80);
        setTimeout(() => this.particles.emitConfetti(data.canvasWidth || 800, 60), 500);
        setTimeout(() => this.particles.emitConfetti(data.canvasWidth || 800, 40), 1000);
        break;
    }
  }

  /** Per-frame update for ongoing effects */
  update(canvasWidth, canvasHeight) {
    // Continuous rain particles
    if (this.isRaining) {
      this.particles.emitRain(canvasWidth, canvasHeight, 5);
    }

    // Remove expired DOM effects
    this.activeEffects = this.activeEffects.filter(e => {
      if (Date.now() - e.time > e.duration) {
        if (e.el && e.el.parentElement) e.el.remove();
        return false;
      }
      return true;
    });
  }

  stopRain() {
    this.isRaining = false;
  }

  stopSafetyCar() {
    this.hasSafetyCar = false;
  }

  /** Show a DOM element effect at canvas position */
  _showDOMEffect(emoji, cx, cy, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = emoji;
    el.style.left = cx + 'px';
    el.style.top = cy + 'px';
    this.overlay.appendChild(el);

    const duration = 2000;
    this.activeEffects.push({ el, time: Date.now(), duration });

    setTimeout(() => {
      if (el.parentElement) el.remove();
    }, duration);
  }

  /** Flash the entire overlay */
  _flashOverlay(className) {
    const el = document.createElement('div');
    el.className = className;
    this.overlay.appendChild(el);
    setTimeout(() => {
      if (el.parentElement) el.remove();
    }, 1000);
  }

  /** Trigger global screen shake on the map container */
  _triggerScreenShake() {
    const section = document.getElementById('raceSection');
    if (section) {
      section.classList.remove('screen-shake');
      // Trigger reflow to restart animation
      void section.offsetWidth; 
      section.classList.add('screen-shake');
      setTimeout(() => section.classList.remove('screen-shake'), 600);
    }
  }

  /** Add a styled event to the event feed */
  _addToFeed(type, config, data) {
    const item = document.createElement('div');
    item.className = `event-item ${config.cssClass}`;

    const driver1 = data.driver1 || data.driver || '???';
    const driver2 = data.driver2 || '';

    let text = '';
    if (type === EFFECT_TYPES.OVERTAKE) {
      text = `${driver1} used MUSHROOM BOOST and overtook ${driver2}!`;
    } else if (type === EFFECT_TYPES.RETIREMENT) {
      text = `${driver1} hit by BLUE SHELL — RETIRED!`;
    } else if (type === EFFECT_TYPES.RACE_FINISH) {
      text = `${driver1} WINS THE RACE! 🏆`;
    } else {
      text = `${driver1} ${config.verb}`;
    }

    item.innerHTML = `
      <span class="event-icon">${config.icon}</span>
      <div class="event-content">
        <div class="event-text">${text}</div>
        <div class="event-time">Lap ${data.lap || '?'}</div>
      </div>
    `;

    // Prepend (newest first)
    if (this.eventFeed.firstChild) {
      this.eventFeed.insertBefore(item, this.eventFeed.firstChild);
    } else {
      this.eventFeed.appendChild(item);
    }

    // Limit feed size
    while (this.eventFeed.children.length > 50) {
      this.eventFeed.removeChild(this.eventFeed.lastChild);
    }
  }
}
