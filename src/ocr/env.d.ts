/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Version de Tesseract.js, fixée au build (vite.config.ts) : ses fichiers sont servis sous ocr/<version>/ */
  readonly VITE_OCR_VERSION: string;
}
