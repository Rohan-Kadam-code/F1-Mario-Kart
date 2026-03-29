/**
 * RaceInfo — Bottom bar showing weather, track status, and race control messages.
 */

export class RaceInfo {
  constructor(container, weatherWidget) {
    this.container = container;
    this.weatherWidget = weatherWidget;
    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <div class="race-info-item">
        <span class="info-label">Track Status:</span>
        <span class="info-value status-green" id="trackStatus">🟢 Green</span>
      </div>
      <div class="race-info-item">
        <span class="info-label">Track Temp:</span>
        <span class="info-value" id="trackTemp">--°C</span>
      </div>
      <div class="race-info-item">
        <span class="info-label">Air Temp:</span>
        <span class="info-value" id="airTemp">--°C</span>
      </div>
      <div class="race-info-item">
        <span class="info-label">Wind:</span>
        <span class="info-value" id="windSpeed">-- km/h</span>
      </div>
      <div class="race-control-messages" id="raceControlArea">
        <div class="race-control-message">
          <span class="flag-icon">🏁</span>
          <span class="rc-text">Ready to race</span>
        </div>
      </div>
    `;

    this.trackStatusEl = this.container.querySelector('#trackStatus');
    this.trackTempEl = this.container.querySelector('#trackTemp');
    this.airTempEl = this.container.querySelector('#airTemp');
    this.windSpeedEl = this.container.querySelector('#windSpeed');
    this.rcArea = this.container.querySelector('#raceControlArea');
  }

  updateWeather(weather) {
    if (!weather) return;
    if (weather.track_temperature !== undefined) {
      this.trackTempEl.textContent = `${weather.track_temperature.toFixed(1)}°C`;
    }
    if (weather.air_temperature !== undefined) {
      this.airTempEl.textContent = `${weather.air_temperature.toFixed(1)}°C`;
    }
    if (weather.wind_speed !== undefined) {
      this.windSpeedEl.textContent = `${weather.wind_speed.toFixed(1)} km/h`;
    }

    // Weather widget in header
    let icon = '☀️';
    if (weather.rainfall && weather.rainfall > 0) icon = '🌧️';
    else if (weather.air_temperature < 15) icon = '🌤️';

    this.weatherWidget.innerHTML = `
      <span class="weather-item">
        <span class="weather-icon">${icon}</span>
        <span class="weather-value">${weather.air_temperature?.toFixed(0) || '--'}°C</span>
      </span>
      <span class="weather-item">
        <span class="weather-icon">💨</span>
        <span class="weather-value">${weather.wind_speed?.toFixed(0) || '--'}</span>
      </span>
    `;
  }

  updateTrackStatus(status) {
    const statusMap = {
      '1': { text: '🟢 Green', cls: 'status-green' },
      '2': { text: '🟡 Yellow', cls: 'status-yellow' },
      '4': { text: '🔴 SC', cls: 'status-sc' },
      '5': { text: '🔴 Red Flag', cls: 'status-red' },
      '6': { text: '🟡 VSC', cls: 'status-vsc' },
      '7': { text: '🔴 VSC Ending', cls: 'status-vsc' },
    };
    const s = statusMap[status] || { text: '🏁 ' + status, cls: 'status-green' };
    this.trackStatusEl.textContent = s.text;
    this.trackStatusEl.className = `info-value ${s.cls}`;
  }

  addRaceControlMessage(message) {
    const flagMap = {
      'GREEN': '🟢',
      'YELLOW': '🟡',
      'DOUBLE YELLOW': '🟡🟡',
      'RED': '🔴',
      'CHEQUERED': '🏁',
      'BLUE': '🔵',
      'BLACK AND WHITE': '🏴',
    };

    let flag = '🚩';
    if (message.flag) {
      flag = flagMap[message.flag] || '🚩';
    }

    const el = document.createElement('div');
    el.className = 'race-control-message';
    el.innerHTML = `
      <span class="flag-icon">${flag}</span>
      <span class="rc-text">${message.message || message.category || ''}</span>
    `;
    this.rcArea.innerHTML = '';
    this.rcArea.appendChild(el);
  }
}
