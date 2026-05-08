/**
 * Unit tests for usePipelineLogStore.
 * ADR-1 (log-viewer) T-010: all state and action coverage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePipelineLogStore } from '../../src/stores/usePipelineLogStore';

function resetStore() {
  usePipelineLogStore.setState({
    logPanelOpen:       false,
    selectedStageIndex: 0,
    stageLogs:          {},
    stageLoading:       {},
    stageErrors:        {},
  });
}

beforeEach(() => {
  resetStore();
});

describe('usePipelineLogStore — initial state', () => {
  it('initialises logPanelOpen to false', () => {
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });

  it('initialises selectedStageIndex to 0', () => {
    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(0);
  });

  it('initialises stageLogs to empty object', () => {
    expect(usePipelineLogStore.getState().stageLogs).toEqual({});
  });

  it('initialises stageLoading to empty object', () => {
    expect(usePipelineLogStore.getState().stageLoading).toEqual({});
  });

  it('initialises stageErrors to empty object', () => {
    expect(usePipelineLogStore.getState().stageErrors).toEqual({});
  });
});

describe('usePipelineLogStore — setLogPanelOpen', () => {
  it('sets logPanelOpen to true', () => {
    usePipelineLogStore.getState().setLogPanelOpen(true);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
  });

  it('sets logPanelOpen back to false', () => {
    usePipelineLogStore.getState().setLogPanelOpen(true);
    usePipelineLogStore.getState().setLogPanelOpen(false);
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(false);
  });
});

describe('usePipelineLogStore — setSelectedStageIndex', () => {
  it('sets selectedStageIndex to the given value', () => {
    usePipelineLogStore.getState().setSelectedStageIndex(3);
    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(3);
  });

  it('can be set back to 0', () => {
    usePipelineLogStore.getState().setSelectedStageIndex(3);
    usePipelineLogStore.getState().setSelectedStageIndex(0);
    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(0);
  });
});

describe('usePipelineLogStore — setStageLog', () => {
  it('stores log content for a given stage index', () => {
    usePipelineLogStore.getState().setStageLog(2, 'hello world');
    expect(usePipelineLogStore.getState().stageLogs[2]).toBe('hello world');
  });

  it('does not overwrite other stages when setting one stage', () => {
    usePipelineLogStore.getState().setStageLog(0, 'stage 0 log');
    usePipelineLogStore.getState().setStageLog(2, 'stage 2 log');
    expect(usePipelineLogStore.getState().stageLogs[0]).toBe('stage 0 log');
    expect(usePipelineLogStore.getState().stageLogs[2]).toBe('stage 2 log');
  });

  it('overwrites log for the same stage index', () => {
    usePipelineLogStore.getState().setStageLog(1, 'first');
    usePipelineLogStore.getState().setStageLog(1, 'updated');
    expect(usePipelineLogStore.getState().stageLogs[1]).toBe('updated');
  });
});

describe('usePipelineLogStore — setStageLoading', () => {
  it('sets loading to true for a stage', () => {
    usePipelineLogStore.getState().setStageLoading(0, true);
    expect(usePipelineLogStore.getState().stageLoading[0]).toBe(true);
  });

  it('sets loading to false for a stage', () => {
    usePipelineLogStore.getState().setStageLoading(0, true);
    usePipelineLogStore.getState().setStageLoading(0, false);
    expect(usePipelineLogStore.getState().stageLoading[0]).toBe(false);
  });
});

describe('usePipelineLogStore — setStageError', () => {
  it('stores an error message for a stage', () => {
    usePipelineLogStore.getState().setStageError(1, 'HTTP 500');
    expect(usePipelineLogStore.getState().stageErrors[1]).toBe('HTTP 500');
  });

  it('stores null to clear an error for a stage', () => {
    usePipelineLogStore.getState().setStageError(1, 'HTTP 500');
    usePipelineLogStore.getState().setStageError(1, null);
    expect(usePipelineLogStore.getState().stageErrors[1]).toBeNull();
  });
});

describe('usePipelineLogStore — appendStageEvents', () => {
  it('appends new events to an empty slot', () => {
    const events = [
      { idx: 0, kind: 'session_start' as const, t: 0 },
      { idx: 1, kind: 'assistant_text' as const, t: 1, bytes: 10, preview: 'hi' },
    ];
    usePipelineLogStore.getState().appendStageEvents(0, events as any);
    expect(usePipelineLogStore.getState().stageEvents[0]).toHaveLength(2);
    expect(usePipelineLogStore.getState().stageEvents[0][0].idx).toBe(0);
    expect(usePipelineLogStore.getState().stageEvents[0][1].idx).toBe(1);
  });

  it('appends incremental events to an existing slot', () => {
    const first  = [{ idx: 0, kind: 'session_start' as const, t: 0 }];
    const second = [{ idx: 1, kind: 'assistant_text' as const, t: 1, bytes: 5, preview: 'x' }];
    usePipelineLogStore.getState().appendStageEvents(0, first as any);
    usePipelineLogStore.getState().appendStageEvents(0, second as any);
    expect(usePipelineLogStore.getState().stageEvents[0]).toHaveLength(2);
  });

  it('deduplicates events with the same idx (polling race safety net)', () => {
    const batch = [
      { idx: 0, kind: 'session_start' as const, t: 0 },
      { idx: 1, kind: 'assistant_text' as const, t: 1, bytes: 5, preview: 'hi' },
    ];
    // Simulate two concurrent since=0 fetches both completing
    usePipelineLogStore.getState().appendStageEvents(0, batch as any);
    usePipelineLogStore.getState().appendStageEvents(0, batch as any);
    // Must have exactly 2 events, not 4
    expect(usePipelineLogStore.getState().stageEvents[0]).toHaveLength(2);
    expect(usePipelineLogStore.getState().stageEvents[0].map((e: any) => e.idx)).toEqual([0, 1]);
  });

  it('does not mix events across store slots', () => {
    const ev0 = [{ idx: 0, kind: 'session_start' as const, t: 0 }];
    const ev1 = [{ idx: 0, kind: 'rate_limit' as const, t: 0, status: '429' }];
    usePipelineLogStore.getState().appendStageEvents(0, ev0 as any);
    usePipelineLogStore.getState().appendStageEvents(1, ev1 as any);
    expect(usePipelineLogStore.getState().stageEvents[0][0].kind).toBe('session_start');
    expect(usePipelineLogStore.getState().stageEvents[1][0].kind).toBe('rate_limit');
  });
});

describe('usePipelineLogStore — clearStageLogs', () => {
  it('resets stageLogs to empty object', () => {
    usePipelineLogStore.getState().setStageLog(0, 'data');
    usePipelineLogStore.getState().setStageLog(2, 'more data');
    usePipelineLogStore.getState().clearStageLogs();
    expect(usePipelineLogStore.getState().stageLogs).toEqual({});
  });

  it('resets stageLoading to empty object', () => {
    usePipelineLogStore.getState().setStageLoading(0, true);
    usePipelineLogStore.getState().clearStageLogs();
    expect(usePipelineLogStore.getState().stageLoading).toEqual({});
  });

  it('resets stageErrors to empty object', () => {
    usePipelineLogStore.getState().setStageError(0, 'error msg');
    usePipelineLogStore.getState().clearStageLogs();
    expect(usePipelineLogStore.getState().stageErrors).toEqual({});
  });

  it('does not reset logPanelOpen or selectedStageIndex', () => {
    usePipelineLogStore.getState().setLogPanelOpen(true);
    usePipelineLogStore.getState().setSelectedStageIndex(2);
    usePipelineLogStore.getState().clearStageLogs();
    expect(usePipelineLogStore.getState().logPanelOpen).toBe(true);
    expect(usePipelineLogStore.getState().selectedStageIndex).toBe(2);
  });
});
