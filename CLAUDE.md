# F1.Mario — Codebase Index

React 18 + Tailwind v4 + Zustand + Three.js race replay visualiser.
Entry: `src/main.jsx` → `src/components/App.jsx`

## Stack
| Layer | Technology |
|---|---|
| UI | React 18 (no StrictMode — Three.js incompatible) |
| State | Zustand 5 (stores read via `.getState()` in rAF loop) |
| Styling | Tailwind CSS v4 (`@import "tailwindcss"` in globals.css) |
| 3D | Three.js via SceneManager (imperative, ref-based) |
| Build | Vite 8 + `@vitejs/plugin-react` + `@tailwindcss/vite` |
| API | OpenF1 REST (`/api` proxy → `api.openf1.org`) |
| Cache | IndexedDB via `idb` (API data + GPS telemetry chunks) |

## Stores (`src/stores/`)
| File | Holds |
|---|---|
| `sessionStore.js` | session, drivers, positions, laps, stints, weather, raceControl, intervals, pitStops, raceStartTime, raceEndTime, raceDuration, totalLaps, trackPoints2D, pitLanePoints2D, matchedCircuit, worldTrackLength, gridSlots, driverLapTimes, locationCache |
| `playbackStore.js` | currentRaceTime, isPlaying, speed, currentLap, trackedDriver, positionSnapshot, lastPositionMap, lastIntervalMap, fastestLapTime, fastestLapDriver, detectedEvents, currentWeather, currentRaceControl |
| `sceneStore.js` | garageMode, garageKartIndex, quality, isAudioEnabled, isLoading, loadProgress, loadStage |

## Hooks (`src/hooks/`)
| File | Purpose |
|---|---|
| `useRenderLoop.js` | 60fps rAF loop. Reads stores via `.getState()` (not hooks). Advances time, moves karts, detects events, calls `sceneManager.render()`. Throttles UI writes to ~10fps. |
| `useSessionLoader.js` | Async session data fetch → track build → kart create → store write. Deferred SceneManager construction so container has layout. |

## Components (`src/components/`)
| File | Role |
|---|---|
| `App.jsx` | Root. Holds `sceneRefs` + `audioRef`. Wires hooks. Layout. |
| `RaceCanvas.jsx` | Container div. Deferred SceneManager init via `requestAnimationFrame`. Canvas controls overlay. |
| `MiniMap.jsx` | React wrapper around vanilla `MiniMap` class (canvas). |
| `SessionSelector.jsx` | Year → Meeting → Session dropdowns. Calls `loadSession`. |
| `DriverPanel.jsx` | Left sidebar. Reads `positionSnapshot` ~10fps. |
| `PlaybackControls.jsx` | Playback bar. Reads/writes playback store. |
| `EventFeed.jsx` | Right sidebar. Imperative `addEvent()` via forwardRef. |
| `RaceInfo.jsx` | Footer. Imperative `updateWeather/addRaceControlMessage` via forwardRef. |
| `GaragePanel.jsx` | Overlay. Reads `garageMode` from sceneStore. Calls `kart.*` methods. |
| `LoadingOverlay.jsx` | Reads `isLoading/loadProgress/loadStage` from sceneStore. |

## Libs (`src/lib/`)
| File | Exports |
|---|---|
| `geometry.js` | `projectLatLng`, `generateFallbackTrackPoints`, `computeArcLengths`, `walkBackFromStart`, `computeWorldTrackLength` |
| `timeline.js` | `buildTimeline`, `buildDriverLapTimes` |
| `positioning.js` | `getPositionSnapshot`, `getDriverTrackProgress`, `getCurrentLap`, `getWeatherAtTime`, `getRaceControlAtTime` |
| `kartFactory.js` | `createKarts(drivers, scene, year, existingKarts)` |

## Renderer (DO NOT MODIFY — imperative Three.js)
```
src/renderer3d/
  SceneManager.js   - WebGLRenderer, cameras (orbit/chase/tcam), interaction, resize
  Track3D.js        - 3D track mesh, pit lane, start lights, grid markers
  Kart3D.js         - F1 car mesh (GLB or procedural), updatePosition()
  Particles3D.js    - Boost / star / confetti / rain particle systems
  Environment3D.js  - Lighting, skybox, rain toggle
  CarModelLoader.js - GLB async preload

src/renderer/
  DriverSprite.js   - getTeamColor(teamName, year)
  AudioEffects.js   - Engine sounds, effects
  MarioEffects.js   - DOM overlay animations, EFFECT_TYPES enum
  ParticleSystem.js - 2D canvas particles (legacy, used via adapter)

src/components/MiniMap.js  - Vanilla canvas mini-map class
```

## API (`src/api/openf1.js`)
Rate-limited (2 req/s) fetch wrapper with IndexedDB caching.
Endpoints: getMeetings, getSessions, getDrivers, getPositions, getLaps, getIntervals,
getStints, getWeather, getRaceControl, getPitStops, getLocations, getLocationsAll

## Key Patterns
- **rAF loop never uses React hooks** — reads `useXxxStore.getState()` directly
- **SceneManager deferred** — constructed inside `requestAnimationFrame` in `RaceCanvas.jsx` so `clientWidth/clientHeight` are non-zero
- **positionSnapshot throttled** — written to store ~10fps (not 60fps) to avoid over-rendering `DriverPanel`
- **imperative methods** — `RaceInfo` and `EventFeed` expose `forwardRef` APIs for the render loop
- **sceneRefs** — shared mutable ref bag: `{ sceneManager, track3D, particles3D, environment3D, miniMap, karts, marioEffects, raceInfo }`

## CSS
`src/styles/globals.css` — Tailwind v4 import + CSS custom props + all component styles
`src/styles/mario-effects.css` — Mario Kart animation keyframes (untouched)
