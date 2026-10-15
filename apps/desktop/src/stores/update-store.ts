import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

import { isUpdateRequired, visibleNotes } from "@/lib/update-policy";

const AUTO_KEY = "termirust.updates.auto";
const DISMISSED_KEY = "termirust.updates.dismissed";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string;
  date: string | null;
  /** The running version is below the release's minimum: the app cannot be used until updated. */
  required: boolean;
}

export type UpdatePhase = "idle" | "checking" | "upToDate" | "available" | "downloading" | "installing" | "error";

interface UpdateState {
  phase: UpdatePhase;
  available: AvailableUpdate | null;
  /** 0–1 while downloading, when the size is known. */
  progress: number | null;
  error: string | null;
  lastChecked: number | null;
  autoCheck: boolean;
  /** The version the user chose "Later" for; its banner stays hidden. */
  dismissedVersion: string | null;
  check: (options?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
  setAutoCheck: (on: boolean) => void;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session.
  }
}

// The plugin's handle is not serialisable, so it lives beside the store.
let pending: Update | null = null;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  phase: "idle",
  available: null,
  progress: null,
  error: null,
  lastChecked: null,
  autoCheck: read(AUTO_KEY) !== "0",
  dismissedVersion: read(DISMISSED_KEY),

  /** A silent check (on start-up) never shows errors: being offline is normal. */
  check: async ({ silent = false } = {}) => {
    if (["checking", "downloading", "installing"].includes(get().phase)) return;
    set({ phase: "checking", error: null });
    try {
      const update = await check();
      pending = update;
      if (!update) {
        set({ phase: "upToDate", available: null, lastChecked: Date.now() });
        return;
      }
      set({
        phase: "available",
        lastChecked: Date.now(),
        available: {
          version: update.version,
          currentVersion: update.currentVersion,
          notes: visibleNotes(update.body),
          date: update.date ?? null,
          required: isUpdateRequired(update.currentVersion, update.body),
        },
      });
    } catch (err) {
      set({ phase: silent ? "idle" : "error", error: silent ? null : message(err), lastChecked: Date.now() });
    }
  },

  /** Downloads, verifies the signature (done by the plugin), installs and restarts. */
  install: async () => {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ phase: "downloading", progress: null, error: null });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) set({ progress: Math.min(received / total, 1) });
        } else set({ phase: "installing", progress: 1 });
      });
      await relaunch();
    } catch (err) {
      set({ phase: "error", error: message(err) });
    }
  },

  dismiss: () => {
    const version = get().available?.version ?? null;
    if (version) write(DISMISSED_KEY, version);
    set({ dismissedVersion: version });
  },

  setAutoCheck: (on) => {
    write(AUTO_KEY, on ? "1" : "0");
    set({ autoCheck: on });
  },
}));
