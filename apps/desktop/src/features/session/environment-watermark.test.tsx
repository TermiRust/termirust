import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EnvironmentBadge } from "@/components/ui/environment-badge";

import { EnvironmentWatermark } from "./environment-watermark";
import { watermarkTile } from "./watermark-tile";

describe("environment marks", () => {
  it("repeats PROD over the whole production terminal and pins a badge in the corner", () => {
    render(<EnvironmentWatermark environment="production" />);
    const mark = screen.getByTestId("environment-watermark");
    expect(mark.className).toMatch(/pointer-events-none/);
    expect(mark.className).toMatch(/select-none/);
    expect(mark).toHaveAttribute("aria-hidden");
    const tiles = screen.getByTestId("watermark-tiles");
    expect(tiles.style.backgroundRepeat).toBe("repeat");
    expect(decodeURIComponent(tiles.style.backgroundImage)).toContain(">PROD</text>");
    expect(mark).toHaveTextContent("PRODUCTION");
  });

  it("marks staging in amber and leaves other hosts alone", () => {
    const { rerender } = render(<EnvironmentWatermark environment="staging" />);
    expect(decodeURIComponent(screen.getByTestId("watermark-tiles").style.backgroundImage)).toContain(">STAGING</text>");
    rerender(<EnvironmentWatermark environment="development" />);
    expect(screen.queryByTestId("environment-watermark")).not.toBeInTheDocument();
    rerender(<EnvironmentWatermark environment={null} />);
    expect(screen.queryByTestId("environment-watermark")).not.toBeInTheDocument();
  });

  it("builds a self-contained SVG tile the CSP allows (data: URL)", () => {
    const tile = watermarkTile("PROD", "rgba(239, 68, 68, 0.11)");
    expect(tile.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(tile)).toContain('fill="rgba(239, 68, 68, 0.11)"');
  });

  it("shows a short badge per environment", () => {
    render(
      <>
        <EnvironmentBadge environment="production" />
        <EnvironmentBadge environment="staging" />
        <EnvironmentBadge environment={null} />
      </>,
    );
    expect(screen.getByTitle("Production")).toHaveTextContent("PROD");
    expect(screen.getByTitle("Staging")).toHaveTextContent("STG");
  });
});
