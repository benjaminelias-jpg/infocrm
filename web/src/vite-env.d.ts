/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" para precargar la cuenta demo en el login (solo desarrollo). */
  readonly VITE_DEMO?: string;
}
