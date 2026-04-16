/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth Web client ID (public). When unset, Google login is hidden. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

// CSS Modules
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
