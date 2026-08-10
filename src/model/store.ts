import * as nodeFs from 'node:fs';
import { StoreFileSchema, emptyStore, type StoreFile, type TerminalEntry, type Workspace } from './schema';

export interface StoreFs {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
}

export interface LoadResult { store: StoreFile; recoveredFrom: string | null; }

export function loadStore(fs: StoreFs, filePath: string, epoch: () => number): LoadResult {
  const raw = fs.readFile(filePath);
  if (raw === null) return { store: emptyStore(), recoveredFrom: null };
  try {
    return { store: StoreFileSchema.parse(JSON.parse(raw)), recoveredFrom: null };
  } catch {
    const backup = `${filePath}.bak-${epoch()}`;
    fs.rename(filePath, backup);
    return { store: emptyStore(), recoveredFrom: backup };
  }
}

export function saveStore(fs: StoreFs, filePath: string, store: StoreFile): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFile(tmp, JSON.stringify(store, null, 2));
  fs.rename(tmp, filePath);
}

export function createWorkspace(store: StoreFile, name: string, id: string): Workspace {
  const lower = name.toLowerCase();
  if (store.workspaces.some((w) => w.name.toLowerCase() === lower)) {
    throw new Error(`Tên workspace "${name}" đã tồn tại.`);
  }
  const ws: Workspace = { id, name, lastActiveAt: null, activeWindowId: null, terminals: [] };
  store.workspaces.push(ws);
  return ws;
}

export function findWorkspace(store: StoreFile, id: string): Workspace | undefined {
  return store.workspaces.find((w) => w.id === id);
}

export function upsertTerminal(ws: Workspace, entry: TerminalEntry): void {
  const i = ws.terminals.findIndex((t) => t.id === entry.id);
  if (i >= 0) ws.terminals[i] = entry;
  else ws.terminals.push(entry);
}

export function removeTerminal(ws: Workspace, terminalId: string): void {
  const i = ws.terminals.findIndex((t) => t.id === terminalId);
  if (i >= 0) ws.terminals.splice(i, 1);
}

export const realStoreFs: StoreFs = {
  readFile(p) {
    try {
      return nodeFs.readFileSync(p, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  },
  writeFile(p, c) { nodeFs.writeFileSync(p, c, 'utf8'); },
  rename(a, b) { nodeFs.renameSync(a, b); },
};
