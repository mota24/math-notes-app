import { Modal } from './Modal';

/** Guide affiché au premier lancement (et depuis les réglages). */
export function WelcomeDialog({ onClose, onOpenSettings }: { onClose(): void; onOpenSettings(): void }) {
  return (
    <Modal
      title="Bienvenue dans Notes Maths"
      onClose={onClose}
      wide
      footer={
        <button className="primary" onClick={onClose}>
          C’est parti
        </button>
      }
    >
      <div className="welcome-grid">
        <section className="welcome-step">
          <h3>1. Écris</h3>
          <ul>
            <li>Crée un dossier (Semestre → Matière), puis un cahier, ou importe un PDF de cours.</li>
            <li>
              Avec un stylet actif, lui seul écrit et ta paume est ignorée. Sans stylet actif (téléphone, stylet passif), le doigt
              écrit. Couleur et épaisseur : les trois couleurs rapides, ou la roue multicolore, dans la barre d'outils.
            </li>
            <li>
              <strong>Deux doigts</strong> : déplacer la page et zoomer (pincement). <strong>Tap à deux doigts</strong> : annuler.
            </li>
            <li>
              <strong>Appui long</strong> : garde le stylet posé sans bouger une seconde, il gomme jusqu'à ce que tu le lèves.
            </li>
            <li>Outils : stylo, surligneur, gomme (par trait ou de précision), lasso (déplacer, redimensionner, pivoter, recolorer, copier une zone), capture, formes et volumes 3D.</li>
          </ul>
        </section>
        <section className="welcome-step">
          <h3>2. Travaille avec tes cours</h3>
          <ul>
            <li>Écran partagé (icône à deux colonnes) : le PDF du cours à gauche, ton cahier à droite.</li>
            <li>Images : bouton de la barre d’outils, glisser-déposer ou Ctrl+V ; déplace-les et écris par-dessus.</li>
            <li>Partage un cahier en lecture seule par lien secret (icône de lien).</li>
          </ul>
        </section>
        <section className="welcome-step">
          <h3>3. Exporte et sauvegarde</h3>
          <ul>
            <li>« Exporter en PDF » (icône de téléchargement) : papier, fond PDF et encre dans un seul fichier.</li>
            <li>Tout reste sur l’appareil, même hors-ligne ; la synchronisation Firestore (réglages) garde une copie de tes cahiers et de tes PDF.</li>
            <li>Sauvegarde complète sur fichier dans les réglages.</li>
          </ul>
          <button onClick={onOpenSettings}>Ouvrir les réglages</button>
        </section>
      </div>
    </Modal>
  );
}
