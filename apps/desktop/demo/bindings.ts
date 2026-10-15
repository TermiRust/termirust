// Demo backend: answers every command with fictional data so the real UI can be shown and
// screenshotted in a browser. Selected with `vite --mode demo`; `?scene=connect` keeps one
// login waiting so the step display can be captured.
import { AI_CHAT, GROUPS, HOSTS, KEYS, LOCAL_FILES, REMOTE_FILES, SNIPPETS, TERMINAL, statsFor } from "./data";

type Sink = { onmessage: (message: unknown) => void } | undefined;
type Handler = (...args: unknown[]) => unknown;

const ok = (data: unknown) => ({ status: "ok", data });
const scene = new URLSearchParams(location.search).get("scene") ?? "";
const bytes = (text: string) => Array.from(new TextEncoder().encode(text));
const later = (ms: number, run: () => void) => setTimeout(run, ms);
let nextId = 1;

const files = (tree: typeof LOCAL_FILES, dir: string) =>
  (tree[dir] ?? []).map((f, i) => ({
    name: f.name,
    path: `${dir.replace(/\/$/, "")}/${f.name}`,
    kind: f.kind,
    size: f.size,
    modified: 1_792_036_000 - i * 86_400 * 3,
    permissions: f.kind === "directory" ? 0o755 : 0o644,
  }));

const handlers: Record<string, Handler> = {
  appVersion: () => "0.1.0",
  onboardingNeeded: () => scene === "onboarding",
  commandDanger: () => null,
  // "clean" scenes drop the PROD/STAGING watermark so the terminal itself is in focus.
  hostsList: () => ok(scene === "clean" ? HOSTS.map((h) => ({ ...h, environment: null })) : HOSTS),
  groupsList: () => ok(GROUPS),
  keysList: () => ok(KEYS),
  snippetsList: () => ok(SNIPPETS),
  forwardsList: () => ok([]),
  forwardsAutoStart: () => ok([]),
  settingsTerminalGet: () => ok({ appTheme: "dark", theme: "match-app", fontSize: 13 }),
  settingsTerminalSet: (s) => ok(s),
  aiSettingsGet: () => ok({ enabled: true, kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", hasApiKey: true }),
  aiChatsList: (hostId) =>
    ok(hostId === AI_CHAT.hostId ? [{ id: AI_CHAT.id, hostId: AI_CHAT.hostId, hostLabel: AI_CHAT.hostLabel, title: AI_CHAT.title, updatedAt: Date.now() - 600_000, messageCount: 2 }] : []),
  aiChatGet: () => ok(AI_CHAT),
  monitorProbe: (request) => {
    const { hostId } = request as { hostId: string };
    return new Promise((resolve) => later(250, () => resolve(ok({ status: "stats", stats: statsFor(hostId) }))));
  },
  localHome: () => ok("/Users/demo"),
  localList: (path) => ok(files(LOCAL_FILES, path as string)),
  sftpOpen: () => new Promise((resolve) => later(300, () => resolve(ok({ status: "opened", sftpId: 1, home: "/home/deploy" })))),
  sftpList: (_id, path) => ok(files(REMOTE_FILES, path as string)),
  sessionOpenHost: (request, onOutput, _onClosed, onProgress) => {
    const { hostId } = request as { hostId: string };
    const target = HOSTS.find((h) => h.id === hostId) ?? HOSTS[0];
    const progress = onProgress as Sink;
    const emit = (p: unknown) => progress?.onmessage(p);
    emit({ kind: "started", host: target.hostname, port: 22, via: target.proxyCommand ? "proxy" : "direct" });
    emit({ kind: "reached", host: target.hostname });
    emit({ kind: "serverIdentity", host: target.hostname, algorithm: "ssh-ed25519", fingerprint: "SHA256:6vR2mQ9xT1bN4cK8pL0sD3fG7hJ5wE2yU9iO4aZ1nM8" });
    emit({ kind: "authenticating", host: target.hostname, user: target.username, method: "key", keyFingerprint: KEYS[0].fingerprint });
    // The step display stays on "Log in" for the connect scene.
    if (scene === "connect") return new Promise(() => {});
    emit({ kind: "authenticated", host: target.hostname, user: target.username });
    emit({ kind: "openingShell" });
    const output = onOutput as Sink;
    later(200, () => output?.onmessage(bytes(TERMINAL[hostId] ?? TERMINAL["h-web1"])));
    return Promise.resolve(ok({ status: "opened", sessionId: nextId++ }));
  },
};

export const commands = new Proxy({} as Record<string, Handler>, {
  get: (_target, name: string) => async (...args: unknown[]) => (name in handlers ? handlers[name](...args) : ok(null)),
});
