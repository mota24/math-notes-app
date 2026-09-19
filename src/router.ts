import { useSyncExternalStore } from 'react';

/** Navigation par l'adresse (#/…) : le bouton retour d'Android fonctionne. */
export type Route =
  | { name: 'library'; folderId: string | null }
  | { name: 'trash' }
  | { name: 'notebook'; notebookId: string; pageIndex: number }
  | { name: 'handwriting' }
  | { name: 'print'; notebookId: string; pageIndex: number | null };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'dossier':
      return { name: 'library', folderId: parts[1] ?? null };
    case 'corbeille':
      return { name: 'trash' };
    case 'cahier':
      return { name: 'notebook', notebookId: parts[1] ?? '', pageIndex: Math.max(0, (Number(parts[2]) || 1) - 1) };
    case 'ecriture':
      return { name: 'handwriting' };
    case 'imprimer':
      return { name: 'print', notebookId: parts[1] ?? '', pageIndex: parts[2] ? Math.max(0, Number(parts[2]) - 1) : null };
    default:
      return { name: 'library', folderId: null };
  }
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'library':
      return route.folderId ? `#/dossier/${encodeURIComponent(route.folderId)}` : '#/';
    case 'trash':
      return '#/corbeille';
    case 'notebook':
      return `#/cahier/${encodeURIComponent(route.notebookId)}/${route.pageIndex + 1}`;
    case 'handwriting':
      return '#/ecriture';
    case 'print':
      return `#/imprimer/${encodeURIComponent(route.notebookId)}${route.pageIndex !== null ? `/${route.pageIndex + 1}` : ''}`;
  }
}

export function go(route: Route) {
  window.location.hash = routeHash(route);
}

/** Change de page sans empiler d'historique (tourner les pages d'un cahier). */
export function replaceRoute(route: Route) {
  window.history.replaceState(null, '', routeHash(route));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (listener) => {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
    () => window.location.hash,
  );
  return parseHash(hash);
}
