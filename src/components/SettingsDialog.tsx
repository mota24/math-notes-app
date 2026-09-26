import type { Settings } from '../settings';
import { Modal } from './Modal';
import { AccountSection } from './settings/AccountSection';
import { CloudSection } from './settings/CloudSection';
import { WritingSection } from './settings/WritingSection';

/**
 * Réglages : le compte et la conservation des notes, l'écriture, l'accès au guide, puis — tout en bas, à
 * part — les méthodes de connexion et la suppression du compte.
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
      <AccountSection />
    </Modal>
  );
}
