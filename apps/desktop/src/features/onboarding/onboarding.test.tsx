import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = { onboardingFinish: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));

const { Onboarding } = await import("./onboarding");
const { keyStoreName } = await import("./key-store-name");

describe("Onboarding", () => {
  beforeEach(() => commands.onboardingFinish.mockReset());

  it("explains the protection first and only creates the vault when asked", async () => {
    commands.onboardingFinish.mockResolvedValue({ status: "ok", data: null });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);

    expect(screen.getByRole("list", { name: "How your data is protected" })).toHaveTextContent("Encrypted on this device");
    expect(screen.getByText(/never sees or stores your computer password/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    expect(commands.onboardingFinish).not.toHaveBeenCalled();

    expect(screen.getByText(/comes from your operating system, not from Termirust/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create my vault" }));
    expect(commands.onboardingFinish).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalled();
  });

  it("lets the user retry when keychain access was denied", async () => {
    commands.onboardingFinish
      .mockResolvedValueOnce({ status: "error", error: { code: "keychain", message: "OS keychain error: access denied" } })
      .mockResolvedValueOnce({ status: "ok", data: null });
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Onboarding onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByRole("button", { name: "Create my vault" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("access denied");
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("names the key store of each platform", () => {
    expect(keyStoreName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").store).toBe("macOS Keychain");
    expect(keyStoreName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").store).toBe("Windows Credential Manager");
    expect(keyStoreName("Mozilla/5.0 (X11; Linux x86_64)").store).toMatch(/keyring/);
  });
});
