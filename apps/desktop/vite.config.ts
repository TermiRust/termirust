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

const src = fileURLToPath(new URL("./src", import.meta.url));
const demo = (file: string) => fileURLToPath(new URL(`./demo/${file}`, import.meta.url));

/** `vite --mode demo`: the real UI on a fictional backend, for screenshots and the website. */
const demoAliases = [
  { find: /^@\/bindings$/, replacement: demo("bindings.ts") },
  { find: /^@tauri-apps\/api\/core$/, replacement: demo("tauri-core.ts") },
  { find: /^@tauri-apps\/(api\/window|api\/webview|plugin-opener|plugin-dialog|plugin-process|plugin-updater)$/, replacement: demo("tauri-stubs.ts") },
];

/** In the demo, macOS draws no window buttons: paint them where the top bar leaves room. */
const demoTrafficLights = {
  name: "demo-traffic-lights",
  transformIndexHtml: (html: string) =>
    html.replace(
      "</body>",
      `<div aria-hidden style="position:fixed;top:13px;left:14px;display:flex;gap:8px;z-index:100;pointer-events:none">${["#ff5f57", "#febc2e", "#28c840"].map((c) => `<span style="width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.25)"></span>`).join("")}</div></body>`,
    ),
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "demo" ? [demoTrafficLights] : [])],
  define: { __BUILD_ID__: JSON.stringify(mode === "demo" ? "" : buildId()) },
  resolve: {
    alias: mode === "demo" ? [...demoAliases, { find: "@", replacement: src }] : { "@": src },
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
