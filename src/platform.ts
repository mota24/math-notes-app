import { Capacitor } from '@capacitor/core';

/**
 * Vrai dans l'application Android (APK Capacitor), faux dans un navigateur ou une PWA installée.
 * Sert à contourner ce que la WebView Android ne sait pas faire : télécharger un lien Blob, ouvrir la
 * fenêtre d'impression, se connecter à Google.
 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
