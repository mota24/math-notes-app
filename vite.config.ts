import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Lecture du texte des scans (Tesseract.js) : le script du worker, le moteur WebAssembly et les modèles de
 * langue sont servis PAR LE SITE, sous un chemin fixe qui porte la version (ocr/<version>/…) — ni CDN tiers
 * (la CSP les refuse, et hors-ligne ils manqueraient), ni nom haché (Tesseract attend un dossier pour les
 * langues). Ils ne sont téléchargés qu'à la première lecture d'un scan, jamais au démarrage.
 */
const OCR_VERSION = (JSON.parse(readFileSync(new URL('./node_modules/tesseract.js/package.json', import.meta.url), 'utf8')) as { version: string }).version;
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  // Moteur LSTM seul, WebAssembly intégré : avec instructions SIMD (tablettes et navigateurs récents) ou sans
  'core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  // Modèles « best_int » : précis et compacts (français 0,7 Mo, anglais 2,9 Mo)
  'fra.traineddata.gz': '@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
const ocrSource = (name: string) => new URL(`./node_modules/${OCR_FILES[name]}`, import.meta.url);

function ocrAssets(): Plugin {
  const prefix = `ocr/${OCR_VERSION}/`;
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const name = path.startsWith(`/${prefix}`) ? path.slice(prefix.length + 1) : '';
        if (!OCR_FILES[name]) return next();
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(ocrSource(name)));
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) this.emitFile({ type: 'asset', fileName: prefix + name, source: readFileSync(ocrSource(name)) });
    },
  };
}

/** Liste des fichiers générés, lue par le service worker pour tout mettre en cache (hors-ligne). */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Les fichiers de lecture des scans (~8 Mo) ne sont pas pré-chargés : le service worker les garde à part
      // dès leur premier usage (voir public/sw.js)
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map') && !file.startsWith('ocr/'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ builtAt: Date.now(), files }) });
    },
  };
}

export default defineConfig({
  // Chemins absolus : l'appli est servie à la racine du domaine (Vercel), et une adresse comme /share/<id>
  // doit encore trouver /assets/… (en relatif, le navigateur chercherait /share/assets/…). BASE_PATH reste
  // possible pour un hébergement dans un sous-dossier.
  base: env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), ocrAssets(), precacheManifest()],
  define: { 'import.meta.env.VITE_OCR_VERSION': JSON.stringify(OCR_VERSION) },
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
