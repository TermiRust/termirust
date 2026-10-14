import { ArrowLeft, ArrowRight, FolderTree, Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { commands, type FileEntry, type HostView } from "@/bindings";
import { Button } from "@/components/ui/button";
import { CredentialsPrompt } from "@/features/session/credentials-prompt";
import { HostKeyDialog } from "@/features/session/host-key-dialog";
import { credentialsRequestOf } from "@/features/session/host-prompt";
import { isMacPlatform } from "@/lib/shortcuts";
import type { TabStatus } from "@/stores/tabs-store";
import { useTransfersStore } from "@/stores/transfers-store";

import { ConfirmDialog, NameDialog } from "./file-dialogs";
import { chooseApp } from "./choose-app";
import { FileEditor } from "./file-editor";
import { FilePanel } from "./file-panel";
import { join, localSource, parent, remoteSource, type FileSource } from "./file-source";
import { baseName, pathStyleOf } from "./paths";
import { TransferQueuePanel } from "./transfer-queue-panel";
import { useDirectory } from "./use-directory";
import { useOsFileDrop } from "./use-os-file-drop";
import { useSftpConnection, type SftpConnectionState } from "./use-sftp-connection";

type Side = "local" | "remote";

interface SftpViewProps {
  host: HostView;
  onStatusChange?: (status: TabStatus) => void;
}

const tabStatusOf: Record<SftpConnectionState["phase"], TabStatus> = {
  connecting: "connecting",
  needsPassword: "connecting",
  needsPassphrase: "connecting",
  needsUsername: "connecting",
  hostKeyUnknown: "connecting",
  hostKeyChanged: "connecting",
  connected: "connected",
  cancelled: "disconnected",
  error: "error",
};

type Pending =
  | { kind: "newFolder"; side: Side }
  | { kind: "newFile"; side: Side }
  | { kind: "rename"; side: Side; entry: FileEntry }
  | { kind: "delete"; side: Side; entries: FileEntry[] }
  | { kind: "edit"; side: Side; path: string }
  | { kind: "replace"; from: Side; sources: string[]; conflicts: string[] };

interface Drag {
  from: Side;
  paths: string[];
  x: number;
  y: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

/** Two file panels — this machine on the left, the server on the right — with a transfer queue below. */
export function SftpView({ host, onStatusChange }: SftpViewProps) {
  const connection = useSftpConnection(host);
  const { state } = connection;
  const isMac = useMemo(() => isMacPlatform(), []);
  const sftpId = state.phase === "connected" ? state.sftpId : null;
  const remoteHome = state.phase === "connected" ? state.home : null;

  const [localHome, setLocalHome] = useState<string | null>(null);
  useEffect(() => {
    void commands.localHome().then((r) => r.status === "ok" && setLocalHome(r.data));
  }, []);

  const local = useMemo(() => (localHome === null ? null : localSource(pathStyleOf(localHome))), [localHome]);
  const remote = useMemo(() => (sftpId === null ? null : remoteSource(sftpId)), [sftpId]);

  const [localPathChoice, setLocalPath] = useState<string | null>(null);
  const [remotePathChoice, setRemotePath] = useState<string | null>(null);
  const localPath = localPathChoice ?? localHome;
  const remotePath = remotePathChoice ?? remoteHome;

  const [localRefresh, setLocalRefresh] = useState(0);
  const [remoteRefresh, setRemoteRefresh] = useState(0);
  // A finished transfer refreshes the side it wrote into.
  const [uploadsDone, downloadsDone] = useTransfersStore(
    useShallow((s) => {
      const done = s.items.filter((t) => t.request.sftpId === sftpId && t.event.state === "completed");
      return [done.filter((t) => t.request.direction === "upload").length, done.filter((t) => t.request.direction === "download").length];
    }),
  );
  const localDir = useDirectory(local, localPath, localRefresh + (downloadsDone ?? 0));
  const remoteDir = useDirectory(remote, remotePath, remoteRefresh + (uploadsDone ?? 0));

  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const [remoteSelected, setRemoteSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<Side | null>(null);

  useEffect(() => {
    onStatusChange?.(tabStatusOf[state.phase]);
  }, [state.phase, onStatusChange]);

  const sides = {
    local: { source: local, path: localPath, dir: localDir, selected: localSelected, setSelected: setLocalSelected, setPath: setLocalPath, refresh: () => setLocalRefresh((n) => n + 1) },
    remote: { source: remote, path: remotePath, dir: remoteDir, selected: remoteSelected, setSelected: setRemoteSelected, setPath: setRemotePath, refresh: () => setRemoteRefresh((n) => n + 1) },
  };
  const other = (side: Side): Side => (side === "local" ? "remote" : "local");

  const navigate = (side: Side, path: string) => {
    sides[side].setPath(path);
    sides[side].setSelected([]);
    setActionError(null);
  };

  const startTransfers = (from: Side, sources: string[]) => {
    const target = sides[other(from)];
    const origin = sides[from];
    if (sftpId === null || !target.source || !origin.source || target.path === null) return;
    for (const source of sources) {
      const name = baseName(source, origin.source.sep);
      const destination = join(target.source, target.path, name);
      void useTransfersStore.getState().start(
        from === "local"
          ? { sftpId, direction: "upload", localPath: source, remotePath: destination }
          : { sftpId, direction: "download", localPath: destination, remotePath: source },
        name,
      );
    }
  };

  /** Sends `sources` to the other side, asking first if that would replace anything there. */
  const transfer = (from: Side, sources: string[]) => {
    const origin = sides[from].source;
    if (sources.length === 0 || !origin) return;
    const existing = new Set(sides[other(from)].dir.entries.map((e) => e.name));
    const conflicts = sources.map((s) => baseName(s, origin.sep)).filter((name) => existing.has(name));
    if (conflicts.length > 0) setPending({ kind: "replace", from, sources, conflicts });
    else startTransfers(from, sources);
  };
  const transferRef = useRef(transfer);
  useEffect(() => {
    transferRef.current = transfer;
  });

  const runAction = async (side: Side, action: (source: FileSource) => Promise<void>): Promise<string | null> => {
    const source = sides[side].source;
    if (!source) return "Not connected";
    try {
      await action(source);
      sides[side].refresh();
      setActionError(null);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  // Pointer-based dragging works whether or not the webview intercepts native drag and drop.
  const dragRef = useRef<Drag | null>(null);
  const onRowPointerDown = useCallback(
    (side: Side, selected: string[]) => (event: ReactPointerEvent, entry: FileEntry) => {
      if (event.button !== 0) return;
      const paths = selected.includes(entry.path) ? selected : [entry.path];
      dragRef.current = { from: side, paths, x: event.clientX, y: event.clientY, moved: false };
      const sideAt = (e: PointerEvent): Side | null => {
        const panel = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-side]");
        const value = panel?.dataset.dropSide;
        return value === "local" || value === "remote" ? value : null;
      };
      const onMove = (e: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD) return;
        drag.moved = true;
        const over = sideAt(e);
        setDropSide(over !== null && over !== drag.from ? over : null);
      };
      const onUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = dragRef.current;
        dragRef.current = null;
        setDropSide(null);
        const over = drag?.moved ? sideAt(e) : null;
        if (drag && over !== null && over !== drag.from) transferRef.current(drag.from, drag.paths);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [],
  );

  // Files dropped from Finder / Explorer onto the server panel are uploaded into its folder.
  const onOsDrop = useCallback((paths: string[]) => transferRef.current("local", paths), []);
  useOsFileDrop(sftpId !== null, onOsDrop, setDropSide);

  const openExternal = async (side: Side, entry: FileEntry, choose: boolean) => {
    const source = sides[side].source;
    if (!source) return;
    const app = choose ? await chooseApp() : null;
    if (choose && app === null) return;
    setActionError(null);
    setNotice(side === "remote" ? `Downloading ${entry.name} to open it…` : null);
    try {
      await source.openFile(entry.path, app);
      setNotice(side === "remote" ? `Opened a copy of ${entry.name}; edits there are not sent back to the server.` : null);
    } catch (err) {
      setNotice(null);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const credentials = credentialsRequestOf(state);
  const endpoint = `${host.hostname}:${host.port}`;

  const panel = (side: Side, title: string) => {
    const s = sides[side];
    return (
      <FilePanel
        side={side}
        title={title}
        path={s.path}
        entries={s.dir.entries}
        loading={s.dir.loading}
        error={s.dir.error}
        selected={s.selected}
        dropTarget={dropSide === side}
        isMac={isMac}
        onSelect={s.setSelected}
        onNavigate={(path) => navigate(side, path)}
        onUp={() => s.source && s.path !== null && navigate(side, parent(s.source, s.path))}
        onRefresh={s.refresh}
        onNewFolder={() => setPending({ kind: "newFolder", side })}
        onRename={(entry) => setPending({ kind: "rename", side, entry })}
        onDelete={(entries) => entries.length > 0 && setPending({ kind: "delete", side, entries })}
        onOpenFile={(entry) => transfer(side, [entry.path])}
        onEdit={(entry) => setPending({ kind: "edit", side, path: entry.path })}
        onNewFile={() => setPending({ kind: "newFile", side })}
        onOpenExternal={(entry, choose) => void openExternal(side, entry, choose)}
        onRowPointerDown={onRowPointerDown(side, s.selected)}
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <FolderTree size={14} className="text-fg-muted" />
        <span className="font-medium">{host.label}</span>
        <span className="font-mono text-xs text-fg-muted">SFTP · {endpoint}</span>
        {state.phase === "connecting" && (
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <Loader2 size={12} className="animate-spin" aria-hidden /> Connecting…
          </span>
        )}
        {(state.phase === "error" || state.phase === "cancelled") && (
          <span role="alert" className="flex items-center gap-2 text-xs text-danger">
            {state.phase === "error" ? state.message : "Not connected"}
            <Button size="sm" variant="outline" onClick={connection.reconnect}>
              <RotateCw size={12} /> Reconnect
            </Button>
          </span>
        )}
      </header>

      {notice && !actionError && (
        <p role="status" className="flex items-center border-b border-border bg-bg-sunk px-3 py-1 text-xs text-fg-muted">
          <span className="flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded px-1 hover:bg-hover">
            ×
          </button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="border-b border-border bg-danger-soft px-3 py-1 text-xs text-danger">
          {actionError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {panel("local", "Local")}
        <div className="flex w-10 shrink-0 flex-col items-center justify-center gap-2 border-x border-border bg-bg-sunk">
          <Button
            size="icon"
            variant="outline"
            aria-label="Upload selected"
            title="Upload selected to the server"
            disabled={sftpId === null || localSelected.length === 0}
            onClick={() => transfer("local", localSelected)}
          >
            <ArrowRight size={14} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Download selected"
            title="Download selected to this machine"
            disabled={sftpId === null || remoteSelected.length === 0}
            onClick={() => transfer("remote", remoteSelected)}
          >
            <ArrowLeft size={14} />
          </Button>
        </div>
        <div className="relative flex min-w-0 flex-1">
          {panel("remote", host.label)}
          {state.phase === "connecting" && (
            // Logging in can take seconds (DNS, jump host, slow servers); show it is working.
            <div role="status" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/80 backdrop-blur-[1px]">
              <Loader2 size={26} className="animate-spin text-accent" aria-hidden />
              <span className="text-[13px] font-medium">Connecting to {host.label}…</span>
              <span className="font-mono text-[11px] text-fg-muted">{endpoint}</span>
            </div>
          )}
        </div>
      </div>

      {sftpId !== null && <TransferQueuePanel sftpId={sftpId} />}

      {pending?.kind === "edit" && sides[pending.side].source && (
        <FileEditor
          source={sides[pending.side].source as FileSource}
          path={pending.path}
          where={pending.side === "local" ? "This computer" : host.label}
          onClose={() => setPending(null)}
          onSaved={sides[pending.side].refresh}
        />
      )}
      {pending?.kind === "newFile" && (
        <NameDialog
          title="New file"
          initial=""
          action="Create"
          onClose={() => setPending(null)}
          onSubmit={(name) => runAction(pending.side, (src) => src.createFile(join(src, sides[pending.side].path ?? "", name)))}
        />
      )}
      {pending?.kind === "newFolder" && (
        <NameDialog
          title="New folder"
          initial=""
          action="Create"
          onClose={() => setPending(null)}
          onSubmit={(name) => runAction(pending.side, (src) => src.createDir(join(src, sides[pending.side].path ?? "", name)))}
        />
      )}
      {pending?.kind === "rename" && (
        <NameDialog
          title={`Rename ${pending.entry.name}`}
          initial={pending.entry.name}
          action="Rename"
          onClose={() => setPending(null)}
          onSubmit={(name) =>
            runAction(pending.side, (src) => src.rename(pending.entry.path, join(src, parent(src, pending.entry.path), name)))
          }
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          danger
          title={pending.entries.length === 1 ? `Delete ${pending.entries[0]?.name}?` : `Delete ${pending.entries.length} items?`}
          description={
            pending.side === "remote" ? "This deletes them on the server, including everything inside folders." : "This deletes them from this machine, including everything inside folders."
          }
          items={pending.entries.map((e) => e.name)}
          action="Delete"
          onClose={() => setPending(null)}
          onConfirm={() => {
            const { side, entries } = pending;
            void (async () => {
              for (const entry of entries) {
                const failure = await runAction(side, (src) => src.remove(entry.path));
                if (failure) {
                  setActionError(failure);
                  break;
                }
              }
              sides[side].setSelected([]);
            })();
          }}
        />
      )}
      {pending?.kind === "replace" && (
        <ConfirmDialog
          title={pending.conflicts.length === 1 ? `Replace ${pending.conflicts[0]}?` : `Replace ${pending.conflicts.length} items?`}
          description={`These already exist ${pending.from === "local" ? "on the server" : "on this machine"} and will be overwritten.`}
          items={pending.conflicts}
          action="Replace"
          onClose={() => setPending(null)}
          onConfirm={() => startTransfers(pending.from, pending.sources)}
        />
      )}

      {credentials && (
        <CredentialsPrompt
          key={state.phase}
          hostLabel={host.label}
          endpoint={endpoint}
          request={credentials}
          onSubmit={connection.submitCredentials}
          onCancel={connection.cancel}
        />
      )}
      {(state.phase === "hostKeyUnknown" || state.phase === "hostKeyChanged") && (
        <HostKeyDialog
          endpoint={state.server}
          algorithm={state.algorithm}
          fingerprint={state.fingerprint}
          previousFingerprint={state.phase === "hostKeyChanged" ? state.previousFingerprint : undefined}
          onTrust={(remember) => connection.trustHostKey(state.fingerprint, remember)}
          onCancel={connection.cancel}
        />
      )}
    </div>
  );
}
