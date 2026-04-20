/**
 * GaragePanel — full-screen overlay that lives INSIDE the canvas wrapper.
 * The overlay itself is transparent (pointer-events:none); only the sidebar
 * has a background and receives pointer events. The 3D canvas shows through
 * the transparent right area (matching original garage.css design).
 */
import { useEffect, useState } from 'react';
import { useSceneStore } from '../stores/sceneStore.js';

export function GaragePanel({ sceneRefs, onClose }) {
  const garageMode = useSceneStore((s) => s.garageMode);
  const garageKartIndex = useSceneStore((s) => s.garageKartIndex);
  const setGarageKartIndex = useSceneStore((s) => s.setGarageKartIndex);

  const [color, setColor] = useState('#000000');
  const [abbr, setAbbr] = useState('---');
  const [driverNum, setDriverNum] = useState(1);
  const [compound, setCompound] = useState('SOFT');
  const [lightIntensity, setLightIntensity] = useState(500);
  const [bloom, setBloom] = useState(0.4);
  const [showBase, setShowBase] = useState(true);

  // Load current kart data whenever the index changes or garage opens
  useEffect(() => {
    if (!garageMode) return;
    const karts = sceneRefs.current?.karts;
    if (!karts) return;
    const entries = [...karts.entries()];
    const kart = entries[garageKartIndex]?.[1];
    if (kart) {
      setAbbr(kart.abbreviation || '---');
      setDriverNum(kart.driver?.driver_number ?? 1);
      setCompound(kart.tireCompound || 'SOFT');
      const hex = '#' + ((kart.teamColorHex || 0).toString(16).padStart(6, '0'));
      setColor(hex);
    }
  }, [garageMode, garageKartIndex, sceneRefs]);

  if (!garageMode) return null;

  const karts = sceneRefs.current?.karts ? [...sceneRefs.current.karts.entries()] : [];
  const currentKart = karts[garageKartIndex]?.[1];

  function navigate(dir) {
    if (!karts.length) return;
    const next = (garageKartIndex + dir + karts.length) % karts.length;
    setGarageKartIndex(next);
    const nextKart = karts[next]?.[1];
    if (nextKart && sceneRefs.current?.sceneManager) {
      sceneRefs.current.sceneManager.setGarageMode(true, nextKart);
    }
  }

  function applyColor(hex) {
    setColor(hex);
    currentKart?.setTeamColor?.(hex);
  }

  function applyCompound(c) {
    setCompound(c);
    currentKart?.setTireCompound?.(c);
  }

  function applyDetails() {
    currentKart?.setDriverDetails?.(abbr || 'AAA', parseInt(driverNum) || 1);
  }

  function applyStudio(overrides = {}) {
    const settings = { intensity: lightIntensity, bloom, showBase, ...overrides };
    sceneRefs.current?.sceneManager?.updateStudioSettings?.(settings);
  }

  return (
    /* Transparent overlay — covers the full canvas area, passes clicks through */
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        pointerEvents: 'none', // pass-through everywhere except sidebar
      }}
    >
      {/* Sidebar — the only opaque interactive element */}
      <div
        style={{
          width: 320,
          background: 'rgba(10, 10, 18, 0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          pointerEvents: 'auto',
          boxShadow: '10px 0 30px rgba(0,0,0,0.5)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div className="panel-header" style={{ height: 44, flexShrink: 0, padding: '0 16px' }}>
          <span style={{ fontSize: '0.9rem' }}>🛠️ Customizer</span>
          <button
            className="close-btn action-btn"
            onClick={onClose}
            style={{ background: '#e10600', color: '#fff', border: 'none', fontWeight: 700 }}
          >
            Return to Track
          </button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
          {/* Driver navigation */}
          <Section label="Select Driver">
            <div className="driver-nav" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <NavBtn onClick={() => navigate(-1)}>◀</NavBtn>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>
                {abbr}
              </span>
              <NavBtn onClick={() => navigate(1)}>▶</NavBtn>
            </div>
          </Section>

          {/* Team paint */}
          <Section label="Team Paint">
            <input
              type="color"
              value={color}
              onChange={(e) => applyColor(e.target.value)}
              style={{ width: '100%', height: 44, border: 'none', borderRadius: 8, cursor: 'pointer', padding: 0, background: 'none' }}
            />
            <button
              className="small-btn"
              onClick={() => {
                const def = '#' + ((currentKart?.defaultTeamColor || 0).toString(16).padStart(6, '0'));
                applyColor(def);
              }}
            >
              Reset to Default
            </button>
          </Section>

          {/* Driver details */}
          <Section label="Driver Abbreviation (3 Letters)">
            <GarageInput type="text" maxLength={3} value={abbr} onChange={(e) => setAbbr(e.target.value.toUpperCase())} onBlur={applyDetails} />
          </Section>
          <Section label="Driver Number">
            <GarageInput type="number" min={1} max={99} value={driverNum} onChange={(e) => setDriverNum(e.target.value)} onBlur={applyDetails} />
          </Section>

          {/* Tire compound */}
          <Section label="Tire Compound">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[['SOFT', '🔴 Soft'], ['MEDIUM', '🟡 Med'], ['HARD', '⚪ Hard'], ['WET', '🔵 Wet']].map(([c, label]) => (
                <button
                  key={c}
                  className={`compound-btn ${compound === c ? 'selected' : ''}`}
                  onClick={() => applyCompound(c)}
                  style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: compound === c ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)', border: compound === c ? '1px solid #fff' : '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', cursor: 'pointer' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          {/* Studio settings */}
          <Section label="Studio Settings">
            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 14, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <StudioRow label="Intensity">
                <input type="range" min={0} max={2000} value={lightIntensity}
                  onChange={(e) => { const v = Number(e.target.value); setLightIntensity(v); applyStudio({ intensity: v }); }} />
              </StudioRow>
              <StudioRow label="Bloom">
                <input type="range" min={0} max={2} step={0.1} value={bloom}
                  onChange={(e) => { const v = Number(e.target.value); setBloom(v); applyStudio({ bloom: v }); }} />
              </StudioRow>
              <StudioRow label="Podium">
                <input type="checkbox" checked={showBase}
                  onChange={(e) => { setShowBase(e.target.checked); applyStudio({ showBase: e.target.checked }); }} />
              </StudioRow>
            </div>
          </Section>
        </div>
      </div>

      {/* Transparent right side — 3D canvas visible through here, clicks pass through */}
      <div style={{ flex: 1 }} />
    </div>
  );
}

/* Small helpers */
function Section({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function NavBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer', padding: '8px 12px', borderRadius: 4, transition: 'background 0.15s' }}
      onMouseEnter={e => e.target.style.background = 'rgba(255,255,255,0.1)'}
      onMouseLeave={e => e.target.style.background = 'none'}>
      {children}
    </button>
  );
}

function GarageInput({ type, ...props }) {
  return (
    <input
      type={type}
      {...props}
      style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontFamily: 'JetBrains Mono, monospace', padding: '10px 14px', borderRadius: 8, fontSize: '0.95rem', outline: 'none', width: '100%' }}
      onFocus={e => e.target.style.borderColor = '#e10600'}
      onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; props.onBlur?.(e); }}
    />
  );
}

function StudioRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <span style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.65)', fontWeight: 500, minWidth: 70 }}>{label}</span>
      {children}
    </div>
  );
}
