/**
 * Someone else changed a field while this person was editing it. Nothing is lost until they
 * choose: only when two people touch the same field does it come to this.
 */

import { Button } from '@/components/shared/Button';
import { Modal } from '@/components/shared/Modal';
import { useAppStore } from '@/stores/useAppStore';
import { formatRelativeTime } from '@/utils/formatRelativeTime';

const TEXT = 'p-3 rounded-lg border border-border text-sm text-text-primary whitespace-pre-wrap break-words';

export function EditConflictDialog() {
  const conflict = useAppStore((s) => s.editConflict);
  const resolve = useAppStore((s) => s.resolveConflict);
  if (!conflict) return null;

  const who = conflict.by ?? 'Someone';
  return (
    <Modal open role="alertdialog" onClose={() => resolve('keep-editing')} title="Edit conflict" maxWidth="max-w-3xl">
      {/* The buttons stay in view however long the texts, and on a small phone. */}
      <div className="p-5 flex flex-col max-h-[85dvh]" data-testid="edit-conflict">
        <h2 className="text-lg font-semibold text-text-primary">{who} changed the {conflict.field} while you were editing</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {conflict.key ?? 'This issue'}{conflict.at ? ` · ${formatRelativeTime(conflict.at)}` : ''}. Nothing is lost until you choose.
        </p>
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold text-text-secondary">Yours</p>
            <div className={TEXT} data-testid="conflict-mine">{conflict.mine}</div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-text-secondary">{conflict.by ? `${who}'s` : 'Theirs'}</p>
            <div className={TEXT} data-testid="conflict-theirs">{conflict.theirs}</div>
          </div>
        </div>
        <div className="mt-4 flex-shrink-0 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => resolve('keep-editing')}>Keep editing</Button>
          <Button variant="secondary" size="sm" onClick={() => resolve('theirs')}>Use theirs</Button>
          <Button variant="primary" size="sm" onClick={() => resolve('mine')}>Save mine</Button>
        </div>
      </div>
    </Modal>
  );
}
