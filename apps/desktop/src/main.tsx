import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "@/components/layout/app-root";
import { installWebviewGuards } from "@/lib/webview-guards";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

installWebviewGuards(window, { dev: import.meta.env.DEV });

createRoot(root).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
