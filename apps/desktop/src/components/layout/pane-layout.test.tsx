import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { singlePane, splitPane } from "@/features/panes/pane-tree";

import { PaneLayout } from "./pane-layout";

const mounts: string[] = [];
function Probe({ id, focused }: { id: string; focused: boolean }) {
  useEffect(() => {
    mounts.push(id);
  }, [id]);
  return <div data-testid={`pane-${id}`}>{focused ? "focused" : "idle"}</div>;
}

const renderPane = (id: string, focused: boolean) => <Probe id={id} focused={focused} />;

describe("PaneLayout", () => {
  it("keeps existing panes mounted when the layout is split again", () => {
    mounts.length = 0;
    const one = singlePane("a");
    const props = { focusedPaneId: "a", broadcast: false, onFocusPane: vi.fn(), onResize: vi.fn(), renderPane };
    const { rerender } = render(<PaneLayout layout={one} {...props} />);
    const two = splitPane(one, "a", "row", "b", "s1");
    rerender(<PaneLayout layout={two} {...props} />);
    rerender(<PaneLayout layout={splitPane(two, "a", "column", "c", "s2")} {...props} />);
    expect(mounts).toEqual(["a", "b", "c"]);
  });

  it("positions panes from the tree and focuses the one clicked", () => {
    const onFocusPane = vi.fn();
    render(<PaneLayout layout={splitPane(singlePane("a"), "a", "row", "b", "s1")} focusedPaneId="a" broadcast={false} onFocusPane={onFocusPane} onResize={vi.fn()} renderPane={renderPane} />);
    const second = screen.getByRole("group", { name: "Pane 2" });
    expect(second.style.left).toBe("50%");
    expect(screen.getByRole("group", { name: "Pane 1 (focused)" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId("pane-b"));
    expect(onFocusPane).toHaveBeenCalledWith("b");
  });

  it("resizes with the keyboard on the divider", () => {
    const onResize = vi.fn();
    render(<PaneLayout layout={splitPane(singlePane("a"), "a", "column", "b", "s1")} focusedPaneId="a" broadcast={false} onFocusPane={vi.fn()} onResize={onResize} renderPane={renderPane} />);
    const divider = screen.getByRole("separator", { name: "Resize panes" });
    expect(divider).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.keyDown(divider, { key: "ArrowDown" });
    expect(onResize).toHaveBeenCalledWith("s1", 0.55);
  });

  it("frames every pane while broadcasting and shows no frame for a single pane", () => {
    const { rerender, container } = render(<PaneLayout layout={singlePane("a")} focusedPaneId="a" broadcast={false} onFocusPane={vi.fn()} onResize={vi.fn()} renderPane={renderPane} />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    rerender(<PaneLayout layout={splitPane(singlePane("a"), "a", "row", "b", "s")} focusedPaneId="a" broadcast onFocusPane={vi.fn()} onResize={vi.fn()} renderPane={renderPane} />);
    expect(container.querySelectorAll("[data-pane-id]")).toHaveLength(2);
    for (const pane of screen.getAllByRole("group")) expect(pane.className).toMatch(/inset_0_0_0_2px/);
  });
});
