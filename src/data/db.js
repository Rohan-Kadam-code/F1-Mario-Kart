import { openDB } from 'idb';

const DB_NAME = 'openf1-cache';
const DB_VERSION = 1;

// Object stores
const STORE_METADATA = 'metadata'; // For generic API responses (drivers, sessions, etc.)
const STORE_LOCATIONS = 'locations'; // For LocationCache telemetry chunks

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA);
        }
        if (!db.objectStoreNames.contains(STORE_LOCATIONS)) {
          db.createObjectStore(STORE_LOCATIONS);
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Save generic API metadata to IndexedDB
 */
export async function setApiCache(key, data) {
  try {
    const db = await getDB();
    await db.put(STORE_METADATA, data, key);
  } catch (e) {
    console.warn('Failed to cache API response:', e);
  }
}

/**
 * Retrieve cached API metadata
 */
export async function getApiCache(key) {
  try {
    const db = await getDB();
    const data = await db.get(STORE_METADATA, key);
    return data || null;
  } catch (e) {
    console.warn('Failed to get cached API response:', e);
    return null;
  }
}

/**
 * Save location data chunks
 */
export async function setLocationChunkCache(key, data) {
  try {
    const db = await getDB();
    await db.put(STORE_LOCATIONS, data, key);
  } catch (e) {
    console.warn('Failed to cache location chunk:', e);
  }
}

/**
 * Retrieve location data chunk
 */
export async function getLocationChunkCache(key) {
  try {
    const db = await getDB();
    const data = await db.get(STORE_LOCATIONS, key);
    return data || null;
  } catch (e) {
    console.warn('Failed to get location chunk cache:', e);
    return null;
  }
}

/**
 * Retrieve ALL cached location data keys for a session to know what we already have
 */
export async function getSessionLocationKeys(sessionKey) {
  try {
    const db = await getDB();
    const keys = await db.getAllKeys(STORE_LOCATIONS);
    return keys.filter(k => k.startsWith(`loc_${sessionKey}_`));
  } catch (e) {
    console.warn('Failed to get session location keys:', e);
    return [];
  }
}

/**
 * Clear all cached data (useful for settings page)
 */
export async function clearCache() {
  try {
    const db = await getDB();
    await Promise.all([
      db.clear(STORE_METADATA),
      db.clear(STORE_LOCATIONS)
    ]);
    console.log('[Cache] IndexedDB cleared');
  } catch (e) {
    console.warn('Failed to clear cache:', e);
  }
}
