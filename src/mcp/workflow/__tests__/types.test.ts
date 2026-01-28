import { ItemStatus, WorkItem, WorkItemType } from '../types';

describe('ItemStatus type', () => {
  it('should define all required status values', () => {
    const statuses: ItemStatus[] = [
      'pending',
      'brainstormed',
      'interface',
      'pseudocode',
      'skeleton',
      'complete',
    ];
    expect(statuses).toHaveLength(6);
  });

  it('should allow creating a WorkItem with pending status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'pending' as ItemStatus,
    };
    expect(item.status).toBe('pending');
  });

  it('should allow creating a WorkItem with brainstormed status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'brainstormed' as ItemStatus,
    };
    expect(item.status).toBe('brainstormed');
  });

  it('should allow creating a WorkItem with interface status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'interface' as ItemStatus,
    };
    expect(item.status).toBe('interface');
  });

  it('should allow creating a WorkItem with pseudocode status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'pseudocode' as ItemStatus,
    };
    expect(item.status).toBe('pseudocode');
  });

  it('should allow creating a WorkItem with skeleton status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'skeleton' as ItemStatus,
    };
    expect(item.status).toBe('skeleton');
  });

  it('should allow creating a WorkItem with complete status', () => {
    const item: WorkItem = {
      number: 1,
      title: 'Test Item',
      type: 'code' as WorkItemType,
      status: 'complete' as ItemStatus,
    };
    expect(item.status).toBe('complete');
  });

  it('should create a valid WorkItem with all required fields', () => {
    const item: WorkItem = {
      number: 5,
      title: 'Complete Feature',
      type: 'code',
      status: 'complete',
    };
    expect(item.number).toBe(5);
    expect(item.title).toBe('Complete Feature');
    expect(item.type).toBe('code');
    expect(item.status).toBe('complete');
  });

  it('should support all WorkItemType values', () => {
    const types: WorkItemType[] = ['code', 'task', 'bugfix'];
    types.forEach((type) => {
      const item: WorkItem = {
        number: 1,
        title: 'Test',
        type,
        status: 'pending',
      };
      expect(item.type).toBe(type);
    });
  });

  it('should support ItemStatus in WorkItem interface', () => {
    const workItems: WorkItem[] = [
      { number: 1, title: 'Item 1', type: 'code', status: 'pending' },
      { number: 2, title: 'Item 2', type: 'code', status: 'brainstormed' },
      { number: 3, title: 'Item 3', type: 'code', status: 'interface' },
      { number: 4, title: 'Item 4', type: 'code', status: 'pseudocode' },
      { number: 5, title: 'Item 5', type: 'code', status: 'skeleton' },
      { number: 6, title: 'Item 6', type: 'code', status: 'complete' },
    ];
    expect(workItems).toHaveLength(6);
    expect(workItems.map((i) => i.status)).toEqual([
      'pending',
      'brainstormed',
      'interface',
      'pseudocode',
      'skeleton',
      'complete',
    ]);
  });
});
