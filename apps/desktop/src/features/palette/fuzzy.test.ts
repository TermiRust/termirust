import { describe, expect, it } from "vitest";

import { fuzzyMatch, rankByFuzzy } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches everything for an empty query", () => {
    expect(fuzzyMatch("  ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("matches a case-insensitive subsequence and returns highlight indices", () => {
    expect(fuzzyMatch("PDB", "prod-db")?.indices).toEqual([0, 5, 6]);
  });

  it("rejects text that does not contain the subsequence", () => {
    expect(fuzzyMatch("xyz", "prod-db")).toBeNull();
    expect(fuzzyMatch("dbp", "prod-db")).toBeNull();
  });

  it("ignores spaces in the query", () => {
    expect(fuzzyMatch("prod api", "prod-api-1")).not.toBeNull();
  });

  it("ranks word-start and consecutive matches above scattered ones", () => {
    const ranked = rankByFuzzy(["pandabear", "prod-db", "staging-db"], "pdb", (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe("prod-db");
    expect(ranked).not.toContain("staging-db");
  });

  it("ranks a prefix match first", () => {
    const ranked = rankByFuzzy(["my-staging", "staging"], "stag", (s) => s).map((r) => r.item);
    expect(ranked).toEqual(["staging", "my-staging"]);
  });

  it("prefers shorter text when everything else is equal", () => {
    const ranked = rankByFuzzy(["api-server-long-name", "api-server"], "api", (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe("api-server");
  });
});
