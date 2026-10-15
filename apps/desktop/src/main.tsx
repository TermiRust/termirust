import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "@/components/layout/app-root";
import { applyAppTheme } from "@/lib/app-theme";
import { loadThemeCache } from "@/lib/theme-cache";
import { installWebviewGuards } from "@/lib/webview-guards";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

installWebviewGuards(window, { dev: import.meta.env.DEV });
// Before the first paint, so the onboarding and "Unlocking vault…" already use the chosen theme.
const cachedTheme = loadThemeCache();
applyAppTheme(document.documentElement, cachedTheme.appTheme, cachedTheme.customThemes);

createRoot(root).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
