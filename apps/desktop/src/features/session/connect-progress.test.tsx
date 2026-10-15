import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Dialog } from "@/components/ui/dialog";

import { ConnectPanel } from "./connect-progress";

const zOf = (el: Element | null) => Number(/(?:^|\s)z-(\d+)/.exec(el?.getAttribute("class") ?? "")?.[1] ?? 0);

describe("ConnectPanel", () => {
  it("stays below dialogs, so the host key and password prompts are never hidden", () => {
    render(
      <>
        <ConnectPanel title="Connecting to prod" trace={{ lines: [], step: 2, waiting: true, failed: false }} />
        <Dialog open onOpenChange={() => {}} title="Unknown host key">
          <button type="button">Trust</button>
        </Dialog>
      </>,
    );
    const panel = screen.getByRole("region", { name: "Connection progress", hidden: true });
    const layer = document.querySelector("[data-dialog-layer]");
    expect(zOf(layer)).toBeGreaterThan(zOf(panel));
    expect(screen.getByRole("listitem", { current: "step", hidden: true })).toHaveAttribute("data-state", "waiting");
  });
});
