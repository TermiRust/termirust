import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("renders a button with the default ghost variant", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("hover:bg-bg-elev");
  });

  it("applies the requested variant", () => {
    render(<Button variant="primary">Connect</Button>);
    expect(screen.getByRole("button", { name: "Connect" }).className).toContain("bg-accent");
  });

  it("renders its child element instead of a button when asChild is set", () => {
    render(
      <Button asChild>
        <a href="#docs">Docs</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.tagName).toBe("A");
    expect(link.className).toContain("inline-flex");
  });
});
