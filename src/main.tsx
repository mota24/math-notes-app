import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/caveat/400.css';
import '@fontsource/kalam/400.css';
import '@fontsource/patrick-hand/400.css';
// Polices assorties aux documents scannés (mêmes dimensions que Times New Roman, Arial, Courier New) : seules leurs
// déclarations sont chargées ici, chaque fichier de police n'est téléchargé que si une correction s'en sert
import '@fontsource/tinos/400.css';
import '@fontsource/tinos/700.css';
import '@fontsource/tinos/400-italic.css';
import '@fontsource/tinos/700-italic.css';
import '@fontsource/arimo/400.css';
import '@fontsource/arimo/700.css';
import '@fontsource/arimo/400-italic.css';
import '@fontsource/arimo/700-italic.css';
import '@fontsource/cousine/400.css';
import '@fontsource/cousine/700.css';
import '@fontsource/cousine/400-italic.css';
import '@fontsource/cousine/700-italic.css';
import './index.css';
import App from './App';
import { SHARE_ID_RE } from './share/plan';

/**
 * /share/<id> : un cahier partagé en lecture seule. Ce lecteur passe AVANT l'appli, donc avant l'écran
 * « Accès Réservé » : il ne demande aucun compte, n'ouvre pas la base locale et ne lance aucune
 * synchronisation. Il ne peut que lire le partage (voir firestore.rules). Chargé à part : il n'alourdit pas l'appli.
 */
const SharedNotebook = lazy(() => import('./share/SharedNotebook'));
const shareId = /^\/share\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareId !== null && SHARE_ID_RE.test(shareId) ? (
      <Suspense fallback={null}>
        <SharedNotebook shareId={shareId} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

// iOS/iPadOS : Safari ignore « user-scalable=no » ; sans ceci, pincer une barre ou un menu zoomait la page
// entière, qui restait ensuite de travers. Le pincement DANS la page (zoom de la feuille) passe par les
// événements pointeur/tactiles, que ceci ne bloque pas.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

// Hors-ligne : l'appli se rouvre sans réseau une fois installée (uniquement en https:// ou localhost).
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
