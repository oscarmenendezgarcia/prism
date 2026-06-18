/**
 * ArcBar — horizontal chip bar shown above the board columns.
 * Displays distinct arc values from all tasks in the active space.
 * Clicking an arc chip toggles arcFilter in the global store.
 * The grouping toggle button enables arcGrouping (visually groups cards by arc in each column).
 */

import { useAppStore, useTasks } from '@/stores/useAppStore';
import { distinctArcs } from '@/utils/arcs';

export function ArcBar() {
  const tasks       = useTasks();
  const arcFilter   = useAppStore((s) => s.arcFilter);
  const arcGrouping = useAppStore((s) => s.arcGrouping);
  const setArcFilter      = useAppStore((s) => s.setArcFilter);
  const toggleArcGrouping = useAppStore((s) => s.toggleArcGrouping);

  const arcs = distinctArcs(tasks);

  // Hide bar when there are no arcs in the space
  if (arcs.length === 0) return null;

  return (
    <div
      data-testid="arc-bar"
      className="flex items-center gap-2 px-6 py-2 border-b border-border bg-surface-elevated/40 overflow-x-auto flex-shrink-0"
    >
      {/* Label */}
      <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-widest flex-shrink-0 mr-1">
        Arc
      </span>

      {/* "All" chip — clears filter */}
      <button
        type="button"
        onClick={() => setArcFilter(null)}
        aria-pressed={arcFilter === null}
        className={`inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-fast flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
          arcFilter === null
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
        }`}
      >
        All
      </button>

      {/* Arc chips */}
      {arcs.map((arc) => (
        <button
          key={arc}
          type="button"
          onClick={() => setArcFilter(arcFilter === arc ? null : arc)}
          aria-pressed={arcFilter === arc}
          data-testid={`arc-filter-chip-${arc}`}
          className={`inline-flex items-center text-[11px] font-mono font-semibold px-2.5 py-1 rounded-full border transition-all duration-fast flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            arcFilter === arc
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
          }`}
        >
          {arc}
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Group toggle */}
      <button
        type="button"
        onClick={toggleArcGrouping}
        aria-pressed={arcGrouping}
        title={arcGrouping ? 'Disable arc grouping' : 'Group cards by arc'}
        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-fast flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
          arcGrouping
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
        }`}
      >
        <span className="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">
          group_work
        </span>
        Group
      </button>
    </div>
  );
}
