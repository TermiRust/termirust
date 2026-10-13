import { describe, expect, it } from "vitest";

import type { FileEntry } from "@/bindings";

import { sortEntries, toggleSort } from "./sort";

const e = (name: string, kind: FileEntry["kind"], size: number, modified: number | null): FileEntry => ({
  name,
  path: `/${name}`,
  kind,
  size,
  modified,
  permissions: null,
});
const entries = [e("b.txt", "file", 30, 3), e("logs", "directory", 0, 1), e("A.txt", "file", 10, null), e("file10", "file", 20, 2), e("file9", "file", 20, 2)];
const names = (list: FileEntry[]) => list.map((x) => x.name);

describe("sortEntries", () => {
  it("sorts by name with folders first, ignoring case and ordering numbers naturally", () => {
    expect(names(sortEntries(entries, { key: "name", ascending: true }))).toEqual(["logs", "A.txt", "b.txt", "file9", "file10"]);
    expect(names(sortEntries(entries, { key: "name", ascending: false }))).toEqual(["logs", "file10", "file9", "b.txt", "A.txt"]);
  });

  it("sorts by size and by date, keeping folders on top", () => {
    expect(names(sortEntries(entries, { key: "size", ascending: false }))).toEqual(["logs", "b.txt", "file10", "file9", "A.txt"]);
    expect(names(sortEntries(entries, { key: "modified", ascending: true }))).toEqual(["logs", "A.txt", "file9", "file10", "b.txt"]);
  });

  it("does not mutate its input", () => {
    const copy = [...entries];
    sortEntries(entries, { key: "size", ascending: true });
    expect(entries).toEqual(copy);
  });
});

describe("toggleSort", () => {
  it("flips the active column and starts others ascending", () => {
    expect(toggleSort({ key: "name", ascending: true }, "name")).toEqual({ key: "name", ascending: false });
    expect(toggleSort({ key: "name", ascending: false }, "size")).toEqual({ key: "size", ascending: true });
  });
});
