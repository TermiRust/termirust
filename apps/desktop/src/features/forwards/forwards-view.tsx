import { Pencil, Play, Plus, Square, Trash2, Waypoints } from "lucide-react";
import { useEffect, useState } from "react";

import type { ForwardRuleView, ForwardState, PromptedLogin } from "@/bindings";
import { Button } from "@/components/ui/button";
import { CredentialsPrompt } from "@/features/session/credentials-prompt";
import { HostKeyDialog } from "@/features/session/host-key-dialog";
import { credentialsRequestOf, hostPromptOf, type HostPrompt } from "@/features/session/host-prompt";
import { ConfirmDialog } from "@/features/sftp/file-dialogs";
import { cn } from "@/lib/utils";
import { useForwardsStore } from "@/stores/forwards-store";
import { useHostsStore } from "@/stores/hosts-store";

import { ForwardRuleDialog } from "./forward-rule-dialog";

/** How often the screen refreshes connection counts and notices dropped tunnels. */
export const STATUS_POLL_MS = 1000;

interface Attempt {
  prompted: PromptedLogin | null;
  confirmedFingerprint: string | null;
  rememberHostKey: boolean;
}

type Prompting = { rule: ForwardRuleView; prompt: HostPrompt; attempt: Attempt };

const kindLabel = { local: "Local", remote: "Remote", dynamic: "SOCKS" } as const;

export function ForwardsView() {
  const { rules, states, loaded, error, load, refreshStatus, start, stop, remove } = useForwardsStore();
  const hosts = useHostsStore((s) => s.hosts);
  const [editing, setEditing] = useState<ForwardRuleView | "new" | null>(null);
  const [deleting, setDeleting] = useState<ForwardRuleView | null>(null);
  const [prompting, setPrompting] = useState<Prompting | null>(null);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, refreshStatus]);

  const run = async (rule: ForwardRuleView, attempt: Attempt) => {
    setPrompting(null);
    const result = await start({ ruleId: rule.id, ...attempt });
    if (result.status === "ok" && result.data.status === "needsInput" && result.data.prompt.status !== "opened") {
      setPrompting({ rule, prompt: hostPromptOf(result.data.prompt), attempt });
    }
  };

  const hostLabel = (id: string) => hosts.find((h) => h.id === id)?.label ?? "Deleted host";
  const prompt = prompting?.prompt;
  const credentials = prompt ? credentialsRequestOf(prompt) : null;
  const hostKey = prompt?.phase === "hostKeyUnknown" || prompt?.phase === "hostKeyChanged" ? prompt : null;

  return (
    <section aria-label="Port forwarding" className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Waypoints size={16} className="text-fg-muted" />
        <h1 className="text-[15px] font-semibold">Port forwarding</h1>
        <span className="text-xs text-fg-muted">Tunnels through your hosts, saved encrypted in the vault</span>
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => setEditing("new")} disabled={hosts.length === 0}>
          <Plus size={14} /> New rule
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {loaded && rules.length === 0 && !error && (
          <div className="mx-auto mt-16 max-w-sm text-center text-fg-muted">
            <p className="text-fg">No port forwards yet</p>
            <p className="mt-1 text-[13px]">
              {hosts.length === 0 ? "Add a host first, then tunnel ports through it." : "Reach a database behind a bastion, share a local dev server, or browse through a SOCKS proxy."}
            </p>
          </div>
        )}
        <ul aria-label="Port forwards" className="grid gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              host={hostLabel(rule.hostId)}
              state={states[rule.id] ?? { state: "stopped" }}
              onStart={() => void run(rule, { prompted: null, confirmedFingerprint: null, rememberHostKey: true })}
              onStop={() => void stop(rule.id)}
              onEdit={() => setEditing(rule)}
              onDelete={() => setDeleting(rule)}
            />
          ))}
        </ul>
      </div>

      {editing && <ForwardRuleDialog rule={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          danger
          title={`Delete ${deleting.label}?`}
          description="A running tunnel is stopped first."
          items={[deleting.summary]}
          action="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => void remove(deleting.id)}
        />
      )}
      {prompting && credentials && (
        <CredentialsPrompt
          key={prompting.prompt.phase}
          hostLabel={hostLabel(prompting.rule.hostId)}
          endpoint={prompting.rule.summary}
          request={credentials}
          onSubmit={(prompted) => void run(prompting.rule, { ...prompting.attempt, prompted })}
          onCancel={() => setPrompting(null)}
        />
      )}
      {prompting && hostKey && (
        <HostKeyDialog
          endpoint={hostKey.server}
          algorithm={hostKey.algorithm}
          fingerprint={hostKey.fingerprint}
          previousFingerprint={hostKey.phase === "hostKeyChanged" ? hostKey.previousFingerprint : undefined}
          onTrust={(remember) => void run(prompting.rule, { ...prompting.attempt, confirmedFingerprint: hostKey.fingerprint, rememberHostKey: remember })}
          onCancel={() => setPrompting(null)}
        />
      )}
    </section>
  );
}

interface RuleRowProps {
  rule: ForwardRuleView;
  host: string;
  state: ForwardState;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RuleRow({ rule, host, state, onStart, onStop, onEdit, onDelete }: RuleRowProps) {
  const running = state.state === "running";
  const busy = state.state === "starting";
  return (
    <li aria-label={rule.label} className="rounded-lg border border-border bg-bg-elev px-3 py-2">
      <div className="flex items-center gap-3">
        <span
          aria-label={`Status: ${state.state}`}
          className={cn("h-2 w-2 shrink-0 rounded-full", {
            "bg-ok": running,
            "animate-pulse bg-accent": busy,
            "bg-danger": state.state === "failed",
            "bg-fg-faint": state.state === "stopped",
          })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{rule.label}</span>
            <span className="rounded border border-border px-1 text-[10px] text-fg-muted uppercase">{kindLabel[rule.spec.kind]}</span>
            {rule.autoStart && <span className="text-[11px] text-fg-muted">auto start</span>}
          </div>
          <div className="truncate font-mono text-xs text-fg-muted">
            {rule.summary} · via {host}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-fg-muted tabular-nums">
          {state.state === "running" && (
            <>
              <div className="font-mono text-fg-2">{state.listeningOn}</div>
              <div>
                {state.active} open · {state.total} total
              </div>
            </>
          )}
          {busy && <div>Connecting…</div>}
        </div>
        {running || busy ? (
          <Button size="sm" variant="outline" onClick={onStop} aria-label={`Stop ${rule.label}`}>
            <Square size={12} /> Stop
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onStart} aria-label={`Start ${rule.label}`}>
            <Play size={12} /> Start
          </Button>
        )}
        <Button size="icon" aria-label={`Edit ${rule.label}`} onClick={onEdit}>
          <Pencil size={13} />
        </Button>
        <Button size="icon" aria-label={`Delete ${rule.label}`} onClick={onDelete}>
          <Trash2 size={13} />
        </Button>
      </div>
      {state.state === "failed" && (
        <p role="alert" className="mt-1 pl-5 text-xs text-danger">
          {state.message}
        </p>
      )}
    </li>
  );
}
