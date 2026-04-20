/**
 * kartFactory — Creates Kart3D instances for all drivers.
 */
import { Kart3D } from '../renderer3d/Kart3D.js';
import { getTeamColor } from '../renderer/DriverSprite.js';
import { preloadCarModel, isModelLoaded } from '../renderer3d/CarModelLoader.js';

/**
 * Dispose old karts, preload GLB model, create new Kart3D instances.
 * @param {Object[]} drivers
 * @param {THREE.Scene} scene
 * @param {number} year
 * @param {Map} existingKarts - old karts to dispose
 * @returns {Promise<Map<number, Kart3D>>}
 */
export async function createKarts(drivers, scene, year, existingKarts) {
  // Dispose old karts
  if (existingKarts) {
    for (const kart of existingKarts.values()) kart.dispose();
    existingKarts.clear();
  }

  if (!isModelLoaded()) {
    try {
      await preloadCarModel();
      console.log('[kartFactory] GLB model loaded');
    } catch (e) {
      console.warn('[kartFactory] GLB model failed, using procedural karts:', e);
    }
  }

  const karts = new Map();
  drivers.forEach((d) => {
    // Prefer the team_colour field from the OpenF1 API (exact season color).
    // Fall back to the local color map if the API field is missing.
    const apiColor = d.team_colour ? `#${d.team_colour.replace('#', '')}` : null;
    const color = apiColor || getTeamColor(d.team_name, year);
    const kart = new Kart3D(d, color, scene, year);
    karts.set(d.driver_number, kart);
  });
  return karts;
}
