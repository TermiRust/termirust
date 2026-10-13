interface EmptyWorkspaceProps {
  version: string | null;
  sidebarShortcut: string;
}

export function EmptyWorkspace({ version, sidebarShortcut }: EmptyWorkspaceProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Termi<span className="text-accent">rust</span>
      </h1>
      <p className="max-w-sm text-fg-muted">
        No open sessions. Add a host to start your first SSH connection.
      </p>
      <p className="text-xs text-fg-muted">
        Toggle sidebar <kbd className="rounded border border-border px-1 font-mono">{sidebarShortcut}</kbd>
      </p>
      {version && <p className="text-xs text-fg-muted">v{version}</p>}
    </div>
  );
}
