import { open } from "@tauri-apps/plugin-dialog";

import { isMacPlatform } from "@/lib/shortcuts";

/** Asks the user for an application to open a file with; null when they cancel. */
export async function chooseApp(): Promise<string | null> {
  const mac = isMacPlatform();
  const windows = !mac && /Win/i.test(navigator.userAgent);
  const picked = await open({
    title: "Open with…",
    multiple: false,
    directory: false,
    defaultPath: mac ? "/Applications" : undefined,
    filters: mac ? [{ name: "Applications", extensions: ["app"] }] : windows ? [{ name: "Programs", extensions: ["exe"] }] : undefined,
  });
  return typeof picked === "string" ? picked : null;
}
