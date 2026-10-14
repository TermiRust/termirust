/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTORUN_BENCHMARK?: string;
}

/** Short git commit of the build, set by vite.config.ts; a trailing "+" means uncommitted changes. */
declare const __BUILD_ID__: string;
