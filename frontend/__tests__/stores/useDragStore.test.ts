/**
 * Unit tests for useDragStore.
 * Verifies that drag state actions update correctly and resetDrag clears all fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useDragStore } from '../../src/stores/useDragStore';

beforeEach(() => {
  useDragStore.getState().resetDrag();
});

describe('useDragStore — initial state', () => {
  it('starts with all fields null', () => {
    const { draggedTaskId, dragOverTaskId, dragSourceColumn } = useDragStore.getState();
    expect(draggedTaskId).toBeNull();
    expect(dragOverTaskId).toBeNull();
    expect(dragSourceColumn).toBeNull();
  });
});

describe('useDragStore — startDrag', () => {
  it('sets draggedTaskId and dragSourceColumn', () => {
    useDragStore.getState().startDrag('task-1', 'todo');
    const { draggedTaskId, dragSourceColumn } = useDragStore.getState();
    expect(draggedTaskId).toBe('task-1');
    expect(dragSourceColumn).toBe('todo');
  });

  it('does not clear dragOverTaskId when called', () => {
    useDragStore.setState({ dragOverTaskId: 'task-2' });
    useDragStore.getState().startDrag('task-1', 'in-progress');
    expect(useDragStore.getState().dragOverTaskId).toBe('task-2');
  });
});

describe('useDragStore — setDragOver', () => {
  it('sets dragOverTaskId to a task ID', () => {
    useDragStore.getState().setDragOver('task-3');
    expect(useDragStore.getState().dragOverTaskId).toBe('task-3');
  });

  it('clears dragOverTaskId when called with null', () => {
    useDragStore.setState({ dragOverTaskId: 'task-3' });
    useDragStore.getState().setDragOver(null);
    expect(useDragStore.getState().dragOverTaskId).toBeNull();
  });
});

describe('useDragStore — resetDrag', () => {
  it('clears draggedTaskId, dragOverTaskId, and dragSourceColumn', () => {
    useDragStore.setState({
      draggedTaskId: 'task-1',
      dragOverTaskId: 'task-2',
      dragSourceColumn: 'in-progress',
    });

    useDragStore.getState().resetDrag();

    const { draggedTaskId, dragOverTaskId, dragSourceColumn } = useDragStore.getState();
    expect(draggedTaskId).toBeNull();
    expect(dragOverTaskId).toBeNull();
    expect(dragSourceColumn).toBeNull();
  });
});
