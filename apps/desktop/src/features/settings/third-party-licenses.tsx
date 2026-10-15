import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface LicensedPackage {
  name: string;
  version: string;
  source: "cargo" | "npm";
  license: string;
  homepage: string | null;
  text: string | null;
}

interface LicenseFile {
  generatedAt: string;
  packages: LicensedPackage[];
  texts: Record<string, string>;
}

type Load = { phase: "loading" } | { phase: "missing" } | { phase: "ready"; data: LicenseFile };

/** Every Rust crate and npm package shipped in the app, with its license text. */
export function ThirdPartyLicenses({ onClose, url = "/third-party-licenses.json" }: { onClose: () => void; url?: string }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<LicenseFile>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => live && setLoad({ phase: "ready", data }))
      // Development builds skip the generator; the list exists in release builds.
      .catch(() => live && setLoad({ phase: "missing" }));
    return () => {
      live = false;
    };
  }, [url]);

  const shown = useMemo(() => {
    if (load.phase !== "ready") return [];
    const q = query.trim().toLowerCase();
    return load.data.packages.filter((p) => !q || p.name.toLowerCase().includes(q) || p.license.toLowerCase().includes(q));
  }, [load, query]);

  return (
    <Dialog open width="lg" onOpenChange={(o) => !o && onClose()} title="Third-party licenses" description="Open-source software included in Termirust">
      {load.phase === "loading" && <p className="py-8 text-center text-[13px] text-fg-muted">Loading…</p>}
      {load.phase === "missing" && (
        <p className="py-8 text-center text-[13px] text-fg-muted">The license list is generated for release builds (pnpm build).</p>
      )}
      {load.phase === "ready" && (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" />
            <Input
              type="search"
              aria-label="Find a package"
              placeholder={`Find among ${load.data.packages.length} packages…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <ul aria-label="Packages" className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
            {shown.map((p) => {
              const key = `${p.source}:${p.name}@${p.version}`;
              const expanded = open === key;
              return (
                <li key={key} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : key)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {p.name} <span className="text-fg-muted">{p.version}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-muted">{p.license}</span>
                    <span className="w-10 shrink-0 text-right text-[10px] text-fg-faint uppercase">{p.source}</span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border bg-bg-sunk px-3 py-2">
                      {p.homepage && <p className="mb-1 truncate font-mono text-[11px] text-fg-muted">{p.homepage}</p>}
                      <pre className="max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-fg-2">
                        {(p.text && load.data.texts[p.text]) ?? `Licensed under ${p.license}. No license file was shipped with this package.`}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-3 py-4 text-center text-[12px] text-fg-muted">No package matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
