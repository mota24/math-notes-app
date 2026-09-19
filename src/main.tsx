import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/caveat/400.css';
import '@fontsource/kalam/400.css';
import '@fontsource/patrick-hand/400.css';
import './index.css';
import App from './App';
import { isNativeApp } from './platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Hors-ligne : l'appli se rouvre sans réseau une fois installée (uniquement en https:// ou localhost).
// Pas dans l'appli Android : ses fichiers sont déjà embarqués dans l'APK, et un service worker ne ferait
// que risquer de servir une ancienne copie après une mise à jour.
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext && !isNativeApp()) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
