/**
 * EventFeed — right sidebar.
 * Forwards a real DOM div ref to the parent so MarioEffects can call
 * appendChild / insertBefore directly on it (it manages its own DOM children).
 */
import { forwardRef } from 'react';

export const EventFeed = forwardRef(function EventFeed(_, ref) {
  return (
    <aside
      className="glass-panel"
      style={{
        width: 200,
        flexShrink: 0,
        borderLeft: '1px solid var(--border-subtle)',
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="panel-header">
        <span>📡 Live Feed</span>
      </div>

      {/* MarioEffects writes directly into this div */}
      <div
        ref={ref}
        className="event-feed"
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
      >
        <div
          className="event-item"
          style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 10px', fontSize: '0.68rem' }}
        >
          Waiting for session…
        </div>
      </div>
    </aside>
  );
});
