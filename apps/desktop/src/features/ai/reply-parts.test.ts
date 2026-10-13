import { describe, expect, it } from "vitest";

import { splitReply } from "./reply-parts";

describe("splitReply", () => {
  it("separates prose from shell and other code blocks", () => {
    const reply = "Port 8080 is taken.\n\n```sh\nlsof -i :8080\n```\nThen stop it.\n```json\n{\"a\":1}\n```";
    expect(splitReply(reply)).toEqual([
      { kind: "text", text: "Port 8080 is taken." },
      { kind: "code", code: "lsof -i :8080", shell: true },
      { kind: "text", text: "Then stop it." },
      { kind: "code", code: "{\"a\":1}", shell: false },
    ]);
  });

  it("treats an unfinished block as code while streaming", () => {
    expect(splitReply("Try:\n```bash\nsystemctl status ng")).toEqual([
      { kind: "text", text: "Try:" },
      { kind: "code", code: "systemctl status ng", shell: true },
    ]);
  });

  it("drops empty blocks and blank text", () => {
    expect(splitReply("```\n```\n\n")).toEqual([]);
    expect(splitReply("Just text")).toEqual([{ kind: "text", text: "Just text" }]);
  });
});
