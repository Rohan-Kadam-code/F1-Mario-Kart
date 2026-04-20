import { useSceneStore } from '../stores/sceneStore.js';

const TIPS = [
  '💡 Click a driver card to follow their kart with the camera.',
  '⚡ Use 5x or 10x speed to jump to the action.',
  '🏎️ Overtakes trigger mushroom boosts. Watch for the sparks!',
  '🗺️ The mini-map in the corner tracks every car in real time.',
  '🎮 Press C to cycle through camera modes (orbit / chase / T-cam).',
];

export function LoadingOverlay() {
  const isLoading = useSceneStore((s) => s.isLoading);
  const progress = useSceneStore((s) => s.loadProgress);
  const stage = useSceneStore((s) => s.loadStage);

  if (!isLoading) return null;

  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: '#060610' }}
    >
      <div className="loading-grid" />
      <div className="loading-stripes" />

      <div className="relative flex flex-col items-center gap-4 z-10">
        {/* Kart animation */}
        <div className="relative w-20 h-12">
          <span className="loading-kart absolute text-5xl">🏎️</span>
          <div className="loading-kart-trail absolute bottom-0.5 -left-5 w-14 h-0.5 rounded-full" />
        </div>

        {/* Title */}
        <h1 className="text-4xl font-black tracking-tighter leading-none">
          <span style={{ color: '#fff' }}>F1</span>
          <span style={{ color: '#e10600', textShadow: '0 0 20px rgba(225,6,0,0.7)' }}>.</span>
          <span
            style={{
              background: 'linear-gradient(135deg, #e10600 0%, #ff6b35 60%, #fbbf24 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Mario
          </span>
        </h1>

        {/* Stage label */}
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: 'var(--text-secondary)' }}>
          {stage || 'Loading…'}
        </p>

        {/* Progress bar */}
        <div className="relative w-72 h-1.5 rounded-full overflow-visible" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="loading-progress-fill h-full rounded-full"
            style={{ width: `${progress}%` }}
          />
          <div
            className="loading-progress-glow absolute -top-1 w-3.5 h-3.5 rounded-full"
            style={{ left: `${progress}%` }}
          />
        </div>

        <span
          className="text-sm font-semibold font-mono"
          style={{ color: 'var(--accent-neon)', textShadow: '0 0 10px rgba(0,255,136,0.4)' }}
        >
          {progress}%
        </span>

        {/* Tip */}
        <div
          className="flex items-start gap-2 max-w-xs rounded-lg px-3 py-2 mt-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <span className="text-sm flex-shrink-0 mt-px">💬</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{tip}</p>
        </div>
      </div>

      {/* Checkered bottom */}
      <div className="loading-checker absolute bottom-0 left-0 right-0 h-5" />
    </div>
  );
}
