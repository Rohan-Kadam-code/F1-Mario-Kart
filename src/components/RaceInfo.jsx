/**
 * RaceInfo — bottom bar. Exposes imperative methods via forwardRef for the render loop.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { usePlaybackStore } from '../stores/playbackStore.js';

const STATUS_MAP = {
  '1': { text: '🟢 Green', cls: 'status-green' },
  '2': { text: '🟡 Yellow', cls: 'status-yellow' },
  '4': { text: '🔴 SC', cls: 'status-sc' },
  '5': { text: '🔴 Red Flag', cls: 'status-red' },
  '6': { text: '🟡 VSC', cls: 'status-vsc' },
  '7': { text: '🔴 VSC Ending', cls: 'status-vsc' },
};

export const RaceInfo = forwardRef(function RaceInfo(_, ref) {
  const [trackStatus, setTrackStatus] = useState({ text: '🟢 Green', cls: 'status-green' });
  const [weather, setWeather] = useState(null);
  const [rcMsg, setRcMsg] = useState(null);
  const currentWeather = usePlaybackStore((s) => s.currentWeather);
  const displayWeather = weather ?? currentWeather;

  useImperativeHandle(ref, () => ({
    updateWeather(w) { setWeather(w); },
    updateTrackStatus(status) {
      setTrackStatus(STATUS_MAP[status] || { text: '🏁 ' + status, cls: 'status-green' });
    },
    addRaceControlMessage(msg) {
      const flagMap = { GREEN: '🟢', YELLOW: '🟡', 'DOUBLE YELLOW': '🟡🟡', RED: '🔴', CHEQUERED: '🏁', BLUE: '🔵', 'BLACK AND WHITE': '🏴' };
      const flag = msg.flag ? (flagMap[msg.flag] || '🚩') : '🚩';
      setRcMsg({ flag, text: msg.message || msg.category || '' });
    },
  }));

  const weatherIcon = displayWeather?.rainfall > 0 ? '🌧️' : displayWeather?.air_temperature < 15 ? '🌤️' : '☀️';

  return (
    <footer className="race-info-bar glass-panel">
      <div className="race-info-item">
        <span className="info-label">Status:</span>
        <span className={`info-value ${trackStatus.cls}`}>{trackStatus.text}</span>
      </div>

      {displayWeather && (
        <>
          <div className="race-info-item">
            <span className="info-label">Track:</span>
            <span className="info-value">{displayWeather.track_temperature?.toFixed(1)}°C</span>
          </div>
          <div className="race-info-item">
            <span className="info-label">Air:</span>
            <span className="info-value">{displayWeather.air_temperature?.toFixed(1)}°C</span>
          </div>
          <div className="race-info-item">
            <span className="info-label">Wind:</span>
            <span className="info-value">{displayWeather.wind_speed?.toFixed(1)} km/h</span>
          </div>
        </>
      )}

      <div className="race-control-messages">
        {rcMsg ? (
          <div className="race-control-message">
            <span className="flag-icon">{rcMsg.flag}</span>
            <span className="rc-text">{rcMsg.text}</span>
          </div>
        ) : (
          <div className="race-control-message">
            <span className="flag-icon">🏁</span>
            <span className="rc-text">Ready to race</span>
          </div>
        )}
      </div>

      {/* Weather widget (header area — duplicated inline here for footer) */}
      {displayWeather && (
        <div className="weather-widget" style={{ marginLeft: 'auto' }}>
          <span className="weather-item">
            <span className="weather-icon">{weatherIcon}</span>
            <span className="weather-value">{displayWeather.air_temperature?.toFixed(0)}°C</span>
          </span>
          <span className="weather-item">
            <span className="weather-icon">💨</span>
            <span className="weather-value">{displayWeather.wind_speed?.toFixed(0)}</span>
          </span>
        </div>
      )}
    </footer>
  );
});
