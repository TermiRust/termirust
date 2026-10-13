import { create } from "zustand";

import { commands, type CommandError, type KeyView } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

export interface KeyImport {
  label: string;
  passphrase: string | null;
  rememberPassphrase: boolean;
}

interface KeysState {
  keys: KeyView[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  importText: (privateKey: string, options: KeyImport) => Promise<Outcome<KeyView>>;
  importFile: (path: string, options: KeyImport) => Promise<Outcome<KeyView>>;
  generate: (label: string) => Promise<Outcome<KeyView>>;
  remove: (id: string) => Promise<Outcome<null>>;
}

export const useKeysStore = create<KeysState>()((set, get) => {
  const added = (result: Outcome<KeyView>) => {
    if (result.status === "ok") set({ keys: [...get().keys, result.data] });
    return result;
  };

  return {
    keys: [],
    loaded: false,
    error: null,

    load: async () => {
      const result = await commands.keysList();
      if (result.status === "error") set({ error: result.error.message, loaded: true });
      else set({ keys: result.data, loaded: true, error: null });
    },

    importText: async (privateKey, o) =>
      added(await commands.keysImport(o.label, privateKey, o.passphrase, o.rememberPassphrase)),
    importFile: async (path, o) => added(await commands.keysImportFile(o.label, path, o.passphrase, o.rememberPassphrase)),
    generate: async (label) => added(await commands.keysGenerate(label)),

    remove: async (id) => {
      const result = await commands.keysDelete(id);
      if (result.status === "ok") set({ keys: get().keys.filter((k) => k.id !== id) });
      return result;
    },
  };
});
