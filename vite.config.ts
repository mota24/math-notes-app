import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Liste des fichiers générés, lue par le service worker pour tout mettre en cache (hors-ligne). */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ builtAt: Date.now(), files }) });
    },
  };
}

export default defineConfig({
  // Chemins relatifs par défaut : l'appli marche telle quelle depuis n'importe quel dossier, en particulier
  // dans la WebView Android (Capacitor). Sur GitHub Pages, BASE_PATH impose /nom-du-depot/ (voir deploy.yml).
  base: env.BASE_PATH ?? './',
  plugins: [react(), tailwindcss(), precacheManifest()],
  build: {
    // Les bibliothèques qui ne changent presque jamais (React, KaTeX) vont dans leurs propres fichiers :
    // une mise à jour de l'appli ne fait retélécharger que le code de l'appli, pas ces bibliothèques.
    // pdf.js et pdf-lib, eux, ne sont chargés qu'à la demande (import() dans src/pdf et src/export).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'katex', test: /node_modules[\\/]katex[\\/]/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  // PORT permet à un outil (aperçu intégré) d'imposer son port ; sinon 5173 comme d'habitude
  server: { port: Number(env.PORT) || 5173 },
});
