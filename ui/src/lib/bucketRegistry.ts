import { isEpic, type KindBearing } from './todoKind';

export type BucketType = 'inbox' | 'bugfix';
export type TriageTag = 'domain' | 'orchestration' | 'operational';

export const TRIAGE_TAGS: readonly TriageTag[] = ['domain', 'orchestration', 'operational'];

/** Lane label + stable render order for the Triage section. */
export const BUCKET_LANE_LABEL: Readonly<Record<BucketType, string>> = {
  inbox: 'Inbox',
  bugfix: 'Bugfix inbox',
};
export const BUCKET_TYPE_ORDER: readonly BucketType[] = ['inbox', 'bugfix'];

export interface BucketBearingUI extends KindBearing {
  bucketType?: BucketType | null;
  isBucket?: boolean;
}

/** Structural bucket predicate — role from `kind`, bucket-ness from the
 *  `bucketType`/`isBucket` COLUMNS, never the title. */
export function isBucketEpicUI(t: BucketBearingUI | null | undefined): boolean {
  if (!t) return false;
  if (!isEpic(t)) return false;
  return (t.bucketType ?? null) != null || t.isBucket === true;
}

/** The bucket lane key for a bucket epic (null if unknown). */
export function bucketTypeOfTodo(t: BucketBearingUI | null | undefined): BucketType | null {
  return t?.bucketType ?? null;
}
