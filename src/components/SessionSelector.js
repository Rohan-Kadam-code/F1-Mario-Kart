/**
 * SessionSelector — Dropdown to pick Year → Meeting → Session.
 */

import { getMeetings, getSessions } from '../api/openf1.js';

export class SessionSelector {
  constructor(container, onSessionSelected) {
    this.container = container;
    this.onSessionSelected = onSessionSelected;

    this.meetings = [];
    this.sessions = [];

    this._render();
    this._loadYears();
  }

  _render() {
    this.container.innerHTML = `
      <div class="session-selector">
        <select id="yearSelect" title="Select Year">
          <option value="">Year</option>
        </select>
        <select id="meetingSelect" title="Select Meeting" disabled>
          <option value="">Meeting</option>
        </select>
        <select id="sessionSelect" title="Select Session" disabled>
          <option value="">Session</option>
        </select>
        <button class="load-btn" id="loadRaceBtn" disabled>Load Race</button>
      </div>
    `;

    this.yearSelect = this.container.querySelector('#yearSelect');
    this.meetingSelect = this.container.querySelector('#meetingSelect');
    this.sessionSelect = this.container.querySelector('#sessionSelect');
    this.loadBtn = this.container.querySelector('#loadRaceBtn');

    this.yearSelect.addEventListener('change', () => this._onYearChange());
    this.meetingSelect.addEventListener('change', () => this._onMeetingChange());
    this.loadBtn.addEventListener('click', () => this._onLoad());
  }

  _loadYears() {
    // Available years: 2023, 2024, 2025, 2026
    const years = [2026, 2025, 2024, 2023];
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      this.yearSelect.appendChild(opt);
    });
  }

  async _onYearChange() {
    const year = this.yearSelect.value;
    this.meetingSelect.innerHTML = '<option value="">Loading...</option>';
    this.meetingSelect.disabled = true;
    this.sessionSelect.innerHTML = '<option value="">Session</option>';
    this.sessionSelect.disabled = true;
    this.loadBtn.disabled = true;

    if (!year) return;

    try {
      this.meetings = await getMeetings(parseInt(year));
      this.meetingSelect.innerHTML = '<option value="">Select Meeting</option>';
      this.meetings
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
        .forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.meeting_key;
          opt.textContent = m.meeting_name || m.meeting_official_name || `Meeting ${m.meeting_key}`;
          this.meetingSelect.appendChild(opt);
        });
      this.meetingSelect.disabled = false;
    } catch (err) {
      console.error('Failed to load meetings:', err);
      this.meetingSelect.innerHTML = '<option value="">Error loading</option>';
    }
  }

  async _onMeetingChange() {
    const meetingKey = this.meetingSelect.value;
    this.sessionSelect.innerHTML = '<option value="">Loading...</option>';
    this.sessionSelect.disabled = true;
    this.loadBtn.disabled = true;

    if (!meetingKey) return;

    try {
      this.sessions = await getSessions(parseInt(meetingKey));
      this.sessionSelect.innerHTML = '<option value="">Select Session</option>';
      this.sessions
        .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
        .forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.session_key;
          opt.textContent = s.session_name || `Session ${s.session_key}`;
          this.sessionSelect.appendChild(opt);
        });
      this.sessionSelect.disabled = false;
    } catch (err) {
      console.error('Failed to load sessions:', err);
      this.sessionSelect.innerHTML = '<option value="">Error loading</option>';
    }
  }

  _onLoad() {
    const sessionKey = parseInt(this.sessionSelect.value);
    const session = this.sessions.find(s => s.session_key === sessionKey);
    if (session && this.onSessionSelected) {
      this.loadBtn.disabled = true;
      this.loadBtn.textContent = 'Loading...';
      this.onSessionSelected(session);
    }
  }

  enableLoadButton() {
    this.loadBtn.disabled = false;
    this.loadBtn.textContent = 'Load Race';
    // Enable only if session is selected
    if (!this.sessionSelect.value) {
      this.loadBtn.disabled = true;
    }
  }

  // Enable load when session selected
  _updateLoadState() {
    this.loadBtn.disabled = !this.sessionSelect.value;
  }
}

// Patch: enable load button when session is selected
SessionSelector.prototype._render = function () {
  this.container.innerHTML = `
    <div class="session-selector">
      <select id="yearSelect" title="Select Year">
        <option value="">Year</option>
      </select>
      <select id="meetingSelect" title="Select Meeting" disabled>
        <option value="">Meeting</option>
      </select>
      <select id="sessionSelect" title="Select Session" disabled>
        <option value="">Session</option>
      </select>
      <button class="load-btn" id="loadRaceBtn" disabled>Load Race</button>
    </div>
  `;

  this.yearSelect = this.container.querySelector('#yearSelect');
  this.meetingSelect = this.container.querySelector('#meetingSelect');
  this.sessionSelect = this.container.querySelector('#sessionSelect');
  this.loadBtn = this.container.querySelector('#loadRaceBtn');

  this.yearSelect.addEventListener('change', () => this._onYearChange());
  this.meetingSelect.addEventListener('change', () => this._onMeetingChange());
  this.sessionSelect.addEventListener('change', () => {
    this.loadBtn.disabled = !this.sessionSelect.value;
  });
  this.loadBtn.addEventListener('click', () => this._onLoad());
};
