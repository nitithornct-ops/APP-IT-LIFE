import { useSyncExternalStore } from 'react';

export const DENSITY_KEY = 'itlife-density';
export const DENSITIES = ['compact', 'standard', 'comfortable'] as const;
export type Density = typeof DENSITIES[number];
const CHANGE_EVENT = 'itlife-density-change';

export function readDensity(): Density {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return DENSITIES.find(density => density === value) ?? 'standard';
  } catch {
    return 'standard';
  }
}

let current: Density = 'standard';

export function initializeDensity() {
  current = readDensity();
  document.documentElement.dataset.density = current;
}

export function setDensity(density: Density) {
  current = density;
  document.documentElement.dataset.density = density;
  try { localStorage.setItem(DENSITY_KEY, density); } catch { /* Preferences remain usable when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const sync = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key !== DENSITY_KEY && event.key !== null) return;
      initializeDensity();
    }
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, sync);
  window.addEventListener('storage', sync);
  return () => {
    window.removeEventListener(CHANGE_EVENT, sync);
    window.removeEventListener('storage', sync);
  };
}

export function useDensity() {
  return useSyncExternalStore(subscribe, () => current, () => 'standard' as Density);
}
