/**
 * Domain-plugin barrel (design-system-object-primitive §8, Phase 4).
 *
 * Single import that seeds collab's full built-in domain set. Each domain module
 * self-registers (`registerDomainPlugin`) on import, so importing this barrel is
 * what loads them into the registry; consumers (the server boot, the fleet-graph
 * view layer) import this one module rather than each plugin file. The core never
 * names a domain — it only ever sees the generic DomainPlugin contract.
 *
 * Phase 2 seeded cad + saas; Phase 4 adds robotics + electrical + requirements.
 */
export { cadPlugin } from './cad';
export { saasPlugin } from './saas';
export { roboticsPlugin } from './robotics';
export { electricalPlugin } from './electrical';
export { requirementsPlugin } from './requirements';
