import { create } from "zustand";

import { commands, type CommandError, type GroupView, type HostInput, type HostView } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

interface HostsState {
  hosts: HostView[];
  groups: GroupView[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Re-opens a vault that failed to open (e.g. keychain access was denied), then reloads. */
  retryVault: () => Promise<void>;
  createHost: (input: HostInput) => Promise<Outcome<HostView>>;
  updateHost: (id: string, input: HostInput) => Promise<Outcome<HostView>>;
  deleteHost: (id: string) => Promise<Outcome<null>>;
  createGroup: (name: string) => Promise<Outcome<GroupView>>;
  updateGroup: (id: string, name: string, color: string | null, warningBorder: boolean) => Promise<Outcome<GroupView>>;
  deleteGroup: (id: string) => Promise<Outcome<null>>;
}

export const useHostsStore = create<HostsState>()((set, get) => ({
  hosts: [],
  groups: [],
  loaded: false,
  error: null,

  load: async () => {
    const [hosts, groups] = await Promise.all([commands.hostsList(), commands.groupsList()]);
    if (hosts.status === "error") return set({ error: hosts.error.message, loaded: true });
    if (groups.status === "error") return set({ error: groups.error.message, loaded: true });
    set({ hosts: hosts.data, groups: groups.data, loaded: true, error: null });
  },

  retryVault: async () => {
    set({ error: null, loaded: false });
    const result = await commands.vaultRetryOpen();
    if (result.status === "error") set({ error: result.error.message, loaded: true });
    else await get().load();
  },

  createHost: async (input) => {
    const result = await commands.hostsCreate(input);
    if (result.status === "ok") set({ hosts: [...get().hosts, result.data] });
    return result;
  },

  updateHost: async (id, input) => {
    const result = await commands.hostsUpdate(id, input);
    if (result.status === "ok") {
      set({ hosts: get().hosts.map((h) => (h.id === id ? result.data : h)) });
    }
    return result;
  },

  deleteHost: async (id) => {
    const result = await commands.hostsDelete(id);
    if (result.status === "ok") set({ hosts: get().hosts.filter((h) => h.id !== id) });
    return result;
  },

  createGroup: async (name) => {
    const result = await commands.groupsCreate(name, null);
    if (result.status === "ok") set({ groups: [...get().groups, result.data] });
    return result;
  },

  updateGroup: async (id, name, color, warningBorder) => {
    const result = await commands.groupsUpdate(id, name, color, warningBorder);
    if (result.status === "ok") set({ groups: get().groups.map((g) => (g.id === id ? result.data : g)) });
    return result;
  },

  /** Hosts in a deleted group become ungrouped, so the host list is reloaded too. */
  deleteGroup: async (id) => {
    const result = await commands.groupsDelete(id);
    if (result.status === "ok") await get().load();
    return result;
  },
}));
