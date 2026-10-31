/**
 * End of the spaces row: open the space's settings.
 */

import { useAppStore } from '@/stores/useAppStore';
import { useIsAdmin } from '@/stores/useAuthStore';

export function SpaceSettingsButton() {
  const openSpaceModal = useAppStore((s) => s.openSpaceModal);
  const isAdmin = useIsAdmin();
  const space = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId));

  if (!space || !isAdmin) return <div className="border-b border-border bg-surface-elevated flex-shrink-0" />;

  return (
    <div className="flex items-center pr-4 border-b border-border bg-surface-elevated flex-shrink-0">
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
    </div>
  );
}
