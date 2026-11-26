/**
 * Local persistence for surface environmental state and saved Godmode scenarios (Sections 14 & 16).
 */

import type { PersistentSurfaceState, SavedScenario } from '../core/types';

const SURFACE_KEY_PREFIX = 'microcosm.surface.v1.';
const SCENARIOS_KEY = 'microcosm.scenarios.v1';

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

export function saveSurfaceState(
  regionId: string,
  state: PersistentSurfaceState,
  storage?: Storage
): void {
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.setItem(SURFACE_KEY_PREFIX + regionId, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSurfaceState(
  regionId: string,
  storage?: Storage
): Partial<PersistentSurfaceState> | null {
  const store = getStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(SURFACE_KEY_PREFIX + regionId);
    return raw ? (JSON.parse(raw) as Partial<PersistentSurfaceState>) : null;
  } catch {
    return null;
  }
}

export function listScenarios(storage?: Storage): SavedScenario[] {
  const store = getStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(SCENARIOS_KEY);
    return raw ? (JSON.parse(raw) as SavedScenario[]) : [];
  } catch {
    return [];
  }
}

export function saveScenario(scenario: SavedScenario, storage?: Storage): SavedScenario[] {
  const store = getStorage(storage);
  const existing = listScenarios(store ?? undefined).filter((s) => s.name !== scenario.name);
  const next = [scenario, ...existing].slice(0, 20);
  if (store) {
    try {
      store.setItem(SCENARIOS_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function deleteScenario(name: string, storage?: Storage): SavedScenario[] {
  const store = getStorage(storage);
  const next = listScenarios(store ?? undefined).filter((s) => s.name !== name);
  if (store) {
    try {
      store.setItem(SCENARIOS_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }
  return next;
}
