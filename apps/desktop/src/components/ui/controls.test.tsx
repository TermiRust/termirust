import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Dialog, DialogFooter } from "./dialog";
import { Select } from "./select";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Plain</Button>
        <Button type="submit">Submit</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Plain" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "submit");
  });

  it("styles the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("text-danger");
  });
});

describe("Checkbox", () => {
  it("is labelled and toggles", async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Remember in vault" description="Encrypted on this device" defaultChecked />);
    const box = screen.getByRole("checkbox", { name: /Remember in vault/ });
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByText("Encrypted on this device")).toBeInTheDocument();
  });
});

describe("Select", () => {
  it("is a native combobox with its options", async () => {
    const user = userEvent.setup();
    render(
      <Select aria-label="Group" defaultValue="">
        <option value="">Ungrouped</option>
        <option value="g1">Production</option>
      </Select>,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Group" }), "g1");
    expect(screen.getByRole("combobox", { name: "Group" })).toHaveValue("g1");
  });
});

describe("Dialog", () => {
  it("renders title, description, body and footer, and closes", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Verify new server" description="First connection">
        <p>body</p>
        <DialogFooter>
          <Button>OK</Button>
        </DialogFooter>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Verify new server" });
    expect(dialog).toHaveAccessibleDescription("First connection");
    expect(screen.getByText("body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("marks the danger tone", () => {
    render(
      <Dialog open onOpenChange={vi.fn()} title="Host key has changed" tone="danger">
        <p>x</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog").className).toContain("border-danger-border");
  });
});
