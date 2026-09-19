import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.notesmaths.app',
  appName: 'Notes Maths',
  // Les fichiers compilés (npm run build) sont embarqués tels quels dans l'APK : l'appli marche à 100 % hors-ligne
  webDir: 'dist',
  // Couleur de la WebView avant l'affichage de la page (pas d'éclair blanc au démarrage)
  backgroundColor: '#1e2533',
  server: {
    // À NE PLUS CHANGER une fois l'appli installée : les cahiers sont stockés (IndexedDB) sous l'origine
    // https://localhost. Changer ce schéma, ou l'appId ci-dessus, reviendrait à repartir d'une appli vide.
    androidScheme: 'https',
  },
  android: {
    // Tout est embarqué : seuls Gemini et Google Drive (en https) sont joints par le réseau
    allowMixedContent: false,
  },
};

export default config;
