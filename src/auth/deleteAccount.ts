import { deleteUser } from 'firebase/auth';
import { db } from '../db/db';
import { updateNotebook } from '../db/library';
import { auth, getFirestoreDb } from '../firebase';
import { cancelAllShareUpdates } from '../share/share';
import { disconnectDriveBackup } from '../sync/driveBackup';
import { firestoreController } from '../sync/firestore';
import { syncController } from '../sync/useSync';
import { wipeUserData } from './accountModel';
import type { WipeDoc, WipeReport, WipeStore } from './accountModel';
import { resetDeviceOwner } from './useAccess';

/** Un envoi groupé Firestore : 500 opérations au plus ; on garde de la marge */
const MAX_BATCH_OPS = 450;

/** L'adaptateur Firestore de wipeUserData (SDK Web, avec les droits du compte connecté) */
async function firestoreStore(): Promise<WipeStore> {
  const fs = await import('firebase/firestore');
  const firestore = await getFirestoreDb();
  let batch = fs.writeBatch(firestore);
  let ops = 0;
  const ref = (path: string[]) => fs.doc(firestore, path.join('/'));
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = fs.writeBatch(firestore);
    ops = 0;
  };
  const docs = (snap: { docs: { id: string; data(): Record<string, unknown> }[] }): WipeDoc[] => snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return {
    list: async (collection) => docs(await fs.getDocs(fs.collection(firestore, collection.join('/')))),
    async ownedShares(uid) {
      try {
        return docs(await fs.getDocs(fs.query(fs.collection(firestore, 'shares'), fs.where('owner', '==', uid))));
      } catch (e) {
        // Règles pas encore republiées (liste des partages interdite) : on retrouve au moins ceux des cahiers
        if (!/permission-denied/.test((e as { code?: string }).code ?? '')) throw e;
        const found: WipeDoc[] = [];
        for (const n of await db.notebooks()) {
          if (!n.shareId) continue;
          const snap = await fs.getDoc(fs.doc(firestore, 'shares', n.shareId)).catch(() => null);
          const data = snap?.exists() ? (snap.data() as Record<string, unknown>) : null;
          if (data && data.owner === uid) found.push({ id: n.shareId, data });
        }
        return found;
      }
    },
    exists: async (path) => (await fs.getDoc(ref(path))).exists(),
    async remove(path) {
      if (ops >= MAX_BATCH_OPS) await flush();
      batch.delete(ref(path));
      ops++;
    },
    flush,
  };
}

const permissionHint = (e: unknown) =>
  /permission-denied|insufficient permissions/i.test(`${(e as { code?: string }).code ?? ''} ${(e as Error)?.message ?? ''}`)
    ? ' Les règles Firestore publiées ne l’autorisent pas encore : publie la dernière version de firestore.rules, puis recommence.'
    : '';

/**
 * Supprime le compte connecté, dans cet ordre (chaque étape peut être relancée sans risque) :
 *  1. plus rien ne part vers le cloud (synchronisation, Drive de l'appareil, mises à jour de liens) ;
 *  2. la sauvegarde hebdomadaire Google Drive est déconnectée (autorisation révoquée) ;
 *  3. tout ce que le compte a dans Firestore est effacé (partages, pages, fichiers, transcriptions, index) ;
 *  4. l'appareil oublie ce compte : liens de partage des cahiers, « propriétaire de l'appareil » ;
 *  5. le compte Firebase Auth est détruit — ce qui déconnecte et ramène à l'écran « Accès Réservé ».
 * Les notes de CET appareil (IndexedDB) ne sont pas touchées : elles restent dans le navigateur.
 *
 * Une reconnexion récente est exigée AVANT (voir reauthenticate) : sans elle, Firebase refuserait l'étape 5
 * alors que tout le reste serait déjà effacé.
 */
export async function deleteAccount(progress: (message: string) => void): Promise<WipeReport> {
  const user = auth.currentUser;
  if (!user) throw new Error('Connecte-toi d’abord.');
  if (!navigator.onLine) throw new Error('Pas de réseau : la suppression doit joindre le serveur. Réessaie une fois en ligne.');

  progress('Arrêt de la synchronisation…');
  firestoreController.stop();
  syncController.disconnect();
  cancelAllShareUpdates();

  progress('Déconnexion de la sauvegarde Google Drive…');
  await disconnectDriveBackup();

  let report: WipeReport;
  try {
    report = await wipeUserData(await firestoreStore(), user.uid, progress);
  } catch (e) {
    throw new Error(`Suppression des données en ligne interrompue : ${(e as Error)?.message ?? 'erreur inconnue'}.${permissionHint(e)}`, { cause: e });
  }

  progress('Nettoyage de cet appareil…');
  // Les liens de partage n'existent plus : les cahiers les oublient (un futur compte n'essaiera pas de les mettre à jour)
  for (const n of await db.notebooks()) if (n.shareId) await updateNotebook(n.id, { shareId: null });
  await resetDeviceOwner();

  progress('Suppression du compte…');
  try {
    await deleteUser(user);
  } catch (e) {
    throw new Error(
      `Tes données en ligne sont supprimées, mais le compte lui-même n’a pas pu l’être (${(e as { code?: string }).code ?? (e as Error)?.message}). Relance la suppression tout de suite, sans recharger la page.`,
      { cause: e },
    );
  }
  try {
    sessionStorage.setItem('notes-maths:compte-supprime', '1');
  } catch {
    /* navigation privée */
  }
  return report;
}
