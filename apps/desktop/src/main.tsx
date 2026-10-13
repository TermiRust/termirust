import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppShell } from "@/components/layout/app-shell";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
