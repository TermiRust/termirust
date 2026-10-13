import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appVersion = vi.fn<() => Promise<string>>();
vi.mock("@/bindings", () => ({ commands: { appVersion: () => appVersion() } }));

const { useAppVersion } = await import("./use-app-version");

describe("useAppVersion", () => {
  beforeEach(() => {
    appVersion.mockReset();
  });

  it("returns the version reported by the Rust backend", async () => {
    appVersion.mockResolvedValue("1.2.3");
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("1.2.3"));
  });

  it("stays null when the backend is unavailable", async () => {
    appVersion.mockRejectedValue(new Error("no Tauri runtime"));
    const { result } = renderHook(() => useAppVersion());
    await waitFor(() => expect(appVersion).toHaveBeenCalledOnce());
    expect(result.current).toBeNull();
  });

  it("ignores a response that arrives after unmount", async () => {
    let resolve: (v: string) => void = () => {};
    appVersion.mockReturnValue(new Promise<string>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useAppVersion());
    unmount();
    resolve("9.9.9");
    await Promise.resolve();
    expect(result.current).toBeNull();
  });
});
