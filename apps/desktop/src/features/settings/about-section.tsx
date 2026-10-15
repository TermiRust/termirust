import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { versionLabel } from "@/lib/build-info";
import { PROJECT } from "@/lib/project";
import { useAppVersion } from "@/lib/use-app-version";
import { useUpdateStore } from "@/stores/update-store";

import { ThirdPartyLicenses } from "./third-party-licenses";

function Link({ href, children }: { href: string; children: string }) {
  return (
    <button type="button" onClick={() => void openUrl(href)} className="inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
      {children} <ExternalLink size={11} aria-hidden />
    </button>
  );
}

function UpdateStatus() {
  const { phase, available, error, lastChecked } = useUpdateStore();
  if (phase === "checking") return <span className="text-fg-muted">Checking…</span>;
  if (phase === "error") return <span className="text-danger">Could not check: {error}</span>;
  if (available) return <span className="font-medium text-accent">Version {available.version} is available</span>;
  if (phase === "upToDate")
    return (
      <span className="flex items-center gap-1 text-fg-muted">
        <CheckCircle2 size={12} className="text-ok" /> Up to date
      </span>
    );
  return lastChecked ? null : <span className="text-fg-muted">Not checked yet</span>;
}

/** Version, updates and the legal notices the AGPL asks an interactive program to show. */
export function AboutSection() {
  const version = useAppVersion();
  const { phase, available, autoCheck, check, install, setAutoCheck } = useUpdateStore();
  const [licensesOpen, setLicensesOpen] = useState(false);
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <section aria-labelledby="about-title" className="border-t border-border pt-4 lg:col-span-2">
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-64 flex-1">
          <h2 id="about-title" className="text-[14px] font-semibold">
            About {PROJECT.name}
          </h2>
          <p className="mt-0.5 font-mono text-[12px] text-fg-2">{versionLabel(version) ?? "—"}</p>
          <p className="mt-2 max-w-xl text-[12px] leading-5 text-fg-muted">
            {PROJECT.copyright}. {PROJECT.name} is free software: you can redistribute it and/or modify it under the terms of the {PROJECT.license}. It
            comes with ABSOLUTELY NO WARRANTY. The source code is available at the link below.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <Link href={PROJECT.repoUrl}>Source code</Link>
            <Link href={PROJECT.licenseUrl}>License (AGPL-3.0)</Link>
            <button type="button" onClick={() => setLicensesOpen(true)} className="text-[12.5px] text-accent hover:underline">
              Third-party licenses
            </button>
            <Link href={PROJECT.issuesUrl}>Report a problem</Link>
            <Link href={PROJECT.privacyUrl}>Privacy</Link>
            <Link href={PROJECT.trademarksUrl}>Trademarks</Link>
          </div>
        </div>
        <div className="flex min-w-64 flex-col gap-2">
          <p className="text-[13px] font-medium">Updates</p>
          <div className="flex items-center gap-2 text-[12px]">
            <UpdateStatus />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void check()} disabled={busy}>
              {phase === "checking" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check for updates
            </Button>
            {available && (
              <Button size="sm" variant="primary" onClick={() => void install()} disabled={busy}>
                Install {available.version} & restart
              </Button>
            )}
          </div>
          <Checkbox
            label="Check for updates automatically"
            description="Asks GitHub for the latest release at start-up; nothing else is sent."
            checked={autoCheck}
            onChange={(e) => setAutoCheck(e.target.checked)}
          />
        </div>
      </div>
      {licensesOpen && <ThirdPartyLicenses onClose={() => setLicensesOpen(false)} />}
    </section>
  );
}
