import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostView } from "@/bindings";

import { DROP_ATTR, useHostDrag } from "./use-host-drag";

const host = { id: "h1", label: "api", groupId: "g1" } as HostView;

function Harness({ onDrop }: { onDrop: (hostId: string, groupId: string | null) => void }) {
  const drag = useHostDrag(onDrop);
  return (
    <div>
      <div data-testid="row" onPointerDown={(e) => drag.onPointerDown(e, host)}>
        api
      </div>
      <div data-testid="g2" {...{ [DROP_ATTR]: "g2" }} data-active={drag.dropTarget === "g2" ? "yes" : "no"} />
      <div data-testid="g1" {...{ [DROP_ATTR]: "g1" }} />
      <div data-testid="none" {...{ [DROP_ATTR]: "" }} />
      <div data-testid="outside" />
      {drag.ghost}
    </div>
  );
}

function dragTo(testId: string, distance = 40) {
  document.elementFromPoint = vi.fn(() => screen.getByTestId(testId));
  fireEvent.pointerDown(screen.getByTestId("row"), { button: 0, clientX: 0, clientY: 0 });
  act(() => {
    fireEvent.pointerMove(window, { clientX: distance, clientY: 0 });
  });
}

describe("useHostDrag", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves a host onto another group, highlighting it and showing a ghost", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    dragTo("g2");
    expect(screen.getByTestId("g2")).toHaveAttribute("data-active", "yes");
    expect(screen.getByText("api", { selector: "div[aria-hidden]" })).toBeInTheDocument();
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).toHaveBeenCalledWith("h1", "g2");
    expect(screen.getByTestId("g2")).toHaveAttribute("data-active", "no");
  });

  it("takes the host out of its group when dropped outside every group", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    dragTo("none");
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).toHaveBeenCalledWith("h1", null);
  });

  it("ignores clicks, drops on its own group and drops on nothing", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    dragTo("g2", 2);
    act(() => {
      fireEvent.pointerUp(window);
    });
    dragTo("g1");
    act(() => {
      fireEvent.pointerUp(window);
    });
    dragTo("outside");
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
