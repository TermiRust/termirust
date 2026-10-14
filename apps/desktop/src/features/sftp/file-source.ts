import { commands, type CommandError, type FileEntry } from "@/bindings";

import { joinPath, parentPath, type PathStyle } from "./paths";

/** One side of the SFTP view: this machine or the server. */
export interface FileSource {
  side: "local" | "remote";
  sep: PathStyle;
  list: (path: string) => Promise<FileEntry[]>;
  createDir: (path: string) => Promise<void>;
  /** Creates an empty file; never overwrites. */
  createFile: (path: string) => Promise<void>;
  /** Opens with the default app or `app`; a remote file is downloaded to a temporary copy first. */
  openFile: (path: string, app: string | null) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  /** Whole text file for the built-in editor (refused when binary or over 2 MB). */
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
}

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: CommandError };

async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const result = await call;
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

async function done(call: Promise<Result<null>>): Promise<void> {
  await unwrap(call);
}

export function localSource(sep: PathStyle): FileSource {
  return {
    side: "local",
    sep,
    list: (path) => unwrap(commands.localList(path)),
    createDir: (path) => done(commands.localCreateDir(path)),
    createFile: (path) => done(commands.localCreateFile(path)),
    openFile: (path, app) => done(commands.localOpenFile(path, app)),
    rename: (from, to) => done(commands.localRename(from, to)),
    remove: (path) => done(commands.localRemove(path)),
    readText: (path) => unwrap(commands.localReadText(path)),
    writeText: (path, text) => done(commands.localWriteText(path, text)),
  };
}

export function remoteSource(sftpId: number): FileSource {
  return {
    side: "remote",
    sep: "/",
    list: (path) => unwrap(commands.sftpList(sftpId, path)),
    createDir: (path) => done(commands.sftpCreateDir(sftpId, path)),
    createFile: (path) => done(commands.sftpCreateFile(sftpId, path)),
    openFile: async (path, app) => {
      await unwrap(commands.sftpOpenFile(sftpId, path, app));
    },
    rename: (from, to) => done(commands.sftpRename(sftpId, from, to)),
    remove: (path) => done(commands.sftpRemove(sftpId, path)),
    readText: (path) => unwrap(commands.sftpReadText(sftpId, path)),
    writeText: (path, text) => done(commands.sftpWriteText(sftpId, path, text)),
  };
}

export const join = (source: FileSource, dir: string, name: string) => joinPath(dir, name, source.sep);
export const parent = (source: FileSource, path: string) => parentPath(path, source.sep);
