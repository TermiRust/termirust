import type { HostView } from "@/bindings";
import { HostFormDialog } from "@/features/hosts/host-form-dialog";
import { ImportSshConfigDialog } from "@/features/hosts/import-ssh-config-dialog";
import { useDialogsStore } from "@/stores/dialogs-store";
import { useHostsStore } from "@/stores/hosts-store";

/** Dialogs that must work even while the sidebar is hidden. */
export function AppDialogs({ onConnect }: { onConnect: (host: HostView) => void }) {
  const { hostEditor, closeHostEditor, importConfigOpen, setImportConfigOpen } = useDialogsStore();
  const { createHost, updateHost, deleteHost } = useHostsStore();
  const editing = hostEditor?.mode === "edit" ? hostEditor.host : undefined;

  return (
    <>
      <HostFormDialog
        open={hostEditor !== null}
        host={editing}
        onOpenChange={(open) => !open && closeHostEditor()}
        onSave={(input) => (editing ? updateHost(editing.id, input) : createHost(input))}
        onDelete={editing ? () => deleteHost(editing.id) : undefined}
        onConnect={onConnect}
      />
      <ImportSshConfigDialog open={importConfigOpen} onOpenChange={setImportConfigOpen} />
    </>
  );
}
