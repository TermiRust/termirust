// Fictional servers for screenshots; addresses come from private / documentation ranges.
const host = (id: string, label: string, hostname: string, os: string, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  hostname,
  port: 22,
  username: "deploy",
  auth: { method: "identity", identityId: "k1" },
  groupId: null,
  jumpHostId: null,
  tags: [] as string[],
  notes: "",
  keepaliveSecs: null,
  color: null,
  aiDisabled: false,
  os,
  environment: null,
  proxyCommand: null,
  ...extra,
});

export const GROUPS = [
  { id: "g-prod", name: "Production", parentId: null, color: "red", warningBorder: false, aiDisabled: false },
  { id: "g-stg", name: "Staging", parentId: null, color: "amber", warningBorder: false, aiDisabled: false },
  { id: "g-lab", name: "Home lab", parentId: null, color: "teal", warningBorder: false, aiDisabled: false },
];

export const HOSTS = [
  host("h-web1", "web-01", "10.20.1.11", "ubuntu", { groupId: "g-prod", environment: "production", tags: ["nginx", "eu-west"] }),
  host("h-web2", "web-02", "10.20.1.12", "ubuntu", { groupId: "g-prod", environment: "production", tags: ["nginx", "eu-west"] }),
  host("h-db1", "db-01", "10.20.2.21", "debian", { groupId: "g-prod", environment: "production", username: "postgres", tags: ["postgres"] }),
  host("h-cache", "cache-01", "10.20.2.31", "alpine", { groupId: "g-prod", environment: "production", tags: ["redis"] }),
  host("h-api", "api-staging", "10.30.1.10", "rocky", { groupId: "g-stg", environment: "staging", tags: ["docker"] }),
  host("h-ci", "ci-runner", "10.30.1.40", "fedora", { groupId: "g-stg", tags: ["ci"] }),
  host("h-edge", "edge-tunnel", "edge.example.app", "debian", { groupId: "g-lab", proxyCommand: "cloudflared access ssh --hostname %h", tags: ["cloudflare"] }),
  host("h-pi", "raspberry-pi", "192.168.1.50", "raspbian", { groupId: "g-lab", username: "pi" }),
  host("h-nas", "nas", "192.168.1.20", "freebsd", { groupId: "g-lab", username: "admin" }),
];

