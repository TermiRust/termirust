/** Remote paths are always POSIX; local ones use the separator found in the home path. */
export type PathStyle = "/" | "\\";

export function pathStyleOf(home: string): PathStyle {
  return /^[A-Za-z]:\\/.test(home) || home.startsWith("\\\\") ? "\\" : "/";
}

export function joinPath(dir: string, name: string, sep: PathStyle = "/"): string {
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** The parent directory; a root ("/", "C:\") is its own parent. */
export function parentPath(path: string, sep: PathStyle = "/"): string {
  const trimmed = path.length > 1 && path.endsWith(sep) && !isRoot(path, sep) ? path.slice(0, -1) : path;
  if (isRoot(trimmed, sep)) return trimmed;
  const cut = trimmed.lastIndexOf(sep);
  if (cut < 0) return trimmed;
  const parent = trimmed.slice(0, cut);
  if (sep === "/") return parent || "/";
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent || trimmed;
}

export function baseName(path: string, sep: PathStyle = "/"): string {
  const trimmed = path.endsWith(sep) && !isRoot(path, sep) ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf(sep) + 1) || trimmed;
}

function isRoot(path: string, sep: PathStyle): boolean {
  return sep === "/" ? path === "/" : /^[A-Za-z]:\\?$/.test(path);
}

/** Rejects names that would escape the current directory or be invalid on either side. */
export function validFileName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed === "." || trimmed === "..") return "That name is reserved";
  if (/[/\\]/.test(trimmed)) return "Name cannot contain / or \\";
  return null;
}
