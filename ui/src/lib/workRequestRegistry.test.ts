import { describe, it, expect } from 'vitest';
import { WORK_REQUEST_VIEW_ORDER, normalizeWorkRequestType, workRequestTypeOfTodo, type WorkRequestBearingUI } from './workRequestRegistry';

describe('workRequestRegistry', () => {
  it('WORK_REQUEST_VIEW_ORDER is explore,bugfix,feature in order', () => {
    expect(WORK_REQUEST_VIEW_ORDER).toEqual(['explore', 'bugfix', 'feature']);
  });

  it('normalizeWorkRequestType maps legacy inbox to explore, passes feature through, and returns null for null', () => {
    expect(normalizeWorkRequestType('inbox')).toBe('explore');
    expect(normalizeWorkRequestType('explore')).toBe('explore');
    expect(normalizeWorkRequestType('bugfix')).toBe('bugfix');
    expect(normalizeWorkRequestType('feature')).toBe('feature');
    expect(normalizeWorkRequestType(null)).toBe(null);
    expect(normalizeWorkRequestType(undefined)).toBe(null);
  });

  it('workRequestTypeOfTodo reads the bucketType column and returns null for a title-only match', () => {
    const titleOnlyBucket: WorkRequestBearingUI = {
      kind: 'epic',
      title: 'Bugfix inbox',
      bucketType: null,
      isBucket: undefined,
    };
    expect(workRequestTypeOfTodo(titleOnlyBucket)).toBe(null);

    const columnBucket: WorkRequestBearingUI = {
      kind: 'epic',
      title: 'Some title',
      bucketType: 'bugfix',
      isBucket: undefined,
    };
    expect(workRequestTypeOfTodo(columnBucket)).toBe('bugfix');

    expect(workRequestTypeOfTodo(null)).toBe(null);
    expect(workRequestTypeOfTodo(undefined)).toBe(null);
  });
});
