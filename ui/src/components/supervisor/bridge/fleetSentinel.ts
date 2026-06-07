/**
 * Sentinel value for uiStore.activeProject meaning "the FLEET landing" (the
 * cross-project triage + status grid) rather than a single project. A real
 * project path can never collide with this (paths are absolute, start with '/').
 */
export const FLEET_SENTINEL = '__fleet__';
