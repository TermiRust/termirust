import { useEffect, useState } from "react";

import type { FileEntry } from "@/bindings";

import type { FileSource } from "./file-source";

type Listing = { path: string; version: number } & ({ entries: FileEntry[]; error: null } | { entries: null; error: string });

/** Lists `path`, again whenever `version` changes; stale answers for an older path are dropped. */
export function useDirectory(source: FileSource | null, path: string | null, version: number) {
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    if (!source || path === null) return;
    let current = true;
    source.list(path).then(
      (entries) => current && setListing({ path, version, entries, error: null }),
      (e: unknown) => current && setListing({ path, version, entries: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      current = false;
    };
  }, [source, path, version]);

  const fresh = listing !== null && listing.path === path && listing.version === version;
  return {
    entries: listing?.path === path ? (listing.entries ?? []) : [],
    error: listing?.path === path ? listing.error : null,
    loading: !fresh,
  };
}
