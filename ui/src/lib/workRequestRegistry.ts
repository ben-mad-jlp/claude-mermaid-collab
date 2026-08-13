import { isEpic, type KindBearing } from './todoKind';

export type WorkRequestType = 'inbox' | 'bugfix' | 'explore' | 'feature';
export type FrictionLayer = 'domain' | 'orchestration' | 'operational';

export const FRICTION_LAYERS: readonly FrictionLayer[] = ['domain', 'orchestration', 'operational'];

/** Lane label + stable render order for the work-request view (explore, bugfix, feature). */
export const WORK_REQUEST_VIEW_LABEL: Readonly<Record<'explore'|'bugfix'|'feature', string>> = {
  explore: 'Explore',
  bugfix: 'Bugfix',
  feature: 'Feature',
};
export const WORK_REQUEST_VIEW_ORDER = ['explore','bugfix','feature'] as const;

export interface WorkRequestBearingUI extends KindBearing {
  bucketType?: WorkRequestType | null;
  isBucket?: boolean;
}

/** Structural bucket predicate — role from `kind`, bucket-ness from the
 *  `bucketType`/`isBucket` COLUMNS, never the title. */
export function isBucketEpicUI(t: WorkRequestBearingUI | null | undefined): boolean {
  if (!t) return false;
  if (!isEpic(t)) return false;
  return (t.bucketType ?? null) != null || t.isBucket === true;
}

/** The bucket lane key for a bucket epic (null if unknown). */
export function workRequestTypeOfTodo(t: WorkRequestBearingUI | null | undefined): WorkRequestType | null {
  return t?.bucketType ?? null;
}

/** Map legacy inbox type to explore; pass feature/bugfix through; null/undefined stays null. */
export function normalizeWorkRequestType(t: WorkRequestType | null | undefined): 'explore'|'bugfix'|'feature'|null {
  if (t === 'inbox') return 'explore';
  if (t === 'explore' || t === 'bugfix' || t === 'feature') return t;
  return null;
}
