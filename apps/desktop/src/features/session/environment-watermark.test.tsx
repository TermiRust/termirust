import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EnvironmentBadge } from "@/components/ui/environment-badge";

import { EnvironmentWatermark } from "./environment-watermark";

describe("environment marks", () => {
  it("watermarks production terminals without taking clicks or selection", () => {
    render(<EnvironmentWatermark environment="production" />);
    const mark = screen.getByTestId("environment-watermark");
    expect(mark).toHaveTextContent("PROD");
    expect(mark.className).toMatch(/pointer-events-none/);
    expect(mark.className).toMatch(/select-none/);
    expect(mark).toHaveAttribute("aria-hidden");
  });

  it("marks staging more quietly and leaves other hosts alone", () => {
    const { rerender } = render(<EnvironmentWatermark environment="staging" />);
    expect(screen.getByTestId("environment-watermark")).toHaveTextContent("STAGING");
    rerender(<EnvironmentWatermark environment="development" />);
    expect(screen.queryByTestId("environment-watermark")).not.toBeInTheDocument();
    rerender(<EnvironmentWatermark environment={null} />);
    expect(screen.queryByTestId("environment-watermark")).not.toBeInTheDocument();
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
