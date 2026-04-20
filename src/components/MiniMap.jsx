/**
 * MiniMap — wraps the imperative MiniMap class in a React container div.
 * The class instance is stored in sceneRefs so the render loop can call .update().
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MiniMap as MiniMapClass } from './MiniMapClass.js';

export const MiniMap = forwardRef(function MiniMap({ sceneRefs }, ref) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const mm = new MiniMapClass(el);
    instanceRef.current = mm;

    // Store in sceneRefs so render loop & session loader can access it
    if (sceneRefs) sceneRefs.current = { ...sceneRefs.current, miniMap: mm };

    return () => {
      window.removeEventListener('resize', mm._resizeHandler);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => instanceRef.current);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: 160,
        height: 120,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(8,8,16,0.7)',
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: 10,
        overflow: 'hidden',
      }}
    />
  );
});
