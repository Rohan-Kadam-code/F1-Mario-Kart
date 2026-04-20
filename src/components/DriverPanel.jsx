import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '../stores/playbackStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { getTeamColor } from '../renderer/DriverSprite.js';

function tireLabel(compound) {
  if (!compound) return '';
  const tc = compound.toUpperCase();
  if (tc === 'SOFT') return '🔴 S';
  if (tc === 'MEDIUM') return '🟡 M';
  if (tc === 'HARD') return '⬜ H';
  if (tc === 'INTERMEDIATE') return '🟢 I';
  if (tc === 'WET') return '🔵 W';
  return compound;
}

function posClass(pos) {
  if (pos === 1) return 'driver-position p1';
  if (pos === 2) return 'driver-position p2';
  if (pos === 3) return 'driver-position p3';
  return 'driver-position';
}

export function DriverPanel({ onDriverClick }) {
  const drivers = useSessionStore((s) => s.drivers);
  const totalLaps = useSessionStore((s) => s.totalLaps);
  const positionSnapshot = usePlaybackStore((s) => s.positionSnapshot);
  const currentLap = usePlaybackStore((s) => s.currentLap);
  const trackedDriver = usePlaybackStore((s) => s.trackedDriver);
  const setTrackedDriver = usePlaybackStore((s) => s.setTrackedDriver);
  const prevPositions = useRef(new Map());

  const sorted = [...positionSnapshot.entries()].sort((a, b) => a[1].position - b[1].position);

  function handleClick(driverNum) {
    const next = trackedDriver === driverNum ? null : driverNum;
    setTrackedDriver(next);
    onDriverClick?.(next);
  }

  return (
    <aside
      className="glass-panel flex flex-col"
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--border-subtle)',
        borderRadius: 0,
        overflowY: 'auto',
      }}
    >
      <div className="panel-header">
        <span>🏁 Drivers</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          Lap {currentLap}/{totalLaps}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 && drivers.length > 0
          ? drivers.map((d) => <DriverCard key={d.driver_number} driver={d} data={null} tracked={false} onClick={handleClick} />)
          : sorted.map(([driverNum, data]) => {
              const driver = drivers.find((d) => d.driver_number === driverNum);
              if (!driver) return null;
              const prev = prevPositions.current.get(driverNum);
              const anim = prev !== undefined && data.position < prev ? 'pos-gained' : prev !== undefined && data.position > prev ? 'pos-lost' : '';
              prevPositions.current.set(driverNum, data.position);
              return (
                <DriverCard
                  key={driverNum}
                  driver={driver}
                  data={data}
                  tracked={trackedDriver === driverNum}
                  onClick={handleClick}
                  anim={anim}
                />
              );
            })}
      </div>
    </aside>
  );
}

function DriverCard({ driver, data, tracked, onClick, anim = '' }) {
  const teamColor = getTeamColor(driver.team_name);
  return (
    <div
      className={`driver-card ${tracked ? 'tracked-driver' : ''} ${anim}`}
      onClick={() => onClick(driver.driver_number)}
    >
      <span className={posClass(data?.position)}>{data?.position ?? '-'}</span>
      <div className="team-stripe" style={{ background: teamColor }} />
      <div className="driver-info">
        <div className="driver-name">{driver.name_acronym || driver.broadcast_name || 'Unknown'}</div>
        <div className="driver-team">{driver.team_name || ''}</div>
      </div>
      <div className="driver-stats">
        <div className="driver-gap">{data?.gap ?? '-'}</div>
        <div className="driver-tire">{tireLabel(data?.tireCompound)}</div>
      </div>
    </div>
  );
}
