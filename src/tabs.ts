import { useCallback, useEffect, useState } from 'react';
import type { Route } from './router';

/** Un cahier gardé ouvert dans la barre d'onglets, avec la page où on l'a laissé. */
export interface Tab {
  notebookId: string;
  pageIndex: number;
}

const KEY = 'notes-maths.tabs';

function load(): Tab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tab[];
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.notebookId === 'string' && t.notebookId) : [];
  } catch {
    return [];
  }
}

/**
 * Onglets de cahiers façon navigateur. Ouvrir un cahier (depuis la bibliothèque, un lien…) l'ajoute
 * à droite s'il n'y est pas encore ; tourner les pages met à jour la page mémorisée de son onglet.
 * La liste est gardée d'une session à l'autre.
 */
export function useTabs(route: Route) {
  const [tabs, setTabs] = useState<Tab[]>(load);
  const notebookId = route.name === 'notebook' ? route.notebookId : null;
  const pageIndex = route.name === 'notebook' ? route.pageIndex : 0;

  useEffect(() => {
    if (!notebookId) return;
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.notebookId === notebookId);
      if (i === -1) return [...prev, { notebookId, pageIndex }];
      if (prev[i].pageIndex === pageIndex) return prev;
      const next = prev.slice();
      next[i] = { notebookId, pageIndex };
      return next;
    });
  }, [notebookId, pageIndex]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(tabs));
    } catch {
      /* stockage indisponible (navigation privée) */
    }
  }, [tabs]);

  /** Ferme un onglet ; renvoie l'onglet voisin à afficher à sa place (le suivant, sinon le précédent). */
  const close = useCallback(
    (id: string): Tab | null => {
      const i = tabs.findIndex((t) => t.notebookId === id);
      const rest = tabs.filter((t) => t.notebookId !== id);
      setTabs(rest);
      return rest[i] ?? rest[i - 1] ?? null;
    },
    [tabs],
  );

  /** Retire les onglets dont le cahier n'existe plus (supprimé, corbeille). */
  const prune = useCallback((ids: string[]) => setTabs((prev) => prev.filter((t) => !ids.includes(t.notebookId))), []);

  return { tabs, close, prune };
}
