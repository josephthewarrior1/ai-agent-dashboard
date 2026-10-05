import { useSyncExternalStore } from 'react';
import { createOfficeStore } from './office-state.js';

export const officeStore = createOfficeStore({
  websocketUrl: typeof window === 'undefined' ? null : window.HERMES_OFFICE_CONFIG?.websocketUrl ?? null,
});

export function useOfficeStore(selector = value => value) {
  const snapshot = useSyncExternalStore(officeStore.subscribe, officeStore.getSnapshot, officeStore.getServerSnapshot);
  return selector(snapshot);
}

export { createOfficeStore, normalizeLiveState, websocketURL, DESKS, ROOM_GOALS } from './office-state.js';
