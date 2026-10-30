/**
 * Bar above the board: filter it to an epic, and open the space's settings.
 */

import { useAppStore, useTasks } from '@/stores/useAppStore';
import { allTasks } from '@/utils/issues';

const CHIP = 'inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full border transition-all duration-fast flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50';
const CHIP_ON = 'bg-primary/15 border-primary/40 text-primary';
const CHIP_OFF = 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary';

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
      className="flex items-center gap-2 px-6 py-2 border-b border-border bg-surface-elevated/40 overflow-x-auto flex-shrink-0"
    >
      {epics.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setEpicFilter(null)}
            aria-pressed={epicFilter === null}
            className={`${CHIP} ${epicFilter === null ? CHIP_ON : CHIP_OFF}`}
          >
            All epics
          </button>
          {epics.map((epic) => (
            <button
              key={epic.id}
              type="button"
              onClick={() => setEpicFilter(epicFilter === epic.id ? null : epic.id)}
              aria-pressed={epicFilter === epic.id}
              data-testid={`epic-filter-chip-${epic.key}`}
              className={`${CHIP} ${epicFilter === epic.id ? CHIP_ON : CHIP_OFF}`}
            >
              {epic.title}
            </button>
          ))}
        </>
      )}

      <div className="flex-1" />

      {space && (
        <button
          type="button"
          onClick={() => openSpaceModal('rename', space)}
          data-testid="space-settings-button"
          className={`${CHIP} ${CHIP_OFF} gap-1`}
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">settings</span>
          Space settings
        </button>
      )}
    </div>
  );
}
