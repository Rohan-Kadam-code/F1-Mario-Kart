import { create } from 'zustand';

export const useSceneStore = create((set) => ({
  // Three.js karts map — kept as ref via sceneRefs, not here
  // But we store garage state + quality for UI-driven changes
  garageMode: false,
  garageKartIndex: 0,
  quality: 'high',
  isAudioEnabled: true,
  isLoading: false,
  loadProgress: 0,
  loadStage: '',

  setGarageMode: (on) => set({ garageMode: on }),
  setGarageKartIndex: (i) => set({ garageKartIndex: i }),
  setQuality: (q) => set({ quality: q }),
  setAudioEnabled: (v) => set({ isAudioEnabled: v }),
  setLoading: (on, progress = 0, stage = '') =>
    set({ isLoading: on, loadProgress: progress, loadStage: stage }),
  setLoadProgress: (progress, stage) => set({ loadProgress: progress, loadStage: stage }),
}));
