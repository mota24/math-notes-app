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
              Ton stylet écrit ; ta paume posée est ignorée, même si elle touche l'écran à plusieurs endroits.
              Couleur et épaisseur (1 à 20 px) : les trois couleurs rapides, ou la roue multicolore, dans la barre d'outils.
            </li>
            <li>
              <strong>Deux doigts</strong> : déplacer la page et zoomer (pincement). <strong>Tap à deux doigts</strong> : annuler.
            </li>
            <li>
              <strong>Appui long</strong> : garde le stylet posé sans bouger une seconde, il gomme jusqu'à ce que tu le lèves.
            </li>
            <li>Outils : stylo, surligneur, gomme (par trait ou de précision), lasso (déplacer, recolorer, copier une zone), capture, formes et volumes 3D.</li>
          </ul>
        </section>
        <section className="welcome-step">
          <h3>2. Convertis en LaTeX</h3>
          <ul>
            <li>Crée une clé Gemini gratuite et colle-la dans les réglages.</li>
            <li>« Convertir la page » ou « Convertir le cahier ». Pour une formule : lasso → « Convertir en LaTeX ».</li>
            <li>Les passages douteux sont surlignés en jaune : « Corriger » pour les modifier.</li>
            <li>Marche aussi sur un PDF ou une photo du tableau.</li>
          </ul>
          <button onClick={onOpenSettings}>Ouvrir les réglages</button>
        </section>
        <section className="welcome-step">
          <h3>3. Exporte et sauvegarde</h3>
          <ul>
            <li>PDF de tes notes, PDF propre (LaTeX), fichier .tex, ou PDF manuscrit lisible.</li>
            <li>« Mon écriture » : écris ton alphabet une fois pour des PDF avec ta propre écriture.</li>
            <li>Tout reste sur l’appareil, même hors-ligne. Sauvegarde sur fichier ou Google Drive dans les réglages.</li>
          </ul>
        </section>
      </div>
    </Modal>
  );
}