export const KEYS = [
  { id: "k1", label: "deploy ed25519", keyType: "ssh-ed25519", fingerprint: "SHA256:q8Jm1vXc0yTzP4aR7kLwN2eH6dB9sF3uG5iO1pQ7r0M", publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoKeyForScreenshotsOnly deploy@laptop", encrypted: true, hasSavedPassphrase: true, usedBy: ["web-01", "web-02", "db-01", "cache-01", "api-staging"] },
  { id: "k2", label: "home lab", keyType: "ssh-ed25519", fingerprint: "SHA256:Zx41LmTqB8wE2rY6uI0oP3aS7dF5gH9jK1lZ2xC4vB6", publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHomeLabDemoKey pi@laptop", encrypted: false, hasSavedPassphrase: false, usedBy: ["raspberry-pi", "nas"] },
];

export const SNIPPETS = [
  { id: "s1", name: "Disk usage", command: "df -h /", description: "How full is the root disk", tags: ["ops"] },
  { id: "s2", name: "Tail service logs", command: "journalctl -u {{service}} -f --since '10 min ago'", description: "Follow a systemd unit", tags: ["logs"] },
  { id: "s3", name: "Restart service", command: "sudo systemctl restart {{service}}", description: "", tags: ["ops"] },
];

const kb = (gb: number) => gb * 1024 * 1024;
export function statsFor(hostId: string) {
  const base = {
    load: [0.42, 0.37, 0.31],
    swapTotalKb: kb(2),
    swapFreeKb: kb(1.6),
    diskMount: "/",
  };
  const by: Record<string, Record<string, unknown>> = {
    "h-web1": { osId: "ubuntu", osName: "Ubuntu 24.04.1 LTS", kernel: "Linux 6.8.0-45-generic x86_64", hostname: "web-01", uptimeSecs: 1_843_200, cpuCount: 4, cpuPercent: 37, memTotalKb: kb(8), memAvailableKb: kb(3.1), diskTotalKb: kb(80), diskUsedKb: kb(41), addresses: ["10.20.1.11"], topProcesses: [{ cpuPercent: 21.4, memPercent: 6.2, command: "nginx: worker process" }, { cpuPercent: 9.8, memPercent: 14.1, command: "node /srv/app/server.js" }, { cpuPercent: 1.2, memPercent: 0.4, command: "sshd: deploy" }] },
    "h-db1": { osId: "debian", osName: "Debian GNU/Linux 12 (bookworm)", kernel: "Linux 6.1.0-26-amd64 x86_64", hostname: "db-01", uptimeSecs: 5_356_800, cpuCount: 8, cpuPercent: 64, load: [5.12, 4.88, 4.31], memTotalKb: kb(32), memAvailableKb: kb(5.2), diskTotalKb: kb(500), diskUsedKb: kb(412), addresses: ["10.20.2.21"], topProcesses: [{ cpuPercent: 48.0, memPercent: 61.3, command: "postgres: checkpointer" }, { cpuPercent: 11.5, memPercent: 4.0, command: "postgres: autovacuum worker" }, { cpuPercent: 2.1, memPercent: 1.1, command: "pgbouncer" }] },
    "h-cache": { osId: "alpine", osName: "Alpine Linux v3.20", kernel: "Linux 6.6.41-0-virt x86_64", hostname: "cache-01", uptimeSecs: 302_400, cpuCount: 2, cpuPercent: 12, load: [0.08, 0.11, 0.09], memTotalKb: kb(4), memAvailableKb: kb(2.7), swapTotalKb: 0, swapFreeKb: 0, diskTotalKb: kb(20), diskUsedKb: kb(3.4), addresses: ["10.20.2.31"], topProcesses: [{ cpuPercent: 8.4, memPercent: 28.5, command: "redis-server *:6379" }] },
    "h-api": { osId: "rocky", osName: "Rocky Linux 9.4 (Blue Onyx)", kernel: "Linux 5.14.0-427.el9 x86_64", hostname: "api-staging", uptimeSecs: 86_400 * 3 + 7200, cpuCount: 4, cpuPercent: 92, load: [3.9, 3.4, 2.8], memTotalKb: kb(16), memAvailableKb: kb(1.4), diskTotalKb: kb(100), diskUsedKb: kb(58), addresses: ["10.30.1.10", "172.17.0.1"], topProcesses: [{ cpuPercent: 71.0, memPercent: 22.4, command: "java -jar api.jar" }, { cpuPercent: 12.3, memPercent: 3.1, command: "dockerd" }] },
  };
  return { ...base, osId: null, osName: null, kernel: null, hostname: null, uptimeSecs: null, cpuCount: null, cpuPercent: null, memTotalKb: null, memAvailableKb: null, diskTotalKb: null, diskUsedKb: null, addresses: [], topProcesses: [], ...(by[hostId] ?? by["h-web1"]) };
}

const E = "\x1b";
const g = (s: string) => `${E}[32m${s}${E}[0m`;
const b = (s: string) => `${E}[1;34m${s}${E}[0m`;
const y = (s: string) => `${E}[33m${s}${E}[0m`;
const r = (s: string) => `${E}[31m${s}${E}[0m`;
const dim = (s: string) => `${E}[2m${s}${E}[0m`;
const prompt = (user: string, h: string, dir = "~") => `${g(`${user}@${h}`)}:${b(dir)}$ `;

export const TERMINAL: Record<string, string> = {
  "h-web1": [
    `${dim("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)")}`,
    "",
    `${prompt("deploy", "web-01")}systemctl status nginx --no-pager`,
    `${g("●")} nginx.service - A high performance web server and a reverse proxy server`,
    `     Loaded: loaded (/usr/lib/systemd/system/nginx.service; ${g("enabled")}; preset: enabled)`,
    `     Active: ${g("active (running)")} since Tue 2026-10-13 08:14:02 UTC; 2 days ago`,
    "       Docs: man:nginx(8)",
    "   Main PID: 1123 (nginx)",
    "      Tasks: 5 (limit: 9385)",
    "     Memory: 18.4M (peak: 22.1M)",
    "        CPU: 3min 41.226s",
    "",
    `${prompt("deploy", "web-01")}tail -n 4 /var/log/nginx/access.log`,
    `203.0.113.24 - - [15/Oct/2026:09:12:01] "GET /api/health HTTP/2.0" ${g("200")} 17`,
    `198.51.100.7 - - [15/Oct/2026:09:12:03] "POST /api/orders HTTP/2.0" ${g("201")} 412`,
    `203.0.113.51 - - [15/Oct/2026:09:12:04] "GET /assets/app.js HTTP/2.0" ${g("200")} 81233`,
    `198.51.100.9 - - [15/Oct/2026:09:12:06] "GET /api/orders/42 HTTP/2.0" ${y("404")} 54`,
    `${prompt("deploy", "web-01")}`,
  ].join("\r\n"),
  "h-db1": [
    `${prompt("postgres", "db-01")}df -h / /var/lib/postgresql`,
    "Filesystem      Size  Used Avail Use% Mounted on",
    `/dev/nvme0n1p2  500G  412G   88G  ${y("83%")} /`,
    `/dev/nvme1n1    1.8T  1.1T  700G  ${g("61%")} /var/lib/postgresql`,
    "",
    `${prompt("postgres", "db-01")}uptime`,
    " 09:12:44 up 62 days,  3:01,  2 users,  load average: 5.12, 4.88, 4.31",
    `${prompt("postgres", "db-01")}psql -c "select count(*) from orders where created_at > now() - interval '1 hour';"`,
    " count ",
    "-------",
    "  1834",
    "(1 row)",
    "",
    `${prompt("postgres", "db-01")}`,
  ].join("\r\n"),
  "h-api": [
    `${prompt("deploy", "api-staging")}docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`,
    "NAMES          STATUS                   PORTS",
    `api            ${g("Up 3 hours (healthy)")}     0.0.0.0:8080->8080/tcp`,
    `worker         ${g("Up 3 hours")}               `,
    `redis          ${g("Up 3 days")}                6379/tcp`,
    `migrations     ${r("Exited (1) 2 minutes ago")}`,
    "",
    `${prompt("deploy", "api-staging")}docker logs migrations --tail 3`,
    `${r("ERROR")}  relation "invoices" already exists`,
    `${y("WARN")}   migration 2026_10_14_add_invoices failed, rolled back`,
    `${prompt("deploy", "api-staging")}`,
  ].join("\r\n"),
};

export const AI_CHAT = {
  id: "c-demo",
  hostId: "h-api",
  hostLabel: "api-staging",
  title: "Why did the migrations container exit?",
  messages: [
    { role: "user", text: "Why did the migrations container exit?", quotes: [{ label: "L8–L9", text: 'ERROR  relation "invoices" already exists\nWARN   migration 2026_10_14_add_invoices failed, rolled back' }] },
    {
      role: "assistant",
      text: [
        "The migration tried to **create a table that already exists**, so it failed and the container exited with code 1.",
        "",
        "Most likely the table was created by hand (or by an earlier, half-applied run) but the migration was never recorded.",
        "",
        "1. Check whether the migration is marked as applied:",
        "```sh",
        "docker exec -it api psql -c \"select version from schema_migrations order by version desc limit 3;\"",
        "```",
        "2. If `2026_10_14_add_invoices` is missing but the table is correct, mark it applied instead of re-running it:",
        "```sh",
        "docker run --rm --network host app/migrate mark-applied 2026_10_14_add_invoices",
        "```",
      ].join("\n"),
      quotes: [],
    },
  ],
};

export const LOCAL_FILES: Record<string, { name: string; kind: string; size: number }[]> = {
  "/Users/demo": [
    { name: "Downloads", kind: "directory", size: 0 },
    { name: "projects", kind: "directory", size: 0 },
    { name: "backup-2026-10-14.sql.gz", kind: "file", size: 734_003_200 },
    { name: "nginx.conf", kind: "file", size: 2_481 },
    { name: "notes.md", kind: "file", size: 6_120 },
  ],
};
export const REMOTE_FILES: Record<string, { name: string; kind: string; size: number }[]> = {
  "/home/deploy": [
    { name: ".ssh", kind: "directory", size: 0 },
    { name: "app", kind: "directory", size: 0 },
    { name: "logs", kind: "directory", size: 0 },
    { name: "releases", kind: "directory", size: 0 },
    { name: ".bashrc", kind: "file", size: 3_771 },
    { name: "deploy.sh", kind: "file", size: 1_204 },
    { name: "docker-compose.yml", kind: "file", size: 2_960 },
    { name: "release-v2.14.0.tar.gz", kind: "file", size: 48_211_968 },
  ],
};
