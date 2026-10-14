import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { MarkdownReply } = await import("./markdown-reply");

const reply = [
  "## Why it fails",
  "The **port** is taken by `nginx`:",
  "",
  "- check it",
  "- then stop it",
  "",
  "```sh",
  "sudo lsof -i :80",
  "```",
  "",
  "```sh",
  "sudo rm -rf /var/cache/nginx",
  "```",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "See [docs](https://nginx.org).",
  "",
  "<script>alert(1)</script>",
].join("\n");

describe("MarkdownReply", () => {
  it("renders headings, emphasis, lists, tables and code", () => {
    const { container } = render(<MarkdownReply text={reply} commands={[]} onInsert={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Why it fails" })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("port");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("sudo lsof -i :80")).toBeInTheDocument();
  });

  it("never renders raw HTML", () => {
    const { container } = render(<MarkdownReply text={reply} commands={[]} onInsert={vi.fn()} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("offers Insert for suggested shell commands, warning about dangerous ones", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    render(
      <MarkdownReply
        text={reply}
        commands={[
          { command: "sudo lsof -i :80", danger: null },
          { command: "sudo rm -rf /var/cache/nginx", danger: "deletes files recursively without asking" },
        ]}
        onInsert={onInsert}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This deletes files recursively without asking.");
    await user.click(screen.getByRole("button", { name: "Insert into terminal: sudo lsof -i :80" }));
    expect(onInsert).toHaveBeenCalledWith("sudo lsof -i :80");
  });

  it("opens links in the browser instead of navigating the app", async () => {
    const user = userEvent.setup();
    render(<MarkdownReply text={reply} commands={[]} onInsert={vi.fn()} />);
    await user.click(screen.getByRole("link", { name: "docs" }));
    expect(openUrl).toHaveBeenCalledWith("https://nginx.org");
  });

  it("wraps long commands instead of scrolling sideways, while Insert keeps the exact command", async () => {
    const long = "docker run --rm -it -v $(pwd):/work -e A=1 -e B=2 --network host ghcr.io/example/some-very-long-image-name:latest bash -lc 'make test'";
    const onInsert = vi.fn();
    const user = userEvent.setup();
    render(<MarkdownReply text={"```sh\n" + long + "\n```"} commands={[{ command: long, danger: null }]} onInsert={onInsert} />);
    const block = screen.getByTestId("code-block");
    expect(block.className).toMatch(/whitespace-pre-wrap/);
    expect(block.className).not.toMatch(/overflow-x-auto/);
    await user.click(screen.getByRole("button", { name: `Insert into terminal: ${long}` }));
    expect(onInsert).toHaveBeenCalledWith(long);
  });
});
