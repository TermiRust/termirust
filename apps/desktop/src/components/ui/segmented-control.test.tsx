import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SegmentedControl, type SegmentOption } from "./segmented-control";

type Auth = "password" | "key" | "agent";

function Harness({ options }: { options: SegmentOption<Auth>[] }) {
  const [value, setValue] = useState<Auth>("password");
  return <SegmentedControl label="Authentication" value={value} options={options} onChange={setValue} />;
}

const all: SegmentOption<Auth>[] = [
  { value: "password", label: "Password" },
  { value: "key", label: "Key" },
  { value: "agent", label: "Agent" },
];

describe("SegmentedControl", () => {
  it("exposes a radio group with the selected option checked", () => {
    render(<Harness options={all} />);
    expect(screen.getByRole("radiogroup", { name: "Authentication" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Password" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Key" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", async () => {
    const user = userEvent.setup();
    render(<Harness options={all} />);
    await user.click(screen.getByRole("radio", { name: "Agent" }));
    expect(screen.getByRole("radio", { name: "Agent" })).toHaveAttribute("aria-checked", "true");
  });

  it("moves with arrow keys, wraps around and moves focus", async () => {
    const user = userEvent.setup();
    render(<Harness options={all} />);
    screen.getByRole("radio", { name: "Password" }).focus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Agent" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Agent" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Password" })).toHaveAttribute("aria-checked", "true");
  });

  it("skips disabled options", async () => {
    const user = userEvent.setup();
    render(<Harness options={[all[0]!, { ...all[1]!, disabled: true }, all[2]!]} />);
    screen.getByRole("radio", { name: "Password" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Agent" })).toHaveAttribute("aria-checked", "true");
  });

  it("ignores other keys", async () => {
    const user = userEvent.setup();
    render(<Harness options={all} />);
    screen.getByRole("radio", { name: "Password" }).focus();
    await user.keyboard("a");
    expect(screen.getByRole("radio", { name: "Password" })).toHaveAttribute("aria-checked", "true");
  });
});
