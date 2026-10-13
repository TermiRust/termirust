import { create } from "zustand";

import { commands, type CommandError, type GroupView, type HostInput, type HostView } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

interface HostsState {
  hosts: HostView[];
  groups: GroupView[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  createHost: (input: HostInput) => Promise<Outcome<HostView>>;
  updateHost: (id: string, input: HostInput) => Promise<Outcome<HostView>>;
  deleteHost: (id: string) => Promise<Outcome<null>>;
  createGroup: (name: string) => Promise<Outcome<GroupView>>;
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
}));
