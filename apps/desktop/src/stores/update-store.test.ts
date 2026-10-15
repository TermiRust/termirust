import { beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
const relaunch = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => check(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...a: unknown[]) => relaunch(...a) }));

const { useUpdateStore } = await import("./update-store");
const initial = useUpdateStore.getState();

const update = (overrides: Record<string, unknown> = {}) => ({
  version: "0.2.0",
  currentVersion: "0.1.0",
  body: "New monitor.",
  date: "2026-10-20",
  downloadAndInstall: vi.fn(async (onEvent: (e: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 100 } });
    onEvent({ event: "Progress", data: { chunkLength: 50 } });
    onEvent({ event: "Finished" });
  }),
  ...overrides,
});

describe("update store", () => {
  beforeEach(() => {
    localStorage.clear();
    check.mockReset();
    relaunch.mockReset();
    useUpdateStore.setState({ ...initial, autoCheck: true, dismissedVersion: null }, true);
  });

  it("reports an available update, and up to date when there is none", async () => {
    check.mockResolvedValueOnce(update());
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState()).toMatchObject({ phase: "available", available: { version: "0.2.0", currentVersion: "0.1.0", notes: "New monitor.", required: false } });

    check.mockResolvedValueOnce(null);
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState()).toMatchObject({ phase: "upToDate", available: null });
  });

  it("marks the update required below the release's minimum version, hiding the marker", async () => {
    check.mockResolvedValueOnce(update({ body: "Security fix.\n<!-- minimum-version: 0.1.5 -->" }));
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().available).toMatchObject({ required: true, notes: "Security fix." });
  });

  it("stays quiet about failures in a silent check, but reports them when asked", async () => {
    check.mockRejectedValueOnce(new Error("offline"));
    await useUpdateStore.getState().check({ silent: true });
    expect(useUpdateStore.getState()).toMatchObject({ phase: "idle", error: null });

    check.mockRejectedValueOnce(new Error("offline"));
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState()).toMatchObject({ phase: "error", error: "offline" });
  });

  it("downloads, installs and restarts", async () => {
    const pending = update();
    check.mockResolvedValueOnce(pending);
    await useUpdateStore.getState().check();
    await useUpdateStore.getState().install();
    expect(pending.downloadAndInstall).toHaveBeenCalled();
    expect(relaunch).toHaveBeenCalled();
    expect(useUpdateStore.getState()).toMatchObject({ phase: "installing", progress: 1 });
  });

  it("remembers Later for that version and the auto-check choice", async () => {
    check.mockResolvedValueOnce(update());
    await useUpdateStore.getState().check();
    useUpdateStore.getState().dismiss();
    expect(localStorage.getItem("termirust.updates.dismissed")).toBe("0.2.0");
    useUpdateStore.getState().setAutoCheck(false);
    expect(localStorage.getItem("termirust.updates.auto")).toBe("0");
    expect(useUpdateStore.getState().autoCheck).toBe(false);
  });
});
