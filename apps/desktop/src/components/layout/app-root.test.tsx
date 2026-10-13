import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const commands = { onboardingNeeded: vi.fn() };
vi.mock("@/bindings", () => ({ commands }));
vi.mock("./app-shell", () => ({ AppShell: () => <div>app shell</div> }));
vi.mock("@/features/onboarding/onboarding", () => ({ Onboarding: () => <div>onboarding</div> }));

const { AppRoot } = await import("./app-root");

describe("AppRoot", () => {
  it("shows the onboarding on first launch instead of the app", async () => {
    commands.onboardingNeeded.mockResolvedValue(true);
    render(<AppRoot />);
    expect(await screen.findByText("onboarding")).toBeInTheDocument();
    expect(screen.queryByText("app shell")).not.toBeInTheDocument();
  });

  it("goes straight to the app once a vault exists", async () => {
    commands.onboardingNeeded.mockResolvedValue(false);
    render(<AppRoot />);
    expect(await screen.findByText("app shell")).toBeInTheDocument();
  });
});
