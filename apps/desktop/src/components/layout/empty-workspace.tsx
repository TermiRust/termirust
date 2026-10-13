import { FileInput, FlaskConical, Lock, Plus, SquareTerminal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { commands } from "@/bindings";
import { Kbd } from "@/components/ui/kbd";

interface EmptyWorkspaceProps {
  version: string | null;
  shortcuts: { palette: string; newHost: string; newLocal: string; sidebar: string };
  onNewHost: () => void;
  onImportConfig: () => void;
  onOpenLocal: () => void;
  /** Developer-only entry to the connection lab. */
  onOpenConnectionLab?: () => void;
}

function ActionCard({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-56 flex-col items-start gap-2 rounded-xl border border-border bg-bg-elev p-4 text-left transition-colors hover:border-accent hover:bg-hover"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
      <span className="text-[14px] font-medium">{title}</span>
      <span className="text-xs text-fg-muted">{detail}</span>
    </button>
  );
}

/** Shown when no tab is open — on first launch and after closing every tab. */
export function EmptyWorkspace({ version, shortcuts, onNewHost, onImportConfig, onOpenLocal, onOpenConnectionLab }: EmptyWorkspaceProps) {
  const [configHosts, setConfigHosts] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    commands
      .sshConfigPreview(null)
      .then((r) => {
        if (!cancelled && r.status === "ok") setConfigHosts(r.data.candidates.filter((c) => !c.alreadySaved).length);
      })
      .catch(() => {
        // No backend (browser preview) or no config: the card keeps its generic text.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importDetail =
    configHosts === null ? "Bring hosts and keys from ~/.ssh/config" : configHosts === 0 ? "Nothing new found in ~/.ssh/config" : `Found ${configHosts} host${configHosts === 1 ? "" : "s"} you can bring over`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Termi<span className="text-accent">rust</span>
        </h1>
        <p className="mt-1 text-[13px] text-fg-muted">No account needed. Start by adding a server.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <ActionCard icon={<Plus size={16} />} title="New host" detail="Save a server's address and login" onClick={onNewHost} />
        <ActionCard icon={<FileInput size={16} />} title="Import ~/.ssh/config" detail={importDetail} onClick={onImportConfig} />
        <ActionCard icon={<SquareTerminal size={16} />} title="Open local terminal" detail="A shell on this machine" onClick={onOpenLocal} />
      </div>
      <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
        <dt className="text-right">Search hosts and commands</dt>
        <dd className="text-left">
          <Kbd>{shortcuts.palette}</Kbd>
        </dd>
        <dt className="text-right">New host</dt>
        <dd className="text-left">
          <Kbd>{shortcuts.newHost}</Kbd>
        </dd>
        <dt className="text-right">Local terminal</dt>
        <dd className="text-left">
          <Kbd>{shortcuts.newLocal}</Kbd>
        </dd>
        <dt className="text-right">Toggle sidebar</dt>
        <dd className="text-left">
          <Kbd>{shortcuts.sidebar}</Kbd>
        </dd>
      </dl>
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Lock size={12} /> Hosts, keys and passwords are encrypted on this device. Nothing leaves it.
      </p>
      <p className="flex items-center gap-3 text-[11px] text-fg-faint">
        {version && <span>v{version}</span>}
        {onOpenConnectionLab && (
          <button type="button" onClick={onOpenConnectionLab} className="flex items-center gap-1 hover:text-fg-muted">
            <FlaskConical size={11} /> Connection lab
          </button>
        )}
      </p>
    </div>
  );
}
