import { create } from "zustand";

import { commands, type CommandError, type ForwardRuleInput, type ForwardRuleView, type ForwardState, type StartForwardRequest } from "@/bindings";

type Outcome<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

interface ForwardsState {
  rules: ForwardRuleView[];
  states: Record<string, ForwardState>;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  create: (input: ForwardRuleInput) => Promise<Outcome<ForwardRuleView>>;
  update: (id: string, input: ForwardRuleInput) => Promise<Outcome<ForwardRuleView>>;
  remove: (id: string) => Promise<Outcome<null>>;
  start: (request: StartForwardRequest) => ReturnType<typeof commands.forwardsStart>;
  stop: (ruleId: string) => Promise<void>;
  /** Called when a terminal tab to `hostId` connects. */
  autoStart: (hostId: string) => Promise<void>;
}

export const useForwardsStore = create<ForwardsState>()((set, get) => {
  const setState = (ruleId: string, state: ForwardState) => set((s) => ({ states: { ...s.states, [ruleId]: state } }));

  return {
    rules: [],
    states: {},
    loaded: false,
    error: null,

    load: async () => {
      const result = await commands.forwardsList();
      if (result.status === "error") set({ error: result.error.message, loaded: true });
      else set({ rules: result.data, loaded: true, error: null });
      await get().refreshStatus();
    },

    refreshStatus: async () => {
      const result = await commands.forwardsStatus();
      if (result.status === "ok") set({ states: Object.fromEntries(result.data.map((s) => [s.ruleId, s.state])) });
    },

    create: async (input) => {
      const result = await commands.forwardsCreate(input);
      if (result.status === "ok") set((s) => ({ rules: [...s.rules, result.data] }));
      return result;
    },

    update: async (id, input) => {
      const result = await commands.forwardsUpdate(id, input);
      if (result.status === "ok") {
        set((s) => ({ rules: s.rules.map((r) => (r.id === id ? result.data : r)) }));
        setState(id, { state: "stopped" });
      }
      return result;
    },

    remove: async (id) => {
      const result = await commands.forwardsDelete(id);
      if (result.status === "ok") {
        set((s) => ({
          rules: s.rules.filter((r) => r.id !== id),
          states: Object.fromEntries(Object.entries(s.states).filter(([ruleId]) => ruleId !== id)),
        }));
      }
      return result;
    },

    start: async (request) => {
      setState(request.ruleId, { state: "starting" });
      const result = await commands.forwardsStart(request);
      if (result.status === "error") setState(request.ruleId, { state: "failed", message: result.error.message });
      else if (result.data.status === "started") setState(request.ruleId, result.data.state);
      else setState(request.ruleId, { state: "stopped" });
      return result;
    },

    stop: async (ruleId) => {
      await commands.forwardsStop(ruleId);
      setState(ruleId, { state: "stopped" });
    },

    autoStart: async (hostId) => {
      if (!get().rules.some((r) => r.hostId === hostId && r.autoStart) && get().loaded) return;
      const result = await commands.forwardsAutoStart(hostId);
      if (result.status === "ok") {
        set((s) => ({ states: { ...s.states, ...Object.fromEntries(result.data.map((st) => [st.ruleId, st.state])) } }));
      }
    },
  };
});
