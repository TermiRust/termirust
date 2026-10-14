/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

/** Short commit of this build ("dev" outside git), so a running app says exactly what it is. */
function buildId(): string {
  try {
    const commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
    return dirty ? `${commit}+` : commit;
  } catch {
    return "dev";
  }
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Tauri needs a fixed port and must not have Rust errors hidden by a cleared screen.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
}));
