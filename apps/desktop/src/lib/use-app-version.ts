import { useEffect, useState } from "react";

import { commands } from "@/bindings";

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    commands
      .appVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // Outside the Tauri webview (e.g. plain browser preview) there is no backend to ask.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}
