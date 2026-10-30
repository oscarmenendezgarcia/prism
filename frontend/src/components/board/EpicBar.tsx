/**
 * End of the spaces row: filter the board to an epic, and open the space's settings.
 */

import { useAppStore, useTasks } from '@/stores/useAppStore';
import { allTasks } from '@/utils/issues';

export function EpicBar() {
  const tasks = useTasks();
  const epicFilter = useAppStore((s) => s.epicFilter);
  const setEpicFilter = useAppStore((s) => s.setEpicFilter);
  const openSpaceModal = useAppStore((s) => s.openSpaceModal);
  const space = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId));

  const epics = allTasks(tasks)
    .filter((t) => t.type === 'epic')
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div
      data-testid="epic-bar"
      className="flex items-center gap-1 pr-4 border-b border-border bg-surface-elevated flex-shrink-0"
    >
      {epics.length > 0 && (
        <select
          value={epicFilter ?? ''}
          onChange={(e) => setEpicFilter(e.target.value || null)}
          aria-label="Filter by epic"
          data-testid="epic-filter"
          className={`h-7 max-w-[7.5rem] sm:max-w-[12rem] pl-2.5 pr-1 rounded-md border text-xs font-medium truncate cursor-pointer transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary/50 ${
            epicFilter
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
          }`}
        >
          <option value="">All epics</option>
          {epics.map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}
        </select>
      )}

      {space && (
        <button
          type="button"
          onClick={() => openSpaceModal('rename', space)}
          aria-label="Space settings"
          title="Space settings"
          data-testid="space-settings-button"
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-fast"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">settings</span>
        </button>
      )}
    </div>
  );
}
