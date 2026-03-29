/**
 * DriverPanel — Sidebar showing all drivers sorted by position.
 */

import { getTeamColor } from '../renderer/DriverSprite.js';

export class DriverPanel {
  constructor(listEl, lapIndicatorEl, onDriverClick) {
    this.listEl = listEl;
    this.lapIndicatorEl = lapIndicatorEl;
    this.onDriverClick = onDriverClick || (() => {});
    this.driverCards = new Map(); // driverNumber -> DOM element
    this.previousPositions = new Map();
  }

  /**
   * Initialize driver cards from driver list.
   */
  init(drivers) {
    this.listEl.innerHTML = '';
    this.driverCards.clear();
    this.previousPositions.clear();

    drivers.forEach(d => {
      const card = this._createCard(d);
      this.listEl.appendChild(card);
      this.driverCards.set(d.driver_number, card);
    });
  }

  _createCard(driver) {
    const card = document.createElement('div');
    card.className = 'driver-card';
    card.dataset.driverNumber = driver.driver_number;

    const teamColor = getTeamColor(driver.team_name);

    card.innerHTML = `
      <span class="driver-position" data-field="position">-</span>
      <div class="team-stripe" style="background: ${teamColor}"></div>
      <div class="driver-info">
        <div class="driver-name">${driver.name_acronym || driver.broadcast_name || 'Unknown'}</div>
        <div class="driver-team">${driver.team_name || ''}</div>
      </div>
      <div class="driver-stats">
        <div class="driver-gap" data-field="gap">-</div>
        <div class="driver-tire" data-field="tire"></div>
      </div>
    `;

    card.addEventListener('click', () => {
      this.onDriverClick(driver.driver_number);
    });

    return card;
  }

  setTrackedDriver(driverNum) {
    this.driverCards.forEach((card, num) => {
      if (num === driverNum) card.classList.add('tracked-driver');
      else card.classList.remove('tracked-driver');
    });
  }

  /**
   * Update driver data for current frame.
   * @param {Map} driverData — Map of driverNumber -> { position, gap, tireCompound }
   */
  update(driverData) {
    // Sort cards by position
    const sorted = [...driverData.entries()].sort((a, b) => a[1].position - b[1].position);

    sorted.forEach(([driverNum, data], index) => {
      const card = this.driverCards.get(driverNum);
      if (!card) return;

      // Update fields
      const posEl = card.querySelector('[data-field="position"]');
      const gapEl = card.querySelector('[data-field="gap"]');
      const tireEl = card.querySelector('[data-field="tire"]');

      // Position change animation
      const prevPos = this.previousPositions.get(driverNum) || data.position;
      if (data.position < prevPos) {
        card.classList.remove('position-change-down');
        card.classList.add('position-change-up');
        setTimeout(() => card.classList.remove('position-change-up'), 600);
      } else if (data.position > prevPos) {
        card.classList.remove('position-change-up');
        card.classList.add('position-change-down');
        setTimeout(() => card.classList.remove('position-change-down'), 600);
      }
      this.previousPositions.set(driverNum, data.position);

      posEl.textContent = data.position;
      posEl.className = 'driver-position';
      if (data.position === 1) posEl.classList.add('p1');
      else if (data.position === 2) posEl.classList.add('p2');
      else if (data.position === 3) posEl.classList.add('p3');

      gapEl.textContent = data.gap || '-';

      if (data.tireCompound) {
        const tc = data.tireCompound.toUpperCase();
        let tireClass = 'tire-hard';
        let tireLabel = '⬜ H';
        if (tc === 'SOFT') { tireClass = 'tire-soft'; tireLabel = '🔴 S'; }
        else if (tc === 'MEDIUM') { tireClass = 'tire-medium'; tireLabel = '🟡 M'; }
        else if (tc === 'HARD') { tireClass = 'tire-hard'; tireLabel = '⬜ H'; }
        else if (tc === 'INTERMEDIATE') { tireClass = 'tire-inter'; tireLabel = '🟢 I'; }
        else if (tc === 'WET') { tireClass = 'tire-wet'; tireLabel = '🔵 W'; }
        tireEl.className = `driver-tire ${tireClass}`;
        tireEl.textContent = tireLabel;
      }

      // Re-order in DOM (only when order actually differs to prevent breaking 60fps hit-testing during physical clicks)
      const currentElementAtSlot = this.listEl.children[index];
      if (currentElementAtSlot !== card) {
        this.listEl.insertBefore(card, currentElementAtSlot);
      }
    });
  }

  updateLap(currentLap, totalLaps) {
    this.lapIndicatorEl.textContent = `Lap ${currentLap}/${totalLaps}`;
  }
}
