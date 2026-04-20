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
    const { draggedTaskId, dragOverColumn, dragSourceColumn } = useDragStore.getState();
    expect(draggedTaskId).toBeNull();
    expect(dragOverColumn).toBeNull();
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

  it('does not clear dragOverColumn when called', () => {
    useDragStore.setState({ dragOverColumn: 'todo' });
    useDragStore.getState().startDrag('task-1', 'in-progress');
    expect(useDragStore.getState().dragOverColumn).toBe('todo');
  });
});

describe('useDragStore — setDragOver', () => {
  it('sets dragOverColumn to a column', () => {
    useDragStore.getState().setDragOver('in-progress');
    expect(useDragStore.getState().dragOverColumn).toBe('in-progress');
  });

  it('clears dragOverColumn when called with null', () => {
    useDragStore.setState({ dragOverColumn: 'done' });
    useDragStore.getState().setDragOver(null);
    expect(useDragStore.getState().dragOverColumn).toBeNull();
  });
});

describe('useDragStore — resetDrag', () => {
  it('clears draggedTaskId, dragOverColumn, and dragSourceColumn', () => {
    useDragStore.setState({
      draggedTaskId: 'task-1',
      dragOverColumn: 'in-progress',
      dragSourceColumn: 'in-progress',
    });

    useDragStore.getState().resetDrag();

    const { draggedTaskId, dragOverColumn, dragSourceColumn } = useDragStore.getState();
    expect(draggedTaskId).toBeNull();
    expect(dragOverColumn).toBeNull();
    expect(dragSourceColumn).toBeNull();
  });
});
