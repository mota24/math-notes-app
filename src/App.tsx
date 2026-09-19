import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HandwritingSetup } from './components/HandwritingSetup';
import { Library } from './components/Library';
import { NotebookEditor } from './components/NotebookEditor';
import { PrintView } from './components/PrintView';
import { SettingsDialog } from './components/SettingsDialog';
import { TabBar } from './components/TabBar';
import { WelcomeDialog } from './components/WelcomeDialog';
import { migrateLegacyDraft } from './db/migrate';
import { go, routeHash, useRoute } from './router';
import { useSettings } from './settings';
import { startSyncTriggers, syncController } from './sync/useSync';
import { useTabs } from './tabs';
import type { CSSProperties } from 'react';

const WELCOME_KEY = 'notes-maths.welcome';

function welcomeSeen() {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return true;
  }
}

export default function App() {
  const [settings, update] = useSettings();
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !welcomeSeen());
  const { tabs, close: closeTabState, prune: pruneTabs } = useTabs(route);

  useEffect(() => {
    void migrateLegacyDraft();
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    syncController.configure(settings.driveClientId, settings.driveAutoSync);
    startSyncTriggers();
  }, [settings.driveClientId, settings.driveAutoSync]);

  const openSettings = () => setSettingsOpen(true);
  const closeWelcome = () => {
    setWelcomeOpen(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      /* navigation privée */
    }
  };

  /** Ferme un onglet ; si c'était le cahier affiché, on passe à l'onglet voisin (ou à la bibliothèque). */
  const closeTab = (id: string) => {
    const next = closeTabState(id);
    if (route.name === 'notebook' && route.notebookId === id) {
      go(next ? { name: 'notebook', notebookId: next.notebookId, pageIndex: next.pageIndex } : { name: 'library', folderId: null });
    }
  };
  const showTabs = tabs.length > 0 && (route.name === 'library' || route.name === 'trash' || route.name === 'notebook');

  let screen;
  switch (route.name) {
    case 'library':
    case 'trash':
      screen = <Library route={route} onOpenSettings={openSettings} />;
      break;
    case 'notebook':
      screen = (
        <NotebookEditor
          key={route.notebookId}
          notebookId={route.notebookId}
          pageIndex={route.pageIndex}
          settings={settings}
          update={update}
          onOpenSettings={openSettings}
        />
      );
      break;
    case 'handwriting':
      screen = <HandwritingSetup settings={settings} />;
      break;
    case 'print':
      screen = <PrintView notebookId={route.notebookId} pageIndex={route.pageIndex} />;
      break;
  }

  return (
    <ErrorBoundary resetKey={routeHash(route)}>
      <div className="shell" style={{ '--tabbar-h': showTabs ? '46px' : '0px' } as CSSProperties}>
        {showTabs && <TabBar tabs={tabs} route={route} onClose={closeTab} onPrune={pruneTabs} />}
        {screen}
      </div>
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          update={update}
          onClose={() => setSettingsOpen(false)}
          onShowWelcome={() => {
            setSettingsOpen(false);
            setWelcomeOpen(true);
          }}
        />
      )}
      {welcomeOpen && (
        <WelcomeDialog
          onClose={closeWelcome}
          onOpenSettings={() => {
            closeWelcome();
            setSettingsOpen(true);
          }}
        />
      )}
    </ErrorBoundary>
  );
}
