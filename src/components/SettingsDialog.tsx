import type { Settings } from '../settings';
import { Modal } from './Modal';
import { CloudSection } from './settings/CloudSection';
import { WritingSection } from './settings/WritingSection';

/**
 * Réglages : deux cartes seulement — le compte et la conservation des notes, l'écriture — et l'accès au
 * guide. Chaque carte va à l'essentiel ; les explications longues ont disparu.
 */
export function SettingsDialog({
  settings,
  update,
  onClose,
  onShowWelcome,
}: {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  onClose(): void;
  onShowWelcome(): void;
}) {
  return (
    <Modal title="Réglages" onClose={onClose}>
      <CloudSection settings={settings} update={update} />
      <WritingSection settings={settings} update={update} />
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={onShowWelcome}
          className="min-h-0 rounded-lg border-0 bg-transparent px-3 py-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          Revoir le guide de démarrage
        </button>
      </div>
    </Modal>
  );
}
