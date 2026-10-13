import { describe, expect, it } from "vitest";

import { toBytes } from "./to-bytes";

describe("toBytes", () => {
  it("passes a Uint8Array through unchanged", () => {
    const bytes = new Uint8Array([1, 2]);
    expect(toBytes(bytes)).toBe(bytes);
  });

  it("wraps an ArrayBuffer from a raw channel", () => {
    expect(Array.from(toBytes(new Uint8Array([104, 105]).buffer))).toEqual([104, 105]);
  });

  it("respects the offset of other typed-array views", () => {
    const view = new DataView(new Uint8Array([0, 7, 8, 0]).buffer, 1, 2);
    expect(Array.from(toBytes(view))).toEqual([7, 8]);
  });

  it("converts a number array from a JSON channel", () => {
    expect(Array.from(toBytes([65, 66]))).toEqual([65, 66]);
  });

  it("rejects anything else", () => {
    expect(() => toBytes("text")).toThrow(TypeError);
    expect(() => toBytes(null)).toThrow(/\[object Null\]/);
  });
});
