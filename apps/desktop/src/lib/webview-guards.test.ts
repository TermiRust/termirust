import { afterEach, describe, expect, it } from "vitest";

import { installWebviewGuards, isReloadKey } from "./webview-guards";

const rightClick = (target: EventTarget) => {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const press = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("webview guards", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("hides the webview's Reload menu everywhere except editable fields", () => {
    cleanup = installWebviewGuards(window);
    const div = document.body.appendChild(document.createElement("div"));
    const input = document.body.appendChild(document.createElement("input"));
    const textarea = document.body.appendChild(document.createElement("textarea"));
    const xterm = document.body.appendChild(document.createElement("textarea"));
    xterm.className = "xterm-helper-textarea";
    expect(rightClick(div)).toBe(true);
    expect(rightClick(input)).toBe(false);
    expect(rightClick(textarea)).toBe(false);
    expect(rightClick(xterm)).toBe(true);
  });

  it("blocks reload shortcuts in builds but not in development", () => {
    cleanup = installWebviewGuards(window);
    expect(press({ key: "F5" })).toBe(true);
    expect(press({ key: "r", metaKey: true })).toBe(true);
    expect(press({ key: "R", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press({ key: "r" })).toBe(false);
    cleanup();
    cleanup = installWebviewGuards(window, { dev: true });
    expect(press({ key: "F5" })).toBe(false);
  });

  it("recognises reload keys", () => {
    expect([isReloadKey({ key: "F5", metaKey: false, ctrlKey: false }), isReloadKey({ key: "k", metaKey: true, ctrlKey: false })]).toEqual([true, false]);
  });
});
