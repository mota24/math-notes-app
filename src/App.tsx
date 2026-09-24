import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HandwritingSetup } from './components/HandwritingSetup';
import { Library } from './components/Library';
import { NotebookEditor } from './components/NotebookEditor';
import { PrintView } from './components/PrintView';
import { SettingsDialog } from './components/SettingsDialog';
import { TabBar } from './components/TabBar';
import { WelcomeDialog } from './components/WelcomeDialog';
import { AuthPanel } from './components/AuthPanel';
import { StorageBanner } from './components/StorageBanner';
import { useAccess } from './auth/useAccess';
import { watchStorage } from './db/storageAlert';
import { NewNotebookDialog } from './components/NewNotebookDialog';
import { createNotebook } from './db/library';
import { migrateLegacyDraft } from './db/migrate';
import { useAuthUser } from './firebase';
import { go, routeHash, useRoute } from './router';
import { useSettings } from './settings';
import { startSyncTriggers, syncController } from './sync/useSync';
import { configureFirestore, startFirestoreTriggers } from './sync/useFirestore';
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
  const user = useAuthUser();
  const access = useAccess(user);
  const open = access.status === 'open';
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newNotebookOpen, setNewNotebookOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !welcomeSeen());
  const { tabs, close: closeTabState, prune: pruneTabs } = useTabs(route);

  useEffect(() => {
    watchStorage();
    void migrateLegacyDraft();
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  // Aucune synchronisation tant que l'accès n'est pas validé. Sans cela, un compte étranger connecté (puis
  // refusé) avait le temps de recevoir dans SON espace cloud toutes les notes de l'appareil.
  useEffect(() => {
    syncController.configure(open ? settings.driveClientId : '', settings.driveAutoSync);
    startSyncTriggers();
  }, [open, settings.driveClientId, settings.driveAutoSync]);

  useEffect(() => {
    startFirestoreTriggers();
    configureFirestore(open && settings.firestoreSync);
  }, [open, settings.firestoreSync]);

  const openSettings = () => setSettingsOpen(true);
  /** Le « + » des onglets : un nouveau cahier, créé là où on est, et ouvert aussitôt dans son propre onglet. */
  const openNewNotebook = () => setNewNotebookOpen(true);
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
  // Barre d'onglets autonome : uniquement dans la bibliothèque/corbeille s'il y a des onglets ouverts.
  // Dans l'éditeur, les onglets sont fusionnés directement dans sa propre barre unifiée de 48px.
  const showTabs = tabs.length > 0 && (route.name === 'library' || route.name === 'trash');

  let screen;
  switch (route.name) {
    case 'library':
      screen = <Library route={route} onOpenSettings={openSettings} />;
      break;
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
          tabs={tabs}
          onCloseTab={closeTab}
          onNewNotebook={openNewNotebook}
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

  // Accès réservé, sans option possible : l'appli est privée, et un compte connecté ne suffit pas, il doit être
  // autorisé (voir auth/access.ts). Tant que la vérification n'a pas répondu on n'affiche rien, pour éviter un
  // clignotement de l'appli avant l'écran de connexion.
  if (access.status === 'checking') return <div className="shell" />;
  if (access.status === 'locked') return <AuthPanel refus={access.refusal} />;

  return (
    <ErrorBoundary resetKey={routeHash(route)}>
      <div className="shell" style={{ '--tabbar-h': showTabs ? '46px' : '0px' } as CSSProperties}>
        {showTabs && <TabBar tabs={tabs} route={route} onClose={closeTab} onPrune={pruneTabs} onNewNotebook={openNewNotebook} />}
        {screen}
      </div>
      <StorageBanner />
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
      {newNotebookOpen && (
        <NewNotebookDialog
          onClose={() => setNewNotebookOpen(false)}
          onCreate={(title, paper, subject) => {
            setNewNotebookOpen(false);
            // Créé dans le dossier courant si on est dans la bibliothèque, à la racine sinon
            const folderId = route.name === 'library' ? route.folderId : null;
            void createNotebook({ title, folderId, paper, subject }).then((n) =>
              go({ name: 'notebook', notebookId: n.id, pageIndex: 0 }),
            );
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
