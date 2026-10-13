import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { osName } from "@/lib/os-catalog";

import { OsIcon } from "./os-icon";

describe("OsIcon", () => {
  it("draws the distribution logo in its brand colour", () => {
    render(<OsIcon os="ubuntu" />);
    const icon = screen.getByRole("img", { name: "Ubuntu" });
    expect(icon.getAttribute("fill")).toBe("#E95420");
  });

  it("keeps black logos visible on dark backgrounds", () => {
    render(<OsIcon os="macos" />);
    expect(screen.getByRole("img", { name: "macOS" }).getAttribute("fill")).toBe("currentColor");
  });

  it("falls back to a generic icon before detection or for systems without a logo", () => {
    render(
      <>
        <OsIcon os={null} />
        <OsIcon os="windows" />
        <OsIcon os="haiku" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Unknown system" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Windows" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Haiku" })).toBeInTheDocument();
  });

  it("names systems for people", () => {
    expect(osName("rhel")).toBe("Red Hat Enterprise Linux");
    expect(osName("amazon")).toBe("Amazon Linux");
    expect(osName("debian")).toBe("Debian");
  });
});
