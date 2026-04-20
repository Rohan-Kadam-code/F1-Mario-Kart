import { useState, useEffect } from 'react';
import { getMeetings, getSessions } from '../api/openf1.js';

const YEARS = [2026, 2025, 2024, 2023];

export function SessionSelector({ onLoad }) {
  const [year, setYear] = useState('');
  const [meetings, setMeetings] = useState([]);
  const [meetingKey, setMeetingKey] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionKey, setSessionKey] = useState('');
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    if (!year) return;
    setLoadingMeetings(true);
    setMeetings([]);
    setMeetingKey('');
    setSessions([]);
    setSessionKey('');
    getMeetings(parseInt(year))
      .then((data) => setMeetings(data.sort((a, b) => new Date(a.date_start) - new Date(b.date_start))))
      .catch(console.error)
      .finally(() => setLoadingMeetings(false));
  }, [year]);

  useEffect(() => {
    if (!meetingKey) return;
    setLoadingSessions(true);
    setSessions([]);
    setSessionKey('');
    getSessions(parseInt(meetingKey))
      .then((data) => setSessions(data.sort((a, b) => new Date(a.date_start) - new Date(b.date_start))))
      .catch(console.error)
      .finally(() => setLoadingSessions(false));
  }, [meetingKey]);

  const handleLoad = () => {
    const session = sessions.find((s) => s.session_key === parseInt(sessionKey));
    if (session && onLoad) onLoad(session);
  };

  return (
    <div className="session-selector">
      <select value={year} onChange={(e) => setYear(e.target.value)} title="Select Year">
        <option value="">Year</option>
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>

      <select
        value={meetingKey}
        onChange={(e) => setMeetingKey(e.target.value)}
        disabled={!year || loadingMeetings}
        title="Select Meeting"
      >
        <option value="">{loadingMeetings ? 'Loading…' : 'Meeting'}</option>
        {meetings.map((m) => (
          <option key={m.meeting_key} value={m.meeting_key}>
            {m.meeting_name || m.meeting_official_name || `Meeting ${m.meeting_key}`}
          </option>
        ))}
      </select>

      <select
        value={sessionKey}
        onChange={(e) => setSessionKey(e.target.value)}
        disabled={!meetingKey || loadingSessions}
        title="Select Session"
      >
        <option value="">{loadingSessions ? 'Loading…' : 'Session'}</option>
        {sessions.map((s) => (
          <option key={s.session_key} value={s.session_key}>
            {s.session_name || `Session ${s.session_key}`}
          </option>
        ))}
      </select>

      <button className="load-btn" disabled={!sessionKey} onClick={handleLoad}>
        Load Race
      </button>
    </div>
  );
}
