import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { syncController } from '../sync/useSync';

/**
 * Déconnexion complète : le compte, et la session Google Drive (jeton effacé et révoqué). Avant, le jeton
 * Drive survivait dans l'onglet et la synchronisation Drive continuait de tourner une fois déconnecté.
 */
export async function seDeconnecter() {
  syncController.disconnect();
  await signOut(auth);
}
