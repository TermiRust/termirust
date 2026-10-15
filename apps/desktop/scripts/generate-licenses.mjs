// Collects the licenses of every Rust crate and npm package shipped in the app into
// public/third-party-licenses.json, shown on the About screen. Run by `pnpm build`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const out = join(appDir, "public", "third-party-licenses.json");
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

const texts = new Map();
function addText(text) {
  const id = createHash("sha256").update(text).digest("hex").slice(0, 16);
  texts.set(id, text);
  return id;
}

/** All license-like files in a package directory, joined; null when there are none. */
function licenseText(dir) {
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  if (files.length === 0) return null;
  return addText(files.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n---\n\n"));
}

function cargoPackages() {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", resolve(appDir, "../../Cargo.toml")], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const meta = JSON.parse(raw);
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const members = new Set(meta.workspace_members);
  const root = meta.packages.find((p) => p.name === "termirust-desktop");
  // Walk normal (shipped) dependencies only; dev and build dependencies are not in the app.
  const seen = new Set();
  const queue = [root.id];
  while (queue.length > 0) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => byId.get(id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      source: "cargo",
      license: p.license ?? (p.license_file ? "See license text" : "Unknown"),
      homepage: p.repository ?? p.homepage ?? null,
      text: licenseText(dirname(p.manifest_path)),
    }));
}

function npmPackages() {
  const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: appDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return Object.values(JSON.parse(raw))
    .flat()
    .flatMap((p) =>
      p.versions.map((version, i) => ({
        name: p.name,
        version,
        source: "npm",
        license: p.license ?? "Unknown",
        homepage: p.homepage ?? null,
        text: licenseText(p.paths[i] ?? p.paths[0]),
      })),
    );
}

const packages = [...cargoPackages(), ...npmPackages()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), packages, texts: Object.fromEntries(texts) }));
const missing = packages.filter((p) => !p.text).length;
console.log(`third-party licenses: ${packages.length} packages, ${texts.size} distinct texts, ${missing} without a license file`);
